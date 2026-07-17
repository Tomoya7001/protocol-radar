import { getDb } from "@/app/_data/db";
import {
  listEventsDto,
  protocolExists,
  type EventListItemDto,
} from "@/app/_data/queries";
import { jsonResponse, parseLimit } from "@/app/api/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/** XML-escape dynamic text for safe embedding in RSS element bodies/attributes. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Human-friendly label for an event type used in the item title. */
function typeLabel(type: EventListItemDto["type"]): string {
  switch (type) {
    case "appeared":
      return "appeared";
    case "version_bump":
      return "version bump";
    case "spec_change":
      return "spec change";
    case "vanished":
      return "vanished";
    default:
      return type;
  }
}

/** RFC-822 date string (RSS pubDate/lastBuildDate format), or null if unparseable. */
function rfc822(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toUTCString();
}

function renderItem(event: EventListItemDto, origin: string): string {
  const summary = event.summary ?? "";
  const title = `${event.protocol_name} — ${typeLabel(event.type)}${
    summary ? `: ${summary}` : ""
  }`;
  const link = `${origin}/protocols/${event.protocol_key}`;
  const pubDate = rfc822(event.created_at);
  return [
    "    <item>",
    `      <title>${xmlEscape(title)}</title>`,
    `      <link>${xmlEscape(link)}</link>`,
    `      <guid isPermaLink="false">${xmlEscape(event.hash)}</guid>`,
    ...(pubDate ? [`      <pubDate>${xmlEscape(pubDate)}</pubDate>`] : []),
    `      <description>${xmlEscape(summary)}</description>`,
    "    </item>",
  ].join("\n");
}

/**
 * GET /api/feed — subscribable RSS 2.0 feed of protocol change events, newest first.
 * Optional protocol filter via ?protocol=<key> (unknown yields 404) and ?limit=<1..500>
 * (invalid yields 400), mirroring GET /api/events. Pure read path: performs no DB writes.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const origin = url.origin;
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

  const lastBuild =
    (events[0] && rfc822(events[0].created_at)) ?? new Date().toUTCString();
  const channelDesc = protocolKey
    ? `Change events for protocol "${protocolKey}" tracked by Protocol Radar.`
    : "Change events across all protocols tracked by Protocol Radar.";

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    "    <title>Protocol Radar — changes</title>",
    `    <link>${xmlEscape(origin)}</link>`,
    `    <description>${xmlEscape(channelDesc)}</description>`,
    `    <lastBuildDate>${xmlEscape(lastBuild)}</lastBuildDate>`,
    ...events.map((e) => renderItem(e, origin)),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
