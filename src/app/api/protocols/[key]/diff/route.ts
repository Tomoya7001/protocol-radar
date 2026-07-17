import { getDb } from "@/app/_data/db";
import { listProtocolChanges } from "@/app/_data/diffQueries";
import { jsonResponse, parseLimit } from "@/app/api/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Feature #6 — GET /api/protocols/:key/diff
 * The per-protocol CHANGE/DIFF feed: a structured changelog of one protocol's change events,
 * newest-first, exposing the before/after the schema actually stored (version diffs become
 * from/to; other kinds carry their summary). Read-only.
 *   - Unknown key ⇒ 404 (mirrors /api/protocols/:key).
 *   - `?limit=<1..500>` (invalid ⇒ 400, mirrors /api/events).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await ctx.params;
  const url = new URL(req.url);

  const limit = parseLimit(url, DEFAULT_LIMIT, MAX_LIMIT);
  if ("error" in limit) {
    return jsonResponse({ error: "invalid_limit", detail: limit.error }, 400);
  }

  const changes = listProtocolChanges(getDb(), key, limit.value);
  if (changes === null) {
    return jsonResponse({ error: "protocol_not_found", key }, 404);
  }

  return jsonResponse({ protocol: key, changes });
}
