import type { Relation } from "./graph";

/**
 * Feature D3 — Static, CURATED relationships between the agent protocols the radar tracks.
 *
 * URL/knowledge-integrity rule (docs/spec/99_EXECUTION.md, "keep the why"): every edge below is a
 * real, publicly documented relationship between two protocols we actually monitor (keys match the
 * registry in src/config/sources/protocols.ts). We DO NOT fabricate relationships to fill the graph
 * — only edges we are confident about, each carrying a rationale. Most of these are the same
 * complementary compositions already vetted in src/lib/aggregate/compat.ts; the two agent-messaging
 * "alternative_to" edges are added here because a directed relation graph can express rivalry that a
 * boolean "composes" matrix cannot.
 *
 * The graph builder (graph.ts) intersects this table with the protocols actually present in the DB,
 * so any edge referencing a key not currently tracked is dropped and the graph stays consistent.
 *
 * relation types:
 *   complements    — the two are designed to be used together / one extends the other's use case
 *   competes       — the two target the same job and are positioned as rivals
 *   depends_on      — source is built ON TOP of target (target is a prerequisite layer)
 *   alternative_to — the two solve the same problem; picking one is picking against the other
 */
export const PROTOCOL_RELATIONS: readonly Relation[] = [
  // MCP (tool/context) and A2A (agent-to-agent tasking) are positioned by both projects as
  // complementary layers of the agent stack. (matches compat.ts)
  {
    source: "mcp",
    target: "a2a",
    type: "complements",
    caption: "MCP tools/context complement A2A agent-to-agent tasking",
  },
  // x402 meters paid access to MCP tool/server calls — a payment layer over MCP. (matches compat.ts)
  {
    source: "x402",
    target: "mcp",
    type: "complements",
    caption: "x402 meters paid access to MCP tool calls",
  },
  // The a2a-x402 extension adds HTTP-402 payments to A2A tasks — x402 complements A2A.
  // (matches compat.ts; x402's own registry source is the a2a-x402 extension spec)
  {
    source: "x402",
    target: "a2a",
    type: "complements",
    caption: "a2a-x402 extension adds HTTP-402 payments to A2A tasks",
  },
  // AP2 (Agent Payments Protocol) is built as an extension on top of A2A — AP2 depends on A2A.
  // (matches compat.ts; AP2's repo is google-agentic-commerce/AP2, layered on A2A)
  {
    source: "ap2",
    target: "a2a",
    type: "depends_on",
    caption: "AP2 is built as an extension on top of A2A",
  },
  // AP2 settles agent payments via the x402 rail (x402 is one of AP2's supported payment rails).
  // (matches compat.ts)
  {
    source: "ap2",
    target: "x402",
    type: "complements",
    caption: "AP2 settles agent payments via the x402 rail",
  },
  // ACP (Agent Communication Protocol, BeeAI/IBM) and A2A both standardise agent-to-agent
  // communication; they are widely described as alternative approaches to the same problem.
  {
    source: "acp",
    target: "a2a",
    type: "alternative_to",
    caption: "ACP and A2A are alternative agent-to-agent communication standards",
  },
];
