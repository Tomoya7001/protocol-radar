import { getDb } from "@/app/_data/db";
import { listEventsDto, protocolExists } from "@/app/_data/queries";
import { jsonResponse, parseLimit } from "@/app/api/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * F-032 — GET /api/events
 * Cross-protocol event feed, newest first. Optional `?protocol=<key>` filter (unknown ⇒ 404)
 * and `?limit=<1..500>` (invalid ⇒ 400).
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const db = getDb();

  const limit = parseLimit(url, DEFAULT_LIMIT, MAX_LIMIT);
  if ("error" in limit) {
    return jsonResponse({ error: "invalid_limit", detail: limit.error }, 400);
  }

  const protocolKey = url.searchParams.get("protocol");
  if (protocolKey !== null && !protocolExists(db, protocolKey)) {
    return jsonResponse({ error: "protocol_not_found", key: protocolKey }, 404);
  }

  const events = listEventsDto(db, { protocolKey, limit: limit.value });
  return jsonResponse({ events, count: events.length });
}
