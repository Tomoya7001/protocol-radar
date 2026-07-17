import type { ProtocolSummaryDto } from "@/app/_data/queries";
import type { ProtocolFreshness } from "@/app/_data/freshness";
import { parseIsoMs } from "@/app/_data/freshness";
import type { EventType, ProtocolStatus } from "@/lib/db";

/**
 * Feature D2 — logic for GET /api/compare.
 *
 * PURE read-side transform: given the already-computed protocol summaries (the same DTOs the
 * dashboard / JSON-LD builders consume) and a list of requested keys, it produces a compact,
 * machine-readable side-by-side comparison. No DB access, no I/O — the route reads the ledger
 * once via getProtocolSummaries and hands the result here, so this stays trivially testable
 * offline with an explicit `now` (epoch ms).
 *
 * Design notes:
 *  - An unknown key is NOT an error: it is returned in-band as { found: false } so a partially
 *    valid request still succeeds (200). This makes the endpoint safe for AIs to fan out over
 *    a speculative key list.
 *  - Existing state judgments are REUSED, never re-derived: `status` is the protocol's own
 *    ProtocolStatus and `freshness` is the aggregated ProtocolFreshness from the read layer.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The most recent recorded change for a protocol, flattened for the comparison view. */
export interface CompareLatestEvent {
  type: EventType;
  summary: string | null;
  at: string;
}

/** One column of the comparison. `found: false` ⇒ every data field is null/zero. */
export interface CompareProtocol {
  key: string;
  name: string | null;
  found: boolean;
  /** Existing lifecycle status (reused). null when the key is unknown. */
  status: ProtocolStatus | null;
  /** Existing aggregated freshness (reused). null when the key is unknown. */
  freshness: ProtocolFreshness | null;
  events_total: number;
  last_change_at: string | null;
  days_since_last_change: number | null;
  latest_event: CompareLatestEvent | null;
}

export interface CompareResult {
  generated_at: string;
  count: number;
  protocols: CompareProtocol[];
}

/**
 * Parse the `?keys=` query value into a clean, de-duplicated, order-preserving list. Handles
 * null (param absent), blank entries and surrounding whitespace. An empty result signals the
 * caller to compare ALL protocols.
 */
export function parseKeys(raw: string | null): string[] {
  if (raw === null) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const key = part.trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function toCompareProtocol(
  key: string,
  summary: ProtocolSummaryDto | undefined,
  now: number,
): CompareProtocol {
  if (summary === undefined) {
    return {
      key,
      name: null,
      found: false,
      status: null,
      freshness: null,
      events_total: 0,
      last_change_at: null,
      days_since_last_change: null,
      latest_event: null,
    };
  }

  const last = summary.last_event;
  const lastChangeAt = last === null ? null : last.created_at;
  const lastChangeMs = parseIsoMs(lastChangeAt);
  const daysSince =
    lastChangeMs === null
      ? null
      : Math.max(0, Math.floor((now - lastChangeMs) / DAY_MS));

  return {
    key: summary.key,
    name: summary.name,
    found: true,
    status: summary.status,
    freshness: summary.freshness,
    events_total: summary.event_count,
    last_change_at: lastChangeAt,
    days_since_last_change: daysSince,
    latest_event:
      last === null
        ? null
        : { type: last.type, summary: last.summary, at: last.created_at },
  };
}

/**
 * Build the side-by-side comparison. `keys` is the parsed request list; when empty, ALL
 * protocols are compared (in the summaries' existing stable order). When keys are given, the
 * output preserves the caller's order, and unknown keys appear as { found: false }.
 */
export function buildComparison(
  summaries: ProtocolSummaryDto[],
  keys: string[],
  now: number,
): CompareResult {
  const byKey = new Map<string, ProtocolSummaryDto>();
  for (const summary of summaries) byKey.set(summary.key, summary);

  const requested = keys.length > 0 ? keys : summaries.map((s) => s.key);
  const protocols = requested.map((key) =>
    toCompareProtocol(key, byKey.get(key), now),
  );

  return {
    generated_at: new Date(now).toISOString(),
    count: protocols.length,
    protocols,
  };
}
