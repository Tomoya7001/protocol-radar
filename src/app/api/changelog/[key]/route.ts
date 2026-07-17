import { getDb } from "@/app/_data/db";
import { getProtocolDetail } from "@/app/_data/queries";
import { parseNow } from "@/app/api/_lib/http";
import {
  CHANGELOG_CONTENT_TYPE,
  NOT_FOUND_CONTENT_TYPE,
  notFoundMessage,
  renderChangelogMarkdown,
} from "@/lib/changelog/render";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * D5 — GET /api/changelog/:key
 * AI-ingestible Markdown change history for a single protocol (sibling of llms.txt): a
 * newest-first list of change events with a status/freshness summary and a generation
 * footer. Unknown key ⇒ 404 (plain text). Pure read path: performs no DB writes.
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
    return new Response(notFoundMessage(key), {
      status: 404,
      headers: { "content-type": NOT_FOUND_CONTENT_TYPE },
    });
  }

  const body = renderChangelogMarkdown(detail, now);
  return new Response(body, {
    status: 200,
    headers: { "content-type": CHANGELOG_CONTENT_TYPE },
  });
}
