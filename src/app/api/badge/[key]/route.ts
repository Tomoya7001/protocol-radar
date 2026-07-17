import { getDb } from "@/app/_data/db";
import { getProtocolDetail } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-035 — GET /api/badge/:key
 *
 * An embeddable shields.io-style status BADGE (SVG) for a single protocol. It shows a fixed
 * left label ("protocol radar") and, on the right, the protocol's current `status`, coloured
 * by status + freshness + last-change age. Embedding these badges spreads Protocol Radar as a
 * referenced source (the core thesis). READ-ONLY: it reuses the same one-protocol query the
 * `/api/protocols/:key` route uses (getProtocolDetail). Unknown key ⇒ 404 JSON.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A protocol whose last change is older than this reads as "stale" for badge colouring. */
const STALE_AGE_MS = 30 * DAY_MS;
/** Between AGING_AGE_MS and STALE_AGE_MS old ⇒ "aging" (yellow). */
const AGING_AGE_MS = 14 * DAY_MS;

// shields.io "flat" palette.
const COLOR_GREEN = "#4c1";
const COLOR_YELLOW = "#dfb317";
const COLOR_RED = "#e05d44";
const COLOR_GREY = "#9f9f9f";

/** XML/HTML-escape dynamic text before it lands in the SVG markup. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Pick the right-side colour. `vanished` / no last change ⇒ grey (unknown/gone); an explicitly
 * stale source OR a last change older than ~30 days ⇒ red; 14–30 days ⇒ yellow (aging); a
 * fresh, recently-changed active protocol ⇒ green.
 */
function badgeColor(
  status: string,
  freshness: string,
  lastChangeMs: number | null,
  now: number,
): string {
  if (status === "vanished" || freshness === "vanished") return COLOR_GREY;
  if (lastChangeMs === null) return COLOR_GREY; // no events ⇒ unknown
  const ageMs = now - lastChangeMs;
  if (freshness === "stale" || ageMs > STALE_AGE_MS) return COLOR_RED;
  if (ageMs > AGING_AGE_MS) return COLOR_YELLOW;
  return COLOR_GREEN;
}

/** Rough per-glyph advance at font-size 11 (Verdana-ish), used to size the two rects. */
function textWidth(text: string): number {
  return text.length * 6.5;
}

/** Hand-write a self-contained shields-style SVG (no external lib). Height is fixed at 20. */
function renderBadge(label: string, value: string, color: string): string {
  const PAD = 10;
  const leftW = Math.round(textWidth(label) + PAD);
  const rightW = Math.round(textWidth(value) + PAD);
  const totalW = leftW + rightW;
  const leftX = leftW / 2;
  const rightX = leftW + rightW / 2;
  const safeLabel = escapeXml(label);
  const safeValue = escapeXml(value);
  const aria = `${safeLabel}: ${safeValue}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" ` +
    `role="img" aria-label="${aria}">` +
    `<title>${aria}</title>` +
    `<linearGradient id="s" x2="0" y2="100%">` +
    `<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>` +
    `<stop offset="1" stop-opacity=".1"/>` +
    `</linearGradient>` +
    `<clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${leftW}" height="20" fill="#555"/>` +
    `<rect x="${leftW}" width="${rightW}" height="20" fill="${color}"/>` +
    `<rect width="${totalW}" height="20" fill="url(#s)"/>` +
    `</g>` +
    `<g fill="#fff" text-anchor="middle" ` +
    `font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${leftX}" y="15" fill="#010101" fill-opacity=".3">${safeLabel}</text>` +
    `<text x="${leftX}" y="14">${safeLabel}</text>` +
    `<text x="${rightX}" y="15" fill="#010101" fill-opacity=".3">${safeValue}</text>` +
    `<text x="${rightX}" y="14">${safeValue}</text>` +
    `</g>` +
    `</svg>`
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await ctx.params;
  const url = new URL(req.url);
  const now = parseNow(url);
  const detail = getProtocolDetail(getDb(), key, now);
  if (detail === null) {
    return jsonResponse({ error: "protocol_not_found", key }, 404);
  }

  const { status, freshness, last_event } = detail.protocol;
  const lastChangeMs =
    last_event === null ? null : Date.parse(last_event.created_at);
  const color = badgeColor(
    status,
    freshness,
    lastChangeMs !== null && Number.isNaN(lastChangeMs) ? null : lastChangeMs,
    now,
  );

  const svg = renderBadge("protocol radar", status, color);
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
