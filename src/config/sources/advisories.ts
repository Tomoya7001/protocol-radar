/**
 * A3 — Per-protocol security-advisory lookup targets.
 *
 * Maps a monitored protocol `key` to the upstream GitHub repository whose PUBLISHED security
 * advisories (GHSA/CVE) we query via `GET /repos/{owner}/{repo}/security-advisories`.
 *
 * Integrity (docs/spec/99_EXECUTION.md source-URL integrity rule): every owner/repo below is a
 * REAL repository already tracked as a `github` source in `./protocols.ts` — we reuse the exact
 * same repo, we do NOT invent one. Protocols whose canonical repo is NOT verified (spec-site /
 * homepage only: w3c-agent-protocol, ucp, a2ui, tap) have NO target here — the endpoint returns
 * an empty advisory set for them rather than guessing a repository. New protocols default to no
 * target (empty), which is the safe read-only behavior.
 */
import type { AdvisoryQuery } from "@/lib/fetch/advisories";

/**
 * protocol key -> advisory lookup targets. Keys mirror `PROTOCOL_DEFS[].key`; only protocols
 * with a verified GitHub repo appear. A protocol may map to several repos in principle, hence
 * the array — today each has at most one.
 */
export const ADVISORY_TARGETS: Record<string, AdvisoryQuery[]> = {
  // Real repos, identical to the `github` tag-feed sources in ./protocols.ts.
  mcp: [
    { kind: "github", owner: "modelcontextprotocol", repo: "modelcontextprotocol" },
  ],
  a2a: [{ kind: "github", owner: "a2aproject", repo: "A2A" }],
  x402: [{ kind: "github", owner: "coinbase", repo: "x402" }],
  ap2: [{ kind: "github", owner: "google-agentic-commerce", repo: "AP2" }],
  "ag-ui": [{ kind: "github", owner: "ag-ui-protocol", repo: "ag-ui" }],
  anp: [
    {
      kind: "github",
      owner: "agent-network-protocol",
      repo: "AgentNetworkProtocol",
    },
  ],
  // A1 monitored-protocol expansion — real SDK/framework repos.
  langgraph: [{ kind: "github", owner: "langchain-ai", repo: "langgraph" }],
  "openai-agents": [
    { kind: "github", owner: "openai", repo: "openai-agents-python" },
  ],
  acp: [{ kind: "github", owner: "i-am-bee", repo: "acp" }],
  autogen: [{ kind: "github", owner: "microsoft", repo: "autogen" }],
  crewai: [{ kind: "github", owner: "crewAIInc", repo: "crewAI" }],
};

/** Advisory targets for a protocol key. Unknown / repo-less protocols => [] (never throws). */
export function advisoryTargetsFor(key: string): AdvisoryQuery[] {
  return ADVISORY_TARGETS[key] ?? [];
}
