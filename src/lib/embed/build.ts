import type { Db } from "@/lib/db";
import { buildCertificate } from "@/lib/certificate/build";

/**
 * C1 — embeddable status CARD (GET /embed/:key).
 *
 * A self-contained SVG "card" showing a single protocol's CURRENT state — name, status,
 * freshness, last change (type + short content_hash) and event count — meant to be dropped into
 * a blog or docs page via `<img src=".../embed/mcp">`. It is the richer sibling of the
 * shields-style badge at /api/badge/:key: same read-only thesis (spread Protocol Radar as a
 * referenced source), more information.
 *
 * STRICTLY READ-ONLY. Every value is copied from existing rows via the shared read layer: this
 * module reuses `buildCertificate` (which itself reuses `getProtocolDetail`), so status/freshness
 * are the exact same values the API and dashboard show, and every `content_hash` is the existing
 * bound value copied verbatim — never recomputed here.
 */

/** XML/HTML-escape dynamic text before it lands in the SVG markup (mirrors badge/feed routes). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** shields-style palette, reused for the card accent bar. */
const COLOR_GREEN = "#4c1";
const COLOR_YELLOW = "#dfb317";
const COLOR_RED = "#e05d44";
const COLOR_GREY = "#9f9f9f";

/**
 * The read-only card model, all fields copied from the certificate (which copies the ledger).
 * `contentHashShort` is a display-only truncation of the existing content_hash — the full value
 * is never altered, only shortened for the card.
 */
export interface EmbedCard {
  key: string;
  name: string;
  status: string;
  freshness: string;
  eventCount: number;
  lastChangeType: string | null;
  contentHash: string | null;
  contentHashShort: string | null;
  generatedAt: string;
}

/** Truncate a hash for compact display (first 12 chars + ellipsis). Null stays null. */
function shortenHash(hash: string | null): string | null {
  if (hash === null) return null;
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

/**
 * Build the card model for `key` as of `now`. Returns null when the key is unknown (so the route
 * can 404). Pure read: delegates to `buildCertificate` with asOf = now and the default "raw"
 * verify mode; no value is recomputed.
 */
export function buildEmbedCard(db: Db, key: string, now: number): EmbedCard | null {
  const certificate = buildCertificate(db, key, now, now, "raw");
  if (certificate === null) return null;

  const { state } = certificate;
  const lastChange = state.last_change;
  const contentHash = lastChange === null ? null : lastChange.content_hash;

  return {
    key: certificate.protocol,
    name: certificate.name,
    status: state.status,
    freshness: state.freshness,
    eventCount: state.event_count,
    lastChangeType: lastChange === null ? null : lastChange.type,
    contentHash,
    contentHashShort: shortenHash(contentHash),
    generatedAt: certificate.generatedAt,
  };
}

/** Accent colour for the card: vanished ⇒ grey, stale ⇒ red, pending/unknown ⇒ yellow, else green. */
function accentColor(card: EmbedCard): string {
  if (card.status === "vanished" || card.freshness === "vanished") return COLOR_GREY;
  if (card.freshness === "stale") return COLOR_RED;
  if (card.freshness === "pending" || card.freshness === "unknown") return COLOR_YELLOW;
  return COLOR_GREEN;
}

/** One "label: value" text row inside the card body. */
function fieldRow(label: string, value: string, y: number): string {
  return (
    `<text x="20" y="${y}" fill="#8b949e" font-size="11">${escapeXml(label)}</text>` +
    `<text x="120" y="${y}" fill="#e6edf3" font-size="12" font-weight="600">${escapeXml(value)}</text>`
  );
}

/**
 * Render the self-contained card SVG for `card`. Fixed 360×188 canvas; all dynamic text is
 * XML-escaped, so there is no injection surface even for hostile protocol names/hashes.
 */
export function renderEmbedCard(card: EmbedCard): string {
  const accent = accentColor(card);
  const lastChange =
    card.lastChangeType === null
      ? "no changes yet"
      : `${card.lastChangeType} · ${card.contentHashShort ?? "—"}`;
  const title = escapeXml(card.name);
  const brand = escapeXml(`protocol radar · ${card.key}`);
  const generated = escapeXml(card.generatedAt);
  const aria = escapeXml(
    `${card.name}: status ${card.status}, freshness ${card.freshness}`,
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="188" ` +
    `role="img" aria-label="${aria}" font-family="Verdana,Geneva,DejaVu Sans,sans-serif">` +
    `<title>${aria}</title>` +
    `<rect width="360" height="188" rx="8" fill="#0d1117" stroke="#30363d"/>` +
    `<rect width="6" height="188" rx="3" fill="${accent}"/>` +
    `<text x="20" y="34" fill="#e6edf3" font-size="18" font-weight="700">${title}</text>` +
    `<text x="20" y="52" fill="#8b949e" font-size="10">${brand}</text>` +
    `<line x1="20" y1="64" x2="340" y2="64" stroke="#21262d"/>` +
    fieldRow("status", card.status, 88) +
    fieldRow("freshness", card.freshness, 110) +
    fieldRow("last change", lastChange, 132) +
    fieldRow("events", String(card.eventCount), 154) +
    `<text x="20" y="178" fill="#6e7681" font-size="9">generated ${generated}</text>` +
    `</svg>`
  );
}

/**
 * Build the full embed SVG document for `key` as of `now`, or null if the key is unknown. This is
 * the single logic entry point the route calls — the route only adds HTTP framing.
 */
export function buildEmbedSvg(db: Db, key: string, now: number): string | null {
  const card = buildEmbedCard(db, key, now);
  if (card === null) return null;
  return renderEmbedCard(card);
}
