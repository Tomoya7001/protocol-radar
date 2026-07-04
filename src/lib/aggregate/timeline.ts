import type { Db, EventType } from "@/lib/db";

/**
 * Layer C aggregation — F-050 cross-protocol "latest moves" timeline.
 *
 * Pure read-side aggregation over the ledger the worker writes: every protocol's events
 * merged into ONE feed and ranked most-recent-first with a deterministic tie-break. No
 * wall-clock is read here — ordering is derived entirely from stored, immutable fields, so
 * the same DB always produces the same ranking (offline-testable).
 *
 * "When did it happen" = the referenced observation's `fetched_at` (the moment the change
 * was observed in the world), NOT the ledger row's `created_at` (which is the wall-clock at
 * append() time and is therefore non-deterministic in fixtures). Events without a referenced
 * observation fall back to `created_at`. Ties on the occurrence timestamp break by `seq`
 * DESC — the monotonic ledger sequence — so the order is total and stable.
 */

export interface TimelineEntry {
  /** Monotonic ledger sequence (global across all protocols). */
  seq: number;
  protocol_key: string;
  protocol_name: string;
  type: EventType;
  summary: string | null;
  /** ISO-8601 — when the change was observed (observation.fetched_at, or created_at). */
  occurred_at: string;
  /** ISO-8601 — when the ledger row was written (event.created_at). */
  recorded_at: string;
  /** Ledger hash of the event (provenance handle). */
  hash: string;
}

export interface TimelineOptions {
  /** Cap the number of entries returned (after ranking). Absent => all. */
  limit?: number;
}

interface TimelineRow {
  seq: number;
  protocol_key: string;
  protocol_name: string;
  type: EventType;
  summary: string | null;
  occurred_at: string;
  recorded_at: string;
  hash: string;
}

/**
 * Deterministic ranking: most recent `occurred_at` first; ties broken by `seq` DESC.
 * Exported so callers/tests can reason about (and re-apply) the exact contract.
 */
export function compareTimelineEntries(
  a: TimelineEntry,
  b: TimelineEntry,
): number {
  const at = Date.parse(a.occurred_at);
  const bt = Date.parse(b.occurred_at);
  if (at !== bt) return bt - at; // newer occurrence first
  return b.seq - a.seq; // stable tie-break on the monotonic ledger seq
}

/**
 * Build the merged cross-protocol timeline (F-050). Reads all events joined to their
 * protocol and (optionally) their referenced observation, then ranks them deterministically.
 */
export function buildTimeline(
  db: Db,
  opts: TimelineOptions = {},
): TimelineEntry[] {
  const rows = db
    .prepare(
      `SELECT e.seq AS seq,
              p.key AS protocol_key,
              p.name AS protocol_name,
              e.type AS type,
              e.summary AS summary,
              COALESCE(o.fetched_at, e.created_at) AS occurred_at,
              e.created_at AS recorded_at,
              e.hash AS hash
         FROM events e
         JOIN protocols p ON p.id = e.protocol_id
         LEFT JOIN observations o ON o.id = e.ref_observation_id`,
    )
    .all() as TimelineRow[];

  const ranked = rows
    .map((r) => ({ ...r }) as TimelineEntry)
    .sort(compareTimelineEntries);

  if (opts.limit != null && opts.limit >= 0) {
    return ranked.slice(0, opts.limit);
  }
  return ranked;
}
