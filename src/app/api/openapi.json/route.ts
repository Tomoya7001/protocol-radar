import { jsonResponse } from "@/app/api/_lib/http";

/** Serve the spec at request time so `servers` can reflect the actual request origin. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_VERSION = "1.0.0";

/**
 * Reusable OpenAPI parameter fragments. Constraints mirror the actual route handlers
 * (see each route.ts); do not add params a route does not accept.
 */
const nowParam = {
  name: "now",
  in: "query",
  required: false,
  description:
    "Freshness reference as epoch milliseconds. Absent ⇒ server clock. Used for deterministic/reproducible output.",
  schema: { type: "integer", format: "int64" },
} as const;

function limitParam(def: number) {
  return {
    name: "limit",
    in: "query",
    required: false,
    description: `Maximum number of items to return. Integer in [1, 500] (default ${def}). Out-of-range or non-integer ⇒ 400.`,
    schema: { type: "integer", minimum: 1, maximum: 500, default: def },
  };
}

const protocolFilterParam = {
  name: "protocol",
  in: "query",
  required: false,
  description: "Filter by protocol key. Unknown key ⇒ 404.",
  schema: { type: "string" },
} as const;

const jsonContent = {
  "application/json": { schema: { type: "object" } },
} as const;

const okJson = { description: "Success", content: jsonContent } as const;
const resp400 = {
  description: "Invalid query parameter",
  content: jsonContent,
} as const;
const resp404 = {
  description: "Referenced protocol does not exist",
  content: jsonContent,
} as const;

/**
 * Feature #4 — GET /api/openapi.json
 * Machine-consumable OpenAPI 3.1 contract for the public read API, so agents and developers
 * can discover every route, its parameters and its status codes without reading source.
 * `servers` is derived from the request origin so the document is self-hosting-aware.
 */
export function GET(req: Request): Response {
  const origin = new URL(req.url).origin;

  const document = {
    openapi: "3.1.0",
    info: {
      title: "Protocol Radar API",
      version: API_VERSION,
      description:
        "Read API for Protocol Radar — continuous, tamper-proof observation of agent-protocol " +
        "specs. Every endpoint is a pure read over an append-only, hash-chained ledger, so " +
        "responses are reproducible and independently verifiable (see GET /api/verify).",
    },
    servers: [{ url: origin, description: "This deployment (derived from request origin)" }],
    paths: {
      "/api/protocols": {
        get: {
          summary: "List every tracked protocol with state, last change and freshness.",
          parameters: [nowParam],
          responses: { "200": okJson },
        },
      },
      "/api/protocols/{key}": {
        get: {
          summary: "One protocol with its full event timeline (diffs and ledger hashes).",
          parameters: [
            {
              name: "key",
              in: "path",
              required: true,
              description: "Protocol key. Unknown key ⇒ 404.",
              schema: { type: "string" },
            },
            nowParam,
          ],
          responses: { "200": okJson, "404": resp404 },
        },
      },
      "/api/events": {
        get: {
          summary: "Cross-protocol event feed, newest first.",
          parameters: [protocolFilterParam, limitParam(100)],
          responses: { "200": okJson, "400": resp400, "404": resp404 },
        },
      },
      "/api/timeline": {
        get: {
          summary: "Cross-protocol latest moves: all events merged and ranked most-recent-first.",
          parameters: [limitParam(100)],
          responses: { "200": okJson, "400": resp400 },
        },
      },
      "/api/timeline/digest": {
        get: {
          summary: "Digest of changes over a trailing window.",
          parameters: [
            {
              name: "window",
              in: "query",
              required: false,
              description:
                "Trailing window in hours. Integer in [1, 720] (default 24). Out-of-range ⇒ 400.",
              schema: { type: "integer", minimum: 1, maximum: 720, default: 24 },
            },
            nowParam,
            {
              name: "format",
              in: "query",
              required: false,
              description: "`markdown` returns rendered text/markdown; otherwise JSON.",
              schema: { type: "string", enum: ["markdown"] },
            },
          ],
          responses: {
            "200": {
              description: "Digest as JSON, or text/markdown when format=markdown.",
              content: {
                "application/json": { schema: { type: "object" } },
                "text/markdown": { schema: { type: "string" } },
              },
            },
            "400": resp400,
          },
        },
      },
      "/api/verify": {
        get: {
          summary: "Re-verify the hash-chain ledger (raw or chain mode).",
          parameters: [
            {
              name: "mode",
              in: "query",
              required: false,
              description:
                "`raw` (default) recomputes hashes from raw observation bodies; `chain` runs the field-level chain check only.",
              schema: { type: "string", enum: ["raw", "chain"], default: "raw" },
            },
          ],
          responses: {
            "200": {
              description: "Verification completed (ok or tampered — both are valid results).",
              content: jsonContent,
            },
            "503": {
              description: "Ledger secret not configured; verification cannot run.",
              content: jsonContent,
            },
          },
        },
      },
      "/api/compat": {
        get: {
          summary: "Compatibility matrix: which tracked protocols compose, with a rationale per pair.",
          responses: { "200": okJson },
        },
      },
      "/api/x402": {
        get: {
          summary:
            "x402-metered protocol data endpoint (API-key auth + free/paid gate). No query parameters; auth and payment travel in headers.",
          parameters: [nowParam],
          responses: {
            "200": okJson,
            "401": { description: "Missing or unknown API key", content: jsonContent },
            "402": {
              description: "Payment required (free quota exhausted); body carries x402 accepts.",
              content: jsonContent,
            },
            "429": { description: "Per-key rate limit exceeded", content: jsonContent },
          },
        },
      },
      "/api/feed": {
        get: {
          summary: "Subscribable RSS 2.0 feed of protocol change events, newest first.",
          parameters: [protocolFilterParam, limitParam(50)],
          responses: {
            "200": {
              description: "RSS 2.0 XML feed.",
              content: { "application/rss+xml": { schema: { type: "string" } } },
            },
            "400": resp400,
            "404": resp404,
          },
        },
      },
      "/api/mcp": {
        get: {
          summary:
            "MCP discovery document (server info + tool catalogue). POST speaks JSON-RPC 2.0 for tool calls.",
          responses: { "200": okJson },
        },
      },
    },
  };

  return jsonResponse(document);
}
