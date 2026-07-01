import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrate";
import { insertProtocol } from "../db/repo";
import type { Db } from "../db/connection";
import { append, verify, LedgerSecretError } from "./ledger";
import { canonicalize } from "./canonical";
import type { LedgerRecord } from "./ledger";

function freshDb(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

function seedProtocol(db: Db): number {
  return insertProtocol(db, { key: "mcp", name: "MCP" }).id;
}

function record(protocolId: number, n: number): LedgerRecord {
  return {
    protocol_id: protocolId,
    source_id: null,
    type: "spec_change",
    summary: `change ${n}`,
    ref_observation_id: null,
  };
}

const ORIGINAL_SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

afterEach(() => {
  // Restore in case a test mutated the secret.
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.PROTOCOL_RADAR_HMAC_SECRET;
  } else {
    process.env.PROTOCOL_RADAR_HMAC_SECRET = ORIGINAL_SECRET;
  }
});

describe("F-002 HMAC hash-chain ledger", () => {
  it("appends N records and verify() is ok, with a genesis prev_hash and monotonic seq", () => {
    const db = freshDb();
    const pid = seedProtocol(db);

    const first = append(db, record(pid, 1));
    expect(first.seq).toBe(1);
    expect(first.prev_hash).toBe("0".repeat(64));
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);

    for (let n = 2; n <= 6; n++) {
      const ev = append(db, record(pid, n));
      expect(ev.seq).toBe(n);
    }

    expect(verify(db)).toEqual({ ok: true });
  });

  it("links each prev_hash to the prior stored hash", () => {
    const db = freshDb();
    const pid = seedProtocol(db);
    const a = append(db, record(pid, 1));
    const b = append(db, record(pid, 2));
    expect(b.prev_hash).toBe(a.hash);
  });

  it("detects a tampered record body: verify() returns ok:false with the correct seq", () => {
    const db = freshDb();
    const pid = seedProtocol(db);
    append(db, record(pid, 1));
    append(db, record(pid, 2));
    append(db, record(pid, 3));

    // Mutate a business field of seq 2 directly, leaving the stored hash stale.
    db.prepare("UPDATE events SET summary = 'tampered' WHERE seq = 2").run();

    const result = verify(db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.tamperedSeq).toBe(2);
    }
  });

  it("detects a directly overwritten stored hash", () => {
    const db = freshDb();
    const pid = seedProtocol(db);
    append(db, record(pid, 1));
    append(db, record(pid, 2));

    db.prepare(
      `UPDATE events SET hash = '${"f".repeat(64)}' WHERE seq = 1`,
    ).run();

    const result = verify(db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // seq 1's hash no longer matches recompute (caught before the link check on seq 2).
      expect(result.tamperedSeq).toBe(1);
    }
  });

  it("detects a broken prev_hash link", () => {
    const db = freshDb();
    const pid = seedProtocol(db);
    append(db, record(pid, 1));
    append(db, record(pid, 2));
    append(db, record(pid, 3));

    // Break the link on seq 3 without touching its own body/hash.
    db.prepare(
      `UPDATE events SET prev_hash = '${"a".repeat(64)}' WHERE seq = 3`,
    ).run();

    const result = verify(db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.tamperedSeq).toBe(3);
      expect(result.reason).toBe("broken prev_hash link");
    }
  });

  it("append() throws when the secret is unset", () => {
    const db = freshDb();
    const pid = seedProtocol(db);
    delete process.env.PROTOCOL_RADAR_HMAC_SECRET;
    expect(() => append(db, record(pid, 1))).toThrow(LedgerSecretError);
  });

  it("append() throws when the secret is empty", () => {
    const db = freshDb();
    const pid = seedProtocol(db);
    process.env.PROTOCOL_RADAR_HMAC_SECRET = "";
    expect(() => append(db, record(pid, 1))).toThrow(LedgerSecretError);
  });

  it("verify() throws when the secret is unset", () => {
    const db = freshDb();
    const pid = seedProtocol(db);
    append(db, record(pid, 1));
    delete process.env.PROTOCOL_RADAR_HMAC_SECRET;
    expect(() => verify(db)).toThrow(LedgerSecretError);
  });

  it("canonicalize is key-order independent", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ x: { d: 1, c: 2 } })).toBe(
      canonicalize({ x: { c: 2, d: 1 } }),
    );
  });
});
