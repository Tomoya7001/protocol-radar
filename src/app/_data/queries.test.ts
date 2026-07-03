import { describe, it, expect } from "vitest";
import { seededDb } from "./fixtures";
import {
  getProtocolDetail,
  getProtocolSummaries,
  listEventsDto,
  protocolExists,
} from "./queries";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

describe("queries.getProtocolSummaries (F-030 + F-033)", () => {
  it("returns every protocol, sorted by key", () => {
    const db = seededDb(NOW);
    const summaries = getProtocolSummaries(db, NOW);
    expect(summaries.map((s) => s.key)).toEqual([
      "a2a",
      "mcp",
      "oldproto",
      "ucp",
      "x402",
    ]);
  });

  it("classifies freshness per protocol and flags stale warnings", () => {
    const db = seededDb(NOW);
    const byKey = Object.fromEntries(
      getProtocolSummaries(db, NOW).map((s) => [s.key, s]),
    );
    expect(byKey.mcp?.freshness).toBe("fresh");
    expect(byKey.mcp?.stale_warning).toBe(false);
    expect(byKey.a2a?.freshness).toBe("stale");
    expect(byKey.a2a?.stale_warning).toBe(true);
    expect(byKey.x402?.freshness).toBe("pending");
    expect(byKey.ucp?.freshness).toBe("unknown");
    expect(byKey.oldproto?.freshness).toBe("vanished");
  });

  it("surfaces the last-change event and event count (state + last-change)", () => {
    const db = seededDb(NOW);
    const byKey = Object.fromEntries(
      getProtocolSummaries(db, NOW).map((s) => [s.key, s]),
    );
    expect(byKey.mcp?.event_count).toBe(3);
    expect(byKey.mcp?.last_event?.type).toBe("spec_change");
    expect(byKey.mcp?.status).toBe("active");
    // ucp has no events at all.
    expect(byKey.ucp?.event_count).toBe(0);
    expect(byKey.ucp?.last_event).toBeNull();
    // oldproto ends on a vanished event.
    expect(byKey.oldproto?.status).toBe("vanished");
    expect(byKey.oldproto?.last_event?.type).toBe("vanished");
  });

  it("includes per-source freshness in each summary", () => {
    const db = seededDb(NOW);
    const x402 = getProtocolSummaries(db, NOW).find((s) => s.key === "x402");
    const freshnesses = (x402?.sources ?? []).map((s) => s.freshness).sort();
    expect(freshnesses).toEqual(["inactive", "pending"]);
  });
});

describe("queries.getProtocolDetail (F-031)", () => {
  it("returns the timeline newest-first with hashes and diffs", () => {
    const db = seededDb(NOW);
    const detail = getProtocolDetail(db, "mcp", NOW);
    expect(detail).not.toBeNull();
    expect(detail?.events.map((e) => e.type)).toEqual([
      "spec_change",
      "version_bump",
      "appeared",
    ]);
    // Newest first => descending seq.
    const seqs = detail?.events.map((e) => e.seq) ?? [];
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    // Every event carries a non-empty ledger hash.
    for (const e of detail?.events ?? []) {
      expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Diffs are attached.
    const versionEvent = detail?.events.find((e) => e.type === "version_bump");
    expect(versionEvent?.diffs[0]?.kind).toBe("version");
    expect(versionEvent?.diffs[0]?.detail).toContain("->");
  });

  it("returns null for an unknown protocol key", () => {
    const db = seededDb(NOW);
    expect(getProtocolDetail(db, "does-not-exist", NOW)).toBeNull();
  });
});

describe("queries.listEventsDto (F-032 events feed)", () => {
  it("filters by protocol key, newest first", () => {
    const db = seededDb(NOW);
    const events = listEventsDto(db, { protocolKey: "mcp", limit: 10 });
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.protocol_key === "mcp")).toBe(true);
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
  });

  it("respects the limit across all protocols", () => {
    const db = seededDb(NOW);
    const events = listEventsDto(db, { limit: 2 });
    expect(events).toHaveLength(2);
  });

  it("protocolExists distinguishes known from unknown keys", () => {
    const db = seededDb(NOW);
    expect(protocolExists(db, "mcp")).toBe(true);
    expect(protocolExists(db, "nope")).toBe(false);
  });
});
