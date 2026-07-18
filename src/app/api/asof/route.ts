import { buildAsOfResponse } from "@/lib/asof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * E1 - GET /api/asof
 * Reconstructs the landscape state of ALL protocols as of `?ts=<ISO-8601|epoch>` (required),
 * using only events observed at or before `ts`. The logic lives entirely in @/lib/asof; this
 * Route file only exports the Next.js-allowed runtime/dynamic/GET (never a handler field Next.js
 * rejects at build).
 */
export function GET(req: Request): Response {
  return buildAsOfResponse(req);
}
