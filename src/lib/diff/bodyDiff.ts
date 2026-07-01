/**
 * Lightweight line-level body-diff summary. This is a summary for the diffs table, not a
 * full patch: it reports added/removed line counts and a short preview. Deterministic and
 * dependency-free.
 */

export interface BodyDiffSummary {
  addedLines: number;
  removedLines: number;
  /** A short human-readable summary (English; UI localizes separately). */
  summary: string;
}

function lineSet(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split("\n")) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/**
 * Summarize the change from `prev` to `next` at line granularity (multiset difference).
 * Order-insensitive counting keeps this cheap and stable for large spec bodies.
 */
export function summarizeBodyDiff(prev: string, next: string): BodyDiffSummary {
  const before = lineSet(prev);
  const after = lineSet(next);

  let added = 0;
  for (const [line, count] of after) {
    added += Math.max(0, count - (before.get(line) ?? 0));
  }

  let removed = 0;
  for (const [line, count] of before) {
    removed += Math.max(0, count - (after.get(line) ?? 0));
  }

  return {
    addedLines: added,
    removedLines: removed,
    summary: `body changed: +${added} / -${removed} lines`,
  };
}
