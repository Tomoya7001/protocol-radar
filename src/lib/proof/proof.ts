/**
 * F5 — Single-event ledger inclusion proof (PURE logic, no DB access).
 *
 * Given the ledger's events (ordered ascending by seq) and a target seq, build a
 * verifiable proof that the event belongs to the HMAC-SHA256 hash chain the worker
 * appends (see src/lib/ledger). The proof is READ-ONLY: it only re-presents stored
 * hashes so a third party can re-walk the chain — it never re-appends or fabricates.
 *
 * A verifier confirms inclusion in two steps:
 *  1. Recompute `hash` = HMAC-SHA256(secret, prev_hash + canonical(record)) for the
 *     event and check it equals `hash` (field-level integrity).
 *  2. Walk `chain_to_head`: each link's `prev_hash` must equal the PREVIOUS link's
 *     `hash`, ending at `head_hash` — proving the event is on the chain up to head.
 */

import { GENESIS_PREV_HASH } from "@/lib/ledger";
import type { EventType } from "@/lib/db/types";

/** One (seq, hash, prev_hash) triple along the chain from the target event to head. */
export interface ProofChainLink {
  seq: number;
  hash: string;
  prev_hash: string;
}

/** The ledger business fields of the proven event (the values bound into its hash). */
export interface ProofEventFields {
  seq: number;
  protocol_id: number;
  source_id: number | null;
  type: EventType;
  summary: string | null;
  ref_observation_id: number | null;
  created_at: string;
}

/** The full inclusion proof returned for a found seq. */
export interface InclusionProof {
  seq: number;
  found: true;
  event: ProofEventFields;
  hash: string;
  prev_hash: string;
  chain_to_head: ProofChainLink[];
  head_hash: string;
  verify_instructions: string;
}

/**
 * The stored event shape this module reads. A superset (the DB row) is accepted; only
 * these fields are used, so callers can pass an EventRow directly.
 */
export interface ProofSourceEvent {
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

export type ParsedSeq = { ok: true; seq: number } | { ok: false };

/**
 * Parse the `[seq]` path segment. Accepts a plain positive integer within the safe
 * integer range; everything else (non-numeric, empty, zero/negative, fractional,
 * leading `+`/whitespace, out-of-range) is rejected so the route can answer 400.
 * A well-formed seq that simply is not in the ledger is NOT a parse error — that is a
 * 404 decided later by buildInclusionProof.
 */
export function parseSeq(raw: string): ParsedSeq {
  if (!/^[0-9]+$/.test(raw)) return { ok: false };
  const seq = Number(raw);
  if (!Number.isSafeInteger(seq) || seq < 1) return { ok: false };
  return { ok: true, seq };
}

/** The short, human-readable recompute recipe embedded in every proof. */
export function verifyInstructions(): string {
  return (
    "For the event, recompute hash = HMAC-SHA256(secret, prev_hash + canonical(record)) " +
    "where record = {protocol_id, source_id, type, summary, ref_observation_id, " +
    "created_at, content_hash} serialised as JSON with recursively sorted keys, and " +
    "confirm it equals `hash`. Then walk `chain_to_head` from the event to head: each " +
    "link.prev_hash must equal the previous link.hash (the first link's prev_hash equals " +
    "the event's prev_hash), and the last link.hash must equal `head_hash`."
  );
}

/**
 * Build the inclusion proof for `seq` from events ordered ascending by seq. Returns null
 * when no event has that seq (the route maps this to 404). The genesis marker is exported
 * from the ledger and re-used here so a target that is itself the first event still yields
 * a well-formed prev_hash.
 */
export function buildInclusionProof(
  events: readonly ProofSourceEvent[],
  seq: number,
): InclusionProof | null {
  if (events.length === 0) return null;

  const index = events.findIndex((e) => e.seq === seq);
  if (index === -1) return null;

  const target = events[index];
  if (target === undefined) return null;

  const head = events[events.length - 1];
  if (head === undefined) return null;

  const chain_to_head: ProofChainLink[] = [];
  for (let i = index; i < events.length; i++) {
    const e = events[i];
    if (e === undefined) continue;
    chain_to_head.push({ seq: e.seq, hash: e.hash, prev_hash: e.prev_hash });
  }

  return {
    seq: target.seq,
    found: true,
    event: {
      seq: target.seq,
      protocol_id: target.protocol_id,
      source_id: target.source_id,
      type: target.type,
      summary: target.summary,
      ref_observation_id: target.ref_observation_id,
      created_at: target.created_at,
    },
    hash: target.hash,
    prev_hash: target.prev_hash === "" ? GENESIS_PREV_HASH : target.prev_hash,
    chain_to_head,
    head_hash: head.hash,
    verify_instructions: verifyInstructions(),
  };
}
