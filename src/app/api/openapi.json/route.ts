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
const resp404Text = {
  description: "Referenced protocol does not exist (plain-text body).",
  content: { "text/plain": { schema: { type: "string" } } },
} as const;

/** Required `{key}` path parameter shared by the per-protocol routes. Unknown key ⇒ 404. */
const keyPathParam = {
  name: "key",
  in: "path",
  required: true,
  description: "Protocol key. Unknown key ⇒ 404.",
  schema: { type: "string" },
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
      "/api/velocity": {
        get: {
          summary: "Per-protocol change velocity / momentum derived from the observation ledger.",
          parameters: [nowParam],
          responses: { "200": okJson },
        },
      },
      "/api/compare": {
        get: {
          summary:
            "Side-by-side comparison of several protocols (maturity, freshness, activity, last change) in one call.",
          parameters: [
            {
              name: "keys",
              in: "query",
              required: false,
              description:
                "Comma-separated protocol keys (e.g. `mcp,a2a,x402`). Unknown keys are returned in-band as { found: false } (NOT 400/404). Absent/blank ⇒ compare ALL protocols.",
              schema: { type: "string" },
            },
            nowParam,
          ],
          responses: { "200": okJson },
        },
      },
      "/api/graph": {
        get: {
          summary:
            "Ecosystem relationship graph: observed protocol nodes joined with curated relation edges.",
          parameters: [nowParam],
          responses: { "200": okJson },
        },
      },
      "/api/asof": {
        get: {
          summary: "Reconstruct the state of every tracked protocol as of a chosen instant.",
          parameters: [
            {
              name: "ts",
              in: "query",
              required: true,
              description:
                "Reference instant: ISO-8601 or a unix epoch (seconds when < 1e12, else milliseconds). Missing or unparseable ⇒ 400.",
              schema: { type: "string" },
            },
            nowParam,
          ],
          responses: { "200": okJson, "400": resp400 },
        },
      },
      "/api/diff": {
        get: {
          summary: "Landscape interval diff: what changed across every protocol between two instants.",
          parameters: [
            {
              name: "from",
              in: "query",
              required: true,
              description:
                "Interval start: ISO-8601 or unix epoch. Required; missing/unparseable ⇒ 400.",
              schema: { type: "string" },
            },
            {
              name: "to",
              in: "query",
              required: true,
              description:
                "Interval end: ISO-8601 or unix epoch. Required; missing/unparseable or from > to ⇒ 400.",
              schema: { type: "string" },
            },
            nowParam,
          ],
          responses: { "200": okJson, "400": resp400 },
        },
      },
      "/api/anomalies": {
        get: {
          summary:
            "Notable/abnormal patterns detected in the ledger (spikes, dormancy breaks, vanished sources, churn).",
          parameters: [nowParam],
          responses: { "200": okJson },
        },
      },
      "/api/answer": {
        get: {
          summary:
            "Deterministic (no-LLM) Q&A over the ledger; always 200 (answered:false when unmatched).",
          parameters: [
            {
              name: "q",
              in: "query",
              required: false,
              description: "The question. Absent/empty ⇒ answered:false (still HTTP 200).",
              schema: { type: "string" },
            },
            nowParam,
          ],
          responses: { "200": okJson },
        },
      },
      "/api/report": {
        get: {
          summary:
            'Auto-generated "State of AI Protocols" digest (Markdown by default, JSON on request).',
          parameters: [
            {
              name: "period",
              in: "query",
              required: false,
              description: "Reporting window. `week` (default) or `month`.",
              schema: { type: "string", enum: ["week", "month"], default: "week" },
            },
            {
              name: "format",
              in: "query",
              required: false,
              description: "`md` (default) returns text/markdown; `json` returns structured sections.",
              schema: { type: "string", enum: ["md", "json"], default: "md" },
            },
            nowParam,
          ],
          responses: {
            "200": {
              description: "Report as text/markdown (default), or application/json when format=json.",
              content: {
                "text/markdown": { schema: { type: "string" } },
                "application/json": { schema: { type: "object" } },
              },
            },
          },
        },
      },
      "/api/spec-diff": {
        get: {
          summary: "Section-level diff of a protocol's spec-page body between two observed snapshots.",
          parameters: [
            {
              name: "key",
              in: "query",
              required: true,
              description:
                "Protocol key. Missing/blank ⇒ 400; unknown key or no observable spec page ⇒ 404.",
              schema: { type: "string" },
            },
            {
              name: "from",
              in: "query",
              required: false,
              description:
                "Lower snapshot bound: ISO-8601 or unix epoch. Default: the snapshot immediately before `to`. Unparseable ⇒ 400.",
              schema: { type: "string" },
            },
            {
              name: "to",
              in: "query",
              required: false,
              description:
                "Upper snapshot bound: ISO-8601 or unix epoch. Default: newest snapshot. Unparseable ⇒ 400.",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": okJson,
            "400": resp400,
            "404": {
              description: "Protocol key unknown, or the protocol has no observable spec page.",
              content: jsonContent,
            },
          },
        },
      },
      "/api/sdk-versions": {
        get: {
          summary:
            "Current observed SDK/package versions per protocol (read from the ledger, no network).",
          parameters: [
            {
              name: "protocol",
              in: "query",
              required: false,
              description: "Optional protocol-key filter. Unknown key ⇒ empty result (NOT 404).",
              schema: { type: "string" },
            },
            nowParam,
          ],
          responses: { "200": okJson },
        },
      },
      "/api/changelog/{key}": {
        get: {
          summary: "AI-ingestible Markdown change history for a single protocol.",
          parameters: [keyPathParam, nowParam],
          responses: {
            "200": {
              description: "Change history as Markdown.",
              content: { "text/markdown": { schema: { type: "string" } } },
            },
            "404": resp404Text,
          },
        },
      },
      "/api/proof/{seq}": {
        get: {
          summary: "Verifiable inclusion proof that a ledger event seq belongs to the hash chain.",
          parameters: [
            {
              name: "seq",
              in: "path",
              required: true,
              description:
                "Ledger event sequence number (positive integer). Non-integer/out-of-range ⇒ 400; well-formed but absent ⇒ 404.",
              schema: { type: "integer", minimum: 1 },
            },
          ],
          responses: {
            "200": okJson,
            "400": { description: "seq is not a positive integer in range.", content: jsonContent },
            "404": { description: "No ledger event with that seq.", content: jsonContent },
          },
        },
      },
      "/api/certificate": {
        get: {
          summary:
            "As-of provenance certificate for one protocol, with whole-chain ledger verification.",
          parameters: [
            {
              name: "protocol",
              in: "query",
              required: true,
              description: "Protocol key or name. Missing/blank ⇒ 400; unresolved ⇒ 404.",
              schema: { type: "string" },
            },
            {
              name: "asOf",
              in: "query",
              required: false,
              description: "Reference instant: ISO-8601 or unix epoch. Default: now. Unparseable ⇒ 400.",
              schema: { type: "string" },
            },
            {
              name: "mode",
              in: "query",
              required: false,
              description: "Ledger verification mode: `raw` (default) or `chain`.",
              schema: { type: "string", enum: ["raw", "chain"], default: "raw" },
            },
            nowParam,
          ],
          responses: { "200": okJson, "400": resp400, "404": resp404 },
        },
      },
      "/api/freshness": {
        get: {
          summary:
            "Trust/coverage self-report: how recent each protocol's latest observation is vs the freshness SLA.",
          parameters: [nowParam],
          responses: { "200": okJson },
        },
      },
      "/api/leaderboard": {
        get: {
          summary: "Cross-protocol ranking of which protocols are moving right now.",
          parameters: [nowParam],
          responses: { "200": okJson },
        },
      },
      "/api/protocols/{key}/diff": {
        get: {
          summary: "Per-protocol change/diff feed: a structured changelog, newest-first.",
          parameters: [keyPathParam, limitParam(100)],
          responses: { "200": okJson, "400": resp400, "404": resp404 },
        },
      },
      "/api/protocols/{key}/history.csv": {
        get: {
          summary: "One protocol's full observation/change history as deterministic CSV (oldest-first).",
          parameters: [keyPathParam, nowParam],
          responses: {
            "200": {
              description: "History as CSV (text/csv; served as an attachment).",
              content: { "text/csv": { schema: { type: "string" } } },
            },
            "404": resp404Text,
          },
        },
      },
      "/api/badge/{key}": {
        get: {
          summary: "Embeddable shields.io-style status badge (SVG) for a single protocol.",
          parameters: [keyPathParam, nowParam],
          responses: {
            "200": {
              description: "Status badge as SVG.",
              content: { "image/svg+xml": { schema: { type: "string" } } },
            },
            "404": resp404,
          },
        },
      },
      "/api/jsonld": {
        get: {
          summary:
            "schema.org JSON-LD Dataset (ItemList of monitored protocols) for structured-data ingestion.",
          parameters: [nowParam],
          responses: {
            "200": {
              description: "JSON-LD document (application/ld+json).",
              content: { "application/ld+json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/api/security": {
        get: {
          summary:
            "Per-protocol security advisories, gathered and normalized from configured upstreams.",
          parameters: [protocolFilterParam, limitParam(100), nowParam],
          responses: { "200": okJson, "400": resp400, "404": resp404 },
        },
      },
      "/api/health": {
        get: {
          summary:
            "Operational health snapshot of the ledger (verification, counts, freshness buckets, observation window).",
          parameters: [nowParam],
          responses: { "200": okJson },
        },
      },
      "/api/severity": {
        get: {
          summary:
            "Recent changes annotated with a severity label (breaking/spec/minor/meta) and its reason.",
          parameters: [protocolFilterParam, limitParam(100)],
          responses: { "200": okJson, "400": resp400, "404": resp404 },
        },
      },
      "/api/search": {
        get: {
          summary: "Case-insensitive substring search across protocols and change events.",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              description: "Search term. Missing/empty ⇒ 400.",
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              description:
                "Max items PER collection. Integer in [1, 100] (default 20). Out-of-range or non-integer ⇒ 400.",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            },
            nowParam,
          ],
          responses: { "200": okJson, "400": resp400 },
        },
      },
      "/api/export.json": {
        get: {
          summary:
            "Tamper-evident, citable export of the whole provenance surface (protocols + events + integrity).",
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              description:
                "Cap the embedded event list. Integer in [1, 2000]. Absent ⇒ all events. Out-of-range or non-integer ⇒ 400.",
              schema: { type: "integer", minimum: 1, maximum: 2000 },
            },
            nowParam,
          ],
          responses: {
            "200": {
              description: "Signed (tamper-evident) JSON export.",
              content: jsonContent,
            },
            "400": resp400,
          },
        },
      },
      "/api/feed/{key}": {
        get: {
          summary: "Subscribable RSS 2.0 feed for a single protocol's change events, newest first.",
          parameters: [keyPathParam, limitParam(50)],
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
      "/api/premium/report": {
        get: {
          summary:
            'x402-metered PREMIUM "State of AI Protocols" report (API-key auth + free/paid gate).',
          parameters: [
            {
              name: "period",
              in: "query",
              required: false,
              description: "Reporting window. `month` (default, full depth) or `week`.",
              schema: { type: "string", enum: ["week", "month"], default: "month" },
            },
            nowParam,
          ],
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
      "/api/pricing": {
        get: {
          summary:
            "Machine-readable pricing storefront: free quota, x402 pay-per-call price, and rate limits.",
          responses: { "200": okJson },
        },
      },
      "/api/timestamp": {
        get: {
          summary:
            "OpenTimestamps (Bitcoin) anchor status for the current ledger head (offline; no calendar contact).",
          responses: { "200": okJson },
        },
      },
      "/api/openapi.json": {
        get: {
          summary: "This document: the machine-consumable OpenAPI 3.1 contract for the public read API.",
          responses: {
            "200": {
              description: "OpenAPI 3.1 document.",
              content: jsonContent,
            },
          },
        },
      },
    },
  };

  return jsonResponse(document);
}
