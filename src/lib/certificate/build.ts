import { getDb } from "@/app/_data/db";
import type { Db } from "@/lib/db";
import { getProtocolByKey, listProtocols, type EventType } from "@/lib/db";
import { getProtocolDetail } from "@/app/_data/queries";
import { runVerify, parseVerifyMode, type VerifyMode } from "@/app/_data/verify";
import { GENESIS_PREV_HASH } from "@/lib/ledger";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";

/**
 * B1 - as-of provenance CERTIFICATE (GET /api/certificate).
 *
 * A self-contained, machine-readable snapshot of "what did protocol X look like, and did its
 * ledger verify, AT a chosen point in time?". The point of the certificate is that anyone (a
 * human, another service, an AI) can later re-check the claim independently against the same
 * immutable ledger - so this module is STRICTLY READ-ONLY and never recomputes or rewrites any
 * provenance value. Every hash it emits (`ledger.head_hash`, each event's `content_hash`) is
 * copied verbatim from the existing rows the worker wrote; the invariant
 * `content_hash == sha256(observation.body)` is preserved by never touching it.
 *
 * As-of semantics: an event is "in scope at time T" when the underlying observation was made
 * at or before T - i.e. `COALESCE(observation.fetched_at, event.created_at) <= asOf`. Using the
 * observation time (with the ledger append time as fallback for ref-less events) is the
 * real-world "as of" meaning: it reflects when the change was actually seen upstream.
 */

/** One change event as attested by the certificate (all fields copied, never recomputed). */
export interface CertificateEvent {
  seq: number;
  type: EventType;
  summary: string | null;
  /** sha256 of the referenced observation body - the EXISTING bound value, copied as-is. */
  content_hash: string | null;
  /** Ledger append time (the value bound into the hash chain). */
  created_at: string;
  /** When the underlying observation was fetched upstream (null for ref-less events). */
  observed_at: string | null;
}

export interface CertificateState {
  status: string;
  layer: string | null;
  freshness: string;
  stale_warning: boolean;
  /** Count of this protocol's events in scope at `asOf`. */
  event_count: number;
  /** The most recent in-scope change (null when the protocol had none by `asOf`). */
  last_change: CertificateEvent | null;
}

export interface CertificateLedger {
  /** Hash of the highest-seq event in scope at `asOf` (GENESIS when none) - the chain anchor. */
  head_hash: string;
  /** Number of ledger events (all protocols) in scope at `asOf` and covered by verification. */
  checked: number;
  /** Whole-chain verification result. Conservative: false if any tampering exists anywhere. */
  verified: boolean;
  mode: VerifyMode;
}

export interface Certificate {
  protocol: string;
  name: string;
  /** The reference instant actually applied (ISO-8601, UTC). */
  asOf: string;
  state: CertificateState;
  ledger: CertificateLedger;
  events: CertificateEvent[];
  /** When this certificate document was produced. */
  generatedAt: string;
}

type AsOfResult = { ms: number } | { error: string };

/**
 * Parse `?asOf=`: accepts an ISO-8601 timestamp, or a unix epoch (seconds when < 1e12, else
 * milliseconds). Invalid input is an error (mapped to HTTP 400 by the caller).
 */
export function parseAsOf(raw: string): AsOfResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { error: "asOf must be an ISO-8601 timestamp or a unix epoch" };
  }
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = n < 1e12 ? n * 1000 : n;
    if (!Number.isFinite(ms)) {
      return { error: "asOf is not a finite timestamp" };
    }
    return { ms };
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    return { error: "asOf must be an ISO-8601 timestamp or a unix epoch" };
  }
  return { ms };
}

/** Resolve the `?protocol=` selector against a key first, then an exact/case-insensitive name. */
function resolveProtocolKey(db: Db, selector: string): string | null {
  const byKey = getProtocolByKey(db, selector);
  if (byKey !== undefined) return byKey.key;
  const lowered = selector.toLowerCase();
  const byName = listProtocols(db).find(
    (p) => p.name === selector || p.name.toLowerCase() === lowered,
  );
  return byName ? byName.key : null;
}

interface EventScopeRow {
  seq: number;
  type: EventType;
  summary: string | null;
  content_hash: string | null;
  created_at: string;
  observed_at: string | null;
}

/** This protocol's in-scope events (newest first). content_hash is the existing bound value. */
function scopedEvents(
  db: Db,
  protocolId: number,
  asOfIso: string,
): CertificateEvent[] {
  const rows = db
    .prepare(
      `SELECT e.seq          AS seq,
              e.type         AS type,
              e.summary      AS summary,
              o.content_hash AS content_hash,
              e.created_at   AS created_at,
              o.fetched_at   AS observed_at
         FROM events e
         LEFT JOIN observations o ON o.id = e.ref_observation_id
        WHERE e.protocol_id = ?
          AND COALESCE(o.fetched_at, e.created_at) <= ?
        ORDER BY e.seq DESC`,
    )
    .all(protocolId, asOfIso) as EventScopeRow[];
  return rows.map((r) => ({
    seq: r.seq,
    type: r.type,
    summary: r.summary,
    content_hash: r.content_hash,
    created_at: r.created_at,
    observed_at: r.observed_at,
  }));
}

/** Whole-ledger anchor at `asOf`: hash of the highest-seq in-scope event + the in-scope count. */
function ledgerAnchor(
  db: Db,
  asOfIso: string,
): { headHash: string; checked: number } {
  const head = db
    .prepare(
      `SELECT e.hash AS hash
         FROM events e
         LEFT JOIN observations o ON o.id = e.ref_observation_id
        WHERE COALESCE(o.fetched_at, e.created_at) <= ?
        ORDER BY e.seq DESC LIMIT 1`,
    )
    .get(asOfIso) as { hash: string } | undefined;
  const count = db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM events e
         LEFT JOIN observations o ON o.id = e.ref_observation_id
        WHERE COALESCE(o.fetched_at, e.created_at) <= ?`,
    )
    .get(asOfIso) as { c: number };
  return { headHash: head?.hash ?? GENESIS_PREV_HASH, checked: count.c };
}

/**
 * Assemble the certificate for `protocolKey` as of `asOfMs`. Pure read: state freshness is
 * classified as-of, events are the in-scope slice, ledger is verified whole-chain (conservative)
 * and anchored to the as-of head. Returns null if the protocol key is unknown.
 */
export function buildCertificate(
  db: Db,
  protocolKey: string,
  asOfMs: number,
  nowMs: number,
  mode: VerifyMode,
): Certificate | null {
  const detail = getProtocolDetail(db, protocolKey, asOfMs);
  if (detail === null) return null;
  const summary = detail.protocol;

  const asOfIso = new Date(asOfMs).toISOString();
  const protocolRow = getProtocolByKey(db, protocolKey);
  // protocolRow is defined: getProtocolDetail already succeeded for this key.
  const events = scopedEvents(db, protocolRow!.id, asOfIso);

  const verifyOutcome = runVerify(db, mode);
  const anchor = ledgerAnchor(db, asOfIso);

  return {
    protocol: summary.key,
    name: summary.name,
    asOf: asOfIso,
    state: {
      status: summary.status,
      layer: summary.layer,
      freshness: summary.freshness,
      stale_warning: summary.stale_warning,
      event_count: events.length,
      last_change: events[0] ?? null,
    },
    ledger: {
      head_hash: anchor.headHash,
      checked: anchor.checked,
      verified: verifyOutcome.ok,
      mode: verifyOutcome.mode,
    },
    events,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * HTTP entry point. Parses `?protocol=<key|name>` (required), optional `?asOf=<ISO|epoch>`
 * (default: now) and `?mode=raw|chain` (default: raw). All output flows through jsonResponse,
 * so there is no injection surface. Read-only throughout.
 */
export function buildCertificateResponse(req: Request): Response {
  const url = new URL(req.url);
  const db = getDb();

  const selector = url.searchParams.get("protocol");
  if (selector === null || selector.trim().length === 0) {
    return jsonResponse({ error: "protocol_required" }, 400);
  }

  const nowMs = parseNow(url);

  const asOfRaw = url.searchParams.get("asOf");
  let asOfMs = nowMs;
  if (asOfRaw !== null) {
    const parsed = parseAsOf(asOfRaw);
    if ("error" in parsed) {
      return jsonResponse({ error: "invalid_asof", detail: parsed.error }, 400);
    }
    asOfMs = parsed.ms;
  }

  const mode = parseVerifyMode(url.searchParams.get("mode"));

  const protocolKey = resolveProtocolKey(db, selector);
  if (protocolKey === null) {
    return jsonResponse({ error: "protocol_not_found", key: selector }, 404);
  }

  const certificate = buildCertificate(db, protocolKey, asOfMs, nowMs, mode);
  if (certificate === null) {
    return jsonResponse({ error: "protocol_not_found", key: selector }, 404);
  }

  return jsonResponse(certificate, 200);
}
