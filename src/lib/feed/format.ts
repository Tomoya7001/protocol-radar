/**
 * Feed-formatting helpers for the per-protocol RSS feed (GET /api/feed/[key]) and the
 * site-wide JSON Feed (GET /feed.json), feature D4 "individual subscription feeds".
 *
 * This module is a NEW, self-contained rendering layer used ONLY by the D4 routes. It
 * deliberately re-implements the escaping / date / item formatting rather than importing
 * from the existing whole-site RSS route, so the existing `/api/feed` wiring is untouched.
 * Pure functions only — no DB access, no I/O, no writes.
 */
import type { EventListItemDto } from "@/app/_data/queries";

/** XML-escape dynamic text for safe embedding in RSS element bodies/attributes. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Human-friendly label for an event type used in the item title. */
export function typeLabel(type: EventListItemDto["type"]): string {
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
export function rfc822(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toUTCString();
}

/** RFC-3339 / ISO-8601 date string (JSON Feed date_published), or null if unparseable. */
export function rfc3339(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Absolute permalink to a protocol's page for a given origin. */
export function protocolLink(origin: string, protocolKey: string): string {
  return `${origin}/protocols/${protocolKey}`;
}

/** Composed item title shared by both feed formats. */
export function eventTitle(event: EventListItemDto): string {
  const summary = event.summary ?? "";
  return `${event.protocol_name} — ${typeLabel(event.type)}${
    summary ? `: ${summary}` : ""
  }`;
}

/** Render a single RSS 2.0 <item> for an event. */
export function renderRssItem(event: EventListItemDto, origin: string): string {
  const summary = event.summary ?? "";
  const title = eventTitle(event);
  const link = protocolLink(origin, event.protocol_key);
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
 * Render a complete RSS 2.0 document for a single protocol's events, newest first.
 * `nowIso` supplies the fallback lastBuildDate when there are no events.
 */
export function renderProtocolRss(
  events: EventListItemDto[],
  origin: string,
  opts: { protocolKey: string; protocolName: string; nowIso: string },
): string {
  const first = events[0];
  const lastBuild =
    (first ? rfc822(first.created_at) : null) ??
    rfc822(opts.nowIso) ??
    new Date(0).toUTCString();
  const title = `Protocol Radar — ${opts.protocolName} changes`;
  const desc = `Change events for protocol "${opts.protocolKey}" tracked by Protocol Radar.`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${xmlEscape(title)}</title>`,
    `    <link>${xmlEscape(protocolLink(origin, opts.protocolKey))}</link>`,
    `    <description>${xmlEscape(desc)}</description>`,
    `    <lastBuildDate>${xmlEscape(lastBuild)}</lastBuildDate>`,
    ...events.map((e) => renderRssItem(e, origin)),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** A single JSON Feed 1.1 item. */
export interface JsonFeedItem {
  id: string;
  url: string;
  title: string;
  content_text: string;
  date_published?: string;
  tags: string[];
}

/** JSON Feed 1.1 top-level document (https://jsonfeed.org/version/1.1). */
export interface JsonFeed {
  version: "https://jsonfeed.org/version/1.1";
  title: string;
  home_page_url: string;
  feed_url: string;
  items: JsonFeedItem[];
}

/** Build a JSON Feed 1.1 document for the whole site's events, newest first. */
export function buildJsonFeed(
  events: EventListItemDto[],
  origin: string,
): JsonFeed {
  const items: JsonFeedItem[] = events.map((event) => {
    const published = rfc3339(event.created_at);
    const item: JsonFeedItem = {
      id: event.hash,
      url: protocolLink(origin, event.protocol_key),
      title: eventTitle(event),
      content_text: event.summary ?? "",
      tags: [event.protocol_key, event.type],
    };
    if (published) item.date_published = published;
    return item;
  });
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: "Protocol Radar — changes",
    home_page_url: origin,
    feed_url: `${origin}/feed.json`,
    items,
  };
}
