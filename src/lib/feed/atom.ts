/**
 * Atom 1.0 feed rendering (feature G6, GET /feed.xml).
 *
 * This module is a NEW, self-contained rendering layer for the site-wide Atom feed. It
 * deliberately re-implements the escaping / date / item formatting rather than importing
 * from the existing RSS/JSON feed modules, so the existing `/api/feed` and `/feed.json`
 * wiring stays untouched. Pure functions only — no DB access, no I/O, no writes. The caller
 * injects the site origin, the recent change entries, and the generated-at timestamp.
 *
 * Spec: RFC 4287 (The Atom Syndication Format).
 */
import type { EventListItemDto } from "@/app/_data/queries";

/** XML-escape dynamic text for safe embedding in Atom element bodies/attributes. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Human-friendly label for an event type used in the entry title. */
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

/** RFC-3339 / ISO-8601 date string (Atom <updated>), or null if unparseable. */
export function rfc3339(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Absolute permalink to a protocol's page for a given origin. */
export function protocolLink(origin: string, protocolKey: string): string {
  return `${origin}/protocols/${protocolKey}`;
}

/** Composed entry title for a change event. */
export function eventTitle(event: EventListItemDto): string {
  const summary = event.summary ?? "";
  return `${event.protocol_name} — ${typeLabel(event.type)}${
    summary ? `: ${summary}` : ""
  }`;
}

/**
 * Stable, globally-unique Atom entry id (an IRI). The ledger hash uniquely identifies a
 * change event, so we wrap it in a URN to satisfy Atom's requirement that <id> be an IRI.
 */
export function entryId(event: EventListItemDto): string {
  return `urn:protocol-radar:event:${event.hash}`;
}

/** Input for {@link buildAtomFeed}. Caller supplies origin, entries, and generated-at. */
export interface AtomFeedInput {
  /** Absolute site origin, e.g. "https://pr.example" (no trailing slash). */
  origin: string;
  /** Recent change events across all protocols, in the order they should appear. */
  entries: EventListItemDto[];
  /** ISO timestamp used for the feed <updated> when there are no entries. */
  generatedAt: string;
}

/** Render a single Atom <entry> for a change event. */
function renderEntry(event: EventListItemDto, origin: string): string {
  const summary = event.summary ?? "";
  const updated = rfc3339(event.created_at);
  const link = protocolLink(origin, event.protocol_key);
  return [
    "  <entry>",
    `    <id>${xmlEscape(entryId(event))}</id>`,
    `    <title>${xmlEscape(eventTitle(event))}</title>`,
    `    <link rel="alternate" href="${xmlEscape(link)}"/>`,
    ...(updated ? [`    <updated>${xmlEscape(updated)}</updated>`] : []),
    `    <summary>${xmlEscape(summary)}</summary>`,
    "  </entry>",
  ].join("\n");
}

/**
 * Build a complete Atom 1.0 document for the whole site's change events, in the given order.
 * Deterministic and pure: given identical input it always returns identical output. The feed
 * <updated> is the newest entry's timestamp, falling back to `generatedAt`.
 */
export function buildAtomFeed(input: AtomFeedInput): string {
  const { origin, entries, generatedAt } = input;
  const first = entries[0];
  const feedUpdated =
    (first ? rfc3339(first.created_at) : null) ??
    rfc3339(generatedAt) ??
    new Date(0).toISOString();
  const selfUrl = `${origin}/feed.xml`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>Protocol Radar — changes</title>",
    `  <id>${xmlEscape(selfUrl)}</id>`,
    `  <link rel="self" href="${xmlEscape(selfUrl)}"/>`,
    `  <link rel="alternate" href="${xmlEscape(origin)}"/>`,
    `  <updated>${xmlEscape(feedUpdated)}</updated>`,
    "  <generator>Protocol Radar</generator>",
    ...entries.map((e) => renderEntry(e, origin)),
    "</feed>",
    "",
  ].join("\n");
}
