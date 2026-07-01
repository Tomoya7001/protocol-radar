/**
 * Version/tag comparison. Semver-aware where possible, with a graceful fallback for
 * non-semver tags (date tags, commit-ish, arbitrary labels).
 */

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers (e.g. ["rc", "1"]); empty for a release. */
  prerelease: string[];
}

const SEMVER_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(tag: string): ParsedSemver | null {
  const m = SEMVER_RE.exec(tag.trim());
  if (!m) return null;
  const [, major, minor, patch, pre] = m;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: pre ? pre.split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // A release (no prerelease) outranks a prerelease.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] as string;
    const bi = b[i] as string;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) {
      const d = Number(ai) - Number(bi);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (an !== bn) {
      // Numeric identifiers have lower precedence than alphanumeric.
      return an ? -1 : 1;
    } else {
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/**
 * Compare two version tags. Returns >0 if `next` is newer than `prev`, <0 if older, 0 if
 * equal. When both parse as semver, semver ordering is used. Otherwise falls back to a
 * stable string comparison so ordering is deterministic (non-semver tags still classify a
 * change when they differ).
 */
export function compareVersions(prev: string, next: string): number {
  const a = parseSemver(prev);
  const b = parseSemver(next);

  if (a && b) {
    if (a.major !== b.major) return a.major < b.major ? -1 : 1;
    if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
    if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
    return comparePrerelease(a.prerelease, b.prerelease);
  }

  // Non-semver (or mixed): equal strings => 0, otherwise a deterministic ordering.
  if (prev === next) return 0;
  return prev < next ? -1 : 1;
}

/** A "version bump" is any change where the two tags differ (newer or a re-tag). */
export function isVersionBump(
  prev: string | null,
  next: string | null,
): boolean {
  if (!next) return false;
  if (!prev) return false;
  return compareVersions(prev, next) !== 0;
}
