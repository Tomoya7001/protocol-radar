import { describe, it, expect } from "vitest";
import {
  parseSeq,
  buildInclusionProof,
  verifyInstructions,
  type ProofSourceEvent,
} from "./proof";

const GENESIS = "0".repeat(64);

/**
 * Build a synthetic, internally-consistent chain of `n` events where each event's
 * prev_hash links to the prior event's hash (event 1 links to GENESIS). This exercises
 * the pure proof builder without needing the real HMAC secret / DB.
 */
function chain(n: number): ProofSourceEvent[] {
  const events: ProofSourceEvent[] = [];
  let prev = GENESIS;
  for (let seq = 1; seq <= n; seq++) {
    const hash = `hash-${seq}`.padEnd(64, "0");
    events.push({
      seq,
      protocol_id: 1,
      source_id: null,
      type: "spec_change",
      summary: `change ${seq}`,
      ref_observation_id: null,
      created_at: `2026-07-02T0${seq}:00:00.000Z`,
      prev_hash: prev,
      hash,
    });
    prev = hash;
  }
  return events;
}

describe("F5 parseSeq", () => {
  it("accepts positive integers", () => {
    expect(parseSeq("1")).toEqual({ ok: true, seq: 1 });
    expect(parseSeq("42")).toEqual({ ok: true, seq: 42 });
  });

  it("rejects non-numeric, empty, zero, negative and fractional input", () => {
    for (const bad of ["", "abc", "1.5", "-1", "0", " 3", "3 ", "+3", "0x1", "1e3"]) {
      expect(parseSeq(bad)).toEqual({ ok: false });
    }
  });

  it("rejects out-of-safe-range integers", () => {
    expect(parseSeq("99999999999999999999")).toEqual({ ok: false });
  });
});

describe("F5 buildInclusionProof", () => {
  it("returns a proof whose chain_to_head links are consistent (prev == previous hash)", () => {
    const events = chain(5);
    const proof = buildInclusionProof(events, 2);
    expect(proof).not.toBeNull();
    if (proof === null) return;

    expect(proof.found).toBe(true);
    expect(proof.seq).toBe(2);
    expect(proof.event.seq).toBe(2);
    expect(proof.event.summary).toBe("change 2");

    // chain covers the target (seq 2) through head (seq 5).
    expect(proof.chain_to_head.map((l) => l.seq)).toEqual([2, 3, 4, 5]);

    // first link's prev_hash equals the event's prev_hash.
    expect(proof.chain_to_head[0]?.prev_hash).toBe(proof.prev_hash);

    // every subsequent link's prev_hash equals the previous link's hash.
    for (let i = 1; i < proof.chain_to_head.length; i++) {
      expect(proof.chain_to_head[i]?.prev_hash).toBe(proof.chain_to_head[i - 1]?.hash);
    }

    // last link's hash is the head hash.
    expect(proof.chain_to_head.at(-1)?.hash).toBe(proof.head_hash);
    expect(proof.head_hash).toBe(events[4]?.hash);
    expect(proof.verify_instructions).toBe(verifyInstructions());
  });

  it("handles the first event (prev_hash is genesis)", () => {
    const proof = buildInclusionProof(chain(3), 1);
    expect(proof?.prev_hash).toBe(GENESIS);
    expect(proof?.chain_to_head).toHaveLength(3);
  });

  it("handles the head event (chain_to_head has a single link)", () => {
    const events = chain(4);
    const proof = buildInclusionProof(events, 4);
    expect(proof?.chain_to_head).toHaveLength(1);
    expect(proof?.chain_to_head[0]?.seq).toBe(4);
    expect(proof?.hash).toBe(proof?.head_hash);
  });

  it("returns null for a seq not in the chain (→ 404) and for an empty ledger", () => {
    expect(buildInclusionProof(chain(3), 99)).toBeNull();
    expect(buildInclusionProof([], 1)).toBeNull();
  });
});
