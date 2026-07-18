import { getDb } from "@/app/_data/db";
import type { Db } from "@/lib/db";
import {
  listProtocols,
  type EventType,
  type ProtocolRow,
  type ProtocolStatus,
} from "@/lib/db";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";

/**
 * E1 - LANDSCAPE TIME-TRAVEL (GET /api/asof).
 *
 * Reconstructs the state of EVERY tracked protocol as it was at a chosen instant `ts`, using
 * only the events that had been observed at or before `ts`. This generalises the single-protocol
 * as-of reconstruction in @/lib/certificate (which slices one protocol's events at a cutoff and
 * reads its newest in-scope change) to the whole landscape.
 *
 * As-of semantics (identical to the certificate): an event is "in scope at `ts`" when the
 * underlying observation was made at or before `ts` - i.e. `COALESCE(observation.fetched_at,
 * event.created_at) <= ts`. Events after `ts` are ignored; the observation time (with the ledger
 * append time as fallback for ref-less events) is the real-world "as of" instant.
 *
 * STRICTLY READ-ONLY: this module only SELECTs from the ledger the worker wrote. It never
 * mutates a row and never touches the `content_hash == sha256(body)` invariant.
 */

/** A protocol's most recent in-scope change at `ts` (null when it had none by `ts`). */
export interface AsOfLastEvent {
  type: EventType;
  summary: string | null;
  /** The change instant: observation time, or ledger append time for ref-less events. */
  at: string;
}

/** One protocol's reconstructed state at `ts`. */
export interface AsOfProtocolState {
  key: string;
  name: string;
  /** True when the protocol had already appeared (>=1 in-scope event) by `ts`. */
  known_at_ts: boolean;
  /** Status derived purely from the events observed up to `ts`. */
  status: ProtocolStatus;
  /** Instant of the most recent in-scope change (null when there was none by `ts`). */
  last_change_at: string | null;
  /** The most recent in-scope change (null when there was none by `ts`). */
  last_event: AsOfLastEvent | null;
  /** Count of this protocol's events in scope at `ts`. */
  events_upto_ts: number;
}

/** The whole-landscape snapshot at `ts`. */
export interface AsOfLandscape {
  /** The reference instant actually applied (ISO-8601, UTC). */
  asof: string;
  /** When this snapshot document was produced (ISO-8601, UTC). */
  generated_at: string;
  protocol_count: number;
  protocols: AsOfProtocolState[];
}

type TsParseResult = { ms: number } | { error: string };

/**
 * Parse `?ts=`: accepts an ISO-8601 timestamp, or a unix epoch (seconds when < 1e12, else
 * milliseconds). Invalid or non-finite input is an error (mapped to HTTP 400 by the caller).
 */
export function parseTs(raw: string): TsParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { error: "ts must be an ISO-8601 timestamp or a unix epoch" };
  }
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = n < 1e12 ? n * 1000 : n;
    if (!Number.isFinite(ms)) {
      return { error: "ts is not a finite timestamp" };
    }
    return { ms };
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return { error: "ts must be an ISO-8601 timestamp or a unix epoch" };
  }
  return { ms };
}

/**
 * Derive a protocol's status from the type of its most recent in-scope event. Reuses the domain
 * `ProtocolStatus` enum: a protocol not yet observed at `ts` is "inactive" (it had not appeared),
 * a vanished last event is "vanished", and any content event (appeared/version_bump/spec_change)
 * leaves it "active".
 */
export function statusFromLatestEvent(latest: EventType | null): ProtocolStatus {
  if (latest === null) return "inactive";
  if (latest === "vanished") return "vanished";
  return "active";
}

interface ScopedEventRow {
  type: EventType;
  summary: string | null;
  created_at: string;
  observed_at: string | null;
}

/** This protocol's in-scope events at `asOfIso`, newest (highest seq) first. */
function scopedEvents(
  db: Db,
  protocolId: number,
  asOfIso: string,
): ScopedEventRow[] {
  return db
    .prepare(
      `SELECT e.type       AS type,
              e.summary    AS summary,
              e.created_at AS created_at,
              o.fetched_at AS observed_at
         FROM events e
         LEFT JOIN observations o ON o.id = e.ref_observation_id
        WHERE e.protocol_id = ?
          AND COALESCE(o.fetched_at, e.created_at) <= ?
        ORDER BY e.seq DESC`,
    )
    .all(protocolId, asOfIso) as ScopedEventRow[];
}

/** Reconstruct one protocol's state at `asOfIso` from its in-scope events only. */
export function reconstructProtocolState(
  db: Db,
  protocol: Pick<ProtocolRow, "id" | "key" | "name">,
  asOfIso: string,
): AsOfProtocolState {
  const events = scopedEvents(db, protocol.id, asOfIso);
  const latest = events[0] ?? null;
  const known = events.length > 0;

  const lastEvent: AsOfLastEvent | null =
    latest === null
      ? null
      : {
          type: latest.type,
          summary: latest.summary,
          at: latest.observed_at ?? latest.created_at,
        };

  return {
    key: protocol.key,
    name: protocol.name,
    known_at_ts: known,
    status: statusFromLatestEvent(latest ? latest.type : null),
    last_change_at: lastEvent ? lastEvent.at : null,
    last_event: lastEvent,
    events_upto_ts: events.length,
  };
}

/**
 * Reconstruct the full landscape at `asOfMs`. Pure read: each protocol's state is derived from
 * only the events observed at or before `asOfMs`. Protocols are ordered by `key` for a stable,
 * deterministic listing (mirrors getProtocolSummaries). When `asOfMs` precedes the oldest event,
 * every protocol comes back with `known_at_ts:false` and an empty state - a valid empty景色.
 */
export function reconstructLandscape(
  db: Db,
  asOfMs: number,
  nowMs: number,
): AsOfLandscape {
  const asOfIso = new Date(asOfMs).toISOString();
  const protocols = listProtocols(db)
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => reconstructProtocolState(db, p, asOfIso));

  return {
    asof: asOfIso,
    generated_at: new Date(nowMs).toISOString(),
    protocol_count: protocols.length,
    protocols,
  };
}

/**
 * HTTP entry point. Parses `?ts=<ISO|epoch>` (REQUIRED) and optional `?now=<epoch-ms>` (for
 * deterministic `generated_at`, mirroring the other read routes). Missing or unparseable `ts`
 * yields a plain-JSON 400. Read-only throughout; all output flows through jsonResponse.
 */
export function buildAsOfResponse(req: Request): Response {
  const url = new URL(req.url);

  const tsRaw = url.searchParams.get("ts");
  if (tsRaw === null) {
    return jsonResponse({ error: "ts_required" }, 400);
  }
  const parsed = parseTs(tsRaw);
  if ("error" in parsed) {
    return jsonResponse({ error: "invalid_ts", detail: parsed.error }, 400);
  }

  const db = getDb();
  const nowMs = parseNow(url);
  const landscape = reconstructLandscape(db, parsed.ms, nowMs);
  return jsonResponse(landscape, 200);
}
