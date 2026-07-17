/**
 * C2 — machine-readable discoverability manifest.
 *
 * Pure builder for the `/.well-known/protocol-radar.json` document: a single JSON entry point
 * that lets crawlers and AI agents auto-discover every structured-data endpoint Protocol Radar
 * exposes. It is the machine-readable sibling of `/llms.txt` — same read-only thesis (be the
 * source AI references), expressed as structured links instead of prose.
 *
 * STRICTLY READ-ONLY: this module derives everything from the request-origin base URL and a
 * static endpoint catalogue. It performs no DB access and writes nothing.
 */

/** One discoverable endpoint advertised by the manifest. */
export interface DiscoveryEndpoint {
  /** Stable machine identifier (used as the object key under `endpoints`). */
  id: string;
  /** Absolute URL to the endpoint (origin-prefixed; `{key}` left as a template where relevant). */
  url: string;
  /** MIME type the endpoint responds with. */
  contentType: string;
  /** Short human/agent-facing description of what the endpoint provides. */
  description: string;
}

export interface DiscoveryManifest {
  /** Self-describing schema marker so consumers can recognise the document shape. */
  $schema: "https://protocol-radar.dev/schema/discovery/v1";
  name: string;
  description: string;
  /** The resolved base URL (request origin) this manifest was built for. */
  baseUrl: string;
  endpoints: DiscoveryEndpoint[];
}

/** Strip a single trailing slash so `${base}${path}` never yields a double slash. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * The static catalogue of agent-facing endpoints. Paths mirror the real route handlers
 * (verified against `src/app/**`); `{key}` marks a per-protocol path template.
 */
const ENDPOINT_CATALOGUE: ReadonlyArray<Omit<DiscoveryEndpoint, "url"> & { path: string }> = [
  {
    id: "llms_txt",
    path: "/llms.txt",
    contentType: "text/plain",
    description:
      "llms.txt discovery document (Markdown) summarising the project and its API for LLMs.",
  },
  {
    id: "openapi",
    path: "/api/openapi.json",
    contentType: "application/json",
    description: "OpenAPI 3.1 specification of the public JSON API.",
  },
  {
    id: "feed",
    path: "/api/feed",
    contentType: "application/rss+xml",
    description: "RSS 2.0 feed of protocol change events for subscription.",
  },
  {
    id: "mcp",
    path: "/api/mcp",
    contentType: "application/json",
    description: "Model Context Protocol endpoint for agent tool access.",
  },
  {
    id: "certificate",
    path: "/api/certificate",
    contentType: "application/json",
    description:
      "As-of provenance certificate: a verifiable snapshot of a protocol's state at a point in time.",
  },
  {
    id: "security",
    path: "/api/security",
    contentType: "application/json",
    description: "Security disclosure / contact metadata (security.txt-style JSON).",
  },
  {
    id: "health",
    path: "/api/health",
    contentType: "application/json",
    description: "Service health and ledger-integrity status.",
  },
  {
    id: "jsonld",
    path: "/api/jsonld",
    contentType: "application/ld+json",
    description: "schema.org JSON-LD ItemList of monitored protocols.",
  },
  {
    id: "embed",
    path: "/embed/{key}",
    contentType: "image/svg+xml",
    description: "Embeddable per-protocol status card (SVG). Replace {key} with a protocol key.",
  },
];

/**
 * Build the discovery manifest for a given request-origin base URL. Pure: no DB, no writes.
 * `baseUrl` should be the request origin (e.g. `new URL(req.url).origin`).
 */
export function buildDiscoveryManifest(baseUrl: string): DiscoveryManifest {
  const base = normalizeBaseUrl(baseUrl);
  return {
    $schema: "https://protocol-radar.dev/schema/discovery/v1",
    name: "Protocol Radar",
    description:
      "A continuously-updated, tamper-proof monitor of AI-agent protocols. This manifest lists " +
      "every machine-readable endpoint so crawlers and AI agents can auto-discover the data.",
    baseUrl: base,
    endpoints: ENDPOINT_CATALOGUE.map((e) => ({
      id: e.id,
      url: `${base}${e.path}`,
      contentType: e.contentType,
      description: e.description,
    })),
  };
}
