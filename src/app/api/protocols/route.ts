import { getDb } from "@/app/_data/db";
import { getProtocolSummaries } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-032 — GET /api/protocols
 * List every protocol with its state, last-change event and aggregated freshness.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const protocols = getProtocolSummaries(getDb(), now);
  return jsonResponse({ protocols, count: protocols.length });
}
