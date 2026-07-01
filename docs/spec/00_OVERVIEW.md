project: protocol-radar
type: B
stack: Next.js 15 (App Router) + TypeScript + Tailwind + SQLite (better-sqlite3) + Node cron worker
code_language: en
ui_language: ja
forbidden_languages: any language other than English (code/comments/DB/logs) or Japanese (UI strings)
design_system: docs/spec/02_DESIGN.md
icon_policy: svg-only (lucide-react / inline SVG; no emoji icons anywhere, incl. docs)
goal: All P0 features pass acceptance criteria + CI green + merged to main

# Protocol Radar — Overview

## What this is
A self-hosted system that continuously OBSERVES the source-of-truth locations of
AI-agent protocols (MCP, A2A, x402, AP2, UCP, A2UI, AG-UI, TAP, ANP, and the W3C
AI Agent Protocol standardization track), records every appearance / version-bump /
spec-change / disappearance under an HMAC hash-chain ledger, and exposes that living
index three ways:
  1. A human web dashboard (Japanese UI) — "what is the newest state of each protocol".
  2. A read-only JSON API.
  3. An MCP server + x402-metered endpoint so AI agents themselves can query the index.

## Why it is NOT "just ask an AI"
Value lives in things an LLM structurally cannot do:
  - CONTINUOUS TIME: it polls sources 24/7; an LLM only acts when asked.
  - PERSISTENT MEMORY: it keeps every prior version; diffs (v1 -> v2) are the product.
  - PROVABLE PROVENANCE: every observation is HMAC-hash-chained = "we observed this
    first, at this time, unaltered". An LLM cannot prove when something was first seen.
  - AI BECOMES THE CONSUMER: agents query this index to be correct, instead of competing
    with it.

## Reuse note (important for implementers)
This is a FORK of the architecture proven in mcp-revenue-empire.com (daily-observed
HMAC-hash-chained ledgers with vanish-detection over public sources). The monitoring
engine, ledger primitive, diff-detection, and MCP/x402 layer follow the SAME patterns,
with the monitored sources swapped from Japanese public data to protocol spec sources.
Implementers build this fresh in this repo (no external private code is available here);
the patterns below are the contract.

## Relationship to existing assets — keep SEPARATE
Deploy under a NEW domain/brand (e.g. protocol-radar / protocolradar.dev). Do NOT merge
into mcp-revenue-empire. Rationale: mcp-revenue-empire's core value is TRUST/PROVENANCE of
stable public records; this system's core value is SPEED/INFORMATION-EDGE on fast-moving
specs. Mixing dilutes both brands. Engine is shared at the code-pattern level only.

## Type rationale
type: B (independent feature modules over a small shared foundation). Layer A = schema +
ledger + source-registry + fetch/diff core. Layer B = each protocol watcher + dashboard +
API + MCP/x402, mostly independent. Layer C = cross-protocol aggregation (timeline, compat).

## Team
team:
  lead: reviewer+instructor (Opus)
  implementers: 3 (Opus)
  bug_hunter: 1 (Opus)
  integrator: 1 (Opus)   # Phase C: cross-protocol timeline + compatibility matrix aggregation

Team-size rationale: ~24 P0/P1 features across 4 mostly-independent file groups
(core/foundation, watchers, web+api, mcp+x402). 3 implementers map to watchers / web+api /
mcp+x402; integrator handles Phase C aggregation; bug-hunter does adversarial QA + AC tests.
Total 6 teammates incl. lead — within the 3-5 implementer guidance for a project of this size.

## Cost guidance
Default all teammates on Opus (Tom prioritizes source quality, dislikes bugs). If cost
matters, drop the 3 implementers to Sonnet but KEEP lead + bug-hunter on Opus (review and
bug-hunting stay high-model). Ledger/crypto code (F-002) must stay Opus regardless.

## Absolute language rules
- Code, comments, DB identifiers, logs: ENGLISH ONLY.
- UI strings: JAPANESE (ui_language: ja).
- No third language anywhere. Tom-facing notes/NEXT_STEPS: Japanese.
- Working language may be English, but responses to Tom are always Japanese.
