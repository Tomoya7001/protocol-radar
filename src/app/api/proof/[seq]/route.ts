import { getDb } from "@/app/_data/db";
import { jsonResponse } from "@/app/api/_lib/http";
import { parseSeq, getInclusionProof } from "@/lib/proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F5 — GET /api/proof/:seq
 * Return a verifiable inclusion proof that ledger event `seq` belongs to the HMAC-SHA256
 * hash chain: the event's bound fields, its hash/prev_hash, the (seq, hash, prev_hash)
 * chain from the event to head, the head hash, and a short recompute recipe. READ-ONLY.
 *
 * Status:
 *  - 400 `{error:"invalid_seq"}` when the segment is not a positive integer in range.
 *  - 404 `{error:"not_found"}`  when the seq is well-formed but absent from the ledger.
 *  - 200 with the proof otherwise.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ seq: string }> },
): Promise<Response> {
  const { seq } = await ctx.params;

  const parsed = parseSeq(seq);
  if (!parsed.ok) {
    return jsonResponse({ error: "invalid_seq" }, 400);
  }

  const proof = getInclusionProof(getDb(), parsed.seq);
  if (proof === null) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  return jsonResponse(proof, 200);
}
