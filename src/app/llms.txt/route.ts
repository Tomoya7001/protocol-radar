import { getDb } from "@/app/_data/db";
import { getProtocolSummaries } from "@/app/_data/queries";
import { resolveSiteUrl } from "@/lib/discovery/site";
import { buildLlmsTxt, type LlmsLink } from "@/lib/discovery/llms";

/** Read the monitored-protocol list from the ledger DB at request time. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Documentation / spec entry points (`## Docs`). */
const DOCS: readonly LlmsLink[] = [
  {
    path: "/",
    label: "Protocol Radar",
    description: "Live dashboard of monitored AI-agent protocols.",
  },
  {
    path: "/trust",
    label: "Trust & integrity",
    description: "How the tamper-proof HMAC hash-chained ledger works.",
  },
  {
    path: "/api/openapi.json",
    label: "OpenAPI spec",
    description: "OpenAPI 3.1 specification of the public JSON API.",
  },
  {
    path: "/api/jsonld",
    label: "JSON-LD",
    description: "schema.org JSON-LD ItemList of monitored protocols.",
  },
];

/**
 * Read-only, agent-facing API endpoints (`## Agent endpoints`). Paths mirror the real route
 * handlers under `src/app/api/**`; `{key}`/`{seq}` mark per-resource path templates.
 */
const ENDPOINTS: readonly LlmsLink[] = [
  {
    path: "/api/protocols",
    label: "/api/protocols",
    description: "JSON list of every monitored protocol with status and freshness.",
  },
  {
    path: "/api/answer",
    label: "/api/answer",
    description: "Natural-language question answering over the protocol ledger.",
  },
  {
    path: "/api/asof",
    label: "/api/asof",
    description: "Reconstruct the protocol landscape as of a point in time.",
  },
  {
    path: "/api/diff",
    label: "/api/diff",
    description: "Diff the landscape between two points in time.",
  },
  {
    path: "/api/report",
    label: "/api/report",
    description: "Auto-generated 'State of AI Protocols' week/month digest.",
  },
  {
    path: "/api/velocity",
    label: "/api/velocity",
    description: "Change-velocity / momentum metrics per protocol.",
  },
  {
    path: "/api/compare",
    label: "/api/compare",
    description: "Side-by-side comparison of two or more protocols.",
  },
  {
    path: "/api/graph",
    label: "/api/graph",
    description: "Relationship graph of protocols and their dependencies.",
  },
  {
    path: "/api/anomalies",
    label: "/api/anomalies",
    description: "Detected anomalies in protocol change activity.",
  },
  {
    path: "/api/spec-diff",
    label: "/api/spec-diff",
    description: "Structural diff between two protocol specification snapshots.",
  },
  {
    path: "/api/sdk-versions",
    label: "/api/sdk-versions",
    description: "Tracked SDK versions for each protocol.",
  },
  {
    path: "/api/changelog/{key}",
    label: "/api/changelog/{key}",
    description: "Full change timeline for one protocol (replace {key}).",
  },
  {
    path: "/api/proof/{seq}",
    label: "/api/proof/{seq}",
    description: "Hash-chain inclusion proof for one ledger event (replace {seq}).",
  },
  {
    path: "/api/certificate",
    label: "/api/certificate",
    description: "Verifiable as-of provenance certificate for a protocol's state.",
  },
  {
    path: "/api/openapi.json",
    label: "/api/openapi.json",
    description: "OpenAPI 3.1 specification of the public JSON API.",
  },
  {
    path: "/api/jsonld",
    label: "/api/jsonld",
    description: "schema.org JSON-LD ItemList of monitored protocols.",
  },
];

const TITLE = "Protocol Radar";
const SUMMARY =
  "A continuously-updated, tamper-proof monitor of AI-agent protocols, recorded to an " +
  "HMAC hash-chained ledger you can cite as a source of truth.";

/**
 * GET /llms.txt — machine-readable discovery document (llms.txt convention, text/plain) so LLMs
 * and agents can discover and cite Protocol Radar's read-only endpoints and tracked protocols.
 *
 * DB-backed at request time (`getProtocolSummaries`); base URL resolved the same way as
 * `sitemap.ts` (`resolveSiteUrl`). All rendering is delegated to the pure `buildLlmsTxt`. Pure
 * read path: performs no DB writes.
 */
export function GET(): Response {
  const base = resolveSiteUrl();
  const now = Date.now();
  const protocols = getProtocolSummaries(getDb(), now);

  const body = buildLlmsTxt({
    origin: base,
    title: TITLE,
    summary: SUMMARY,
    docs: DOCS,
    endpoints: ENDPOINTS,
    protocols: protocols.map((p) => ({ key: p.key, name: p.name })),
  });

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
