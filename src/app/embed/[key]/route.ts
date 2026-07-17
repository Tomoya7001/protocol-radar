import { getDb } from "@/app/_data/db";
import { parseNow } from "@/app/api/_lib/http";
import { buildEmbedSvg } from "@/lib/embed/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * C1 — GET /embed/:key
 *
 * A richer, embeddable status CARD (self-contained SVG) for a single protocol, meant to be
 * dropped into external blogs/docs via `<img src=".../embed/mcp">`. Read-only: all logic and
 * every value live in `@/lib/embed/build` (which reuses the shared certificate/query read
 * layer), so this route only parses the request and frames the HTTP response. Unknown key ⇒ 404.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await ctx.params;
  const url = new URL(req.url);
  const now = parseNow(url);

  const svg = buildEmbedSvg(getDb(), key, now);
  if (svg === null) {
    return new Response(
      JSON.stringify({ error: "protocol_not_found", key }),
      { status: 404, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
