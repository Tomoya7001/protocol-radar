import type { Db } from "./connection";
import type {
  DiffRow,
  EventRow,
  ObservationRow,
  ProtocolRow,
  RunRow,
  SourceRow,
} from "./types";

/**
 * Minimal, typed data-access helpers. Kept intentionally small — later features add
 * only what they need. All timestamps are ISO-8601 strings; callers pass them explicitly
 * where determinism matters (tests inject a clock), otherwise columns default to now.
 */

// ---- protocols ----

export interface NewProtocol {
  key: string;
  name: string;
  layer?: string | null;
  status?: ProtocolRow["status"];
}

export function insertProtocol(db: Db, input: NewProtocol): ProtocolRow {
  const row = db
    .prepare(
      `INSERT INTO protocols (key, name, layer, status)
       VALUES (@key, @name, @layer, @status)
       RETURNING *`,
    )
    .get({
      key: input.key,
      name: input.name,
      layer: input.layer ?? null,
      status: input.status ?? "active",
    }) as ProtocolRow;
  return row;
}

export function getProtocolByKey(db: Db, key: string): ProtocolRow | undefined {
  return db.prepare("SELECT * FROM protocols WHERE key = ?").get(key) as
    ProtocolRow | undefined;
}

export function getProtocolById(db: Db, id: number): ProtocolRow | undefined {
  return db.prepare("SELECT * FROM protocols WHERE id = ?").get(id) as
    ProtocolRow | undefined;
}

export function listProtocols(db: Db): ProtocolRow[] {
  return db
    .prepare("SELECT * FROM protocols ORDER BY id ASC")
    .all() as ProtocolRow[];
}

export function setProtocolStatus(
  db: Db,
  id: number,
  status: ProtocolRow["status"],
): void {
  db.prepare(
    `UPDATE protocols
       SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(status, id);
}

// ---- sources ----

export interface NewSource {
  protocol_id: number;
  kind: SourceRow["kind"];
  url: string;
  label?: string | null;
  active?: boolean;
  cadence_seconds?: number;
  etag?: string | null;
  last_modified?: string | null;
}

export function insertSource(db: Db, input: NewSource): SourceRow {
  const row = db
    .prepare(
      `INSERT INTO sources
         (protocol_id, kind, url, label, active, cadence_seconds, etag, last_modified)
       VALUES
         (@protocol_id, @kind, @url, @label, @active, @cadence_seconds, @etag, @last_modified)
       RETURNING *`,
    )
    .get({
      protocol_id: input.protocol_id,
      kind: input.kind,
      url: input.url,
      label: input.label ?? null,
      active: input.active === false ? 0 : 1,
      cadence_seconds: input.cadence_seconds ?? 3600,
      etag: input.etag ?? null,
      last_modified: input.last_modified ?? null,
    }) as SourceRow;
  return row;
}

export function getSourceById(db: Db, id: number): SourceRow | undefined {
  return db.prepare("SELECT * FROM sources WHERE id = ?").get(id) as
    SourceRow | undefined;
}

export function listSources(db: Db): SourceRow[] {
  return db
    .prepare("SELECT * FROM sources ORDER BY id ASC")
    .all() as SourceRow[];
}

export function setSourceActive(db: Db, id: number, active: boolean): void {
  db.prepare(
    `UPDATE sources
       SET active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(active ? 1 : 0, id);
}

export interface SourcePollUpdate {
  last_polled_at: string;
  last_status?: number | null;
  etag?: string | null;
  last_modified?: string | null;
}

/**
 * Update the polling bookkeeping for a source after a fetch. etag/last_modified are only
 * overwritten when explicitly provided (undefined preserves the current value).
 */
export function updateSourcePoll(
  db: Db,
  id: number,
  update: SourcePollUpdate,
): void {
  db.prepare(
    `UPDATE sources
       SET last_polled_at = @last_polled_at,
           last_status = COALESCE(@last_status, last_status),
           etag = CASE WHEN @etag_set = 1 THEN @etag ELSE etag END,
           last_modified = CASE WHEN @last_modified_set = 1 THEN @last_modified ELSE last_modified END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = @id`,
  ).run({
    id,
    last_polled_at: update.last_polled_at,
    last_status: update.last_status ?? null,
    etag_set: update.etag !== undefined ? 1 : 0,
    etag: update.etag ?? null,
    last_modified_set: update.last_modified !== undefined ? 1 : 0,
    last_modified: update.last_modified ?? null,
  });
}

// ---- observations ----

export interface NewObservation {
  source_id: number;
  fetched_at: string;
  http_status?: number | null;
  content_hash?: string | null;
  body?: string | null;
  is_present?: boolean;
}

export function insertObservation(
  db: Db,
  input: NewObservation,
): ObservationRow {
  const row = db
    .prepare(
      `INSERT INTO observations
         (source_id, fetched_at, http_status, content_hash, body, is_present)
       VALUES
         (@source_id, @fetched_at, @http_status, @content_hash, @body, @is_present)
       RETURNING *`,
    )
    .get({
      source_id: input.source_id,
      fetched_at: input.fetched_at,
      http_status: input.http_status ?? null,
      content_hash: input.content_hash ?? null,
      body: input.body ?? null,
      is_present: input.is_present === false ? 0 : 1,
    }) as ObservationRow;
  return row;
}

/** Most recent observation for a source (by id), or undefined if none exists. */
export function getLatestObservation(
  db: Db,
  sourceId: number,
): ObservationRow | undefined {
  return db
    .prepare(
      "SELECT * FROM observations WHERE source_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(sourceId) as ObservationRow | undefined;
}

// ---- events (read side; writes go through the ledger in src/lib/ledger) ----

export function listEvents(db: Db): EventRow[] {
  return db
    .prepare("SELECT * FROM events ORDER BY seq ASC")
    .all() as EventRow[];
}

export function listEventsForProtocol(db: Db, protocolId: number): EventRow[] {
  return db
    .prepare("SELECT * FROM events WHERE protocol_id = ? ORDER BY seq ASC")
    .all(protocolId) as EventRow[];
}

// ---- diffs ----

export interface NewDiff {
  event_id: number;
  from_observation_id?: number | null;
  to_observation_id?: number | null;
  kind: DiffRow["kind"];
  detail?: string | null;
}

export function insertDiff(db: Db, input: NewDiff): DiffRow {
  const row = db
    .prepare(
      `INSERT INTO diffs
         (event_id, from_observation_id, to_observation_id, kind, detail)
       VALUES
         (@event_id, @from_observation_id, @to_observation_id, @kind, @detail)
       RETURNING *`,
    )
    .get({
      event_id: input.event_id,
      from_observation_id: input.from_observation_id ?? null,
      to_observation_id: input.to_observation_id ?? null,
      kind: input.kind,
      detail: input.detail ?? null,
    }) as DiffRow;
  return row;
}

export function listDiffsForEvent(db: Db, eventId: number): DiffRow[] {
  return db
    .prepare("SELECT * FROM diffs WHERE event_id = ? ORDER BY id ASC")
    .all(eventId) as DiffRow[];
}

// ---- runs ----

export interface NewRun {
  started_at: string;
}

export function insertRun(db: Db, input: NewRun): RunRow {
  const row = db
    .prepare(`INSERT INTO runs (started_at) VALUES (@started_at) RETURNING *`)
    .get({ started_at: input.started_at }) as RunRow;
  return row;
}

export interface FinishRun {
  finished_at: string;
  sources_polled: number;
  events_created: number;
  ok: boolean;
  note?: string | null;
}

export function finishRun(db: Db, id: number, input: FinishRun): void {
  db.prepare(
    `UPDATE runs
       SET finished_at = @finished_at,
           sources_polled = @sources_polled,
           events_created = @events_created,
           ok = @ok,
           note = @note
     WHERE id = @id`,
  ).run({
    id,
    finished_at: input.finished_at,
    sources_polled: input.sources_polled,
    events_created: input.events_created,
    ok: input.ok ? 1 : 0,
    note: input.note ?? null,
  });
}

export function listRuns(db: Db): RunRow[] {
  return db.prepare("SELECT * FROM runs ORDER BY id ASC").all() as RunRow[];
}
