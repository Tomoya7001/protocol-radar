# Protocol Radar — Feature Index

Legend: P0 = must ship for "done"; P1 = strong value, ship if AC pass; P2 = nice-to-have.
Layer: A = foundation, B = independent feature, C = integration/aggregation.

## Layer A — Foundation (build first, owned by ONE implementer in series)
| id | name | pri | layer | deps | owner group |
|----|------|-----|-------|------|-------------|
| F-001 | DB schema + migrations (protocols, sources, observations, events, diffs) | P0 | A | - | core |
| F-002 | HMAC hash-chain ledger primitive (append + verify) | P0 | A | F-001 | core |
| F-003 | Source registry + fetch core (HTTP/GitHub poll, ETag/since, retry/backoff) | P0 | A | F-001 | core |
| F-004 | Change/diff engine (version-bump, body diff, vanish-detection) | P0 | A | F-002,F-003 | core |
| F-005 | Scheduler/worker (cron loop, per-source cadence, lock, run log) | P0 | A | F-003,F-004 | core |

## Layer B — Protocol watchers (parallel; each owns its own source-config + watcher file)
| id | name | pri | layer | deps | owner group |
|----|------|-----|-------|------|-------------|
| F-010 | MCP watcher (spec repo tags, schema, spec site) | P0 | B | F-005 | watchers |
| F-011 | A2A watcher (Linux Foundation / a2a spec repo + agent-card schema) | P0 | B | F-005 | watchers |
| F-012 | x402 watcher (x402 spec, facilitator, a2a-x402 ext spec) | P0 | B | F-005 | watchers |
| F-013 | AP2 watcher (ap2-protocol spec repo + FIDO WG status page) | P0 | B | F-005 | watchers |
| F-014 | UCP watcher (Universal Commerce Protocol spec source) | P1 | B | F-005 | watchers |
| F-015 | A2UI watcher (declarative-UI protocol source) | P1 | B | F-005 | watchers |
| F-016 | AG-UI watcher (CopilotKit AG-UI repo/releases) | P1 | B | F-005 | watchers |
| F-017 | TAP watcher (Visa Trusted Agent Protocol public source) | P1 | B | F-005 | watchers |
| F-018 | ANP watcher (Agent Network Protocol / W3C DID-based source) | P2 | B | F-005 | watchers |
| F-019 | W3C AI-Agent-Protocol CG watcher (drafts/standards 2026-2027) | P0 | B | F-005 | watchers |
| F-020 | Future-spec watchlist (pre-announced, fires on first appearance: MCP/A2A joint spec Q3 2026, W3C TR) | P0 | B | F-005,F-004 | watchers |

## Layer B — Surface (web + api; one implementer)
| id | name | pri | layer | deps | owner group |
|----|------|-----|-------|------|-------------|
| F-030 | Dashboard: protocol grid (state, last-change, freshness badge) | P0 | B | F-010..F-019 | webapi |
| F-031 | Protocol detail page (event timeline + ledger verify link) | P0 | B | F-030,F-002 | webapi |
| F-032 | Public read API (GET protocols / events / verify) | P0 | B | F-031 | webapi |
| F-033 | Freshness/decay indicator (stale-source warning per protocol) | P0 | B | F-030 | webapi |
| F-034 | Verify page (re-compute hash-chain from raw, show OK/tampered) | P0 | B | F-002,F-032 | webapi |
| F-035 | EN/JA locale toggle (UI ja default, en optional) | P1 | B | F-030 | webapi |

## Layer B — Agent surface (mcp + x402; one implementer)
| id | name | pri | layer | deps | owner group |
|----|------|-----|-------|------|-------------|
| F-040 | MCP server (tools: list_protocols, get_protocol, get_events, verify) | P0 | B | F-032 | agentapi |
| F-041 | x402-metered endpoint (free tier + USDC-per-call paid tier) | P1 | B | F-040 | agentapi |
| F-042 | API key issuance + per-key rate metering | P1 | B | F-040 | agentapi |

## Layer C — Aggregation (integrator)
| id | name | pri | layer | deps | owner group |
|----|------|-----|-------|------|-------------|
| F-050 | Cross-protocol "latest moves" timeline (all events merged, ranked) | P0 | C | F-031 | integ |
| F-051 | Compatibility matrix (which protocols compose: MCP×A2A×x402×AP2…) | P1 | C | F-050 | integ |
| F-052 | Daily digest builder (JSON + markdown of last-24h changes) | P1 | C | F-050 | integ |

## Owner-file groups (no two groups edit the same files)
- core     -> src/lib/db/**, src/lib/ledger/**, src/lib/fetch/**, src/lib/diff/**, src/worker/**
- watchers -> src/watchers/**, src/config/sources/**
- webapi   -> src/app/**, src/app/api/** (except mcp/x402), src/components/**
- agentapi -> src/app/api/mcp/**, src/app/api/x402/**, src/lib/payments/**
- integ    -> src/lib/aggregate/**, src/app/api/timeline/**, src/app/api/compat/**

Conflict rule: Layer A (core) is a hard prerequisite — built first, in series, by ONE
implementer, before B/C start. After A is green, watchers / webapi / agentapi run in
parallel. integ (Phase C) starts after F-031 + watchers are green.
