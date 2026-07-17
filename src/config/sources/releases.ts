/**
 * GitHub Releases feeds for real-source observation (残② — 実ソースの常時観測).
 *
 * Distinct from `protocols.ts` (which watches GitHub *tags* + spec sites): this file lists
 * the repositories whose GitHub *Releases* we observe as a real, always-on source. Each entry
 * attaches to an EXISTING protocol by key so we reuse the same `protocols` row (no new
 * protocol identities invented) and simply add a second `sources` row pointing at the
 * repo's releases API endpoint.
 *
 * URL integrity (docs/spec/99_EXECUTION.md §"Source-URL integrity rule"):
 *  - Every `repo` below is a real, known-good repository already trusted by protocols.ts.
 *  - The releases endpoint is the public, unauthenticated GitHub REST API — no token needed
 *    (a token, if present in GITHUB_TOKEN, only raises the rate limit; see fetchCore.ts).
 *  - A repo that has published NO releases yet produces no event (first-appearance rule): we
 *    record provenance for what actually exists, never a placeholder.
 */
import type { SourceKind } from "@/lib/db/types";

const SIX_HOURS = 6 * 3600;

export interface GithubReleaseRepo {
  /** Existing protocol key (protocols.ts / DB `protocols.key`) this feed attaches to. */
  protocolKey: string;
  /** Protocol display name — used only if the protocol row does not yet exist. */
  protocolName: string;
  /** GitHub "owner/name" slug. */
  repo: string;
  /** Human-readable English label stored on the source row. */
  label: string;
  /** Poll cadence in seconds. */
  cadenceSeconds: number;
}

/** The GitHub REST API releases endpoint for a repo. per_page bounds the payload. */
export function releasesUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=30`;
}

/**
 * Repositories whose GitHub Releases we observe. Verified to publish real releases; a repo
 * that uses tags-only (e.g. coinbase/x402 at time of writing) is intentionally NOT listed —
 * its tags feed in protocols.ts already covers it, and an empty releases feed adds no signal.
 */
export const GITHUB_RELEASE_REPOS: GithubReleaseRepo[] = [
  {
    protocolKey: "mcp",
    protocolName: "Model Context Protocol",
    repo: "modelcontextprotocol/modelcontextprotocol",
    label: "MCP spec repo releases",
    cadenceSeconds: SIX_HOURS,
  },
  {
    protocolKey: "a2a",
    protocolName: "Agent2Agent Protocol",
    repo: "a2aproject/A2A",
    label: "A2A spec repo releases",
    cadenceSeconds: SIX_HOURS,
  },
  {
    protocolKey: "ap2",
    protocolName: "Agent Payments Protocol",
    repo: "google-agentic-commerce/AP2",
    label: "AP2 spec repo releases",
    cadenceSeconds: SIX_HOURS,
  },
  {
    protocolKey: "ag-ui",
    protocolName: "AG-UI Protocol",
    repo: "ag-ui-protocol/ag-ui",
    label: "AG-UI repo releases",
    cadenceSeconds: SIX_HOURS,
  },
  {
    protocolKey: "langgraph",
    protocolName: "LangGraph",
    repo: "langchain-ai/langgraph",
    label: "LangGraph repo releases",
    cadenceSeconds: SIX_HOURS,
  },
  {
    protocolKey: "openai-agents",
    protocolName: "OpenAI Agents SDK",
    repo: "openai/openai-agents-python",
    label: "OpenAI Agents SDK repo releases",
    cadenceSeconds: SIX_HOURS,
  },
  {
    protocolKey: "acp",
    protocolName: "Agent Communication Protocol",
    repo: "i-am-bee/acp",
    label: "ACP repo releases",
    cadenceSeconds: SIX_HOURS,
  },
  {
    protocolKey: "autogen",
    protocolName: "Microsoft AutoGen",
    repo: "microsoft/autogen",
    label: "AutoGen repo releases",
    cadenceSeconds: SIX_HOURS,
  },
  {
    protocolKey: "crewai",
    protocolName: "CrewAI",
    repo: "crewAIInc/crewAI",
    label: "CrewAI repo releases",
    cadenceSeconds: SIX_HOURS,
  },
];

/** Source kind used for every releases feed (reuses the generic GitHub transport). */
export const RELEASE_SOURCE_KIND: SourceKind = "github";
