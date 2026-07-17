/**
 * Feature #8 — change severity classification.
 *
 * Core idea: give a *meaning* to each change so an AI (or a human) can reason about it
 * without re-reading the raw diff. This is a PURE function layered on top of the existing
 * event/diff DTOs — it never touches the DB and never mutates its input.
 *
 * Honest mapping (we do not over-claim):
 *   - a protocol/endpoint that vanished        ⇒ "breaking" (consumers will break)
 *   - a spec/body change                        ⇒ "spec"     (behaviour may change)
 *   - a version bump                            ⇒ "minor"    (see note below)
 *   - a first appearance                        ⇒ "meta"     (informational, nothing broke)
 *
 * Note on version bumps: a bare version string ("1.2.0" → "2.0.0") does not reliably tell us
 * whether the change is major/minor/patch — semantics vary per protocol and are often lying.
 * Rather than guess a major-bump = breaking, we stay conservative and default to "minor".
 */

import type { DiffKind, EventType } from "@/lib/db/types";

export type Severity = "breaking" | "spec" | "minor" | "meta";

/** Higher rank = more severe. Used to pick the strongest signal among several diffs. */
const SEVERITY_RANK: Record<Severity, number> = {
  breaking: 3,
  spec: 2,
  minor: 1,
  meta: 0,
};

/** The event that is being classified. `diffs` is optional — classify from `type` alone if absent. */
export interface SeverityInput {
  type: EventType;
  diffs?: ReadonlyArray<{ kind: DiffKind }> | null;
}

/** The verdict carries the reason (the "why"), not only the label. */
export interface SeverityVerdict {
  severity: Severity;
  reason: string;
}

/** Map a single diff kind to its severity. */
function severityForDiffKind(kind: DiffKind): Severity {
  switch (kind) {
    case "vanish":
      return "breaking";
    case "body":
      return "spec";
    case "version":
      return "minor";
    case "appear":
      return "meta";
  }
}

/** Map an event type to its severity (the always-available fallback). */
function severityForType(type: EventType): Severity {
  switch (type) {
    case "vanished":
      return "breaking";
    case "spec_change":
      return "spec";
    case "version_bump":
      return "minor";
    case "appeared":
      return "meta";
  }
}

/**
 * Classify a change's severity. When diffs are present, the strongest diff kind wins (a change
 * can carry several diffs); otherwise we fall back to the event type. Returns `{severity, reason}`
 * so callers can surface the judgement basis, never a bare label.
 */
export function classifySeverity(event: SeverityInput): SeverityVerdict {
  const diffs = event.diffs ?? [];

  if (diffs.length > 0) {
    let topSeverity: Severity | undefined;
    let topKind: DiffKind | undefined;
    for (const d of diffs) {
      const s = severityForDiffKind(d.kind);
      if (topSeverity === undefined || SEVERITY_RANK[s] > SEVERITY_RANK[topSeverity]) {
        topSeverity = s;
        topKind = d.kind;
      }
    }
    if (topSeverity !== undefined && topKind !== undefined) {
      return {
        severity: topSeverity,
        reason: `diff kind "${topKind}" ⇒ ${topSeverity} (event type "${event.type}")`,
      };
    }
  }

  const severity = severityForType(event.type);
  return {
    severity,
    reason: `event type "${event.type}" ⇒ ${severity}`,
  };
}
