/**
 * C3 — deliver newly-observed change events to external webhook subscribers.
 *
 * Runs inside the observe loop (GitHub Actions — the only writable host) right after
 * `observe:refresh` has appended this pass's change events to the ledger and regenerated the
 * snapshot. It reads the events this pass just created and POSTs them to every URL in
 * PROTOCOL_RADAR_WEBHOOK_URLS, optionally HMAC-signing each request with
 * PROTOCOL_RADAR_WEBHOOK_SECRET.
 *
 * Strictly READ-ONLY over the DB (mirrors scripts/anchor-ledger.mjs): it opens the canonical
 * DB with { readonly: true } and NEVER writes a row, runs no migration, and never touches the
 * ledger / provenance invariant. All formatting + signing + HTTP lives in the pure, unit-tested
 * src/lib/webhook/deliver.ts.
 *
 * New-event detection: the pure read layer exposes no "delta since last run" cursor and this
 * script runs as a SEPARATE process after observe:refresh (so it cannot capture a pre-run head
 * seq). Since the observe loop runs on a ≥6h cadence and this step fires seconds after the
 * append, "new" is defined as events whose created_at falls within a recent window
 * (PROTOCOL_RADAR_WEBHOOK_SINCE_MINUTES, default 60 — comfortably larger than one observe pass,
 * far smaller than the inter-run gap). Events are read via the existing listEventsDto() read
 * function; nothing here is fabricated. Receivers are expected to be idempotent (standard for
 * webhooks), so a CI retry re-delivering the same window is safe.
 *
 * Safety: delivery is best-effort. Missing env ⇒ clean no-op. A flaky subscriber (or an
 * unexpected error) is logged but NEVER fails the process, so it can never red the observe loop
 * whose durable output (the committed snapshot) is already secured.
 *
 * Run via `pnpm webhook:deliver` (tsx).
 */
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { listEventsDto } from "@/app/_data/queries";
import {
  WEBHOOK_SOURCE,
  buildWebhookPayload,
  deliverWebhooks,
  parseWebhookUrls,
  type WebhookEvent,
} from "@/lib/webhook/deliver";

/** Canonical DB path (same convention as anchor-ledger.mjs). */
const DB_PATH = process.env.DATABASE_PATH?.trim() || "./data/protocol-radar.db";

/** Default "recent" window in minutes; overridable via PROTOCOL_RADAR_WEBHOOK_SINCE_MINUTES. */
const DEFAULT_WINDOW_MINUTES = 60;

/** Upper bound on events scanned per run (matches the /api/events MAX_LIMIT). */
const READ_LIMIT = 500;

/** Resolve the recent-window size, guarding against unset / non-positive / non-numeric env. */
function windowMinutes(): number {
  const raw = process.env.PROTOCOL_RADAR_WEBHOOK_SINCE_MINUTES?.trim();
  if (!raw) return DEFAULT_WINDOW_MINUTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WINDOW_MINUTES;
}

async function main(): Promise<void> {
  const urls = parseWebhookUrls(process.env.PROTOCOL_RADAR_WEBHOOK_URLS);
  if (urls.length === 0) {
    console.log(
      "deliverWebhooks: PROTOCOL_RADAR_WEBHOOK_URLS unset/empty; nothing to deliver (no-op)",
    );
    return;
  }

  if (!existsSync(DB_PATH)) {
    console.log(
      `deliverWebhooks: canonical DB not found at ${DB_PATH}; nothing to deliver (no-op)`,
    );
    return;
  }

  const minutes = windowMinutes();
  const now = new Date();
  const cutoffMs = now.getTime() - minutes * 60_000;

  // Read-only connection: this script must never mutate the ledger.
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  let recent;
  try {
    recent = listEventsDto(db, { limit: READ_LIMIT });
  } finally {
    db.close();
  }

  const fresh = recent.filter((e) => {
    const t = Date.parse(e.created_at);
    return Number.isFinite(t) && t >= cutoffMs;
  });

  if (fresh.length === 0) {
    console.log(
      `deliverWebhooks: no events created in the last ${minutes} min; nothing to deliver`,
    );
    return;
  }

  const events: WebhookEvent[] = fresh.map((e) => ({
    seq: e.seq,
    protocol: e.protocol_key,
    protocolName: e.protocol_name,
    type: e.type,
    summary: e.summary,
    createdAt: e.created_at,
    hash: e.hash,
  }));

  const payload = buildWebhookPayload(events, {
    source: WEBHOOK_SOURCE,
    generatedAt: now.toISOString(),
  });

  const secret = process.env.PROTOCOL_RADAR_WEBHOOK_SECRET?.trim() || undefined;

  const results = await deliverWebhooks({ urls, payload, secret });

  let okCount = 0;
  for (const r of results) {
    if (r.ok) {
      okCount++;
      console.log(`deliverWebhooks: OK   ${r.url} (status=${r.status})`);
    } else {
      console.error(
        `deliverWebhooks: FAIL ${r.url} (${r.status ?? r.error ?? "unknown error"})`,
      );
    }
  }

  console.log(
    `deliverWebhooks: delivered ${events.length} event(s) to ${okCount}/${urls.length} ` +
      `endpoint(s)${secret ? " (signed)" : ""}`,
  );
}

main().catch((err) => {
  // Best-effort: never fail the observe loop over a delivery problem. Log and exit 0.
  console.error("deliverWebhooks: unexpected error (ignored):", err);
});
