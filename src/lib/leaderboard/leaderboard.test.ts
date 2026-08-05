import { describe, it, expect } from "vitest";
import {
  buildLeaderboard,
  ACTIVITY_WEIGHT,
  MOMENTUM_WEIGHT,
  FRESHNESS_WEIGHT,
  STALE_PENALTY,
  type LeaderboardEventInput,
  type LeaderboardProtocolInput,
} from "./leaderboard";

const DAY_MS = 86_400_000;
/** Fixed "now" so every test is deterministic: 2026-08-05T00:00:00Z. */
const NOW = Date.parse("2026-08-05T00:00:00Z");

/** ISO timestamp for `n` days before NOW. */
function daysAgo(n: number): string {
  return new Date(NOW - n * DAY_MS).toISOString();
}

const PROTO = (key: string, stale = false): LeaderboardProtocolInput => ({
  key,
  name: `${key} name`,
  stale,
});

function ev(protocol_key: string, daysAgoN: number): LeaderboardEventInput {
  return { protocol_key, created_at: daysAgo(daysAgoN) };
}

describe("H1 buildLeaderboard — envelope & empty input", () => {
  it("empty input ⇒ empty ranked list with a deterministic generated_at", () => {
    const board = buildLeaderboard({ events: [] }, NOW);
    expect(board.generated_at).toBe("2026-08-05T00:00:00.000Z");
    expect(board.entries).toEqual([]);
  });

  it("generated_at reflects the provided now", () => {
    const t = Date.parse("2025-01-02T03:04:05Z");
    expect(buildLeaderboard({ events: [] }, t).generated_at).toBe(
      "2025-01-02T03:04:05.000Z",
    );
  });

  it("weighting constants sum to 1 (documented blend)", () => {
    expect(ACTIVITY_WEIGHT + MOMENTUM_WEIGHT + FRESHNESS_WEIGHT).toBeCloseTo(
      1,
      10,
    );
  });
});

describe("H1 buildLeaderboard — ranking order", () => {
  it("more recent activity ranks above a quieter/older protocol", () => {
    const protocols = [PROTO("alpha"), PROTO("bravo")];
    const events = [
      // alpha: several very recent changes → high score
      ev("alpha", 1),
      ev("alpha", 3),
      ev("alpha", 5),
      ev("alpha", 10),
      // bravo: a single old change (in the 30–90d window) → low score
      ev("bravo", 70),
    ];
    const board = buildLeaderboard({ protocols, events }, NOW);
    expect(board.entries.map((e) => e.key)).toEqual(["alpha", "bravo"]);
    expect(board.entries[0]!.rank).toBe(1);
    expect(board.entries[1]!.rank).toBe(2);
    expect(board.entries[0]!.score).toBeGreaterThan(board.entries[1]!.score);
  });

  it("assigns ranks 1..N in score-descending order", () => {
    const protocols = [PROTO("a"), PROTO("b"), PROTO("c")];
    const events = [ev("a", 1), ev("a", 2), ev("a", 3), ev("b", 40)];
    const board = buildLeaderboard({ protocols, events }, NOW);
    const scores = board.entries.map((e) => e.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]!).toBeGreaterThanOrEqual(scores[i]!);
    }
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
  });
});

describe("H1 buildLeaderboard — tiebreak determinism", () => {
  it("equal scores break by key ascending (lexicographic)", () => {
    // Three protocols with identical activity ⇒ identical scores ⇒ key tiebreak.
    const protocols = [PROTO("zeta"), PROTO("alpha"), PROTO("mid")];
    const events = [
      ev("zeta", 2),
      ev("alpha", 2),
      ev("mid", 2),
    ];
    const board = buildLeaderboard({ protocols, events }, NOW);
    const scoreSet = new Set(board.entries.map((e) => e.score));
    expect(scoreSet.size).toBe(1); // all tied
    expect(board.entries.map((e) => e.key)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("is deterministic regardless of input protocol/event order", () => {
    const protocols = [PROTO("alpha"), PROTO("mid"), PROTO("zeta")];
    const events = [ev("mid", 2), ev("zeta", 2), ev("alpha", 2)];
    const a = buildLeaderboard({ protocols, events }, NOW);
    const b = buildLeaderboard(
      {
        protocols: [...protocols].reverse(),
        events: [...events].reverse(),
      },
      NOW,
    );
    expect(a.entries).toEqual(b.entries);
  });
});

describe("H1 buildLeaderboard — freshness / stale penalty", () => {
  it("stale flag pushes an otherwise-identical protocol lower", () => {
    const protocols = [PROTO("fresh", false), PROTO("stale", true)];
    // Identical activity for both; only the stale flag differs.
    const events = [
      ev("fresh", 2),
      ev("fresh", 4),
      ev("stale", 2),
      ev("stale", 4),
    ];
    const board = buildLeaderboard({ protocols, events }, NOW);
    const fresh = board.entries.find((e) => e.key === "fresh")!;
    const stale = board.entries.find((e) => e.key === "stale")!;
    expect(stale.score).toBe(Math.round(fresh.score * STALE_PENALTY));
    expect(fresh.score).toBeGreaterThan(stale.score);
    expect(board.entries[0]!.key).toBe("fresh");
  });

  it("an old last-change (beyond the horizon) yields zero freshness", () => {
    const protocols = [PROTO("cold")];
    const events = [ev("cold", 200)]; // > 90d horizon
    const board = buildLeaderboard({ protocols, events }, NOW);
    expect(board.entries[0]!.components.freshness).toBe(0);
  });
});

describe("H1 buildLeaderboard — zero activity sorts last", () => {
  it("a protocol with no events scores 0 and ranks last", () => {
    const protocols = [PROTO("active"), PROTO("idle")];
    const events = [ev("active", 1), ev("active", 2)];
    const board = buildLeaderboard({ protocols, events }, NOW);
    const idle = board.entries.find((e) => e.key === "idle")!;
    expect(idle.score).toBe(0);
    expect(idle.days_since_last_change).toBeNull();
    expect(idle.components).toEqual({
      activity: 0,
      momentum: 0,
      freshness: 0,
    });
    // idle is last.
    expect(board.entries[board.entries.length - 1]!.key).toBe("idle");
  });

  it("events referencing an unknown protocol are ignored (no phantom entries)", () => {
    const protocols = [PROTO("known")];
    const events = [ev("known", 1), ev("ghost", 1)];
    const board = buildLeaderboard({ protocols, events }, NOW);
    expect(board.entries.map((e) => e.key)).toEqual(["known"]);
  });

  it("unparseable timestamps are dropped, never NaN", () => {
    const protocols = [PROTO("p")];
    const events: LeaderboardEventInput[] = [
      { protocol_key: "p", created_at: "not-a-date" },
    ];
    const board = buildLeaderboard({ protocols, events }, NOW);
    expect(board.entries[0]!.events_30d).toBe(0);
    expect(board.entries[0]!.score).toBe(0);
    expect(Number.isNaN(board.entries[0]!.score)).toBe(false);
  });
});
