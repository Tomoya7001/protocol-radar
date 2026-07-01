/**
 * Domain types for the persistence layer. These mirror the SQLite schema
 * (src/lib/db/migrations/*). Identifiers are English, snake_case in the DB.
 */

export type ProtocolStatus = "active" | "inactive" | "vanished";

export type SourceKind = "http" | "github";

export type EventType =
  "appeared" | "version_bump" | "spec_change" | "vanished";

export type DiffKind = "version" | "body" | "vanish" | "appear";

export interface ProtocolRow {
  id: number;
  key: string;
  name: string;
  layer: string | null;
  status: ProtocolStatus;
  created_at: string;
  updated_at: string;
}

export interface SourceRow {
  id: number;
  protocol_id: number;
  kind: SourceKind;
  url: string;
  label: string | null;
  active: number; // 0 | 1
  etag: string | null;
  last_modified: string | null;
  cadence_seconds: number;
  last_polled_at: string | null;
  last_status: number | null;
  created_at: string;
  updated_at: string;
}

export interface ObservationRow {
  id: number;
  source_id: number;
  fetched_at: string;
  http_status: number | null;
  content_hash: string | null;
  body: string | null;
  is_present: number; // 0 | 1
  created_at: string;
}

export interface EventRow {
  id: number;
  seq: number;
  protocol_id: number;
  source_id: number | null;
  type: EventType;
  summary: string | null;
  ref_observation_id: number | null;
  created_at: string;
  prev_hash: string;
  hash: string;
}

export interface DiffRow {
  id: number;
  event_id: number;
  from_observation_id: number | null;
  to_observation_id: number | null;
  kind: DiffKind;
  detail: string | null;
  created_at: string;
}

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  sources_polled: number;
  events_created: number;
  ok: number; // 0 | 1
  note: string | null;
}
