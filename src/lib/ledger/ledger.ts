import { createHash, createHmac } from "node:crypto";
import type { Db } from "../db/connection";
import type { EventRow, EventType } from "../db/types";
import { canonicalize, type CanonicalValue } from "./canonical";

/**
 * Genesis link value. The first event's prev_hash is 64 zero hex chars.
 */
export const GENESIS_PREV_HASH = "0".repeat(64);

/**
 * The business fields of an event that are covered by the hash chain. This shape is a
 * permanent contract: the exact fields (and their values) are what provenance proves.
 *
 * Provenance claim = "we observed this, AT THIS TIME, UNALTERED", so the hash binds:
 *  - the event's own timestamp (`created_at`), and
 *  - the content hash of the referenced observation (`content_hash`), so the raw content
 *    the event points at cannot be swapped without breaking the chain.
 * `ref_observation_id` ties the event to the raw observation row; `content_hash` is that
 * observation's sha256 (null for vanish/absent events, which have no content body).
 *
 * `seq` is intentionally NOT hashed: chain linkage via prev_hash already orders events.
 */
export interface LedgerRecord {
  protocol_id: number;
  source_id: number | null;
  type: EventType;
  summary: string | null;
  ref_observation_id: number | null;
}

/**
 * The fully-bound record hashed by the chain: the caller-facing LedgerRecord plus the
 * event timestamp generated at append() and the content_hash DERIVED from the referenced
 * observation. content_hash is bound here (not on LedgerRecord) so it has a single source
 * of truth — the observation row — used identically by append() and verify().
 */
interface HashedRecord extends LedgerRecord {
  created_at: string;
  /** sha256 of the referenced observation's body; null for vanish/absent events. */
  content_hash: string | null;
}

export class LedgerSecretError extends Error {
  constructor() {
    super(
      "PROTOCOL_RADAR_HMAC_SECRET is unset or empty; the ledger refuses to operate " +
        "without its key.",
    );
    this.name = "LedgerSecretError";
  }
}

/**
 * Read the ledger secret from the environment. Throws if unset/empty — the ledger
 * deliberately refuses to append or verify without its key.
 */
function requireSecret(): string {
  const secret = process.env.PROTOCOL_RADAR_HMAC_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new LedgerSecretError();
  }
  return secret;
}

/** ISO-8601 UTC timestamp with millisecond precision (e.g. 2026-07-02T01:00:00.000Z). */
function nowIsoMs(): string {
  return new Date().toISOString();
}

/**
 * Compute the chained hash for a record: HMAC_SHA256(secret, prev_hash + canonical(record)),
 * hex-encoded. The prev_hash is included in the HMAC message so the chain is tamper-evident.
 * The record hashed here includes created_at + content_hash, so tampering either is detected.
 */
export function computeHash(
  secret: string,
  prevHash: string,
  record: HashedRecord,
): string {
  const message = prevHash + canonicalize(record as unknown as CanonicalValue);
  return createHmac("sha256", secret).update(message).digest("hex");
}

interface HeadRow {
  seq: number;
  hash: string;
}

/** Current chain head (highest seq), or undefined if the chain is empty. */
function getHead(db: Db): HeadRow | undefined {
  return db
    .prepare("SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1")
    .get() as HeadRow | undefined;
}

/**
 * Look up the content_hash bound to an event: the content_hash column of the observation
 * the event references. Vanish/absent events (or events without a ref) have null. This is
 * the SINGLE source of truth for the bound content_hash — used identically by append()
 * (to bind) and verify()/verifyFromRaw() (to recompute).
 */
function boundContentHash(
  db: Db,
  refObservationId: number | null,
): string | null {
  if (refObservationId == null) return null;
  const row = db
    .prepare("SELECT content_hash FROM observations WHERE id = ?")
    .get(refObservationId) as { content_hash: string | null } | undefined;
  return row?.content_hash ?? null;
}

/**
 * Append a record to the hash-chained ledger. Assigns the next monotonic seq, links to
 * the previous head's hash (or GENESIS for the first record), GENERATES the event's
 * created_at in code (so the hashed value is exactly the stored value — not the SQL
 * DEFAULT), computes the HMAC hash over {record fields + created_at + content_hash}, and
 * inserts the events row. Returns the stored event.
 *
 * Throws LedgerSecretError if the secret is unset/empty.
 */
export function append(db: Db, record: LedgerRecord): EventRow {
  const secret = requireSecret();

  const insert = db.transaction((rec: LedgerRecord): EventRow => {
    const head = getHead(db);
    const seq = head ? head.seq + 1 : 1;
    const prevHash = head ? head.hash : GENESIS_PREV_HASH;
    const createdAt = nowIsoMs();
    // Single source of truth for content_hash: DERIVE it from the referenced observation
    // row (never trust a caller-passed value), so append() binds exactly what verify()
    // recomputes. Always present as a key (null when there is no ref / no body).
    const hashed: HashedRecord = {
      ...rec,
      created_at: createdAt,
      content_hash: boundContentHash(db, rec.ref_observation_id),
    };
    const hash = computeHash(secret, prevHash, hashed);

    return db
      .prepare(
        `INSERT INTO events
           (seq, protocol_id, source_id, type, summary, ref_observation_id,
            created_at, prev_hash, hash)
         VALUES
           (@seq, @protocol_id, @source_id, @type, @summary, @ref_observation_id,
            @created_at, @prev_hash, @hash)
         RETURNING *`,
      )
      .get({
        seq,
        protocol_id: rec.protocol_id,
        source_id: rec.source_id,
        type: rec.type,
        summary: rec.summary,
        ref_observation_id: rec.ref_observation_id,
        created_at: createdAt,
        prev_hash: prevHash,
        hash,
      }) as EventRow;
  });

  return insert(record);
}

export type VerifyResult =
  { ok: true } | { ok: false; tamperedSeq: number; reason: string };

/**
 * Row shape read back for verification. content_hash is not a stored events column; it is
 * bound into the hash and, on verify, taken from the referenced observation (see below).
 */
type StoredEvent = Pick<
  EventRow,
  | "seq"
  | "protocol_id"
  | "source_id"
  | "type"
  | "summary"
  | "ref_observation_id"
  | "created_at"
  | "prev_hash"
  | "hash"
>;

function loadEvents(db: Db): StoredEvent[] {
  return db
    .prepare(
      `SELECT seq, protocol_id, source_id, type, summary, ref_observation_id,
              created_at, prev_hash, hash
         FROM events ORDER BY seq ASC`,
    )
    .all() as StoredEvent[];
}

/**
 * Verify the entire chain from seq order (FIELD-level proof). Recomputes each hash from the
 * stored event fields — including created_at and the referenced observation's content_hash
 * — and checks that (a) each row's prev_hash links to the prior row's stored hash, and
 * (b) each row's stored hash matches the recomputation. Returns the first broken seq.
 *
 * Because created_at and content_hash are inside the hash, tampering an event's timestamp,
 * or repointing/altering the bound observation's content_hash, is detected here.
 *
 * Throws LedgerSecretError if the secret is unset/empty.
 */
export function verify(db: Db): VerifyResult {
  const secret = requireSecret();
  const rows = loadEvents(db);

  let expectedPrev = GENESIS_PREV_HASH;
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return {
        ok: false,
        tamperedSeq: row.seq,
        reason: "broken prev_hash link",
      };
    }

    const recomputed = computeHash(secret, row.prev_hash, {
      protocol_id: row.protocol_id,
      source_id: row.source_id,
      type: row.type,
      summary: row.summary,
      ref_observation_id: row.ref_observation_id,
      content_hash: boundContentHash(db, row.ref_observation_id),
      created_at: row.created_at,
    });

    if (recomputed !== row.hash) {
      return {
        ok: false,
        tamperedSeq: row.seq,
        reason: "stored hash does not match recomputation",
      };
    }

    expectedPrev = row.hash;
  }

  return { ok: true };
}

/**
 * Verify the chain from RAW content (the true provenance proof used by the F-034 verify
 * page). This runs the full field-level chain check AND, for each event that references an
 * observation with a body, recomputes sha256(observation.body) and compares it to the
 * content_hash bound into the ledger. If the raw body was altered after the fact — without
 * touching the ledger rows — this catches it, even though the field-level verify() (which
 * trusts the stored content_hash column) would still pass.
 *
 * Returns the first seq where either the chain is broken or the recomputed raw hash no
 * longer matches the bound content_hash, with a reason.
 *
 * Throws LedgerSecretError if the secret is unset/empty.
 */
export function verifyFromRaw(db: Db): VerifyResult {
  // First the standard field-level chain check (also asserts the secret is present).
  const chain = verify(db);
  if (!chain.ok) return chain;

  const rows = loadEvents(db);
  for (const row of rows) {
    if (row.ref_observation_id == null) continue;

    const obs = db
      .prepare("SELECT body, content_hash FROM observations WHERE id = ?")
      .get(row.ref_observation_id) as
      { body: string | null; content_hash: string | null } | undefined;

    // No observation row, or a bodyless (vanish) observation: nothing raw to recompute.
    if (!obs || obs.body == null) continue;

    const rawHash = createHash("sha256").update(obs.body, "utf8").digest("hex");
    if (rawHash !== obs.content_hash) {
      return {
        ok: false,
        tamperedSeq: row.seq,
        reason: "raw observation body does not match its bound content_hash",
      };
    }
  }

  return { ok: true };
}
