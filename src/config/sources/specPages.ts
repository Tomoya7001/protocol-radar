/**
 * Generic spec-page content-hash feeds for real-source observation
 * (A2 — 汎用 spec-page 内容ハッシュ観測ソース).
 *
 * Distinct from `releases.ts` (GitHub *Releases* JSON) and `protocols.ts` (declarative seed
 * data): this file lists the ARBITRARY spec/RFC/registry *pages* whose normalized body content
 * we observe for change. Each entry attaches to an EXISTING protocol by key so we reuse the
 * same `protocols` row (no new protocol identities invented) and simply reuse/point a `sources`
 * row (kind "http") at the page. When the seed engine (protocols.ts) already created an http
 * source with the same (protocol, url), the observer reuses it rather than duplicating.
 *
 * URL integrity (docs/spec/99_EXECUTION.md §"Source-URL integrity rule"):
 *  - Every `url` below is a real, known-good spec source already trusted by protocols.ts (an
 *    ACTIVE http source there). We do NOT invent or guess a URL to broaden coverage — an
 *    unverified location is simply omitted here.
 *  - A page that 404/410s produces a `vanished` event through the existing diff engine; a
 *    changed body produces `spec_change`; the first successful observation produces `appeared`.
 */
import type { SourceKind } from "@/lib/db/types";

const TWELVE_HOURS = 12 * 3600;

export interface SpecPageSource {
  /** Existing protocol key (protocols.ts / DB `protocols.key`) this page attaches to. */
  protocolKey: string;
  /** Protocol display name — used only if the protocol row does not yet exist. */
  protocolName: string;
  /** Real, known-good spec/RFC/registry page URL. */
  url: string;
  /** Human-readable English label stored on the source row. */
  label: string;
  /** Poll cadence in seconds. */
  cadenceSeconds: number;
}

/** Identity helper mirroring releasesUrl(): the observed URL is the page URL itself. */
export function specPageUrl(url: string): string {
  return url;
}

/**
 * Spec pages whose normalized content we observe. Each URL is an ACTIVE, verified http source
 * already listed in protocols.ts — reused here so the content-hash observer and the seed data
 * agree on exactly the same location (the observer reuses the existing source row).
 */
export const SPEC_PAGE_SOURCES: SpecPageSource[] = [
  {
    protocolKey: "mcp",
    protocolName: "Model Context Protocol",
    // Canonical MCP spec/site (protocols.ts F-010, active).
    url: "https://modelcontextprotocol.io",
    label: "MCP spec site (content hash)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "ap2",
    protocolName: "Agent Payments Protocol",
    // Canonical AP2 site (protocols.ts F-013, active).
    url: "https://ap2-protocol.org",
    label: "AP2 spec site (content hash)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "x402",
    protocolName: "x402 Payment Protocol",
    // a2a-x402 extension spec, raw Markdown (protocols.ts F-012, active).
    url: "https://raw.githubusercontent.com/google-agentic-commerce/a2a-x402/main/spec/v0.1/spec.md",
    label: "a2a-x402 extension spec v0.1 (content hash)",
    cadenceSeconds: TWELVE_HOURS,
  },
  {
    protocolKey: "acp",
    protocolName: "Agent Communication Protocol",
    // Canonical ACP spec site (protocols.ts A1, active).
    url: "https://agentcommunicationprotocol.dev",
    label: "ACP spec site (content hash)",
    cadenceSeconds: TWELVE_HOURS,
  },
];

/** Source kind used for every spec-page feed (reuses the generic HTTP transport). */
export const SPEC_SOURCE_KIND: SourceKind = "http";
