/**
 * Future-spec watchlist (F-020).
 *
 * These are PRE-ANNOUNCED specs that do not exist yet. The watchlist monitor
 * (src/watchers/watchlist.ts) fires an `appeared` event EXACTLY ONCE the first time a
 * watched URL returns real content. Until the canonical endpoint is published its URL is
 * unknown, so entries ship `active: false` with a TODO and are activated once the real
 * location is known — we do not guess a URL just to have something to poll.
 */
import type { WatchlistEntry } from "./types";

const DAILY = 24 * 3600;

export const WATCHLIST: WatchlistEntry[] = [
  {
    key: "watch-mcp-a2a-joint",
    name: "MCP × A2A joint spec (pre-announced)",
    feature: "F-020",
    kind: "http",
    // No canonical joint-spec URL published yet — watch the MCP spec index (where it would
    // land), NOT the bare homepage, which is already an ACTIVE MCP-site source. Reusing that
    // live URL is the exact kind of guess we forbid; it also collides with the real source.
    url: "https://modelcontextprotocol.io/specification",
    note: "Pre-announced MCP×A2A joint specification, expected Q3 2026",
    active: false,
    todo: "activate once the MCP×A2A joint spec publishes a canonical URL (do NOT guess)",
  },
  {
    key: "watch-w3c-tr-agent-protocol",
    name: "W3C AI Agent Protocol TR (pre-announced)",
    feature: "F-020",
    kind: "http",
    // Standards-track Technical Report not yet published — watch, do NOT guess.
    url: "https://www.w3.org/TR/",
    note: "W3C AI Agent Protocol standards-track TR, expected 2026-2027",
    active: false,
    todo: "activate once the W3C AI-Agent-Protocol TR publishes a canonical /TR/ URL",
  },
];
