import type { Db } from "@/lib/db";
import { listProtocols, type EventType, type ProtocolStatus } from "@/lib/db";
import { GENESIS_PREV_HASH } from "@/lib/ledger";
import { runVerify, type VerifyMode } from "@/app/_data/verify";

/**
 * B2 - backing logic for the read-only re-verification page (`/trust`).
 *
 * The point of `/trust` is that ANYONE can re-check the ledger's tamper-evidence themselves and
 * see, in human-readable form, the exact result the backend API returns. So this module is a
 * pure, STRICTLY READ-ONLY assembler: it calls the SAME committed `runVerify` the /api/verify
 * route uses (the page and API can therefore never disagree), and it copies every provenance
 * value — `head_hash`, each protocol's last-change `content_hash` — VERBATIM from the rows the
 * worker wrote. It never recomputes, rewrites or "fixes" a hash; the invariant
 * `content_hash == sha256(observation.body)` is preserved by never touching it.
 */

/** The most recent change for one protocol (all fields copied as-is, never recomputed). */
export interface TrustLastChange {
  seq: number;
  type: EventType;
  summary: string | null;
  /** Ledger append time (the value bound into the hash chain). */
  created_at: string;
  /** sha256 of the referenced observation body - the EXISTING bound value, copied as-is. */
  content_hash: string | null;
}

/** One monitored protocol as shown on the trust page. */
export interface TrustProtocol {
  key: string;
  name: string;
  layer: string | null;
  status: ProtocolStatus;
  /** Newest change (null when the protocol has no events yet). */
  last_change: TrustLastChange | null;
}

/** The verification summary + monitored-protocol provenance shown on `/trust`. */
export interface TrustSummary {
  /** Whole-chain verification result (conservative: false if any tampering exists anywhere). */
  ok: boolean;
  mode: VerifyMode;
  /** Number of ledger events covered by verification (0 when verification cannot run). */
  checked: number;
  /** Hash of the highest-seq event (GENESIS when the ledger is empty) - the chain anchor. */
  head_hash: string;
  /** True when the ledger HMAC secret is unset and verification cannot run. */
  unavailable: boolean;
  /** The first seq that failed to verify, when a tamper was detected; null otherwise. */
  tampered_seq: number | null;
  /** Every monitored protocol with its last-change provenance, ordered by key. */
  protocols: TrustProtocol[];
}

interface LastChangeRow {
  seq: number;
  type: EventType;
  summary: string | null;
  created_at: string;
  content_hash: string | null;
}

/** Highest-seq event hash = the current chain head. GENESIS when the ledger is empty. */
function headHash(db: Db): string {
  const row = db
    .prepare("SELECT hash FROM events ORDER BY seq DESC LIMIT 1")
    .get() as { hash: string } | undefined;
  return row?.hash ?? GENESIS_PREV_HASH;
}

/**
 * This protocol's most recent change, with the referenced observation's content_hash copied
 * verbatim (LEFT JOIN: ref-less events keep a null content_hash). Read-only.
 */
function lastChangeForProtocol(
  db: Db,
  protocolId: number,
): TrustLastChange | null {
  const row = db
    .prepare(
      `SELECT e.seq          AS seq,
              e.type         AS type,
              e.summary      AS summary,
              e.created_at   AS created_at,
              o.content_hash AS content_hash
         FROM events e
         LEFT JOIN observations o ON o.id = e.ref_observation_id
        WHERE e.protocol_id = ?
        ORDER BY e.seq DESC
        LIMIT 1`,
    )
    .get(protocolId) as LastChangeRow | undefined;
  if (row === undefined) return null;
  return {
    seq: row.seq,
    type: row.type,
    summary: row.summary,
    created_at: row.created_at,
    content_hash: row.content_hash,
  };
}

/**
 * Assemble the `/trust` summary. `mode` selects the verification depth (raw recompute vs.
 * field-level chain check), matching GET /api/verify. Pure read: verification runs through the
 * shared `runVerify`, and every provenance value is copied from the existing ledger rows.
 */
export function buildTrustSummary(db: Db, mode: VerifyMode): TrustSummary {
  const outcome = runVerify(db, mode);

  const protocols: TrustProtocol[] = listProtocols(db)
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => ({
      key: p.key,
      name: p.name,
      layer: p.layer,
      status: p.status,
      last_change: lastChangeForProtocol(db, p.id),
    }));

  const unavailable = !outcome.ok && outcome.unavailable === true;
  const tampered_seq =
    !outcome.ok && outcome.unavailable !== true ? outcome.tampered_seq : null;

  return {
    ok: outcome.ok,
    mode: outcome.mode,
    checked: outcome.checked,
    head_hash: headHash(db),
    unavailable,
    tampered_seq,
    protocols,
  };
}
