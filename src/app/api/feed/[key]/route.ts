import { getDb } from "@/app/_data/db";
import { getProtocolByKey } from "@/lib/db";
import { listEventsDto } from "@/app/_data/queries";
import { jsonResponse, parseLimit } from "@/app/api/_lib/http";
import { renderProtocolRss } from "@/lib/feed/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * GET /api/feed/[key] — subscribable RSS 2.0 feed for a SINGLE protocol's change events,
 * newest first (feature D4). Unknown key ⇒ 404; invalid `?limit=` ⇒ 400. Pure read path:
 * performs no DB writes. Mirrors the whole-site feed at GET /api/feed without touching it.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  const url = new URL(req.url);
  const origin = url.origin;
  const { key } = await ctx.params;
  const db = getDb();

  const limit = parseLimit(url, DEFAULT_LIMIT, MAX_LIMIT);
  if ("error" in limit) {
    return jsonResponse({ error: "invalid_limit", detail: limit.error }, 400);
  }

  const protocol = getProtocolByKey(db, key);
  if (protocol === undefined) {
    return jsonResponse({ error: "protocol_not_found", key }, 404);
  }

  const events = listEventsDto(db, { protocolKey: key, limit: limit.value });

  const xml = renderProtocolRss(events, origin, {
    protocolKey: protocol.key,
    protocolName: protocol.name,
    nowIso: new Date().toISOString(),
  });

  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
