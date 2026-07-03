import { describe, it, expect, afterEach } from "vitest";
import { seededDb, tamperRawBody, tamperEventTimestamp } from "./fixtures";
import { runVerify, parseVerifyMode } from "./verify";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

afterEach(() => {
  // Restore the secret in case a test cleared it.
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

describe("verify.runVerify (F-034)", () => {
  it("reports ok for an intact chain (raw mode)", () => {
    const db = seededDb(NOW);
    const out = runVerify(db, "raw");
    expect(out.ok).toBe(true);
    expect(out.checked).toBeGreaterThan(0);
    expect(out.mode).toBe("raw");
  });

  it("reports ok for an intact chain (chain mode)", () => {
    const db = seededDb(NOW);
    expect(runVerify(db, "chain").ok).toBe(true);
  });

  it("detects a tampered raw body (raw mode) that chain mode misses", () => {
    const db = seededDb(NOW);
    const seq = tamperRawBody(db);

    const raw = runVerify(db, "raw");
    expect(raw.ok).toBe(false);
    if (!raw.ok && !raw.unavailable) {
      expect(raw.tampered_seq).toBe(seq);
      expect(raw.reason).toMatch(/content_hash/);
    }

    // Field-level chain check trusts the stored content_hash column => still ok.
    expect(runVerify(db, "chain").ok).toBe(true);
  });

  it("detects a tampered event timestamp via the chain check", () => {
    const db = seededDb(NOW);
    const seq = tamperEventTimestamp(db);
    const out = runVerify(db, "chain");
    expect(out.ok).toBe(false);
    if (!out.ok && !out.unavailable) {
      expect(out.tampered_seq).toBe(seq);
    }
  });

  it("returns an 'unavailable' outcome when the ledger secret is unset", () => {
    const db = seededDb(NOW);
    delete process.env.PROTOCOL_RADAR_HMAC_SECRET;
    const out = runVerify(db, "raw");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.unavailable).toBe(true);
  });
});

describe("verify.parseVerifyMode", () => {
  it("defaults to raw and accepts chain", () => {
    expect(parseVerifyMode(null)).toBe("raw");
    expect(parseVerifyMode("raw")).toBe("raw");
    expect(parseVerifyMode("chain")).toBe("chain");
    expect(parseVerifyMode("garbage")).toBe("raw");
  });
});
