import { getDb } from "@/app/_data/db";
import { getProtocolSummaries, listEventsDto } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import { buildLeaderboard } from "@/lib/leaderboard/leaderboard";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upper bound on events scanned for the ranking. The full ledger is small (one row per observed
 * change), so a generous cap captures every event while staying O(bounded).
 */
const EVENT_SCAN_LIMIT = 10_000;

/**
 * Feature H1 — GET /api/leaderboard
 *
 * Read-only, request-time DB read only, no network. Produces a single cross-protocol ranking so
 * consumers can see which protocols are moving right now. Aggregates the existing read layer
 * (getProtocolSummaries + listEventsDto) and hands it to the pure buildLeaderboard() builder —
 * no schema, shared-query, or DTO changes. All computation lives in
 * src/lib/leaderboard/leaderboard.ts; this route only wires data in and serialises the result.
 *
 * Accepts `?now=<epoch-ms>` (via parseNow) for deterministic, reproducible snapshots.
 * Shape: { generated_at, entries: [...] } (entries ranked highest score first).
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

  const board = buildLeaderboard(
    {
      protocols: summaries.map((s) => ({
        key: s.key,
        name: s.name,
        stale: s.stale_warning,
      })),
      events: events.map((e) => ({
        protocol_key: e.protocol_key,
        created_at: e.created_at,
      })),
    },
    now,
  );

  return jsonResponse(board);
}
