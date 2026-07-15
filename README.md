# Protocol Radar

Provenance-tracked observation of agent-protocol releases, folded into an HMAC
hash-chain ledger and served from a read-only snapshot on Vercel.

## Live observation → snapshot (残② 実観測の運用)

Vercel serves the DB **read-only** (`PROTOCOL_RADAR_DB_READONLY=1` / `VERCEL=1`,
`DATABASE_PATH=./data/snapshot.db`), so observations cannot be written in production.
The always-on path runs observation on a **writable host** against the canonical
`./data/protocol-radar.db`, then regenerates the snapshot that production reads.

One command does both:

```bash
pnpm observe:refresh
```

which is equivalent to:

```bash
pnpm observe:once   # writable GitHub Releases observation + ledger self-check
pnpm snapshot       # regenerate ./data/snapshot.db from the canonical DB
```

### What each script does

| Script | Command | Purpose |
| --- | --- | --- |
| `observe:once` | `tsx --env-file-if-exists=.env.local src/worker/observeReleasesOnce.ts` | Poll every configured GitHub Releases feed once (`src/config/sources/releases.ts`), fold new events into the HMAC ledger, then self-check with `verifyFromRaw()`. Exits non-zero if the ledger fails to verify. |
| `snapshot` | `node scripts/make-snapshot.mjs` | Checkpoint the WAL back into `./data/protocol-radar.db` and copy it to `./data/snapshot.db` (the file Vercel bundles). |
| `observe:refresh` | `pnpm observe:once && pnpm snapshot` | The full writable-observe → snapshot cycle in one step. |
| `observe:releases` | `tsx src/worker/observeReleasesOnce.ts` | Same observation, **without** auto-loading `.env.local` (for hosts that inject env another way). |

### Writable-mode requirements

`observe:once` writes to the canonical DB, so it must run in **writable mode**:

- `PROTOCOL_RADAR_DB_READONLY` **unset** (and not on Vercel, i.e. `VERCEL` unset) —
  otherwise the connection opens read-only.
- `PROTOCOL_RADAR_HMAC_SECRET` set — the ledger key; the run refuses to start without it.
  `observe:once` loads it from `.env.local` via Node's `--env-file-if-exists`.
- `DATABASE_PATH` defaults to `./data/protocol-radar.db` (the writable canonical DB).

Copy `.env.example` to `.env.local` and set a fixed local secret:

```
PROTOCOL_RADAR_HMAC_SECRET=<your-local-secret>
DATABASE_PATH=./data/protocol-radar.db
```

### GitHub API notes

The releases endpoint is the public, unauthenticated GitHub REST API (60 req/hour per IP).
Observing the four configured repos costs 4 requests. If you hit the rate limit or need a
higher ceiling, set `GITHUB_TOKEN` in the environment — the fetch layer raises the limit
when it is present. No token is required for normal operation.

### Automated observe loop (schedule → snapshot commit → Vercel auto-redeploy)

The observe → snapshot → commit → redeploy loop is **automated** by
`.github/workflows/observe.yml`. It runs **every 6 hours** (`cron: "0 */6 * * *"`, UTC) and
can also be triggered manually via **workflow_dispatch**. Each run:

1. Checks out the repo, sets up Node 22 + pnpm, and runs `pnpm install` (building the native
   `better-sqlite3`).
2. Restores the canonical DB by copying the committed `data/snapshot.db` to
   `data/protocol-radar.db`, so the ledger hash-chain continues from the last published
   state. (The canonical DB is git-ignored; only the snapshot is committed.)
3. Runs `pnpm observe:refresh` in **writable mode** (`PROTOCOL_RADAR_DB_READONLY` and `VERCEL`
   stay unset) — this is `observe:once` (writable observation + ledger self-check) followed by
   `snapshot` (regenerate `data/snapshot.db`).
4. Commits `data/snapshot.db` **only if it changed** (idempotent — a quiet run creates no
   empty commit; the commit message carries `[skip ci]` so the snapshot push does not
   retrigger CI) under the `github-actions[bot]` identity, then pushes.

Vercel's git integration auto-deploys on that snapshot push, so production serves the new
observations without any manual step.

**Operator setup (human-only):** add a repository secret `PROTOCOL_RADAR_HMAC_SECRET`
(Settings → Secrets and variables → Actions) with the **same value** as your local
`.env.local` — the ledger key must match for `verifyFromRaw()` to succeed. `GITHUB_TOKEN` is
provided automatically by Actions and is used only to raise the releases API rate limit.

A concurrency group (`observe-loop`, `cancel-in-progress: false`) ensures runs never overlap,
which would otherwise corrupt the hash-chain ledger.

You can still run the cycle manually on any writable host with `pnpm observe:refresh`, then
commit the regenerated `./data/snapshot.db` yourself.
