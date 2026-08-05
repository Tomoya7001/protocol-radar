import { getDb } from "@/app/_data/db";
import { getProtocolDetail, protocolExists } from "@/app/_data/queries";
import { parseNow } from "@/app/api/_lib/http";
import { buildHistoryCsv, type HistoryCsvEvent } from "@/lib/export/csv";
import { classifySeverity } from "@/lib/severity/classify";

/** Read from the ledger DB at request time (never statically prerendered), no network at request time. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plain-text content type for the 404 path. */
const NOT_FOUND_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * Feature H2 — GET /api/protocols/:key/history.csv
 * A single protocol's full observation/change history as a deterministic CSV, for data-science /
 * agent ingestion. Read-only: a request-time DB read, then pure CSV rendering. Rows are emitted
 * oldest-first (ascending seq) so the file reads as a chronological history. Unknown key ⇒ 404.
 *
 * NOTE: GET is the ONLY export in this module — Next.js treats stray exports in a route file as
 * additional route handlers and fails the build, so keep it that way.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await ctx.params;
  const db = getDb();

  if (!protocolExists(db, key)) {
    return new Response(`protocol not found: ${key}\n`, {
      status: 404,
      headers: { "content-type": NOT_FOUND_CONTENT_TYPE },
    });
  }

  const url = new URL(req.url);
  const now = parseNow(url);
  // Non-null: protocolExists was true above.
  const detail = getProtocolDetail(db, key, now);
  const rawEvents = detail?.events ?? [];

  // getProtocolDetail returns newest-first; export oldest-first for a readable history.
  const events: HistoryCsvEvent[] = rawEvents
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((e) => ({
      seq: e.seq,
      observed_at: e.created_at,
      kind: e.type,
      severity: classifySeverity({ type: e.type, diffs: e.diffs }).severity,
      summary: e.summary,
      hash: e.hash,
    }));

  const csv = buildHistoryCsv({ key, events });

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${key}-history.csv"`,
    },
  });
}
