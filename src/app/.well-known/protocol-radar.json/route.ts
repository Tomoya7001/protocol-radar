import { buildDiscoveryManifest } from "@/lib/discovery/manifest";

/** Derive the origin at request time; never statically prerendered. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /.well-known/protocol-radar.json — machine discovery manifest.
 *
 * A single well-known entry point listing every agent-facing endpoint so crawlers and AI agents
 * can auto-discover Protocol Radar's structured data. All logic lives in
 * `@/lib/discovery/manifest`; this route only frames the HTTP response. Read-only: no DB access.
 */
export function GET(req: Request): Response {
  const origin = new URL(req.url).origin;
  const manifest = buildDiscoveryManifest(origin);
  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
