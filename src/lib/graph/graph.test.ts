import { describe, it, expect } from "vitest";
import { buildGraph, type GraphNodeInput, type Relation } from "./graph";
import { PROTOCOL_RELATIONS } from "./relations";

const RELATION_TYPES = new Set([
  "complements",
  "competes",
  "depends_on",
  "alternative_to",
]);

function node(key: string, extra: Partial<GraphNodeInput> = {}): GraphNodeInput {
  return {
    key,
    name: key.toUpperCase(),
    status: "active",
    events_total: 0,
    ...extra,
  };
}

describe("D3 buildGraph — consistency invariants", () => {
  it("emits nodes de-duplicated and ordered by key", () => {
    const graph = buildGraph(
      [node("x402"), node("mcp"), node("a2a"), node("mcp")],
      [],
    );
    expect(graph.nodes.map((n) => n.key)).toEqual(["a2a", "mcp", "x402"]);
  });

  it("carries live per-protocol state onto each node", () => {
    const graph = buildGraph(
      [node("mcp", { name: "Model Context Protocol", status: "active", events_total: 7 })],
      [],
    );
    expect(graph.nodes[0]).toEqual({
      key: "mcp",
      name: "Model Context Protocol",
      status: "active",
      events_total: 7,
    });
  });

  it("INVARIANT: every edge source/target resolves to a present node", () => {
    const graph = buildGraph(
      [node("mcp"), node("a2a"), node("x402"), node("ap2"), node("acp")],
      PROTOCOL_RELATIONS,
    );
    const keys = new Set(graph.nodes.map((n) => n.key));
    for (const e of graph.edges) {
      expect(keys.has(e.source)).toBe(true);
      expect(keys.has(e.target)).toBe(true);
    }
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it("drops edges whose endpoints are not tracked (unknown key excluded)", () => {
    const relations: Relation[] = [
      { source: "mcp", target: "a2a", type: "complements", caption: "ok — both present" },
      { source: "mcp", target: "zzz", type: "competes", caption: "target untracked" },
      { source: "zzz", target: "mcp", type: "competes", caption: "source untracked" },
      { source: "yyy", target: "zzz", type: "competes", caption: "both untracked" },
    ];
    const graph = buildGraph([node("mcp"), node("a2a")], relations);
    expect(graph.edges).toEqual([
      { source: "mcp", target: "a2a", type: "complements", caption: "ok — both present" },
    ]);
  });

  it("keeps only the edge subset supported by a PARTIAL protocol set", () => {
    // Only mcp + x402 present: the real relation table has an mcp↔x402 edge but every edge
    // referencing a2a/ap2/acp must be excluded.
    const graph = buildGraph([node("mcp"), node("x402")], PROTOCOL_RELATIONS);
    const keys = new Set(graph.nodes.map((n) => n.key));
    for (const e of graph.edges) {
      expect(keys.has(e.source)).toBe(true);
      expect(keys.has(e.target)).toBe(true);
    }
    expect(graph.edges).toEqual([
      {
        source: "x402",
        target: "mcp",
        type: "complements",
        caption: "x402 meters paid access to MCP tool calls",
      },
    ]);
  });

  it("does not throw on empty data and returns empty nodes/edges", () => {
    const graph = buildGraph([], PROTOCOL_RELATIONS);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("returns no edges when there are nodes but no relations", () => {
    const graph = buildGraph([node("mcp"), node("a2a")], []);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([]);
  });
});

describe("D3 relations table — well-formed and non-fabricated shape", () => {
  it("every relation has a valid type and a non-empty caption", () => {
    expect(PROTOCOL_RELATIONS.length).toBeGreaterThan(0);
    for (const r of PROTOCOL_RELATIONS) {
      expect(RELATION_TYPES.has(r.type)).toBe(true);
      expect(r.caption.trim().length).toBeGreaterThan(0);
      expect(r.source).not.toBe(r.target);
    }
  });

  it("contains no duplicate directed edges", () => {
    const seen = new Set<string>();
    for (const r of PROTOCOL_RELATIONS) {
      const id = `${r.source}->${r.target}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
