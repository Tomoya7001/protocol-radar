import { getDb } from "@/app/_data/db";
import { buildCompatMatrix } from "@/lib/aggregate";
import { jsonResponse } from "@/app/api/_lib/http";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-051 — GET /api/compat
 * Compatibility matrix: which tracked protocols compose (with a rationale per composing pair).
 */
export function GET(): Response {
  const matrix = buildCompatMatrix(getDb());
  return jsonResponse({ matrix });
}
