import { buildDiffResponse } from "@/lib/diff-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F3 - GET /api/diff?from=<ISO|epoch>&to=<ISO|epoch>
 * Landscape interval diff: what changed across every tracked protocol between `from` and `to`.
 * All logic lives in @/lib/diff-range (which reuses @/lib/asof); this Route file only exports the
 * Next.js-allowed runtime/dynamic/GET, never a handler field Next.js rejects at build.
 */
export function GET(req: Request): Response {
  return buildDiffResponse(req);
}
