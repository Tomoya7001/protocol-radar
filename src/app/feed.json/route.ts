import { getDb } from "@/app/_data/db";
import { listEventsDto } from "@/app/_data/queries";
import { jsonResponse, parseLimit } from "@/app/api/_lib/http";
import { buildJsonFeed } from "@/lib/feed/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * GET /feed.json — subscribable JSON Feed 1.1 (https://jsonfeed.org/version/1.1) of the
 * whole site's change events, newest first (feature D4). Invalid `?limit=` ⇒ 400. Pure
 * read path: performs no DB writes.
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
  const feed = buildJsonFeed(events, origin);

  return new Response(JSON.stringify(feed), {
    status: 200,
    headers: { "content-type": "application/feed+json; charset=utf-8" },
  });
}
