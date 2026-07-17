import type { Db } from "../db/connection";
import { listEvents } from "../db";
import { GENESIS_PREV_HASH } from "../ledger";

/**
 * B3 - external anchoring of the ledger head into git tag history.
 *
 * The ledger is an HMAC-SHA256 hash chain in the (mutable) production DB. On its own, an
 * operator who controls that DB could rewrite history and re-sign the chain. B3 closes that
 * gap by pinning the current head hash into git's near-immutable, third-party-observable tag
 * history: every observe pass writes an annotated `ledger/<time>Z` tag noting the head hash
 * and the number of events covered. A later rewrite of the DB can no longer erase what the
 * tag history already recorded, so tampering becomes externally detectable.
 *
 * This module is STRICTLY READ-ONLY over the ledger and PURE apart from computeLedgerHead's
 * single SELECT. It NEVER recomputes any hash: the head hash it reports is the stored hash of
 * the highest-seq event, copied verbatim (exactly as the certificate module copies it). The
 * side effect (running git) lives entirely in scripts/anchor-ledger.mjs; here we only decide
 * the tag NAME, the tag MESSAGE, and whether a head is already anchored - all testable.
 */

/** The ledger head as anchored: the highest-seq event's stored hash + the total event count. */
export interface LedgerHead {
  /** Stored hash of the highest-seq event (GENESIS when the ledger is empty). Never recomputed. */
  headHash: string;
  /** Number of ledger events (all protocols) - what "checked" attests coverage over. */
  checked: number;
}

/** Inputs to the annotated-tag message body. */
export interface AnchorTagInput {
  headHash: string;
  checked: number;
  /** ISO-8601 UTC instant the anchor was generated (e.g. 2026-07-17T12:00:00.000Z). */
  dateISO: string;
}

/**
 * Read the current ledger head WITHOUT recomputing anything: reuse the existing listEvents
 * read helper (events ordered by seq ASC), so the head is the last row's STORED hash and
 * `checked` is the row count. An empty ledger anchors GENESIS. Pure read - no write, no verify.
 */
export function computeLedgerHead(db: Db): LedgerHead {
  const events = listEvents(db);
  const checked = events.length;
  const head = events.at(-1);
  const headHash = head === undefined ? GENESIS_PREV_HASH : head.hash;
  return { headHash, checked };
}

/**
 * Deterministic anchor tag name for an instant. Produces `ledger/YYYY-MM-DDTHHMMZ`, which is a
 * valid `refs/tags/...` name: it deliberately drops the `:` (illegal in a ref) and the
 * sub-second/`.`, keeping only characters git ref rules permit. Same instant -> same name.
 */
export function anchorTagName(dateISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dateISO.trim());
  if (m === null) {
    throw new Error(
      `anchorTagName: unrecognized ISO-8601 timestamp: ${dateISO}`,
    );
  }
  const [, year, month, day, hour, minute] = m;
  return `ledger/${year}-${month}-${day}T${hour}${minute}Z`;
}

/** The single message line that binds a tag to a specific head hash (also used to detect it). */
export function anchorLineForHead(headHash: string): string {
  return `head_hash: ${headHash}`;
}

/**
 * Deterministic annotated-tag message body. Contains the head hash, the checked count and the
 * generation instant, so the tag is self-describing and its head-hash line can be matched back.
 */
export function anchorTagMessage(input: AnchorTagInput): string {
  return [
    "protocol-radar ledger anchor",
    "",
    anchorLineForHead(input.headHash),
    `checked: ${input.checked}`,
    `generated_at: ${input.dateISO}`,
  ].join("\n");
}

/**
 * Idempotency decision (pure): has this exact head hash already been anchored by some existing
 * tag? Given the annotation bodies of the current `ledger/*` tags, we skip creating a new tag
 * when any of them already carries this head's `head_hash:` line. Keeps the git-side script a
 * thin shell around this testable rule.
 */
export function isHeadAlreadyAnchored(
  headHash: string,
  existingMessages: string[],
): boolean {
  const line = anchorLineForHead(headHash);
  return existingMessages.some((msg) => msg.includes(line));
}
