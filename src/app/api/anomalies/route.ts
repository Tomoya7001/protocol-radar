import { getDb } from "@/app/_data/db";
import { getProtocolSummaries, listEventsDto } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import { computeAnomalies } from "@/lib/anomalies/anomalies";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upper bound on events scanned. The ledger is small (one row per observed change), so a
 * generous cap captures every event while staying O(bounded). Mirrors /api/velocity.
 */
const EVENT_SCAN_LIMIT = 10_000;

/**
 * Feature E2 — GET /api/anomalies
 *
 * Read-only. Scans the ledger history and surfaces the notable / abnormal patterns that only
 * continuous observation can produce: activity spikes, dormancy breaks, vanished sources, and
 * rapid spec churn. Aggregates the existing read layer (getProtocolSummaries + listEventsDto)
 * and hands it to the pure computeAnomalies() builder — no schema, shared-query, or DTO changes.
 * All detection logic lives in src/lib/anomalies/anomalies.ts; this route only wires data in.
 *
 * Accepts `?now=<epoch-ms>` (via parseNow) for deterministic, reproducible snapshots.
 * Shape: { generated_at, count, anomalies: [{ key, name, kind, severity, detected_at, detail, evidence }] }.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const db = getDb();

  const summaries = getProtocolSummaries(db, now);
  const events = listEventsDto(db, {
    protocolKey: null,
    limit: EVENT_SCAN_LIMIT,
  });

  const report = computeAnomalies({
    now,
    protocols: summaries.map((s) => ({ key: s.key, name: s.name })),
    events: events.map((e) => ({
      protocol_key: e.protocol_key,
      protocol_name: e.protocol_name,
      created_at: e.created_at,
      type: e.type,
    })),
  });

  return jsonResponse(report);
}
