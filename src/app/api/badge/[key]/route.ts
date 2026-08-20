import { getDb } from "@/app/_data/db";
import { getProtocolDetail } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import {
  compareToLatest,
  latestVersion,
  type VersionVerdict,
} from "@/lib/badge/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/badge/:key — an embeddable, self-updating SVG status badge.
 *
 *   /api/badge/mcp                        -> "MCP | 2026-07-28"        (what is current upstream)
 *   /api/badge/mcp?target=2026-07-28      -> "MCP | 2026-07-28"  green (you are current)
 *   /api/badge/mcp?target=2025-11-25      -> "MCP | outdated"   yellow (upstream moved on)
 *   /api/badge/mcp?label=My%20Server      -> overrides the left-hand label
 *
 * Why `target` is the whole point: a badge that only mirrors upstream says nothing about the
 * project displaying it, so nobody embeds it. A badge that carries the maintainer's DECLARED
 * target version is a claim they are proud to publish while it is green — and it flips to
 * yellow by itself the day upstream moves, which is exactly when they need to know. The
 * embedding repo does the work of stating its target; we supply the continuously-observed
 * truth to check it against.
 *
 * Read-only: one existing query, no writes, no auth.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A protocol whose last change is older than this reads as "stale" for badge colouring. */
const STALE_AGE_MS = 30 * DAY_MS;
/** Between AGING_AGE_MS and STALE_AGE_MS old ⇒ "aging" (yellow). */
const AGING_AGE_MS = 14 * DAY_MS;

/** Longest label/value we will render; keeps a hostile query string from bloating the SVG. */
const MAX_TEXT_LENGTH = 40;

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

/** Trim untrusted query text to a sane badge width. */
function clamp(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_TEXT_LENGTH
    ? `${trimmed.slice(0, MAX_TEXT_LENGTH - 1)}…`
    : trimmed;
}

/**
 * Colour when the badge is reporting upstream state only (no `target` declared).
 * `vanished` / no events ⇒ grey; explicitly stale or >30d ⇒ red; 14–30d ⇒ yellow; else green.
 */
function upstreamColor(
  status: string,
  freshness: string,
  lastChangeMs: number | null,
  now: number,
): string {
  if (status === "vanished" || freshness === "vanished") return COLOR_GREY;
  if (lastChangeMs === null) return COLOR_GREY;
  const ageMs = now - lastChangeMs;
  if (freshness === "stale" || ageMs > STALE_AGE_MS) return COLOR_RED;
  if (ageMs > AGING_AGE_MS) return COLOR_YELLOW;
  return COLOR_GREEN;
}

/** Colour for a declared target. Never green without positive evidence. */
function verdictColor(verdict: VersionVerdict): string {
  if (verdict === "current") return COLOR_GREEN;
  if (verdict === "outdated") return COLOR_YELLOW;
  return COLOR_GREY;
}

/** Rough per-glyph advance at font-size 11 (Verdana-ish), used to size the two rects. */
function textWidth(text: string): number {
  return text.length * 6.5;
}

/** Hand-write a self-contained shields-style SVG (no external lib). Height is fixed at 20. */
function renderBadge(
  label: string,
  value: string,
  color: string,
  title: string,
): string {
  const PAD = 10;
  const leftW = Math.round(textWidth(label) + PAD);
  const rightW = Math.round(textWidth(value) + PAD);
  const totalW = leftW + rightW;
  const leftX = leftW / 2;
  const rightX = leftW + rightW / 2;
  const safeLabel = escapeXml(label);
  const safeValue = escapeXml(value);
  const aria = escapeXml(title);
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
  const parsedLastChange =
    last_event === null ? null : Date.parse(last_event.created_at);
  const lastChangeMs =
    parsedLastChange !== null && Number.isNaN(parsedLastChange)
      ? null
      : parsedLastChange;

  const observed = latestVersion(detail.events);
  const rawTarget = url.searchParams.get("target");
  const target =
    rawTarget !== null && rawTarget.trim().length > 0 ? clamp(rawTarget) : null;

  const rawLabel = url.searchParams.get("label");
  const label =
    rawLabel !== null && rawLabel.trim().length > 0
      ? clamp(rawLabel)
      : key.toUpperCase();

  let value: string;
  let color: string;
  let title: string;

  if (target === null) {
    // No declared target: mirror upstream. Prefer the observed version over the bare status,
    // because "2026-07-28" tells a reader something and "active" does not.
    value = observed ?? status;
    color = upstreamColor(status, freshness, lastChangeMs, now);
    title = observed === null
      ? `${label}: ${status}`
      : `${label}: latest observed version ${observed}`;
  } else {
    const verdict = compareToLatest(target, observed);
    color = verdictColor(verdict);
    if (verdict === "outdated") {
      value = "outdated";
      title = `${label}: target ${target}, latest observed ${observed}`;
    } else if (verdict === "current") {
      value = target;
      title = `${label}: target ${target} matches the latest observed version`;
    } else {
      value = target;
      title = `${label}: target ${target}, latest version not yet observed`;
    }
  }

  const svg = renderBadge(label, value, color, title);
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // Short TTL: the badge exists to flip colour promptly when upstream moves. GitHub's
      // Camo proxy caches on top of this, so a long TTL here would make it lie for hours.
      "cache-control": "public, max-age=300",
    },
  });
}
