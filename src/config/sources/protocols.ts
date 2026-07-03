/**
 * Per-protocol source definitions (F-010..F-019).
 *
 * URL integrity (docs/spec/99_EXECUTION.md §"Source-URL integrity rule"):
 *  - Every ACTIVE url below is a real, known-good starting source drawn from the integrity
 *    list (GitHub tag APIs and canonical spec sites we are confident exist).
 *  - Where a canonical location is NOT verified, the source ships `active: false` with a
 *    `todo` naming what to re-source. We NEVER fabricate a URL to fill a gap.
 *  - The seed engine additionally HEAD-validates every active url at startup: a 404/410
 *    flips it inactive + logs a TODO, and the worker continues.
 *
 * Cadence rationale: fast-moving GitHub tag feeds poll every 6h; spec sites every 12h.
 */
import type { ProtocolDef } from "./types";

const SIX_HOURS = 6 * 3600;
const TWELVE_HOURS = 12 * 3600;

export const PROTOCOL_DEFS: ProtocolDef[] = [
  // ---- F-010 MCP (P0) ----
  {
    key: "mcp",
    name: "Model Context Protocol",
    feature: "F-010",
    priority: "P0",
    sources: [
      {
        kind: "github",
        // Canonical MCP spec repository (tags feed).
        url: "https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/tags",
        label: "MCP spec repo tags",
        cadenceSeconds: SIX_HOURS,
      },
      {
        kind: "http",
        // Canonical MCP spec/site.
        url: "https://modelcontextprotocol.io",
        label: "MCP spec site",
        cadenceSeconds: TWELVE_HOURS,
      },
    ],
  },

  // ---- F-011 A2A (P0) ----
  {
    key: "a2a",
    name: "Agent2Agent Protocol",
    feature: "F-011",
    priority: "P0",
    sources: [
      {
        kind: "github",
        // Linux Foundation-governed A2A spec repo (moved from google/A2A to a2aproject/A2A).
        url: "https://api.github.com/repos/a2aproject/A2A/tags",
        label: "A2A spec repo tags",
        cadenceSeconds: SIX_HOURS,
      },
      {
        kind: "http",
        // A2A publishes its spec site + agent-card schema, but the exact canonical schema
        // URL is not verified here — do NOT guess. Re-source before activating.
        url: "https://a2a-protocol.org",
        label: "A2A spec site (agent-card schema)",
        cadenceSeconds: TWELVE_HOURS,
        active: false,
        todo: "verify canonical A2A spec-site / agent-card schema URL, then activate",
      },
    ],
  },

  // ---- F-012 x402 (P0) ----
  {
    key: "x402",
    name: "x402 Payment Protocol",
    feature: "F-012",
    priority: "P0",
    sources: [
      {
        kind: "github",
        // Coinbase x402 spec repository (tags feed).
        url: "https://api.github.com/repos/coinbase/x402/tags",
        label: "x402 spec repo tags",
        cadenceSeconds: SIX_HOURS,
      },
      {
        kind: "http",
        // a2a-x402 extension spec — path is named explicitly in the integrity list.
        url: "https://raw.githubusercontent.com/google-agentic-commerce/a2a-x402/main/spec/v0.1/spec.md",
        label: "a2a-x402 extension spec (v0.1)",
        cadenceSeconds: TWELVE_HOURS,
      },
    ],
  },

  // ---- F-013 AP2 (P0) ----
  {
    key: "ap2",
    name: "Agent Payments Protocol",
    feature: "F-013",
    priority: "P0",
    sources: [
      {
        kind: "github",
        // AP2 public spec repository (tags feed).
        url: "https://api.github.com/repos/google-agentic-commerce/AP2/tags",
        label: "AP2 spec repo tags",
        cadenceSeconds: SIX_HOURS,
      },
      {
        kind: "http",
        // Canonical AP2 site, named explicitly in the integrity list.
        url: "https://ap2-protocol.org",
        label: "AP2 spec site",
        cadenceSeconds: TWELVE_HOURS,
      },
      {
        kind: "http",
        // FIDO WG status page tied to AP2 — canonical URL not verified. Do NOT guess.
        url: "https://fidoalliance.org",
        label: "FIDO WG status (AP2)",
        cadenceSeconds: TWELVE_HOURS,
        active: false,
        todo: "verify canonical FIDO working-group status page URL for AP2, then activate",
      },
    ],
  },

  // ---- F-019 W3C AI Agent Protocol CG (P0) ----
  {
    key: "w3c-agent-protocol",
    name: "W3C AI Agent Protocol Community Group",
    feature: "F-019",
    priority: "P0",
    sources: [
      {
        kind: "http",
        // The W3C AI Agent Protocol Community Group drafts/standards-track landing page.
        // The exact CG slug / drafts URL is NOT verified here; per the integrity rule we
        // ship it inactive with a TODO rather than guess the canonical location.
        url: "https://www.w3.org/community/",
        label: "W3C AI Agent Protocol CG drafts",
        cadenceSeconds: TWELVE_HOURS,
        active: false,
        todo: "verify canonical W3C AI-Agent-Protocol CG drafts/standards URL, then activate",
      },
    ],
  },

  // ---- F-014 UCP (P1) ----
  {
    key: "ucp",
    name: "Universal Commerce Protocol",
    feature: "F-014",
    priority: "P1",
    sources: [
      {
        kind: "http",
        // Canonical UCP spec source not verified — do NOT guess.
        url: "https://universalcommerceprotocol.org",
        label: "UCP spec source",
        cadenceSeconds: TWELVE_HOURS,
        active: false,
        todo: "verify canonical Universal Commerce Protocol spec URL, then activate",
      },
    ],
  },

  // ---- F-015 A2UI (P1) ----
  {
    key: "a2ui",
    name: "A2UI (declarative UI protocol)",
    feature: "F-015",
    priority: "P1",
    sources: [
      {
        kind: "http",
        // Canonical A2UI spec source not verified — do NOT guess.
        url: "https://a2ui.org",
        label: "A2UI spec source",
        cadenceSeconds: TWELVE_HOURS,
        active: false,
        todo: "verify canonical A2UI declarative-UI protocol spec URL, then activate",
      },
    ],
  },

  // ---- F-016 AG-UI (P1) ----
  {
    key: "ag-ui",
    name: "AG-UI Protocol",
    feature: "F-016",
    priority: "P1",
    sources: [
      {
        kind: "github",
        // CopilotKit AG-UI repository (tags feed).
        url: "https://api.github.com/repos/ag-ui-protocol/ag-ui/tags",
        label: "AG-UI repo tags",
        cadenceSeconds: SIX_HOURS,
      },
    ],
  },

  // ---- F-017 TAP (P1) ----
  {
    key: "tap",
    name: "Trusted Agent Protocol (Visa)",
    feature: "F-017",
    priority: "P1",
    sources: [
      {
        kind: "http",
        // Canonical Visa Trusted Agent Protocol public source not verified — do NOT guess.
        url: "https://developer.visa.com",
        label: "Visa TAP public source",
        cadenceSeconds: TWELVE_HOURS,
        active: false,
        todo: "verify canonical Visa Trusted Agent Protocol public spec URL, then activate",
      },
    ],
  },

  // ---- F-018 ANP (P2) ----
  {
    key: "anp",
    name: "Agent Network Protocol",
    feature: "F-018",
    priority: "P2",
    sources: [
      {
        kind: "github",
        // Agent Network Protocol (W3C DID-based) spec repo — canonical repo not verified.
        url: "https://api.github.com/repos/agent-network-protocol/AgentNetworkProtocol/tags",
        label: "ANP spec repo tags",
        cadenceSeconds: SIX_HOURS,
        active: false,
        todo: "verify canonical Agent Network Protocol (W3C DID) spec repo, then activate",
      },
    ],
  },
];

/** Convenience: the P0 protocol keys that MUST be registered for "done". */
export const P0_PROTOCOL_KEYS = PROTOCOL_DEFS.filter(
  (d) => d.priority === "P0",
).map((d) => d.key);
