import { getDb } from "@/app/_data/db";
import { getProtocolSummaries } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import { buildGraph } from "@/lib/graph/graph";
import { PROTOCOL_RELATIONS } from "@/lib/graph/relations";

/** Read live protocol state from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Feature D3 — GET /api/graph
 *
 * Ecosystem relationship graph: a machine-readable synthesis of (1) the radar's OBSERVED current
 * state for every tracked protocol and (2) the CURATED static relationships between those
 * protocols (competes / complements / depends_on / alternative_to). This is a consistent, reproducible
 * knowledge asset an AI cannot reliably reconstruct by "just asking" — the whole point of D3.
 *
 * Read-only: it projects the existing read layer (getProtocolSummaries) and joins it with the static
 * relation table. All graph logic lives in @/lib/graph; this route only wires them together.
 *
 * `?now=<epoch-ms>` is honoured (via parseNow) for deterministic output, matching the other routes.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const db = getDb();

  const summaries = getProtocolSummaries(db, now);
  const nodes = summaries.map((s) => ({
    key: s.key,
    name: s.name,
    status: s.status,
    events_total: s.event_count,
  }));

  const graph = buildGraph(nodes, PROTOCOL_RELATIONS);

  return jsonResponse({
    generated_at: new Date(now).toISOString(),
    nodes: graph.nodes,
    edges: graph.edges,
  });
}
