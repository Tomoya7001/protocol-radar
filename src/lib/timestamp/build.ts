import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@/app/_data/db";
import { computeLedgerHead } from "@/lib/anchor";
import { jsonResponse } from "@/app/api/_lib/http";
import {
  otsRelPath,
  parseOtsProof,
  type BitcoinAttestationInfo,
  type TimestampStatus,
} from "./ots";

/**
 * F6 - GET /api/timestamp handler logic (kept OUT of route.ts so route.ts can export only the
 * Next.js-allowed runtime/dynamic/GET; A3 lesson repeated by B1's certificate route).
 *
 * REQUEST-TIME IS NETWORK-FREE BY CONSTRUCTION: it reads the current ledger head from the DB
 * (reusing B3's computeLedgerHead - the head hash is copied verbatim, never recomputed) and the
 * matching committed `data/anchors/<head>.ots` file from disk, then classifies the proof by
 * PARSING it offline (parseOtsProof). No calendar server is ever contacted here - a live
 * verification would be a network call, which this endpoint deliberately never makes. Stamping
 * and calendar upgrades happen out-of-band in the observe loop (scripts/timestamp-ledger.mjs).
 */

export interface TimestampResponse {
  /** The current ledger head hash (stored hash of the highest-seq event; GENESIS when empty). */
  head_hash: string;
  /** Whether a committed `.ots` proof exists for this exact head. */
  ots_present: boolean;
  /** The raw proof, base64-encoded, so a caller can verify it themselves; null when absent. */
  ots_base64: string | null;
  /** "none" (no proof yet), "pending" (calendars only), or "confirmed" (Bitcoin attestation). */
  status: TimestampStatus;
  /** Present only when a Bitcoin attestation is in the proof (offline-derivable facts). */
  bitcoin?: BitcoinAttestationInfo;
  /** Calendar server URIs from pending attestations; present whenever a proof exists. */
  calendar_urls?: string[];
}

/**
 * Pure shaping of the response from a head hash + the proof bytes (or null when no proof exists).
 * A committed proof that fails to parse is reported as present-but-pending rather than crashing:
 * the file is real, we just cannot see a Bitcoin attestation in it offline.
 */
export function buildTimestamp(
  headHash: string,
  otsBytes: Uint8Array | null,
): TimestampResponse {
  if (otsBytes === null) {
    return {
      head_hash: headHash,
      ots_present: false,
      ots_base64: null,
      status: "none",
    };
  }

  const ots_base64 = Buffer.from(otsBytes).toString("base64");

  let info;
  try {
    info = parseOtsProof(otsBytes);
  } catch {
    // A committed-but-unparseable proof: honest about presence, conservative about status.
    return {
      head_hash: headHash,
      ots_present: true,
      ots_base64,
      status: "pending",
      calendar_urls: [],
    };
  }

  const response: TimestampResponse = {
    head_hash: headHash,
    ots_present: true,
    ots_base64,
    status: info.status,
    calendar_urls: info.calendar_urls,
  };
  if (info.bitcoin !== null) {
    response.bitcoin = info.bitcoin;
  }
  return response;
}

/** Injectable proof reader so route tests stay network- AND filesystem-free. */
type OtsReader = (headHash: string) => Uint8Array | null;
let otsReaderOverride: OtsReader | null = null;

/**
 * Test-only hook: inject a proof reader (or null to reset to the real filesystem reader). Mirrors
 * __setDbForTests. Not used by production code.
 */
export function __setOtsReaderForTests(reader: OtsReader | null): void {
  otsReaderOverride = reader;
}

/**
 * Read the committed `.ots` proof for a head from disk, or null when none exists. NO network.
 * 404/empty-safe: a missing directory or file simply yields null (status "none").
 */
function readOts(headHash: string): Uint8Array | null {
  if (otsReaderOverride !== null) {
    return otsReaderOverride(headHash);
  }
  const path = join(process.cwd(), otsRelPath(headHash));
  if (!existsSync(path)) {
    return null;
  }
  return new Uint8Array(readFileSync(path));
}

/**
 * HTTP entry point. Reads the head from the DB and the matching committed proof from disk, all at
 * request time and all offline. Always 200: an as-yet-unanchored head is a valid state ("none"),
 * not an error.
 */
export function buildTimestampResponse(_req: Request): Response {
  const db = getDb();
  const { headHash } = computeLedgerHead(db);
  const otsBytes = readOts(headHash);
  return jsonResponse(buildTimestamp(headHash, otsBytes), 200);
}
