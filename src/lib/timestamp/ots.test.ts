import { describe, expect, it } from "vitest";
import OpenTimestamps from "opentimestamps";
import {
  ANCHORS_DIR,
  classifyAttestations,
  detachedForHead,
  deserializeProof,
  isValidHeadHash,
  otsFileName,
  otsRelPath,
  parseOtsProof,
  serializeProof,
} from "./ots";

const { Notary } = OpenTimestamps;

const HEAD_A = "a".repeat(64);
const HEAD_B = "b".repeat(64);

/**
 * Serialize a `.ots` proof for a head with ONE attestation, entirely offline. A single attestation
 * per leaf is what round-trips through OpenTimestamps' serializer, so single-attestation fixtures
 * exercise the full deserialize+classify path; multi-attestation classification is unit-tested
 * directly via classifyAttestations (no serialization involved).
 */
function proofBytesWith(
  headHash: string,
  attestation: InstanceType<typeof Notary.TimeAttestation>,
): Uint8Array {
  const detached = detachedForHead(headHash);
  (detached.timestamp as unknown as { attestations: unknown[] }).attestations.push(
    attestation,
  );
  return serializeProof(detached);
}

describe("F6 timestamp - filename / head idempotency", () => {
  it("names the proof deterministically after the head hash", () => {
    expect(otsFileName(HEAD_A)).toBe(`${HEAD_A}.ots`);
    expect(otsRelPath(HEAD_A)).toBe(`${ANCHORS_DIR}/${HEAD_A}.ots`);
    expect(ANCHORS_DIR).toBe("data/anchors");
  });

  it("is idempotent: the same head always maps to the same filename", () => {
    expect(otsFileName(HEAD_A)).toBe(otsFileName(HEAD_A));
    expect(otsFileName(HEAD_A)).not.toBe(otsFileName(HEAD_B));
  });

  it("validates that a head hash is 64 lowercase hex chars", () => {
    expect(isValidHeadHash(HEAD_A)).toBe(true);
    expect(isValidHeadHash("0".repeat(64))).toBe(true); // GENESIS
    expect(isValidHeadHash("A".repeat(64))).toBe(false); // uppercase
    expect(isValidHeadHash("a".repeat(63))).toBe(false); // too short
    expect(isValidHeadHash("xyz")).toBe(false);
  });

  it("refuses to build a proof for a non-hex head rather than guessing", () => {
    expect(() => detachedForHead("not-a-hash")).toThrow();
  });
});

describe("F6 timestamp - detachedForHead commits to the head bytes", () => {
  it("builds a proof whose digest is exactly the head-hash bytes", () => {
    const detached = detachedForHead(HEAD_A);
    const digestHex = OpenTimestamps.Utils.bytesToHex(detached.fileDigest());
    expect(digestHex).toBe(HEAD_A);
  });

  it("round-trips through serialize/deserialize preserving the digest", () => {
    const bytes = proofBytesWith(
      HEAD_A,
      new Notary.PendingAttestation("https://alice.btc.calendar.opentimestamps.org"),
    );
    const back = deserializeProof(bytes);
    expect(OpenTimestamps.Utils.bytesToHex(back.fileDigest())).toBe(HEAD_A);
  });
});

describe("F6 timestamp - classifyAttestations (pure, offline)", () => {
  it("reports pending with calendar URLs when only pending attestations exist", () => {
    const url = "https://alice.btc.calendar.opentimestamps.org";
    const info = classifyAttestations([new Notary.PendingAttestation(url)]);
    expect(info.status).toBe("pending");
    expect(info.bitcoin).toBeNull();
    expect(info.calendar_urls).toEqual([url]);
  });

  it("reports confirmed with the block height when a Bitcoin attestation exists", () => {
    const info = classifyAttestations([
      new Notary.BitcoinBlockHeaderAttestation(783123),
    ]);
    expect(info.status).toBe("confirmed");
    expect(info.bitcoin).toEqual({ block_height: 783123, block_time: null });
  });

  it("keeps the lowest block height and stays confirmed when both kinds are present", () => {
    const info = classifyAttestations([
      new Notary.PendingAttestation("https://bob.btc.calendar.opentimestamps.org"),
      new Notary.BitcoinBlockHeaderAttestation(800000),
      new Notary.BitcoinBlockHeaderAttestation(783123),
    ]);
    expect(info.status).toBe("confirmed");
    expect(info.bitcoin?.block_height).toBe(783123);
  });

  it("de-duplicates repeated calendar URLs", () => {
    const url = "https://alice.btc.calendar.opentimestamps.org";
    const info = classifyAttestations([
      new Notary.PendingAttestation(url),
      new Notary.PendingAttestation(url),
    ]);
    expect(info.calendar_urls).toEqual([url]);
  });

  it("with no attestations at all, is pending with no bitcoin and no calendars", () => {
    const info = classifyAttestations([]);
    expect(info.status).toBe("pending");
    expect(info.bitcoin).toBeNull();
    expect(info.calendar_urls).toEqual([]);
  });
});

describe("F6 timestamp - parseOtsProof (deserialize + classify)", () => {
  it("classifies a pending proof round-tripped through bytes", () => {
    const url = "https://alice.btc.calendar.opentimestamps.org";
    const bytes = proofBytesWith(HEAD_A, new Notary.PendingAttestation(url));
    const info = parseOtsProof(bytes);
    expect(info.status).toBe("pending");
    expect(info.calendar_urls).toEqual([url]);
  });

  it("classifies a Bitcoin-confirmed proof round-tripped through bytes", () => {
    const bytes = proofBytesWith(
      HEAD_A,
      new Notary.BitcoinBlockHeaderAttestation(783123),
    );
    const info = parseOtsProof(bytes);
    expect(info.status).toBe("confirmed");
    expect(info.bitcoin).toEqual({ block_height: 783123, block_time: null });
  });

  it("throws on malformed proof bytes (caller decides how to handle)", () => {
    expect(() => parseOtsProof(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
