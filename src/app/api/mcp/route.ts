import { getDb } from "@/app/_data/db";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import {
  handlePayload,
  MCP_PROTOCOL_VERSION,
  SERVER_INFO,
} from "./jsonrpc";
import { TOOL_DEFINITIONS } from "./tools";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-040 — MCP server endpoint.
 *
 * POST /api/mcp speaks JSON-RPC 2.0 (Model Context Protocol): initialize / tools/list /
 * tools/call over the four read tools. GET returns a static discovery document (server info
 * + tool catalogue) for humans and simple clients.
 *
 * Tools are backed by the committed `_data` query layer, so this surface never diverges from
 * the REST API (F-032) or the web UI.
 */

export function GET(): Response {
  return jsonResponse({
    server: SERVER_INFO,
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: "jsonrpc-2.0-http",
    tools: TOOL_DEFINITIONS,
  });
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const now = parseNow(url);

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return jsonResponse(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "could not read request body" },
      },
      400,
    );
  }

  const result = handlePayload(getDb(), raw, now);
  // All-notification payloads produce no reply → 202 Accepted with no body.
  if (result === null) {
    return new Response(null, { status: 202 });
  }
  return jsonResponse(result);
}
