import {
  openMigratedDatabase,
  insertProtocol,
  insertSource,
  insertObservation,
  insertDiff,
  updateSourcePoll,
  type Db,
} from "@/lib/db";
import { append } from "@/lib/ledger";
import { contentHash } from "@/lib/fetch";

/**
 * Deterministic test fixtures for the web surface. NOT imported by any production page or
 * route — only by *.test.ts files. Builds a real, valid hash-chained ledger via the F-002
 * `append` primitive so verification tests exercise the genuine chain.
 *
 * All source timings are expressed relative to a caller-supplied `now` (epoch ms) so
 * freshness classification is fully deterministic.
 */

const HOUR_S = 3600;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Insert a content observation + append a matching ledger event + a diff row. */
function addContentEvent(
  db: Db,
  args: {
    protocolId: number;
    sourceId: number;
    type: "appeared" | "version_bump" | "spec_change";
    summary: string;
    body: string;
    fetchedAt: string;
    diffKind: "appear" | "version" | "body";
    diffDetail: string;
  },
): void {
  const obs = insertObservation(db, {
    source_id: args.sourceId,
    fetched_at: args.fetchedAt,
    http_status: 200,
    content_hash: contentHash(args.body),
    body: args.body,
    is_present: true,
  });
  const event = append(db, {
    protocol_id: args.protocolId,
    source_id: args.sourceId,
    type: args.type,
    summary: args.summary,
    ref_observation_id: obs.id,
  });
  insertDiff(db, {
    event_id: event.id,
    to_observation_id: obs.id,
    kind: args.diffKind,
    detail: args.diffDetail,
  });
}

function addVanishEvent(
  db: Db,
  args: { protocolId: number; sourceId: number; fetchedAt: string },
): void {
  const obs = insertObservation(db, {
    source_id: args.sourceId,
    fetched_at: args.fetchedAt,
    http_status: 404,
    content_hash: null,
    body: null,
    is_present: false,
  });
  const event = append(db, {
    protocol_id: args.protocolId,
    source_id: args.sourceId,
    type: "vanished",
    summary: "source vanished (HTTP 404)",
    ref_observation_id: obs.id,
  });
  insertDiff(db, {
    event_id: event.id,
    to_observation_id: obs.id,
    kind: "vanish",
    detail: "previously present, now HTTP 404",
  });
}

/**
 * Seed a representative dataset covering every freshness/status case the web surface must
 * render:
 *  - mcp      : active, fresh source, 3 events (appeared → version_bump → spec_change)
 *  - a2a      : active, STALE source (overdue), 1 event
 *  - x402     : active, one pending (never-polled) + one inactive source, 1 event
 *  - ucp      : active, NO sources and NO events (empty protocol → "unknown"/no-change)
 *  - oldproto : vanished, inactive source, appeared → vanished
 */
export function seedSampleData(db: Db, now: number): void {
  // --- mcp: fresh ---
  const mcp = insertProtocol(db, {
    key: "mcp",
    name: "Model Context Protocol",
    layer: "B",
  });
  const mcpSrc = insertSource(db, {
    protocol_id: mcp.id,
    kind: "github",
    url: "https://example.test/mcp",
    label: "mcp spec repo",
    cadence_seconds: HOUR_S,
  });
  updateSourcePoll(db, mcpSrc.id, {
    last_polled_at: iso(now - 100 * 1000),
    last_status: 200,
  });
  addContentEvent(db, {
    protocolId: mcp.id,
    sourceId: mcpSrc.id,
    type: "appeared",
    summary: "appeared at v1.0.0",
    body: "spec body v1",
    fetchedAt: iso(now - 3 * 3600 * 1000),
    diffKind: "appear",
    diffDetail: "first observed version v1.0.0",
  });
  addContentEvent(db, {
    protocolId: mcp.id,
    sourceId: mcpSrc.id,
    type: "version_bump",
    summary: "version v1.0.0 -> v1.1.0",
    body: "spec body v1.1",
    fetchedAt: iso(now - 2 * 3600 * 1000),
    diffKind: "version",
    diffDetail: "v1.0.0 -> v1.1.0",
  });
  addContentEvent(db, {
    protocolId: mcp.id,
    sourceId: mcpSrc.id,
    type: "spec_change",
    summary: "12 lines added, 3 removed",
    body: "spec body v1.1 amended",
    fetchedAt: iso(now - 1 * 3600 * 1000),
    diffKind: "body",
    diffDetail: "12 lines added, 3 removed",
  });

  // --- a2a: stale (overdue well beyond STALE_FACTOR × cadence) ---
  const a2a = insertProtocol(db, {
    key: "a2a",
    name: "Agent2Agent",
    layer: "B",
  });
  const a2aSrc = insertSource(db, {
    protocol_id: a2a.id,
    kind: "http",
    url: "https://example.test/a2a",
    cadence_seconds: HOUR_S,
  });
  updateSourcePoll(db, a2aSrc.id, {
    last_polled_at: iso(now - 100 * 3600 * 1000), // 100h overdue
    last_status: 200,
  });
  addContentEvent(db, {
    protocolId: a2a.id,
    sourceId: a2aSrc.id,
    type: "appeared",
    summary: "appeared",
    body: "a2a spec body",
    fetchedAt: iso(now - 90 * 3600 * 1000),
    diffKind: "appear",
    diffDetail: "first observed",
  });

  // --- x402: pending (never-polled active source) + one inactive source ---
  const x402 = insertProtocol(db, { key: "x402", name: "x402", layer: "B" });
  const x402Src = insertSource(db, {
    protocol_id: x402.id,
    kind: "github",
    url: "https://example.test/x402",
    cadence_seconds: HOUR_S,
  });
  insertSource(db, {
    protocol_id: x402.id,
    kind: "http",
    url: "https://example.test/x402-alt",
    active: false, // inactive (e.g. URL 404'd at startup)
  });
  addContentEvent(db, {
    protocolId: x402.id,
    sourceId: x402Src.id,
    type: "appeared",
    summary: "appeared",
    body: "x402 spec body",
    fetchedAt: iso(now - 5 * 3600 * 1000),
    diffKind: "appear",
    diffDetail: "first observed",
  });

  // --- ucp: no sources, no events (unknown freshness, no last change) ---
  insertProtocol(db, {
    key: "ucp",
    name: "Universal Commerce Protocol",
    layer: "B",
  });

  // --- oldproto: vanished ---
  const old = insertProtocol(db, {
    key: "oldproto",
    name: "Deprecated Protocol",
    layer: "B",
    status: "vanished",
  });
  const oldSrc = insertSource(db, {
    protocol_id: old.id,
    kind: "http",
    url: "https://example.test/old",
    active: false,
  });
  updateSourcePoll(db, oldSrc.id, {
    last_polled_at: iso(now - 48 * 3600 * 1000),
    last_status: 404,
  });
  addContentEvent(db, {
    protocolId: old.id,
    sourceId: oldSrc.id,
    type: "appeared",
    summary: "appeared",
    body: "old spec body",
    fetchedAt: iso(now - 200 * 3600 * 1000),
    diffKind: "appear",
    diffDetail: "first observed",
  });
  addVanishEvent(db, {
    protocolId: old.id,
    sourceId: oldSrc.id,
    fetchedAt: iso(now - 10 * 3600 * 1000),
  });
}

/** Open a fresh in-memory DB, seed it, and return it (convenience for tests). */
export function seededDb(now: number): Db {
  const db = openMigratedDatabase(":memory:");
  seedSampleData(db, now);
  return db;
}

/**
 * Corrupt a raw observation body WITHOUT updating its bound content_hash. The field-level
 * chain check (verify) still passes, but verifyFromRaw must detect the mismatch. Returns the
 * seq of the affected event.
 */
export function tamperRawBody(db: Db): number {
  const row = db
    .prepare(
      `SELECT e.seq AS seq, o.id AS obs_id
         FROM events e JOIN observations o ON o.id = e.ref_observation_id
        WHERE o.body IS NOT NULL ORDER BY e.seq ASC LIMIT 1`,
    )
    .get() as { seq: number; obs_id: number };
  db.prepare("UPDATE observations SET body = ? WHERE id = ?").run(
    "TAMPERED CONTENT",
    row.obs_id,
  );
  return row.seq;
}

/**
 * Corrupt an event's created_at (which is bound into the hash), breaking the field-level
 * chain. Returns the seq of the affected event.
 */
export function tamperEventTimestamp(db: Db): number {
  const row = db
    .prepare("SELECT seq FROM events ORDER BY seq ASC LIMIT 1")
    .get() as { seq: number };
  db.prepare("UPDATE events SET created_at = ? WHERE seq = ?").run(
    "1999-01-01T00:00:00.000Z",
    row.seq,
  );
  return row.seq;
}
