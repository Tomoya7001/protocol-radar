# Protocol Radar — 99_EXECUTION

## Execution profile
- Engine-agnostic: runs under Agent Teams (teammate) OR dev-start /batch.
- Foundation (Layer A, F-001..F-005) is built FIRST, in series, by ONE implementer, before
  any Layer B/C work begins. After A is green, watchers / webapi / agentapi run in parallel.
  integ (Phase C) starts after F-031 + the P0 watchers are green.

## Team
- Lead (reviewer+instructor) — Opus
- Implementer A "core+watchers" — Opus — owns: core group, then watchers group
- Implementer B "webapi" — Opus — owns: webapi group
- Implementer C "agentapi" — Opus — owns: agentapi group
- Bug-hunter (QA) — Opus — adversarial review + AC tests for every feature
- Integrator — Opus — owns: integ group (Phase C)

(6 teammates incl. lead. If cost matters: implementers A/B/C -> Sonnet, keep Lead +
Bug-hunter on Opus. F-002 ledger stays Opus regardless of cost mode.)

## Completion (done)
All P0 features pass their acceptance_criteria + CI green + merged to main.
P0 set: F-001..F-005, F-010..F-013, F-019, F-020, F-030..F-034, F-040, F-050.
P1/P2 ship if their AC pass but are not required for "done".

## Ownership & conflicts
- owner_files in each feature file are authoritative. A teammate edits only its features' files.
- core group is a prerequisite for everything; never parallelize core with watchers.
- watchers share NO files with webapi/agentapi -> safe to parallelize once core is green.

## Quality gates (hooks enforced — do not bypass)
- PostToolUse(Write|Edit): prettier --write .
- Stop: npm test ; non-zero => fix before proceeding.
- TeammateIdle: exit 2 if a feature's AC tests are not green (keep working).
- TaskCompleted: exit 2 if AC tests fail OR (UI feature) 02_DESIGN.md conformance fails.

## Design gate
All UI conforms to docs/spec/02_DESIGN.md. §A universal rules are non-negotiable
(uniform borders only, tokens-only, :focus-visible, one primary CTA, keyboard reach,
hit>=32px, [data-theme] only, SVG-only icons / no emoji).

## Source-URL integrity rule (critical for this project)
NEVER fabricate a source URL. Each watcher validates its configured URLs at startup. A URL
that 404s is marked inactive + logged with a TODO; the worker continues. Real, known-good
starting sources (verify before use):
- MCP: modelcontextprotocol spec repo + spec site.
- A2A: Agent2Agent spec repo (Linux Foundation governed).
- x402: x402 spec + google-agentic-commerce/a2a-x402 (spec/v0.1/spec.md).
- AP2: ap2-protocol.org + its public GitHub spec repo + FIDO WG status.
- AG-UI: CopilotKit AG-UI repository.
- W3C: W3C AI Agent Protocol Community Group drafts/standards track.
If a source's canonical location is unknown at build time, leave it inactive with a TODO
rather than guessing — provenance integrity is the whole product.

## Language guard
Code/comments/DB/logs: English only. UI strings: Japanese (en bundle allowed via F-035).
No third language anywhere. Tom-facing summaries: Japanese.

## Checkpoint injection
After every 5 completed features, lead posts a SHORT Japanese summary to the user, then
continues without waiting.

## lead launch prompt (paste this to start)
```
You are the LEAD (reviewer + instructor), running on Opus. Read docs/spec/ fully,
including 02_DESIGN.md and 99_EXECUTION.md. Build the team from 00_OVERVIEW.md `team`:
- Spawn 3 implementer teammates on Opus: "core+watchers", "webapi", "agentapi".
- Spawn 1 bug-hunter (QA) on Opus: adversarially review code, hunt edge cases, and
  write/run tests for each feature's acceptance_criteria.
- Spawn 1 integrator on Opus for Phase C (F-050..F-052) after F-031 + P0 watchers are green.

Order of work:
1) Implementer "core+watchers" builds Layer A (F-001..F-005) FIRST, in series. Nobody else
   starts feature code until A passes its AC tests (bug-hunter confirms).
2) Then parallelize: "core+watchers" does F-010..F-020; "webapi" does F-030..F-035;
   "agentapi" does F-040..F-042.
3) Integrator does F-050..F-052 once F-031 + P0 watchers are green.

Ownership & conflicts:
- Each feature lists owner_files. A teammate edits only its features' owner_files.
- Features whose owner_files overlap go to the SAME teammate in series, never parallel.

Rules:
- Implement strictly to features/*.md acceptance_criteria.
- UI is governed by docs/spec/02_DESIGN.md. The palette/typography/density may be tailored,
  but the §A universal rules are NON-NEGOTIABLE regardless of palette:
  * NO partial-edge colored borders: a box/card/panel/callout has a UNIFORM border on all
    sides (same color+width) or none. Signal state via full background tint, full uniform
    border, or a leading icon — never one edge.
  * Use design tokens ONLY (no raw color/spacing/radius/font-size/z-index).
  * Every interactive element defines :focus-visible (full ring; never strip outline
    without a replacement).
  * Exactly one filled primary CTA per view; info/selected stays tinted.
  * All actions keyboard-reachable; hit targets >= 32px.
  * Theme via [data-theme] only.
  * Icons are SVG only — NEVER emoji as UI icons anywhere, nor as doc bullets/markers.
- NEVER fabricate a protocol source URL. Validate URLs at startup; 404 => mark source
  inactive + TODO, continue. Provenance integrity is the product.
- Quality gate is enforced by hooks (build/test). Do not bypass.
- Code, comments, DB, logs: English only. UI strings: Japanese (en bundle via F-035).
  Never use any other language anywhere.
- Track progress in .claude/progress.json (keys compatible with dev-start).
- CHECKPOINT: after every 5 completed features, post a short JAPANESE summary to the user,
  then keep going without waiting.
- A feature is approved only when bug-hunter confirms acceptance_criteria pass, INCLUDING
  02_DESIGN.md conformance for UI features.
- DONE when all P0 features pass acceptance_criteria, CI is green, and merged to main.
  Do not stop early; if unsure, continue.
```
