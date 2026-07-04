import { describe, it, expect } from "vitest";
import { seededDb } from "@/app/_data/fixtures";
import {
  buildTimeline,
  compareTimelineEntries,
  buildCompatMatrix,
  buildDigest,
  digestToMarkdown,
  type CompatCell,
  type TimelineEntry,
} from "./index";

// Fixed reference time so every occurrence timestamp (observation.fetched_at) is
// deterministic. Fixtures place events relative to this `now`.
const NOW = Date.parse("2026-07-02T00:00:00.000Z");

/** occurred_at for each fixture event, in hours-before-NOW (see fixtures.ts). */
// mcp:      appeared -3h (seq1), version_bump -2h (seq2), spec_change -1h (seq3)
// a2a:      appeared -90h (seq4)
// x402:     appeared -5h (seq5)
// oldproto: appeared -200h (seq6), vanished -10h (seq7)

describe("F-050 buildTimeline — cross-protocol merged + ranked", () => {
  it("merges events from all protocols, most-recent-first by occurrence", () => {
    const db = seededDb(NOW);
    const entries = buildTimeline(db);

    // All 7 fixture events across 4 protocols with events (ucp has none).
    expect(entries).toHaveLength(7);
    expect(new Set(entries.map((e) => e.protocol_key))).toEqual(
      new Set(["mcp", "a2a", "x402", "oldproto"]),
    );

    // Deterministic ranking by occurrence time (fetched_at), newest first.
    expect(
      entries.map((e) => [e.protocol_key, e.type] as [string, string]),
    ).toEqual([
      ["mcp", "spec_change"], // -1h
      ["mcp", "version_bump"], // -2h
      ["mcp", "appeared"], // -3h
      ["x402", "appeared"], // -5h
      ["oldproto", "vanished"], // -10h
      ["a2a", "appeared"], // -90h
      ["oldproto", "appeared"], // -200h
    ]);

    // occurred_at is strictly non-increasing.
    const times = entries.map((e) => Date.parse(e.occurred_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    // Every entry carries a real ledger hash (provenance handle).
    for (const e of entries) {
      expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("honours a limit while preserving the ranking", () => {
    const db = seededDb(NOW);
    const top3 = buildTimeline(db, { limit: 3 });
    expect(top3.map((e) => e.type)).toEqual([
      "spec_change",
      "version_bump",
      "appeared",
    ]);
    expect(top3.every((e) => e.protocol_key === "mcp")).toBe(true);
  });

  it("breaks occurrence-time ties deterministically by seq DESC", () => {
    const base = {
      protocol_key: "p",
      protocol_name: "P",
      type: "appeared",
      summary: null,
      occurred_at: "2026-07-01T00:00:00.000Z",
      recorded_at: "2026-07-01T00:00:00.000Z",
      hash: "0".repeat(64),
    };
    const older: TimelineEntry = { ...base, seq: 10 } as TimelineEntry;
    const newer: TimelineEntry = { ...base, seq: 11 } as TimelineEntry;
    // Same occurred_at => higher seq must sort first.
    expect(compareTimelineEntries(newer, older)).toBeLessThan(0);
    expect([older, newer].sort(compareTimelineEntries).map((e) => e.seq)).toEqual([
      11, 10,
    ]);
  });
});

describe("F-051 buildCompatMatrix — which protocols compose", () => {
  function cell(cells: CompatCell[][], protocols: string[], a: string, b: string) {
    const i = protocols.indexOf(a);
    const j = protocols.indexOf(b);
    return cells[i]![j]!;
  }

  it("builds a square, symmetric matrix over tracked protocols", () => {
    const db = seededDb(NOW);
    const { protocols, cells } = buildCompatMatrix(db);
    const keys = protocols.map((p) => p.key);

    // Ordered by key, includes the ucp/oldproto protocols with no edges; ap2 absent.
    expect(keys).toEqual(["a2a", "mcp", "oldproto", "ucp", "x402"]);
    expect(cells).toHaveLength(5);
    expect(cells.every((row) => row.length === 5)).toBe(true);

    // Diagonal is self.
    for (let i = 0; i < keys.length; i += 1) {
      expect(cells[i]![i]!.self).toBe(true);
      expect(cells[i]![i]!.composes).toBe(false);
    }

    // Symmetric.
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = 0; j < keys.length; j += 1) {
        expect(cells[i]![j]!.composes).toBe(cells[j]![i]!.composes);
      }
    }
  });

  it("marks documented composing pairs and leaves unknown pairs false", () => {
    const db = seededDb(NOW);
    const { protocols, cells } = buildCompatMatrix(db);
    const keys = protocols.map((p) => p.key);

    // Documented compositions present in the fixture set.
    expect(cell(cells, keys, "mcp", "a2a").composes).toBe(true);
    expect(cell(cells, keys, "mcp", "x402").composes).toBe(true);
    expect(cell(cells, keys, "a2a", "x402").composes).toBe(true);
    // Composing cells carry a rationale ("keep the why").
    expect(cell(cells, keys, "mcp", "a2a").note).toBeTruthy();

    // No documented composition => false, no note.
    expect(cell(cells, keys, "mcp", "ucp").composes).toBe(false);
    expect(cell(cells, keys, "ucp", "x402").composes).toBe(false);
    expect(cell(cells, keys, "oldproto", "a2a").composes).toBe(false);
    expect(cell(cells, keys, "mcp", "ucp").note).toBeNull();
  });

  it("lists the composing pairs once each, ordered by key", () => {
    const db = seededDb(NOW);
    const { pairs } = buildCompatMatrix(db);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([
      ["a2a", "mcp"],
      ["a2a", "x402"],
      ["mcp", "x402"],
    ]);
    expect(pairs.every((p) => p.note.length > 0)).toBe(true);
  });
});

describe("F-052 buildDigest — last-24h window + shape", () => {
  it("selects only changes within the injected 24h window, ranked", () => {
    const db = seededDb(NOW);
    const digest = buildDigest(db, NOW);

    // Within 24h: mcp x3 (-1/-2/-3h), x402 (-5h), oldproto vanished (-10h) = 5.
    // Excluded: a2a (-90h), oldproto appeared (-200h).
    expect(digest.total).toBe(5);
    expect(digest.window_hours).toBe(24);
    expect(digest.generated_at).toBe(new Date(NOW).toISOString());
    expect(digest.since).toBe(new Date(NOW - 24 * 3600 * 1000).toISOString());
    expect(digest.until).toBe(new Date(NOW).toISOString());

    // Flat entries keep the F-050 most-recent-first ranking.
    const times = digest.entries.map((e) => Date.parse(e.occurred_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    // Grouped by protocol, groups ordered by key.
    expect(digest.by_protocol.map((g) => [g.protocol_key, g.count])).toEqual([
      ["mcp", 3],
      ["oldproto", 1],
      ["x402", 1],
    ]);
  });

  it("resolves a different window from the same now (deterministic)", () => {
    const db = seededDb(NOW);
    const digest = buildDigest(db, NOW, { windowHours: 4 });
    // Only mcp's three events fall within 4h.
    expect(digest.total).toBe(3);
    expect(digest.by_protocol.map((g) => g.protocol_key)).toEqual(["mcp"]);
  });

  it("renders markdown with Japanese labels and the data values", () => {
    const db = seededDb(NOW);
    const md = digestToMarkdown(buildDigest(db, NOW));
    expect(md).toContain("# プロトコル・レーダー デイリーダイジェスト");
    expect(md).toContain("変更 5 件");
    expect(md).toContain("Model Context Protocol（mcp） — 3 件");
    expect(md).toContain("[仕様変更]");
    expect(md).toContain("[消失]");
  });

  it("renders an empty-window digest without groups", () => {
    const db = seededDb(NOW);
    // A 1h window ending far in the past selects nothing.
    const digest = buildDigest(db, NOW - 1000 * 3600 * 1000, { windowHours: 1 });
    expect(digest.total).toBe(0);
    expect(digest.by_protocol).toEqual([]);
    expect(digestToMarkdown(digest)).toContain(
      "この期間に記録された変更はありません。",
    );
  });
});
