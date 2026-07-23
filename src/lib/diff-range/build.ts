import { getDb } from "@/app/_data/db";
import type { Db } from "@/lib/db";
import type { EventType, ProtocolStatus } from "@/lib/db";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import {
  reconstructLandscape,
  parseTs,
  type AsOfLandscape,
  type AsOfProtocolState,
} from "@/lib/asof";

/**
 * F3 - LANDSCAPE INTERVAL DIFF (GET /api/diff).
 *
 * Reports what changed across the WHOLE ecosystem between two instants `from` and `to`. It is
 * the interval sibling of E1's single-instant as-of snapshot: it REUSES @/lib/asof's
 * `reconstructLandscape` to rebuild the `from` scene and the `to` scene, then derives, per
 * protocol, the difference between the two reconstructions (status delta, appearance/vanish, and
 * the events that landed strictly inside the interval).
 *
 * As-of semantics are inherited verbatim from @/lib/asof: an event's instant is
 * `COALESCE(observation.fetched_at, event.created_at)` and a scene at `t` includes only events
 * with that instant `<= t`. The interval `(from, to]` therefore contains exactly the events
 * counted in the `to` scene but not in the `from` scene - so `events_added_count ==
 * to.events_upto_ts - from.events_upto_ts` by construction.
 *
 * STRICTLY READ-ONLY: this module (and its route) only SELECT from the ledger. Nothing here
 * mutates a row or touches the `content_hash == sha256(body)` invariant. The as-of library is
 * imported and reused unchanged - never edited.
 */

/** A single ledger event that fell inside the interval `(from, to]`. */
export interface DiffEvent {
  type: EventType;
  summary: string | null;
  /** The change instant: observation time, or ledger append time for ref-less events. */
  at: string;
}

/** The kinds of change a protocol can exhibit across the interval. */
export type ChangeKind =
  | "appeared"
  | "status_changed"
  | "new_events"
  | "vanished";

/** One protocol's difference between the `from` scene and the `to` scene (changed only). */
export interface ProtocolDiff {
  key: string;
  name: string;
  change_kinds: ChangeKind[];
  from_status: ProtocolStatus;
  to_status: ProtocolStatus;
  events_added_count: number;
  events_between: DiffEvent[];
}

/** Aggregate counts across every changed protocol. */
export interface DiffSummary {
  protocols_changed: number;
  events_added: number;
  appeared: number;
  vanished: number;
}

/** The whole-landscape interval diff document. */
export interface LandscapeDiff {
  /** The `from` instant actually applied (ISO-8601, UTC). */
  from: string;
  /** The `to` instant actually applied (ISO-8601, UTC). */
  to: string;
  /** When this document was produced (ISO-8601, UTC). */
  generated_at: string;
  summary: DiffSummary;
  changes: ProtocolDiff[];
}

type IntervalParse = { from_ms: number; to_ms: number } | { error: string };

/**
 * Parse and validate `?from=` and `?to=` (both REQUIRED, ISO-8601 or unix epoch via the reused
 * `parseTs`). Missing or unparseable operands, or `from > to`, are errors (HTTP 400 by the
 * caller). `from == to` is permitted and yields an empty interval.
 */
export function parseInterval(
  fromRaw: string | null,
  toRaw: string | null,
): IntervalParse {
  if (fromRaw === null) return { error: "from_required" };
  if (toRaw === null) return { error: "to_required" };

  const from = parseTs(fromRaw);
  if ("error" in from) return { error: "invalid_from" };
  const to = parseTs(toRaw);
  if ("error" in to) return { error: "invalid_to" };

  if (from.ms > to.ms) return { error: "from_after_to" };
  return { from_ms: from.ms, to_ms: to.ms };
}

interface IntervalEventRow {
  key: string;
  type: EventType;
  summary: string | null;
  at: string;
}

/**
 * All in-scope events whose instant falls strictly inside `(fromIso, toIso]`, across every
 * protocol, oldest-first (by seq). Mirrors @/lib/asof's scope predicate
 * (`COALESCE(o.fetched_at, e.created_at)`) so the counts reconcile exactly with the two scenes.
 * Pure read.
 */
function intervalEvents(
  db: Db,
  fromIso: string,
  toIso: string,
): IntervalEventRow[] {
  return db
    .prepare(
      `SELECT p.key                                AS key,
              e.type                               AS type,
              e.summary                            AS summary,
              COALESCE(o.fetched_at, e.created_at) AS at
         FROM events e
         JOIN protocols p ON p.id = e.protocol_id
         LEFT JOIN observations o ON o.id = e.ref_observation_id
        WHERE COALESCE(o.fetched_at, e.created_at) >  ?
          AND COALESCE(o.fetched_at, e.created_at) <= ?
        ORDER BY p.key ASC, e.seq ASC`,
    )
    .all(fromIso, toIso) as IntervalEventRow[];
}

/** Group interval events by protocol key, preserving the query's oldest-first order. */
function groupByKey(rows: IntervalEventRow[]): Map<string, DiffEvent[]> {
  const byKey = new Map<string, DiffEvent[]>();
  for (const row of rows) {
    const event: DiffEvent = {
      type: row.type,
      summary: row.summary,
      at: row.at,
    };
    const list = byKey.get(row.key);
    if (list === undefined) {
      byKey.set(row.key, [event]);
    } else {
      list.push(event);
    }
  }
  return byKey;
}

/** Derive the ordered change kinds for one protocol; empty when nothing changed. */
export function changeKindsFor(
  from: AsOfProtocolState,
  to: AsOfProtocolState,
  eventsAdded: number,
): ChangeKind[] {
  const kinds: ChangeKind[] = [];
  const appeared = !from.known_at_ts && to.known_at_ts;
  if (appeared) kinds.push("appeared");
  if (from.status !== to.status) kinds.push("status_changed");
  if (eventsAdded > 0) kinds.push("new_events");
  if (to.status === "vanished" && from.status !== "vanished") {
    kinds.push("vanished");
  }
  return kinds;
}

/**
 * Pure core: given the two reconstructed scenes and the interval events grouped by key, emit the
 * per-protocol diffs for changed protocols only, ordered by key (inherited from
 * `reconstructLandscape`). Both scenes list the same protocol set in the same order.
 */
export function computeChanges(
  fromLandscape: AsOfLandscape,
  toLandscape: AsOfLandscape,
  eventsByKey: Map<string, DiffEvent[]>,
): ProtocolDiff[] {
  const fromByKey = new Map<string, AsOfProtocolState>();
  for (const p of fromLandscape.protocols) fromByKey.set(p.key, p);

  const changes: ProtocolDiff[] = [];
  for (const to of toLandscape.protocols) {
    const from = fromByKey.get(to.key);
    if (from === undefined) continue; // same protocol set; defensive only.

    const events = eventsByKey.get(to.key) ?? [];
    const kinds = changeKindsFor(from, to, events.length);
    if (kinds.length === 0) continue; // unchanged protocols are omitted.

    changes.push({
      key: to.key,
      name: to.name,
      change_kinds: kinds,
      from_status: from.status,
      to_status: to.status,
      events_added_count: events.length,
      events_between: events,
    });
  }
  return changes;
}

/** Fold the per-protocol diffs into the aggregate summary. */
export function summarise(changes: ProtocolDiff[]): DiffSummary {
  let events = 0;
  let appeared = 0;
  let vanished = 0;
  for (const c of changes) {
    events += c.events_added_count;
    if (c.change_kinds.includes("appeared")) appeared += 1;
    if (c.change_kinds.includes("vanished")) vanished += 1;
  }
  return {
    protocols_changed: changes.length,
    events_added: events,
    appeared,
    vanished,
  };
}

/**
 * Compute the full interval diff. Reuses @/lib/asof to rebuild both scenes, then differences them
 * against the interval events. Pure read; deterministic given `nowMs`.
 */
export function diffLandscape(
  db: Db,
  fromMs: number,
  toMs: number,
  nowMs: number,
): LandscapeDiff {
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  const fromLandscape = reconstructLandscape(db, fromMs, nowMs);
  const toLandscape = reconstructLandscape(db, toMs, nowMs);
  const eventsByKey = groupByKey(intervalEvents(db, fromIso, toIso));

  const changes = computeChanges(fromLandscape, toLandscape, eventsByKey);

  return {
    from: fromIso,
    to: toIso,
    generated_at: new Date(nowMs).toISOString(),
    summary: summarise(changes),
    changes,
  };
}

/**
 * HTTP entry point. Parses `?from=` and `?to=` (both REQUIRED) plus optional `?now=<epoch-ms>`
 * for a deterministic `generated_at`. Missing/unparseable operands or `from > to` yield a
 * plain-JSON 400. Read-only throughout; all output flows through jsonResponse.
 */
export function buildDiffResponse(req: Request): Response {
  const url = new URL(req.url);

  const parsed = parseInterval(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  if ("error" in parsed) {
    return jsonResponse({ error: parsed.error }, 400);
  }

  const db = getDb();
  const nowMs = parseNow(url);
  const diff = diffLandscape(db, parsed.from_ms, parsed.to_ms, nowMs);
  return jsonResponse(diff, 200);
}
