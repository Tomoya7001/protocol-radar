import type { Db } from "@/lib/db";
import {
  getProtocolByKey,
  listProtocols,
  type DiffKind,
  type EventType,
  type ProtocolStatus,
  type SourceKind,
  type SourceRow,
} from "@/lib/db";
import {
  classifyProtocol,
  classifySource,
  isStaleWarning,
  type ProtocolFreshness,
  type SourceFreshness,
} from "./freshness";

/**
 * Read-side query layer for the web surface. Produces STABLE, JSON-serialisable DTOs (the
 * public API contract of F-032) from the ledger tables the worker writes. All functions take
 * an explicit `now` (epoch ms) so freshness is deterministic and testable offline.
 *
 * These are pure read queries over the shared foundation (F-001 schema); they never mutate
 * and never re-implement Layer A domain logic.
 */

export interface SourceDto {
  id: number;
  kind: SourceKind;
  url: string;
  label: string | null;
  active: boolean;
  cadence_seconds: number;
  last_polled_at: string | null;
  last_status: number | null;
  freshness: SourceFreshness;
}

export interface LastEventDto {
  seq: number;
  type: EventType;
  summary: string | null;
  created_at: string;
}

export interface ProtocolSummaryDto {
  key: string;
  name: string;
  layer: string | null;
  status: ProtocolStatus;
  freshness: ProtocolFreshness;
  stale_warning: boolean;
  event_count: number;
  last_event: LastEventDto | null;
  sources: SourceDto[];
}

export interface DiffDto {
  kind: DiffKind;
  detail: string | null;
}

export interface EventDto {
  seq: number;
  type: EventType;
  summary: string | null;
  created_at: string;
  hash: string;
  prev_hash: string;
  source_id: number | null;
  ref_observation_id: number | null;
  diffs: DiffDto[];
}

export interface ProtocolDetailDto {
  protocol: ProtocolSummaryDto;
  events: EventDto[];
}

export interface EventListItemDto {
  seq: number;
  protocol_key: string;
  protocol_name: string;
  type: EventType;
  summary: string | null;
  created_at: string;
  hash: string;
}

function toSourceDto(row: SourceRow, now: number): SourceDto {
  return {
    id: row.id,
    kind: row.kind,
    url: row.url,
    label: row.label,
    active: row.active === 1,
    cadence_seconds: row.cadence_seconds,
    last_polled_at: row.last_polled_at,
    last_status: row.last_status,
    freshness: classifySource(row, now),
  };
}

function sourcesForProtocol(db: Db, protocolId: number): SourceRow[] {
  return db
    .prepare("SELECT * FROM sources WHERE protocol_id = ? ORDER BY id ASC")
    .all(protocolId) as SourceRow[];
}

function lastEventForProtocol(db: Db, protocolId: number): LastEventDto | null {
  const row = db
    .prepare(
      `SELECT seq, type, summary, created_at
         FROM events WHERE protocol_id = ? ORDER BY seq DESC LIMIT 1`,
    )
    .get(protocolId) as LastEventDto | undefined;
  return row ?? null;
}

function eventCountForProtocol(db: Db, protocolId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM events WHERE protocol_id = ?")
    .get(protocolId) as { c: number };
  return row.c;
}

function summariseProtocol(
  db: Db,
  protocol: {
    id: number;
    key: string;
    name: string;
    layer: string | null;
    status: ProtocolStatus;
  },
  now: number,
): ProtocolSummaryDto {
  const sourceRows = sourcesForProtocol(db, protocol.id);
  const freshness = classifyProtocol(protocol.status, sourceRows, now);
  return {
    key: protocol.key,
    name: protocol.name,
    layer: protocol.layer,
    status: protocol.status,
    freshness,
    stale_warning: isStaleWarning(freshness),
    event_count: eventCountForProtocol(db, protocol.id),
    last_event: lastEventForProtocol(db, protocol.id),
    sources: sourceRows.map((s) => toSourceDto(s, now)),
  };
}

/**
 * Dashboard data (F-030 + F-033): every protocol with its state, last-change event and
 * aggregated freshness. Ordered by `key` for a stable, deterministic listing.
 */
export function getProtocolSummaries(
  db: Db,
  now: number,
): ProtocolSummaryDto[] {
  return listProtocols(db)
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => summariseProtocol(db, p, now));
}

/**
 * Protocol detail (F-031): the summary plus the full event timeline (newest first) with each
 * event's diffs and ledger hashes. Returns null when the key is unknown.
 */
export function getProtocolDetail(
  db: Db,
  key: string,
  now: number,
): ProtocolDetailDto | null {
  const protocol = getProtocolByKey(db, key);
  if (protocol === undefined) return null;

  const eventRows = db
    .prepare(
      `SELECT seq, type, summary, created_at, hash, prev_hash, source_id, ref_observation_id, id
         FROM events WHERE protocol_id = ? ORDER BY seq DESC`,
    )
    .all(protocol.id) as Array<Omit<EventDto, "diffs"> & { id: number }>;

  const diffStmt = db.prepare(
    "SELECT kind, detail FROM diffs WHERE event_id = ? ORDER BY id ASC",
  );

  const events: EventDto[] = eventRows.map((e) => {
    const diffs = diffStmt.all(e.id) as DiffDto[];
    return {
      seq: e.seq,
      type: e.type,
      summary: e.summary,
      created_at: e.created_at,
      hash: e.hash,
      prev_hash: e.prev_hash,
      source_id: e.source_id,
      ref_observation_id: e.ref_observation_id,
      diffs,
    };
  });

  return { protocol: summariseProtocol(db, protocol, now), events };
}

/**
 * Cross-protocol event feed (F-032 GET /events). Optional protocol-key filter and a bounded
 * limit; newest first. `protocolKey` is validated by the caller (unknown ⇒ 404).
 */
export function listEventsDto(
  db: Db,
  opts: { protocolKey?: string | null; limit: number },
): EventListItemDto[] {
  const { protocolKey, limit } = opts;
  if (protocolKey != null) {
    return db
      .prepare(
        `SELECT e.seq AS seq, p.key AS protocol_key, p.name AS protocol_name,
                e.type AS type, e.summary AS summary, e.created_at AS created_at, e.hash AS hash
           FROM events e JOIN protocols p ON p.id = e.protocol_id
          WHERE p.key = ?
          ORDER BY e.seq DESC LIMIT ?`,
      )
      .all(protocolKey, limit) as EventListItemDto[];
  }
  return db
    .prepare(
      `SELECT e.seq AS seq, p.key AS protocol_key, p.name AS protocol_name,
              e.type AS type, e.summary AS summary, e.created_at AS created_at, e.hash AS hash
         FROM events e JOIN protocols p ON p.id = e.protocol_id
        ORDER BY e.seq DESC LIMIT ?`,
    )
    .all(limit) as EventListItemDto[];
}

/** True when a protocol key exists (used to distinguish 404 from an empty result). */
export function protocolExists(db: Db, key: string): boolean {
  return getProtocolByKey(db, key) !== undefined;
}
