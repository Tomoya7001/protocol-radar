import { getDb } from "@/app/_data/db";
import { getProtocolSummaries, listEventsDto } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import { computeFreshness } from "@/lib/freshness/freshness";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upper bound on ledger rows scanned for the freshness computation. The observation ledger is
 * small (one row per observed change), so a generous cap captures every record while staying
 * O(bounded).
 */
const OBSERVATION_SCAN_LIMIT = 10_000;

/**
 * Feature G5 — GET /api/freshness
 *
 * Read-only TRUST/coverage self-report over the continuous-observation ledger: "how current is
 * this data?". For each tracked protocol it reports the most recent observation, its age, and
 * whether that age is still within the freshness SLA (STALE_THRESHOLD_MS) — plus an overall
 * fresh/stale summary. This is DISTINCT from /api/health (liveness) and /api/anomalies (pattern
 * detection): it lets an AI consumer judge the recency of the snapshot it is reading.
 *
 * Aggregates the existing read layer (getProtocolSummaries for the tracked-protocol set +
 * listEventsDto for the observation ledger) and hands it to the pure computeFreshness() builder
 * — no schema, shared-query, or DTO changes. All computation lives in
 * src/lib/freshness/freshness.ts; this route only wires data in and serialises the result.
 *
 * Accepts `?now=<epoch-ms>` (via parseNow) for deterministic, reproducible snapshots.
 * Shape: { protocols: [{ key, lastObservedAt, staleMs, stale, observationCount }], summary }.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const db = getDb();

  const summaries = getProtocolSummaries(db, now);
  const events = listEventsDto(db, {
    protocolKey: null,
    limit: OBSERVATION_SCAN_LIMIT,
  });

  const report = computeFreshness(
    {
      protocols: summaries.map((s) => ({ key: s.key })),
      observations: events.map((e) => ({
        protocol_key: e.protocol_key,
        observed_at: e.created_at,
      })),
    },
    now,
  );

  return jsonResponse(report);
}
