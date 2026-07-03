import { getDb } from "@/app/_data/db";
import { getProtocolDetail } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-032 — GET /api/protocols/:key
 * A single protocol with its full event timeline (with diffs and ledger hashes).
 * Unknown key ⇒ 404.
 */
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
  return jsonResponse(detail);
}
