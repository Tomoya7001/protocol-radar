import type { Db } from "@/lib/db";
import { callTool, TOOL_DEFINITIONS, ToolError } from "./tools";

/**
 * F-040 — minimal MCP server over JSON-RPC 2.0.
 *
 * Implements the subset of the Model Context Protocol needed to expose the four read tools:
 * `initialize`, `tools/list`, `tools/call` (plus `ping`). It is a pure function of the
 * request object and the DB, so it is unit-testable offline without a transport or a Next
 * server. The route module adapts Web `Request`/`Response` onto this.
 */

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const SERVER_INFO = { name: "protocol-radar", version: "0.1.0" } as const;

// JSON-RPC 2.0 standard error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Wrap a tool result value as an MCP text-content success payload. */
function toolResult(value: unknown): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    isError: false,
  };
}

/** Wrap a tool error as an MCP `isError` result (a result, not a JSON-RPC error). */
function toolError(message: string, code: string): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}

/**
 * Handle a single JSON-RPC request against the given DB. `now` is the default freshness
 * clock (deterministic in tests). Returns a response object, or null for a notification
 * (a request without an `id`), which by spec produces no reply.
 */
export function handleRpc(
  db: Db,
  request: unknown,
  now: number,
): JsonRpcResponse | null {
  if (!isRecord(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return err(null, INVALID_REQUEST, "invalid JSON-RPC 2.0 request");
  }

  const isNotification = !("id" in request) || request.id === undefined;
  const id = (request.id ?? null) as string | number | null;
  const method = request.method;
  const params = request.params;

  // Notifications (e.g. "notifications/initialized") get no response.
  if (isNotification) {
    return null;
  }

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: TOOL_DEFINITIONS });

    case "tools/call": {
      if (!isRecord(params) || typeof params.name !== "string") {
        return err(id, INVALID_PARAMS, "tools/call requires a string `name`");
      }
      const args = isRecord(params.arguments) ? params.arguments : {};
      try {
        const value = callTool(db, params.name, args, now);
        return ok(id, toolResult(value));
      } catch (e) {
        if (e instanceof ToolError) {
          if (e.code === "unknown_tool") {
            return err(id, INVALID_PARAMS, e.message, { code: e.code });
          }
          // Tool-level failures are surfaced as MCP isError results.
          return ok(id, toolError(e.message, e.code));
        }
        return err(id, INTERNAL_ERROR, "internal error");
      }
    }

    default:
      return err(id, METHOD_NOT_FOUND, `method not found: ${method}`);
  }
}

/**
 * Parse a raw request body and dispatch. Supports a single request object or a batch array.
 * Returns the response(s) to serialise, or null when nothing should be sent (all
 * notifications). On unparseable JSON returns a single parse-error response.
 */
export function handlePayload(
  db: Db,
  raw: string,
  now: number,
): JsonRpcResponse | JsonRpcResponse[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(null, PARSE_ERROR, "parse error");
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return err(null, INVALID_REQUEST, "empty batch");
    }
    const responses = parsed
      .map((r) => handleRpc(db, r, now))
      .filter((r): r is JsonRpcResponse => r !== null);
    return responses.length === 0 ? null : responses;
  }

  return handleRpc(db, parsed, now);
}
