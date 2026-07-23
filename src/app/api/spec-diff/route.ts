import { handleSpecDiff } from "@/lib/specdiff/response";

/**
 * GET /api/spec-diff?key=<protocol>&from=<ISO|epoch>&to=<ISO|epoch> (feature F2).
 *
 * Read-only, deterministic section-level diff of a protocol's spec-page body between two
 * observed snapshots. All logic lives in @/lib/specdiff/response — this module exports ONLY
 * the Next.js route contract (GET + runtime + dynamic). A route file may not export arbitrary
 * helpers, so the handler is delegated rather than defined here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return handleSpecDiff(req);
}
