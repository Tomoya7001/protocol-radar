import OpenTimestamps from "opentimestamps";

/**
 * F6 - external timestamping of the ledger head via OpenTimestamps (Bitcoin).
 *
 * Complementary to B3's git-tag anchoring: B3 pins the head hash into git's tag history (trust
 * GitHub not to rewrite it), while F6 anchors the SAME head hash into the Bitcoin blockchain via
 * OpenTimestamps, so provenance becomes verifiable WITHOUT trusting GitHub. The head hash is the
 * stored hash of the highest-seq event, reused verbatim from the SAME computeLedgerHead B3 uses -
 * this module never recomputes any provenance value.
 *
 * This module is the PURE / OFFLINE core: building the detached proof over the head-hash bytes,
 * parsing an existing `.ots` proof's attestations, and deciding the committed filename. The
 * NETWORK side effects (contacting calendar servers to stamp / upgrade) live in
 * scripts/timestamp-ledger.mjs, exactly as B3 keeps the `git` side effect in its own script.
 * Nothing here touches the network, so it is fully unit-testable and safe at request time.
 */

const { DetachedTimestampFile, Ops, Notary, Utils } = OpenTimestamps;

/** Directory (repo-relative) where committed `.ots` proofs live, one per anchored head hash. */
export const ANCHORS_DIR = "data/anchors";

/** Coarse status of a head's Bitcoin anchor. "none" = no proof committed yet for this head. */
export type TimestampStatus = "none" | "pending" | "confirmed";

/** Bitcoin attestation facts that ARE embedded in the proof (offline-derivable). */
export interface BitcoinAttestationInfo {
  /** Block height the head hash is anchored in - present verbatim in the proof. */
  block_height: number;
  /**
   * Block time is NOT stored in an OpenTimestamps proof (it needs a blockchain lookup), so it is
   * always null when derived offline. Kept in the shape so a future online verifier can fill it.
   */
  block_time: number | null;
}

/** Result of classifying a `.ots` proof's attestations entirely offline. */
export interface OtsProofInfo {
  /** "confirmed" once a Bitcoin attestation is present; otherwise "pending". */
  status: "pending" | "confirmed";
  /** Bitcoin facts when confirmed (lowest block height wins), else null. */
  bitcoin: BitcoinAttestationInfo | null;
  /** Calendar server URIs from any pending attestations (de-duplicated, order-preserving). */
  calendar_urls: string[];
}

const HEX64 = /^[0-9a-f]{64}$/;

/** True when `headHash` is a 64-char lowercase hex digest (what the ledger head always is). */
export function isValidHeadHash(headHash: string): boolean {
  return HEX64.test(headHash);
}

/**
 * Committed proof filename for a head hash. Idempotent BY FILENAME: the head hash uniquely names
 * its proof, so "does a proof already exist for this head?" is a pure filesystem existence check -
 * mirroring B3's isHeadAlreadyAnchored idea without any state beyond the file itself.
 */
export function otsFileName(headHash: string): string {
  return `${headHash}.ots`;
}

/** Repo-relative path of the committed `.ots` proof for a head hash. */
export function otsRelPath(headHash: string): string {
  return `${ANCHORS_DIR}/${otsFileName(headHash)}`;
}

/**
 * Build a detached OpenTimestamps proof over the head-hash BYTES, treating them as a SHA256
 * digest (OpSHA256). This is the object the stamp/upgrade script hands to the calendar servers.
 * Pure and offline: it only constructs the proof skeleton, it does NOT contact any calendar.
 */
export function detachedForHead(
  headHash: string,
): InstanceType<typeof DetachedTimestampFile> {
  if (!isValidHeadHash(headHash)) {
    throw new Error(
      `timestamp: head hash must be 64 lowercase hex chars, got: ${headHash}`,
    );
  }
  const digest = Utils.hexToBytes(headHash);
  return DetachedTimestampFile.fromHash(new Ops.OpSHA256(), digest);
}

/** Serialize a detached proof to raw bytes suitable for writing to a binary `.ots` file. */
export function serializeProof(
  detached: InstanceType<typeof DetachedTimestampFile>,
): Uint8Array {
  return detached.serializeToBytes();
}

/** Parse serialized `.ots` bytes into a detached proof (no network). Throws on malformed input. */
export function deserializeProof(
  bytes: Uint8Array | number[],
): InstanceType<typeof DetachedTimestampFile> {
  return DetachedTimestampFile.deserialize(Array.from(bytes));
}

/**
 * Classify a set of proof attestations entirely OFFLINE (the pure core of parseOtsProof). A
 * Bitcoin attestation means the head is confirmed and carries its block height; otherwise pending
 * attestations mean it is still waiting on the calendars. When several Bitcoin attestations are
 * present the lowest (earliest) block height wins - the strongest offline claim. No network.
 */
export function classifyAttestations(
  attestations: Iterable<InstanceType<typeof Notary.TimeAttestation>>,
): OtsProofInfo {
  let bitcoin: BitcoinAttestationInfo | null = null;
  const calendarUrls: string[] = [];

  for (const attestation of attestations) {
    if (attestation instanceof Notary.BitcoinBlockHeaderAttestation) {
      if (bitcoin === null || attestation.height < bitcoin.block_height) {
        bitcoin = { block_height: attestation.height, block_time: null };
      }
    } else if (attestation instanceof Notary.PendingAttestation) {
      if (!calendarUrls.includes(attestation.uri)) {
        calendarUrls.push(attestation.uri);
      }
    }
  }

  return {
    status: bitcoin !== null ? "confirmed" : "pending",
    bitcoin,
    calendar_urls: calendarUrls,
  };
}

/**
 * Inspect a serialized `.ots` proof entirely OFFLINE and classify it: deserialize, walk every
 * attestation in the proof tree, and decide pending vs confirmed purely from what the proof
 * already contains. No live verification / calendar call is made, so this is safe at request time.
 */
export function parseOtsProof(bytes: Uint8Array | number[]): OtsProofInfo {
  const detached = deserializeProof(bytes);
  return classifyAttestations(detached.timestamp.allAttestations().values());
}
