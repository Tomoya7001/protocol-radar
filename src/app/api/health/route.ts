import { getDb } from "@/app/_data/db";
import { getProtocolSummaries } from "@/app/_data/queries";
import { runVerify } from "@/app/_data/verify";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import type { Db } from "@/lib/db";
import type { ProtocolFreshness } from "@/app/_data/freshness";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every ProtocolFreshness bucket, pre-seeded to 0 so the shape is always complete. */
type FreshnessCounts = Record<ProtocolFreshness, number>;

function emptyFreshnessCounts(): FreshnessCounts {
  return { fresh: 0, stale: 0, pending: 0, vanished: 0, unknown: 0 };
}

/** Read-only COUNT of ledger events (no schema/query mutation). */
function countEvents(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM events").get() as {
    c: number;
  };
  return row.c;
}

/** Read-only oldest/newest observation timestamps; null when there are no observations. */
function observationWindow(db: Db): {
  oldest: string | null;
  newest: string | null;
} {
  const row = db
    .prepare(
      "SELECT MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest FROM observations",
    )
    .get() as { oldest: string | null; newest: string | null };
  return { oldest: row.oldest ?? null, newest: row.newest ?? null };
}

/**
 * F-035 — GET /api/health
 *
 * Operational-signal endpoint: exposes the continuously-observed ledger as a machine-readable
 * health snapshot. Read-only; aggregates the existing read layer (getProtocolSummaries +
 * runVerify) plus two read-only COUNT/MIN/MAX queries. No schema or shared-query changes.
 *
 * `ok` is true when the ledger verifies AND at least one protocol is being tracked.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const db = getDb();

  const summaries = getProtocolSummaries(db, now);
  const freshness_counts = emptyFreshnessCounts();
  for (const s of summaries) freshness_counts[s.freshness] += 1;

  const { oldest, newest } = observationWindow(db);
  const ledger = runVerify(db, "raw");

  const body = {
    ok: ledger.ok && summaries.length > 0,
    generated_at: new Date(now).toISOString(),
    protocols_total: summaries.length,
    events_total: countEvents(db),
    freshness_counts,
    oldest_observation_at: oldest,
    newest_observation_at: newest,
    ledger: { ok: ledger.ok, mode: ledger.mode, checked: ledger.checked },
  };

  return jsonResponse(body);
}
