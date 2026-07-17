import { getDb } from "@/app/_data/db";
import { getProtocolSummaries } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import { buildComparison, parseKeys } from "@/lib/compare/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Feature D2 — GET /api/compare
 *
 * Read-only, machine-readable side-by-side comparison of several protocols in ONE request:
 * maturity (status), freshness/decay, total event count, and the latest recorded change.
 * Strengthens the "referenced-by-AI" thesis — an agent can compare a speculative key list in
 * a single call and cite the result.
 *
 * Query params:
 *   - `?keys=mcp,a2a,x402` — optional. Unknown keys are returned in-band as { found: false }
 *     (NOT a 400/404), so a partially valid request still succeeds. Absent/blank ⇒ compare
 *     ALL protocols.
 *   - `?now=<epoch-ms>` — optional; deterministic clock for reproducible output.
 *
 * All logic lives in the pure `@/lib/compare/compare` module; this route only reads the ledger
 * once and delegates. (Route files export ONLY GET/runtime/dynamic — no handler re-exports.)
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const db = getDb();

  const keys = parseKeys(url.searchParams.get("keys"));
  const summaries = getProtocolSummaries(db, now);
  const body = buildComparison(summaries, keys, now);

  return jsonResponse(body);
}
