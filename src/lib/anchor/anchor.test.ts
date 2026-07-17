import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrate";
import { insertProtocol } from "../db/repo";
import type { Db } from "../db/connection";
import { append } from "../ledger/ledger";
import { GENESIS_PREV_HASH } from "../ledger";
import type { LedgerRecord } from "../ledger";
import {
  computeLedgerHead,
  anchorTagName,
  anchorTagMessage,
  anchorLineForHead,
  isHeadAlreadyAnchored,
} from "./anchor";

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

describe("B3 ledger anchor - computeLedgerHead", () => {
  it("an empty ledger anchors GENESIS with checked = 0", () => {
    const db = freshDb();
    const head = computeLedgerHead(db);
    expect(head.headHash).toBe(GENESIS_PREV_HASH);
    expect(head.checked).toBe(0);
  });

  it("head hash is the STORED hash of the highest-seq event (copied, not recomputed)", () => {
    const db = freshDb();
    const pid = seedProtocol(db);
    append(db, record(pid, 1));
    append(db, record(pid, 2));
    const last = append(db, record(pid, 3));

    const head = computeLedgerHead(db);
    // Exactly the stored hash the append returned for the highest seq - a verbatim copy.
    expect(head.headHash).toBe(last.hash);
    expect(last.seq).toBe(3);
  });

  it("checked equals the total number of ledger events", () => {
    const db = freshDb();
    const pid = seedProtocol(db);
    for (let n = 1; n <= 5; n++) {
      append(db, record(pid, n));
    }
    const head = computeLedgerHead(db);
    expect(head.checked).toBe(5);
  });
});

describe("B3 ledger anchor - anchorTagName", () => {
  it("produces ledger/YYYY-MM-DDTHHMMZ from an ISO instant", () => {
    expect(anchorTagName("2026-07-17T12:00:00.000Z")).toBe(
      "ledger/2026-07-17T1200Z",
    );
    expect(anchorTagName("2026-01-05T09:03:59.123Z")).toBe(
      "ledger/2026-01-05T0903Z",
    );
  });

  it("emits a name valid as a git ref: no ':' and no other forbidden chars", () => {
    const name = anchorTagName("2026-07-17T12:00:00.000Z");
    expect(name).not.toContain(":");
    // git ref rules: no space, ~ ^ ? * [ \ , no '..', no trailing .lock, no @{.
    expect(name).toMatch(/^ledger\/\d{4}-\d{2}-\d{2}T\d{4}Z$/);
    expect(name).not.toMatch(/[ ~^?*[\\:]/);
    expect(name).not.toContain("..");
    expect(name.endsWith(".lock")).toBe(false);
  });

  it("throws on an unrecognized timestamp rather than guessing", () => {
    expect(() => anchorTagName("not-a-date")).toThrow();
  });
});

describe("B3 ledger anchor - anchorTagMessage", () => {
  it("includes the head hash and the checked count deterministically", () => {
    const dateISO = "2026-07-17T12:00:00.000Z";
    const msg = anchorTagMessage({
      headHash: "a".repeat(64),
      checked: 7,
      dateISO,
    });
    expect(msg).toContain(`head_hash: ${"a".repeat(64)}`);
    expect(msg).toContain("checked: 7");
    expect(msg).toContain(`generated_at: ${dateISO}`);
    // Deterministic: same input -> identical output.
    expect(
      anchorTagMessage({ headHash: "a".repeat(64), checked: 7, dateISO }),
    ).toBe(msg);
  });
});

describe("B3 ledger anchor - isHeadAlreadyAnchored", () => {
  it("is true when an existing tag body already carries this head hash", () => {
    const headHash = "b".repeat(64);
    const existing = anchorTagMessage({ headHash, checked: 3, dateISO: "x" });
    expect(isHeadAlreadyAnchored(headHash, [existing])).toBe(true);
  });

  it("is false when no existing tag body carries this head hash", () => {
    const existing = anchorTagMessage({
      headHash: "c".repeat(64),
      checked: 3,
      dateISO: "x",
    });
    expect(isHeadAlreadyAnchored("d".repeat(64), [existing])).toBe(false);
    expect(isHeadAlreadyAnchored("d".repeat(64), [])).toBe(false);
  });

  it("matches on the exact head-hash line", () => {
    const headHash = "e".repeat(64);
    expect(anchorLineForHead(headHash)).toBe(`head_hash: ${headHash}`);
  });
});
