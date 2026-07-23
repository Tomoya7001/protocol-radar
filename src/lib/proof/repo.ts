/**
 * F5 — read-only DB access for the inclusion proof. Isolated from proof.ts so the proof
 * construction stays pure/testable. This module ONLY issues SELECTs against the ledger's
 * events table; it never writes and never touches content_hash invariants.
 */

import type { Db } from "@/lib/db";
import { buildInclusionProof, type InclusionProof, type ProofSourceEvent } from "./proof";

/**
 * Load every event's proof-relevant columns, ordered ascending by seq (chain order).
 * Mirrors the ledger's own internal read shape but is a private, read-only query owned by
 * this feature — it does not import or mutate any shared query/DTO helper.
 */
function loadEvents(db: Db): ProofSourceEvent[] {
  return db
    .prepare(
      `SELECT seq, protocol_id, source_id, type, summary, ref_observation_id,
              created_at, prev_hash, hash
         FROM events ORDER BY seq ASC`,
    )
    .all() as ProofSourceEvent[];
}

/**
 * Build the inclusion proof for `seq` from the live ledger. Returns null when the seq is
 * absent (route → 404). Reads are done once and handed to the pure builder.
 */
export function getInclusionProof(db: Db, seq: number): InclusionProof | null {
  return buildInclusionProof(loadEvents(db), seq);
}
