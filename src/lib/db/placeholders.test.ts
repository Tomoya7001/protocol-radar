import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  insertSource,
  updateSourcePoll,
  listProtocols,
} from "@/lib/db";
import {
  isPlaceholderSourceUrl,
  deactivatePlaceholderSources,
  listActivePlaceholderSources,
} from "./placeholders";
import { seededDb, seedSampleData } from "@/app/_data/fixtures";
import { getProtocolSummaries } from "@/app/_data/queries";
import { runVerify } from "@/app/_data/verify";

const NOW = Date.parse("2026-11-18T00:00:00.000Z");
const HOUR_MS = 3600 * 1000;

/** Fixture DB reshaped like production: a2a also has a REAL source polled just now. */
function productionLikeDb() {
  const db = seededDb(NOW);
  const a2a = listProtocols(db).find((p) => p.key === "a2a")!;
  const real = insertSource(db, {
    protocol_id: a2a.id,
    kind: "github",
    url: "https://api.github.com/repos/a2aproject/A2A/releases?per_page=30",
    cadence_seconds: 21600,
  });
  updateSourcePoll(db, real.id, {
    last_polled_at: new Date(NOW - 60 * 1000).toISOString(),
    last_status: 200,
  });
  return { db, a2aId: a2a.id, realId: real.id };
}

function summary(db: ReturnType<typeof seededDb>, key: string) {
  return getProtocolSummaries(db, NOW).find((p) => p.key === key)!;
}

describe("isPlaceholderSourceUrl", () => {
  it("matches the reserved example.test host and its subdomains only", () => {
    expect(isPlaceholderSourceUrl("https://example.test/a2a")).toBe(true);
    expect(isPlaceholderSourceUrl("http://EXAMPLE.TEST/x")).toBe(true);
    expect(isPlaceholderSourceUrl("https://api.example.test/x")).toBe(true);
    expect(isPlaceholderSourceUrl("https://example.test.evil.com/x")).toBe(false);
    expect(isPlaceholderSourceUrl("https://notexample.test/x")).toBe(false);
    expect(isPlaceholderSourceUrl("https://pypi.org/pypi/a2a-sdk/json")).toBe(false);
    expect(isPlaceholderSourceUrl("not a url")).toBe(false);
    expect(isPlaceholderSourceUrl("")).toBe(false);
  });
});

describe("deactivatePlaceholderSources", () => {
  it("switches off only active example.test sources, idempotently", () => {
    const { db, realId } = productionLikeDb();
    expect(listActivePlaceholderSources(db).map((s) => s.url)).toEqual([
      "https://example.test/mcp",
      "https://example.test/a2a",
      "https://example.test/x402",
    ]);
    const first = deactivatePlaceholderSources(db);
    expect(first).toHaveLength(3);
    expect(listActivePlaceholderSources(db)).toEqual([]);
    // Real source untouched.
    const real = db.prepare("SELECT active FROM sources WHERE id = ?").get(realId) as {
      active: number;
    };
    expect(real.active).toBe(1);
    // Retry is a no-op.
    expect(deactivatePlaceholderSources(db)).toEqual([]);
  });

  it("leaves the hash-chained ledger byte-identical and verifiable", () => {
    const { db } = productionLikeDb();
    const before = db.prepare("SELECT * FROM events ORDER BY id").all();
    deactivatePlaceholderSources(db);
    expect(db.prepare("SELECT * FROM events ORDER BY id").all()).toEqual(before);
    expect(runVerify(db, "chain").ok).toBe(true);
    expect(runVerify(db, "raw").ok).toBe(true);
  });
});

describe("freshness rollup with placeholder / inactive sources", () => {
  it("reproduces the production bug: an active overdue placeholder makes a2a stale", () => {
    const { db } = productionLikeDb();
    const a2a = summary(db, "a2a");
    expect(a2a.freshness).toBe("stale");
    expect(a2a.stale_warning).toBe(true);
  });

  it("once the placeholder is inactive it is ignored: a2a is fresh, no warning", () => {
    const { db } = productionLikeDb();
    deactivatePlaceholderSources(db);
    const a2a = summary(db, "a2a");
    expect(a2a.freshness).toBe("fresh");
    expect(a2a.stale_warning).toBe(false);
  });

  it("a protocol with zero active sources does not crash and is never reported fresh", () => {
    const db = seededDb(NOW);
    deactivatePlaceholderSources(db);
    // mcp's ONLY source was the placeholder: nothing is observed any more.
    const mcp = summary(db, "mcp");
    expect(mcp.sources.every((s) => s.freshness === "inactive")).toBe(true);
    expect(mcp.freshness).not.toBe("fresh");
    expect(mcp.freshness).toBe("stale");
  });

  it("a genuinely stale REAL source still raises stale_warning", () => {
    const { db, realId } = productionLikeDb();
    deactivatePlaceholderSources(db);
    updateSourcePoll(db, realId, {
      last_polled_at: new Date(NOW - 100 * HOUR_MS).toISOString(), // > 2 × 6h cadence
      last_status: 200,
    });
    const a2a = summary(db, "a2a");
    expect(a2a.freshness).toBe("stale");
    expect(a2a.stale_warning).toBe(true);
  });
});

describe("seedSampleData guard", () => {
  it("refuses to seed fixtures into a file database", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-seed-guard-"));
    const fileDb = new Database(join(dir, "guard.db"));
    try {
      expect(fileDb.memory).toBe(false);
      expect(() => seedSampleData(fileDb, NOW)).toThrow(/refusing to seed/);
      // Nothing was written before the refusal.
      const tables = fileDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
      expect(tables).toEqual([]);
    } finally {
      fileDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("committed production snapshot (data/snapshot.db)", () => {
  const SNAPSHOT = "./data/snapshot.db";

  it.runIf(existsSync(SNAPSHOT))("has no ACTIVE example.test placeholder source", () => {
    const snap = new Database(SNAPSHOT, { readonly: true, fileMustExist: true });
    try {
      expect(listActivePlaceholderSources(snap)).toEqual([]);
    } finally {
      snap.close();
    }
  });
});
