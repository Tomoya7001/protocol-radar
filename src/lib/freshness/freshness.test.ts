import { describe, it, expect } from "vitest";
import {
  computeFreshness,
  STALE_THRESHOLD_MS,
  type FreshnessObservationInput,
  type FreshnessProtocolInput,
} from "./freshness";

const HOUR_MS = 60 * 60 * 1000;
/** Fixed "now" so every test is deterministic: 2026-07-18T00:00:00Z. */
const NOW = Date.parse("2026-07-18T00:00:00Z");

/** ISO timestamp for `hoursAgo` hours before NOW. */
function hoursAgo(n: number): string {
  return new Date(NOW - n * HOUR_MS).toISOString();
}

function obs(protocol_key: string, hoursAgoN: number): FreshnessObservationInput {
  return { protocol_key, observed_at: hoursAgo(hoursAgoN) };
}

const PROTO = (key: string): FreshnessProtocolInput => ({ key });

describe("G5 computeFreshness — top-level shape", () => {
  it("returns a stable {protocols, summary} envelope", () => {
    const report = computeFreshness({ observations: [] }, NOW);
    expect(Array.isArray(report.protocols)).toBe(true);
    expect(report.summary.protocolsTracked).toBe(0);
    expect(report.summary.generatedAt).toBe("2026-07-18T00:00:00.000Z");
  });

  it("generatedAt reflects the provided now (deterministic)", () => {
    const t = Date.parse("2025-01-02T03:04:05Z");
    expect(computeFreshness({ observations: [] }, t).summary.generatedAt).toBe(
      "2025-01-02T03:04:05.000Z",
    );
  });

  it("STALE_THRESHOLD_MS is 48 hours", () => {
    expect(STALE_THRESHOLD_MS).toBe(48 * 60 * 60 * 1000);
  });
});

describe("G5 computeFreshness — empty / safe data", () => {
  it("no protocols and no observations ⇒ empty output, zeroed summary", () => {
    const { protocols, summary } = computeFreshness({ observations: [] }, NOW);
    expect(protocols).toEqual([]);
    expect(summary.protocolsTracked).toBe(0);
    expect(summary.freshCount).toBe(0);
    expect(summary.staleCount).toBe(0);
    expect(summary.oldestStaleMs).toBeNull();
  });

  it("known protocol with zero observations ⇒ stale, nulls, count 0", () => {
    const { protocols, summary } = computeFreshness(
      { protocols: [PROTO("eth")], observations: [] },
      NOW,
    );
    expect(protocols).toHaveLength(1);
    const p = protocols[0]!;
    expect(p.key).toBe("eth");
    expect(p.lastObservedAt).toBeNull();
    expect(p.staleMs).toBeNull();
    expect(p.stale).toBe(true);
    expect(p.observationCount).toBe(0);
    // never-observed contributes to staleCount but not to oldestStaleMs (no finite age).
    expect(summary.staleCount).toBe(1);
    expect(summary.oldestStaleMs).toBeNull();
  });

  it("ignores unparseable timestamps without producing NaN", () => {
    const { protocols } = computeFreshness(
      {
        observations: [
          { protocol_key: "x", observed_at: "not-a-date" },
          obs("x", 1),
        ],
      },
      NOW,
    );
    const p = protocols[0]!;
    expect(p.observationCount).toBe(1); // the bad row is dropped
    expect(Number.isFinite(p.staleMs!)).toBe(true);
    expect(p.staleMs).toBe(1 * HOUR_MS);
  });
});

describe("G5 computeFreshness — fresh vs stale", () => {
  it("a recent observation is fresh", () => {
    const { protocols, summary } = computeFreshness(
      { observations: [obs("eth", 1)] },
      NOW,
    );
    const p = protocols[0]!;
    expect(p.stale).toBe(false);
    expect(p.staleMs).toBe(HOUR_MS);
    expect(p.lastObservedAt).toBe(hoursAgo(1));
    expect(summary.freshCount).toBe(1);
    expect(summary.staleCount).toBe(0);
  });

  it("an observation older than the SLA is stale", () => {
    const { protocols, summary } = computeFreshness(
      { observations: [obs("eth", 72)] }, // 72h > 48h
      NOW,
    );
    const p = protocols[0]!;
    expect(p.stale).toBe(true);
    expect(p.staleMs).toBe(72 * HOUR_MS);
    expect(summary.staleCount).toBe(1);
    expect(summary.oldestStaleMs).toBe(72 * HOUR_MS);
  });

  it("exactly at the threshold is still fresh (strictly greater ⇒ stale)", () => {
    const at = new Date(NOW - STALE_THRESHOLD_MS).toISOString();
    const { protocols } = computeFreshness(
      { observations: [{ protocol_key: "eth", observed_at: at }] },
      NOW,
    );
    expect(protocols[0]!.stale).toBe(false);
  });

  it("just past the threshold is stale", () => {
    const past = new Date(NOW - STALE_THRESHOLD_MS - 1).toISOString();
    const { protocols } = computeFreshness(
      { observations: [{ protocol_key: "eth", observed_at: past }] },
      NOW,
    );
    expect(protocols[0]!.stale).toBe(true);
  });

  it("freshness is driven by the NEWEST observation, count by all", () => {
    const { protocols } = computeFreshness(
      { observations: [obs("eth", 100), obs("eth", 2), obs("eth", 50)] },
      NOW,
    );
    const p = protocols[0]!;
    expect(p.observationCount).toBe(3);
    expect(p.staleMs).toBe(2 * HOUR_MS); // newest is 2h old
    expect(p.stale).toBe(false);
    expect(p.lastObservedAt).toBe(hoursAgo(2));
  });

  it("a future-dated observation clamps staleMs to 0 (never negative)", () => {
    const { protocols } = computeFreshness(
      { observations: [{ protocol_key: "eth", observed_at: hoursAgo(-5) }] },
      NOW,
    );
    expect(protocols[0]!.staleMs).toBe(0);
    expect(protocols[0]!.stale).toBe(false);
  });
});

describe("G5 computeFreshness — summary aggregation", () => {
  it("counts fresh vs stale and reports the oldest finite staleMs", () => {
    const { summary } = computeFreshness(
      {
        protocols: [PROTO("fresh1"), PROTO("fresh2"), PROTO("stale1"), PROTO("never")],
        observations: [
          obs("fresh1", 1),
          obs("fresh2", 10),
          obs("stale1", 100), // stale
          // "never" has no observations
        ],
      },
      NOW,
    );
    expect(summary.protocolsTracked).toBe(4);
    expect(summary.freshCount).toBe(2);
    expect(summary.staleCount).toBe(2); // stale1 + never
    expect(summary.oldestStaleMs).toBe(100 * HOUR_MS); // never is null, excluded
  });

  it("oldestStaleMs picks the largest staleMs among multiple stale protocols", () => {
    const { summary } = computeFreshness(
      { observations: [obs("a", 60), obs("b", 200), obs("c", 90)] },
      NOW,
    );
    expect(summary.staleCount).toBe(3);
    expect(summary.oldestStaleMs).toBe(200 * HOUR_MS);
  });
});

describe("G5 computeFreshness — ordering", () => {
  it("orders most-stale first, never-observed ahead of all, ties by key", () => {
    const { protocols } = computeFreshness(
      {
        protocols: [PROTO("never"), PROTO("fresh"), PROTO("stale")],
        observations: [obs("fresh", 1), obs("stale", 100)],
      },
      NOW,
    );
    expect(protocols.map((p) => p.key)).toEqual(["never", "stale", "fresh"]);
  });

  it("breaks equal staleMs ties by key ascending", () => {
    const { protocols } = computeFreshness(
      { observations: [obs("zulu", 5), obs("alpha", 5)] },
      NOW,
    );
    expect(protocols.map((p) => p.key)).toEqual(["alpha", "zulu"]);
  });
});
