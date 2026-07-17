import { getDb } from "@/app/_data/db";
import {
  getProtocolSummaries,
  listEventsDto,
  type EventListItemDto,
  type ProtocolSummaryDto,
} from "@/app/_data/queries";
import { jsonResponse, parseLimit, parseNow } from "@/app/api/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Generous ceiling for the in-memory event scan: we load recent events once and filter
 * client-side. This keeps the endpoint simple (no new SQL) while covering the whole
 * accumulated feed for the seeded/small datasets Protocol Radar tracks.
 */
const EVENT_SCAN_LIMIT = 500;

/** Case-insensitive substring test that treats null/empty haystacks as non-matching. */
function includes(haystack: string | null | undefined, needle: string): boolean {
  return haystack != null && haystack.toLowerCase().includes(needle);
}

/**
 * Feature #9 — GET /api/search?q=<term>
 * Full-text-ish (case-insensitive substring) search across protocols AND change events, so
 * agents can retrieve over the accumulated unique data from one endpoint.
 *
 * `?q=` is required (missing/empty ⇒ 400). Optional `?limit=<1..100>` (default 20; invalid ⇒
 * 400) caps EACH collection independently. Read-only reuse of the F-032 query layer.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);

  const q = (url.searchParams.get("q") ?? "").trim();
  if (q === "") {
    return jsonResponse(
      { error: "missing_query", detail: "q is required and must be non-empty" },
      400,
    );
  }

  const limit = parseLimit(url, DEFAULT_LIMIT, MAX_LIMIT);
  if ("error" in limit) {
    return jsonResponse({ error: "invalid_limit", detail: limit.error }, 400);
  }

  const db = getDb();
  const now = parseNow(url);
  const needle = q.toLowerCase();

  // Protocols carry no free-text description column; match the textual fields that exist.
  const protocols: ProtocolSummaryDto[] = getProtocolSummaries(db, now)
    .filter(
      (p) =>
        includes(p.name, needle) ||
        includes(p.key, needle) ||
        includes(p.layer, needle) ||
        includes(p.status, needle),
    )
    .slice(0, limit.value);

  const events: EventListItemDto[] = listEventsDto(db, { limit: EVENT_SCAN_LIMIT })
    .filter(
      (e) =>
        includes(e.protocol_name, needle) ||
        includes(e.summary, needle) ||
        includes(e.type, needle),
    )
    .slice(0, limit.value);

  return jsonResponse({
    query: q,
    protocols,
    events,
    count: protocols.length + events.length,
  });
}
