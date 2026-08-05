import { getDb } from "@/app/_data/db";
import { listEventsDto } from "@/app/_data/queries";
import { jsonResponse, parseLimit } from "@/app/api/_lib/http";
import { buildAtomFeed } from "@/lib/feed/atom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * GET /feed.xml — subscribable Atom 1.0 (RFC 4287) feed of the whole site's change events
 * across all protocols, newest first (feature G6). A new distribution channel alongside the
 * JSON `/feed.json` and RSS `/api/feed` feeds. Invalid `?limit=` ⇒ 400. Pure read path:
 * performs no DB writes.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const origin = url.origin;
  const db = getDb();

  const limit = parseLimit(url, DEFAULT_LIMIT, MAX_LIMIT);
  if ("error" in limit) {
    return jsonResponse({ error: "invalid_limit", detail: limit.error }, 400);
  }

  const events = listEventsDto(db, { protocolKey: null, limit: limit.value });
  const xml = buildAtomFeed({
    origin,
    entries: events,
    generatedAt: new Date().toISOString(),
  });

  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/atom+xml; charset=utf-8" },
  });
}
