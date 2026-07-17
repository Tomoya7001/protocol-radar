import { describe, it, expect, afterEach } from "vitest";
import {
  seededDb,
  tamperRawBody,
  tamperEventTimestamp,
} from "@/app/_data/fixtures";
import { listProtocols, listEvents } from "@/lib/db";
import { GENESIS_PREV_HASH } from "@/lib/ledger";
import { openMigratedDatabase, type Db } from "@/lib/db";
import { buildTrustSummary } from "./summary";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

afterEach(() => {
  // Restore the secret in case a test cleared it.
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

/** The head hash the summary must report = the highest-seq event's stored hash. */
function expectedHead(db: Db): string {
  const events = listEvents(db); // ordered by seq ASC
  return events.length === 0
    ? GENESIS_PREV_HASH
    : events[events.length - 1].hash;
}

/** Read the content_hash stored for a protocol's newest event, straight from the DB. */
function storedLastContentHash(db: Db, protocolId: number): string | null {
  const row = db
    .prepare(
      `SELECT o.content_hash AS content_hash
         FROM events e
         LEFT JOIN observations o ON o.id = e.ref_observation_id
        WHERE e.protocol_id = ?
        ORDER BY e.seq DESC LIMIT 1`,
    )
    .get(protocolId) as { content_hash: string | null } | undefined;
  return row?.content_hash ?? null;
}

describe("buildTrustSummary (B2)", () => {
  it("mirrors runVerify: verified + checked for an intact chain", () => {
    const db = seededDb(NOW);
    const summary = buildTrustSummary(db, "raw");

    expect(summary.ok).toBe(true);
    expect(summary.unavailable).toBe(false);
    expect(summary.tampered_seq).toBeNull();
    expect(summary.mode).toBe("raw");
    // checked == the number of events in the ledger.
    expect(summary.checked).toBe(listEvents(db).length);
    expect(summary.checked).toBeGreaterThan(0);
  });

  it("reports head_hash as the EXISTING chain head (never recomputed)", () => {
    const db = seededDb(NOW);
    const summary = buildTrustSummary(db, "raw");
    expect(summary.head_hash).toBe(expectedHead(db));
    // 64-hex sha256/HMAC, and not the genesis placeholder for a seeded ledger.
    expect(summary.head_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.head_hash).not.toBe(GENESIS_PREV_HASH);
  });

  it("copies each protocol's last-change content_hash verbatim from the ledger", () => {
    const db = seededDb(NOW);
    const summary = buildTrustSummary(db, "raw");

    // Every monitored protocol is listed, ordered by key.
    const keys = summary.protocols.map((p) => p.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(keys.sort()).toEqual(
      listProtocols(db)
        .map((p) => p.key)
        .sort(),
    );

    for (const p of summary.protocols) {
      const row = listProtocols(db).find((r) => r.key === p.key)!;
      const expected = storedLastContentHash(db, row.id);
      expect(p.last_change?.content_hash ?? null).toBe(expected);
    }

    // mcp (has content events) exposes a real 64-hex content_hash.
    const mcp = summary.protocols.find((p) => p.key === "mcp")!;
    expect(mcp.last_change).not.toBeNull();
    expect(mcp.last_change!.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("represents a protocol with no events as last_change: null", () => {
    const db = seededDb(NOW);
    const summary = buildTrustSummary(db, "raw");
    // ucp is seeded with no sources and no events.
    const ucp = summary.protocols.find((p) => p.key === "ucp")!;
    expect(ucp.last_change).toBeNull();
  });

  it("surfaces a raw-body tamper as ok:false with the failing seq", () => {
    const db = seededDb(NOW);
    const seq = tamperRawBody(db);
    const summary = buildTrustSummary(db, "raw");

    expect(summary.ok).toBe(false);
    expect(summary.unavailable).toBe(false);
    expect(summary.tampered_seq).toBe(seq);
    // Field-level chain mode trusts the stored content_hash column => still ok.
    expect(buildTrustSummary(db, "chain").ok).toBe(true);
  });

  it("surfaces a chain tamper (event timestamp) in chain mode", () => {
    const db = seededDb(NOW);
    const seq = tamperEventTimestamp(db);
    const summary = buildTrustSummary(db, "chain");
    expect(summary.ok).toBe(false);
    expect(summary.tampered_seq).toBe(seq);
  });

  it("reports unavailable (not a crash) when the ledger secret is unset", () => {
    const db = seededDb(NOW);
    delete process.env.PROTOCOL_RADAR_HMAC_SECRET;
    const summary = buildTrustSummary(db, "raw");
    expect(summary.ok).toBe(false);
    expect(summary.unavailable).toBe(true);
    expect(summary.checked).toBe(0);
    // head_hash is still readable from the DB even when verification cannot run.
    expect(summary.head_hash).toBe(expectedHead(db));
  });

  it("reports GENESIS head for an empty ledger", () => {
    const db = openMigratedDatabase(":memory:");
    const summary = buildTrustSummary(db, "raw");
    expect(summary.head_hash).toBe(GENESIS_PREV_HASH);
    expect(summary.protocols).toEqual([]);
    expect(summary.checked).toBe(0);
  });
});
