import { getDb } from "@/app/_data/db";
import { runVerify, parseVerifyMode } from "@/app/_data/verify";
import { jsonResponse } from "@/app/api/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-032 / F-034 — GET /api/verify
 * Re-verify the hash-chain ledger. `?mode=raw` (default) recomputes hashes from the raw
 * observation bodies; `?mode=chain` runs the field-level chain check only.
 *
 * Status: 200 for any completed verification (ok OR tampered — both are valid results);
 * 503 only when the ledger secret is not configured (verification cannot run).
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const mode = parseVerifyMode(url.searchParams.get("mode"));
  const outcome = runVerify(getDb(), mode);
  if (!outcome.ok && outcome.unavailable === true) {
    return jsonResponse(outcome, 503);
  }
  return jsonResponse(outcome, 200);
}
