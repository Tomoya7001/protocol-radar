import { getDb } from "@/app/_data/db";
import { getProtocolSummaries } from "@/app/_data/queries";
import { parseNow } from "@/app/api/_lib/http";
import { buildProtocolsJsonLd } from "@/lib/jsonld/build";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/jsonld — schema.org JSON-LD (Dataset embedding an ItemList of monitored protocols)
 * served as `application/ld+json` so search engines and AI agents can ingest Protocol Radar as
 * structured data. All shaping lives in `@/lib/jsonld/build`. Pure read path: performs no DB writes.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const protocols = getProtocolSummaries(getDb(), now);
  const doc = buildProtocolsJsonLd(protocols, url.origin);

  return new Response(JSON.stringify(doc, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/ld+json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
