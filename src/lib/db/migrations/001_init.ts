/**
 * Migration 001 — initial schema.
 *
 * All identifiers are English, snake_case. Text enums are constrained via CHECK.
 * Timestamps are ISO-8601 strings (UTC) stored as TEXT; DEFAULT uses SQLite's
 * strftime to produce a millisecond-precision ISO timestamp with a trailing 'Z'.
 */
export const migration001 = {
  id: 1,
  name: "001_init",
  sql: /* sql */ `
CREATE TABLE protocols (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  layer       TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive', 'vanished')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  protocol_id     INTEGER NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('http', 'github')),
  url             TEXT NOT NULL,
  label           TEXT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  etag            TEXT,
  last_modified   TEXT,
  cadence_seconds INTEGER NOT NULL DEFAULT 3600,
  last_polled_at  TEXT,
  last_status     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_sources_protocol ON sources(protocol_id);
CREATE INDEX idx_sources_due ON sources(active, last_polled_at);

CREATE TABLE observations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  fetched_at   TEXT NOT NULL,
  http_status  INTEGER,
  content_hash TEXT,
  body         TEXT,
  is_present   INTEGER NOT NULL DEFAULT 1 CHECK (is_present IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_observations_source ON observations(source_id, id);

CREATE TABLE events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  seq                INTEGER NOT NULL UNIQUE,
  protocol_id        INTEGER NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  source_id          INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  type               TEXT NOT NULL
                       CHECK (type IN ('appeared', 'version_bump', 'spec_change', 'vanished')),
  summary            TEXT,
  ref_observation_id INTEGER REFERENCES observations(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  prev_hash          TEXT NOT NULL,
  hash               TEXT NOT NULL
);
CREATE INDEX idx_events_protocol ON events(protocol_id, seq);

CREATE TABLE diffs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id           INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_observation_id INTEGER REFERENCES observations(id) ON DELETE SET NULL,
  to_observation_id   INTEGER REFERENCES observations(id) ON DELETE SET NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('version', 'body', 'vanish', 'appear')),
  detail             TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_diffs_event ON diffs(event_id);

CREATE TABLE runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  sources_polled INTEGER NOT NULL DEFAULT 0,
  events_created INTEGER NOT NULL DEFAULT 0,
  ok             INTEGER NOT NULL DEFAULT 0 CHECK (ok IN (0, 1)),
  note           TEXT
);

-- Single-row advisory lock used by the worker to prevent overlapping runs.
CREATE TABLE worker_lock (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  locked_at   TEXT,
  locked      INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1))
);
INSERT INTO worker_lock (id, locked_at, locked) VALUES (1, NULL, 0);
`,
};
