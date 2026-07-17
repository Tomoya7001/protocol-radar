import type { Db } from "@/lib/db";
import { getProtocolByKey, type DiffKind, type EventType } from "@/lib/db";

/**
 * Read-side helper for the per-protocol CHANGE/DIFF endpoint (feature #6,
 * GET /api/protocols/:key/diff). It reuses the SAME ledger tables the web query layer reads
 * (`events` + `diffs`, F-001 schema) and NEVER mutates. Kept in its own module so the shared
 * queries.ts stays untouched while a sibling worker edits nearby files.
 *
 * Honesty note — what the schema actually stores per change:
 *  - `events`: type, summary, created_at, seq (the change itself).
 *  - `diffs`:  kind + a free-text `detail` per event. For `kind='version'` the worker writes
 *    detail as "<from> -> <to>" (see src/lib/diff/engine.ts), so before/after IS recoverable.
 *    For body/appear/vanish only a human summary string exists — there is no field-level
 *    before/after, so `from`/`to` stay null and we surface the summary instead.
 */

export interface ChangeDiffDto {
  kind: DiffKind;
  detail: string | null;
}

export interface ProtocolChangeDto {
  /** Ledger sequence of the change event (monotonic, newest = highest). */
  seq: number;
  type: EventType;
  /** ISO timestamp the change was recorded (events.created_at). */
  at: string;
  summary: string | null;
  /** Before value, when the schema stored a version diff ("<from> -> <to>"); else null. */
  from: string | null;
  /** After value, when the schema stored a version diff ("<from> -> <to>"); else null. */
  to: string | null;
  /** Every diff row attached to the event (kind + raw detail) — nothing invented. */
  diffs: ChangeDiffDto[];
}

interface ChangeEventRow {
  id: number;
  seq: number;
  type: EventType;
  summary: string | null;
  created_at: string;
}

/**
 * Recover before/after from a version diff's `detail` ("<from> -> <to>"). Returns nulls when
 * no version diff is present or the detail is not in that shape — never guesses a value.
 */
function deriveFromTo(diffs: ChangeDiffDto[]): {
  from: string | null;
  to: string | null;
} {
  const version = diffs.find((d) => d.kind === "version");
  if (version?.detail != null) {
    const parts = version.detail.split(" -> ");
    if (parts.length === 2) {
      return { from: parts[0] ?? null, to: parts[1] ?? null };
    }
  }
  return { from: null, to: null };
}

/**
 * Structured changelog for one protocol, newest-first, bounded by `limit`. Returns null when
 * the key is unknown so the caller can answer 404 (mirrors getProtocolDetail).
 */
export function listProtocolChanges(
  db: Db,
  key: string,
  limit: number,
): ProtocolChangeDto[] | null {
  const protocol = getProtocolByKey(db, key);
  if (protocol === undefined) return null;

  const eventRows = db
    .prepare(
      `SELECT id, seq, type, summary, created_at
         FROM events WHERE protocol_id = ? ORDER BY seq DESC LIMIT ?`,
    )
    .all(protocol.id, limit) as ChangeEventRow[];

  const diffStmt = db.prepare(
    "SELECT kind, detail FROM diffs WHERE event_id = ? ORDER BY id ASC",
  );

  return eventRows.map((e) => {
    const diffs = diffStmt.all(e.id) as ChangeDiffDto[];
    const { from, to } = deriveFromTo(diffs);
    return {
      seq: e.seq,
      type: e.type,
      at: e.created_at,
      summary: e.summary,
      from,
      to,
      diffs,
    };
  });
}
