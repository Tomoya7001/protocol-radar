import { getDb } from "@/app/_data/db";
import { buildTimeline } from "@/lib/aggregate";
import { jsonResponse, parseLimit } from "@/app/api/_lib/http";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * F-050 — GET /api/timeline
 * Cross-protocol "latest moves": every protocol's events merged and ranked most-recent-first
 * (deterministic tie-break). Optional `?limit=<1..500>` (invalid ⇒ 400).
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);

  const limit = parseLimit(url, DEFAULT_LIMIT, MAX_LIMIT);
  if ("error" in limit) {
    return jsonResponse({ error: "invalid_limit", detail: limit.error }, 400);
  }

  const entries = buildTimeline(getDb(), { limit: limit.value });
  return jsonResponse({ entries, count: entries.length });
}
