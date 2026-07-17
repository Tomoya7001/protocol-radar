import { getDb } from "@/app/_data/db";
import { getProtocolSummaries, listEventsDto } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import { computeVelocity } from "@/lib/velocity/velocity";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upper bound on events scanned for the momentum computation. The full ledger is small (one
 * row per observed change), so a generous cap captures every event while staying O(bounded).
 */
const EVENT_SCAN_LIMIT = 10_000;

/**
 * Feature D1 — GET /api/velocity
 *
 * Read-only. Surfaces the one signal that continuous observation uniquely provides: how fast
 * each protocol is changing. Aggregates the existing read layer (getProtocolSummaries +
 * listEventsDto) and hands it to the pure computeVelocity() metrics builder — no schema,
 * shared-query, or DTO changes. All heavy lifting lives in src/lib/velocity/velocity.ts; this
 * route only wires data in and serialises the result.
 *
 * Accepts `?now=<epoch-ms>` (via parseNow) for deterministic, reproducible snapshots.
 * Shape: { generated_at, protocols: [...], summary: {...} }.
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

  const report = computeVelocity({
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
