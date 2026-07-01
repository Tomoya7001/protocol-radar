import { createHmac } from "node:crypto";
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
 * ref_observation_id ties the event to the raw observation it was derived from.
 */
export interface LedgerRecord {
  protocol_id: number;
  source_id: number | null;
  type: EventType;
  summary: string | null;
  ref_observation_id: number | null;
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

/**
 * Compute the chained hash for a record: HMAC_SHA256(secret, prev_hash + canonical(record)),
 * hex-encoded. The prev_hash is included in the HMAC message so the chain is tamper-evident.
 */
export function computeHash(
  secret: string,
  prevHash: string,
  record: LedgerRecord,
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
 * Append a record to the hash-chained ledger. Assigns the next monotonic seq, links to
 * the previous head's hash (or GENESIS for the first record), computes the HMAC hash, and
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
    const hash = computeHash(secret, prevHash, rec);

    return db
      .prepare(
        `INSERT INTO events
           (seq, protocol_id, source_id, type, summary, ref_observation_id, prev_hash, hash)
         VALUES
           (@seq, @protocol_id, @source_id, @type, @summary, @ref_observation_id, @prev_hash, @hash)
         RETURNING *`,
      )
      .get({
        seq,
        protocol_id: rec.protocol_id,
        source_id: rec.source_id,
        type: rec.type,
        summary: rec.summary,
        ref_observation_id: rec.ref_observation_id,
        prev_hash: prevHash,
        hash,
      }) as EventRow;
  });

  return insert(record);
}

export type VerifyResult =
  { ok: true } | { ok: false; tamperedSeq: number; reason: string };

/**
 * Verify the entire chain from seq order. Recomputes each hash from the stored record
 * fields and checks that (a) each row's prev_hash links to the prior row's stored hash,
 * and (b) each row's stored hash matches the recomputation. Returns the first broken seq.
 *
 * Throws LedgerSecretError if the secret is unset/empty.
 */
export function verify(db: Db): VerifyResult {
  const secret = requireSecret();

  const rows = db
    .prepare(
      `SELECT seq, protocol_id, source_id, type, summary, ref_observation_id, prev_hash, hash
         FROM events ORDER BY seq ASC`,
    )
    .all() as Array<
    Pick<
      EventRow,
      | "seq"
      | "protocol_id"
      | "source_id"
      | "type"
      | "summary"
      | "ref_observation_id"
      | "prev_hash"
      | "hash"
    >
  >;

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
