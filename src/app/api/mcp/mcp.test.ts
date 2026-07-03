import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb, tamperRawBody } from "@/app/_data/fixtures";
import { GET as mcpGet, POST as mcpPost } from "./route";
import { TOOL_DEFINITIONS } from "./tools";

/**
 * F-040 acceptance tests — MCP tools return correct shapes for the seeded fixture data.
 * Offline: no transport, no network; the DB is an in-memory seeded ledger.
 */

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

function rpc(body: unknown): Request {
  return new Request(`http://test.local/api/mcp?now=${NOW}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface RpcResult {
  jsonrpc: string;
  id: string | number | null;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    [k: string]: unknown;
  };
  error?: { code: number; message: string };
}

async function call(body: unknown): Promise<RpcResult> {
  return (await (await mcpPost(rpc(body))).json()) as RpcResult;
}

/** Parse the JSON embedded in a tools/call text-content result. */
function toolPayload<T>(res: RpcResult): T {
  const text = res.result?.content?.[0]?.text;
  expect(text).toBeDefined();
  return JSON.parse(text as string) as T;
}

afterEach(() => {
  __setDbForTests(null);
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

describe("F-040 MCP protocol handshake", () => {
  it("initialize returns protocol version + server info", async () => {
    seedAndInject();
    const res = await call({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(res.result?.protocolVersion).toBe("2024-11-05");
    expect((res.result as { serverInfo?: { name?: string } }).serverInfo?.name).toBe(
      "protocol-radar",
    );
  });

  it("tools/list advertises exactly the four read tools", async () => {
    seedAndInject();
    const res = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = (res.result as { tools: Array<{ name: string }> }).tools
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(["get_events", "get_protocol", "list_protocols", "verify"]);
    expect(TOOL_DEFINITIONS.every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  it("GET returns a discovery document with the tool catalogue", async () => {
    seedAndInject();
    const body = (await (await mcpGet()).json()) as {
      server: { name: string };
      tools: Array<{ name: string }>;
    };
    expect(body.server.name).toBe("protocol-radar");
    expect(body.tools).toHaveLength(4);
  });

  it("notifications receive no response body (202)", async () => {
    seedAndInject();
    const res = await mcpPost(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
  });

  it("unknown method ⇒ JSON-RPC method-not-found error", async () => {
    seedAndInject();
    const res = await call({ jsonrpc: "2.0", id: 9, method: "does/not/exist" });
    expect(res.error?.code).toBe(-32601);
  });
});

describe("F-040 tool: list_protocols", () => {
  it("returns every seeded protocol with freshness", async () => {
    seedAndInject();
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_protocols", arguments: { now: NOW } },
    });
    expect(res.result?.isError).toBe(false);
    const payload = toolPayload<{
      count: number;
      protocols: Array<{ key: string; freshness: string; stale_warning: boolean }>;
    }>(res);
    expect(payload.count).toBe(5);
    const a2a = payload.protocols.find((p) => p.key === "a2a");
    expect(a2a?.freshness).toBe("stale");
    expect(a2a?.stale_warning).toBe(true);
  });
});

describe("F-040 tool: get_protocol", () => {
  it("returns a protocol with its full timeline + ledger hashes", async () => {
    seedAndInject();
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_protocol", arguments: { key: "mcp", now: NOW } },
    });
    const payload = toolPayload<{
      protocol: { key: string };
      events: Array<{ type: string; hash: string }>;
    }>(res);
    expect(payload.protocol.key).toBe("mcp");
    expect(payload.events).toHaveLength(3);
    expect(payload.events[0]?.type).toBe("spec_change");
    expect(payload.events[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("unknown key ⇒ isError tool result (not a protocol error)", async () => {
    seedAndInject();
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_protocol", arguments: { key: "nope" } },
    });
    expect(res.error).toBeUndefined();
    expect(res.result?.isError).toBe(true);
    expect(toolPayload<{ error: string }>(res).error).toBe("protocol_not_found");
  });

  it("missing required key ⇒ invalid_argument isError result", async () => {
    seedAndInject();
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_protocol", arguments: {} },
    });
    expect(res.result?.isError).toBe(true);
    expect(toolPayload<{ error: string }>(res).error).toBe("invalid_argument");
  });
});

describe("F-040 tool: get_events", () => {
  it("returns the full feed newest-first", async () => {
    seedAndInject();
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_events", arguments: {} },
    });
    const payload = toolPayload<{ count: number; events: Array<{ seq: number }> }>(res);
    expect(payload.count).toBeGreaterThan(0);
    const seqs = payload.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
  });

  it("filters by protocol key", async () => {
    seedAndInject();
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_events", arguments: { protocol: "mcp" } },
    });
    const payload = toolPayload<{ events: Array<{ protocol_key: string }> }>(res);
    expect(payload.events).toHaveLength(3);
    expect(payload.events.every((e) => e.protocol_key === "mcp")).toBe(true);
  });

  it("respects the limit and rejects an out-of-range limit", async () => {
    seedAndInject();
    const good = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_events", arguments: { limit: 2 } },
    });
    expect(toolPayload<{ events: unknown[] }>(good).events).toHaveLength(2);

    const bad = await call({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_events", arguments: { limit: 9999 } },
    });
    expect(bad.result?.isError).toBe(true);
    expect(toolPayload<{ error: string }>(bad).error).toBe("invalid_argument");
  });

  it("unknown protocol filter ⇒ protocol_not_found isError result", async () => {
    seedAndInject();
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_events", arguments: { protocol: "nope" } },
    });
    expect(res.result?.isError).toBe(true);
    expect(toolPayload<{ error: string }>(res).error).toBe("protocol_not_found");
  });
});

describe("F-040 tool: verify", () => {
  it("reports ok:true for an intact chain", async () => {
    seedAndInject();
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "verify", arguments: { mode: "raw" } },
    });
    expect(toolPayload<{ ok: boolean }>(res).ok).toBe(true);
  });

  it("reports ok:false with the tampered seq when raw content is corrupted", async () => {
    const db = seededDb(NOW);
    const seq = tamperRawBody(db);
    __setDbForTests(db);
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "verify", arguments: { mode: "raw" } },
    });
    const payload = toolPayload<{ ok: boolean; tampered_seq?: number }>(res);
    expect(payload.ok).toBe(false);
    expect(payload.tampered_seq).toBe(seq);
  });

  it("unknown tool name ⇒ invalid params error", async () => {
    seedAndInject();
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    });
    expect(res.error?.code).toBe(-32602);
  });
});
