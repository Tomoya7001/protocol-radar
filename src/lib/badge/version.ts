/**
 * Version extraction and comparison for the embeddable status badge.
 *
 * Pure and offline: every input is passed in, so the badge's logic is unit-testable without a
 * database. The diff engine writes version changes into `events.summary` as
 * `version <before> -> <after>`; this module reads the "after" side back out.
 */

/** One observed event, reduced to just what version resolution needs. */
export interface VersionEventLike {
  type: string;
  summary: string | null;
  created_at: string;
}

/** `version <before> -> <after>` as written by the diff engine. */
const VERSION_BUMP_PATTERN = /^version\s+(.+?)\s+->\s+(.+)$/;

/**
 * Pull the post-change version out of a `version_bump` summary.
 *
 * Returns null for any other summary shape, so a future change to the diff engine's wording
 * degrades the badge to "unknown" instead of rendering a garbage string to thousands of
 * READMEs.
 */
export function parseVersionBump(summary: string | null): string | null {
  if (summary === null) return null;
  const m = VERSION_BUMP_PATTERN.exec(summary.trim());
  const after = m?.[2]?.trim();
  return after === undefined || after.length === 0 ? null : after;
}

/**
 * The most recently observed version for a protocol, or null when nothing has been observed.
 *
 * Scans newest-first by `created_at` rather than trusting array order, because callers pass
 * DTO lists whose ordering is not part of their contract.
 */
export function latestVersion(events: readonly VersionEventLike[]): string | null {
  let bestAt = Number.NEGATIVE_INFINITY;
  let best: string | null = null;
  for (const e of events) {
    if (e.type !== "version_bump") continue;
    const version = parseVersionBump(e.summary);
    if (version === null) continue;
    const at = Date.parse(e.created_at);
    const rank = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
    if (rank >= bestAt) {
      bestAt = rank;
      best = version;
    }
  }
  return best;
}

/**
 * Normalise a version for comparison only (never for display).
 *
 * Upstreams label the same release inconsistently — `v1.2.3`, `1.2.3`, `Release 2026-08-18`,
 * `MCP 2026-07-28`. Comparing raw strings would flag a project as outdated purely because its
 * README wrote the version differently from the upstream tag, which is the one failure mode
 * that would make maintainers rip the badge out.
 */
export function normalizeVersion(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(release|version|spec)\s+/, "")
    .replace(/^[a-z0-9-]+\s+(?=\d)/, "")
    .replace(/^v(?=\d)/, "")
    .replace(/\s+/g, "");
}

/** Verdict for a declared target against the latest observed version. */
export type VersionVerdict = "current" | "outdated" | "unknown";

/**
 * Compare a maintainer's declared target version against what we actually observe upstream.
 *
 * `unknown` when either side is missing — the badge then states that plainly instead of
 * guessing. Claiming "current" without evidence would be worse than saying nothing.
 */
export function compareToLatest(
  target: string | null,
  latest: string | null,
): VersionVerdict {
  if (target === null || latest === null) return "unknown";
  return normalizeVersion(target) === normalizeVersion(latest)
    ? "current"
    : "outdated";
}
