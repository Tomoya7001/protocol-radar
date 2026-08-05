/**
 * Feature H2 — CSV export of a single protocol's full observation/change history.
 *
 * This module is a PURE renderer: given a protocol key and its ordered events, it returns a
 * deterministic RFC 4180-style CSV string. It performs NO DB access, reads NO clock, touches
 * NO environment, and does NO IO. Feed it the same input twice and you get byte-identical output
 * — which is exactly what data-science / agent ingestion needs.
 */

/** One row of history, already projected to the columns we export (route does the mapping). */
export interface HistoryCsvEvent {
  /** Monotonic per-protocol sequence number (ledger position). */
  seq: number;
  /** ISO-8601 timestamp the event was observed/recorded at. */
  observed_at: string;
  /** Event kind (e.g. appeared / version_bump / spec_change / vanished). */
  kind: string;
  /** Classified change severity (breaking / spec / minor / meta). */
  severity: string;
  /** Human summary; may be null when the source produced none. */
  summary: string | null;
  /** Ledger hash for this event (tamper-evident chain link). */
  hash: string;
}

/** Input to {@link buildHistoryCsv}: the protocol key plus its ordered events. */
export interface HistoryCsvInput {
  /** Protocol key this history belongs to (kept for provenance; not emitted as a column). */
  key: string;
  /** Events in the exact order they should appear as rows. Caller decides ordering. */
  events: ReadonlyArray<HistoryCsvEvent>;
}

/** Stable header row. Order is part of the contract — do NOT reorder without a version bump. */
export const HISTORY_CSV_HEADER = [
  "seq",
  "observed_at",
  "kind",
  "severity",
  "summary",
  "hash",
] as const;

/** RFC 4180 record separator. */
const CRLF = "\r\n";

/**
 * Escape a single CSV field. A field is quoted (and its interior quotes doubled) when it contains
 * a comma, a double-quote, or a CR/LF; otherwise it is emitted verbatim.
 */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Render one event as an already-escaped CSV record. */
function renderRow(event: HistoryCsvEvent): string {
  const fields = [
    String(event.seq),
    event.observed_at,
    event.kind,
    event.severity,
    event.summary ?? "",
    event.hash,
  ];
  return fields.map(escapeCsvField).join(",");
}

/**
 * Build the full CSV document: a header row followed by one row per event, in the order given.
 * Empty history ⇒ header row only. Every line (including the last) ends with CRLF.
 */
export function buildHistoryCsv(input: HistoryCsvInput): string {
  const lines = [HISTORY_CSV_HEADER.join(",")];
  for (const event of input.events) {
    lines.push(renderRow(event));
  }
  return lines.join(CRLF) + CRLF;
}
