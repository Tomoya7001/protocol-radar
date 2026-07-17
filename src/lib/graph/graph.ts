import type { ProtocolStatus } from "@/lib/db";

/**
 * Feature D3 — Ecosystem relationship graph (pure builder).
 *
 * Synthesises TWO independent facts into one machine-readable graph:
 *   1. The CURATED, static relationships between agent protocols (see relations.ts) — competes /
 *      complements / depends_on / alternative_to. This is domain knowledge that is NOT derivable
 *      from the ledger (the ledger records how each protocol changes, not how two interoperate).
 *   2. The OBSERVED current state of each protocol the radar tracks (status + total change
 *      events), read from the live ledger by the route.
 *
 * The value: "how do these protocols relate, and what is each one's live status" becomes a single,
 * consistent, reproducible artefact — the kind of answer you cannot get consistently by "just
 * asking an AI". This builder is a pure function, so it is deterministic and testable offline.
 */

/** The relationship kinds we model. Kept small and well-defined on purpose. */
export type RelationType =
  | "complements"
  | "competes"
  | "depends_on"
  | "alternative_to";

/** A single curated relationship between two protocol keys, with an AI-readable caption. */
export interface Relation {
  /** Protocol key the edge points FROM. */
  source: string;
  /** Protocol key the edge points TO. */
  target: string;
  type: RelationType;
  /** Short rationale describing WHY the two relate ("keep the why"). */
  caption: string;
}

/** Live per-protocol state fed into the builder (a projection of the read layer). */
export interface GraphNodeInput {
  key: string;
  name: string;
  status: ProtocolStatus;
  events_total: number;
}

/** A node in the emitted graph. */
export interface GraphNode {
  key: string;
  name: string;
  status: ProtocolStatus;
  events_total: number;
}

/** An edge in the emitted graph (only ever between two present nodes). */
export interface GraphEdge {
  source: string;
  target: string;
  type: RelationType;
  caption: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Build the ecosystem graph from live protocol state + the static relation table.
 *
 * Integrity guarantees (verified by graph.test.ts):
 *  - Nodes are de-duplicated by `key` and ordered by `key` (deterministic output).
 *  - An edge is emitted ONLY when BOTH endpoints are present in the node set. A relation that
 *    references a key the radar does not track is silently dropped, so the graph is always
 *    internally consistent: every edge endpoint resolves to a real node.
 *  - Empty / partial input never throws.
 */
export function buildGraph(
  protocols: readonly GraphNodeInput[],
  relations: readonly Relation[],
): Graph {
  const seen = new Set<string>();
  const nodes: GraphNode[] = [];
  for (const p of [...protocols].sort((a, b) => a.key.localeCompare(b.key))) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    nodes.push({
      key: p.key,
      name: p.name,
      status: p.status,
      events_total: p.events_total,
    });
  }

  const present = new Set(nodes.map((n) => n.key));
  const edges: GraphEdge[] = [];
  for (const r of relations) {
    // Consistency rule: never emit an edge touching a protocol we do not track.
    if (!present.has(r.source) || !present.has(r.target)) continue;
    edges.push({
      source: r.source,
      target: r.target,
      type: r.type,
      caption: r.caption,
    });
  }

  return { nodes, edges };
}
