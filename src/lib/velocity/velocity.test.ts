import { describe, it, expect } from "vitest";
import {
  computeVelocity,
  type VelocityEventInput,
  type VelocityProtocolInput,
} from "./velocity";

const DAY_MS = 86_400_000;
/** Fixed "now" so every test is deterministic: 2026-07-18T00:00:00Z. */
const NOW = Date.parse("2026-07-18T00:00:00Z");

/** ISO timestamp for `daysAgo` days before NOW. */
function daysAgo(n: number): string {
  return new Date(NOW - n * DAY_MS).toISOString();
}

function ev(
  protocol_key: string,
  daysAgoN: number,
  type = "spec_change",
): VelocityEventInput {
  return {
    protocol_key,
    protocol_name: `${protocol_key} name`,
    created_at: daysAgo(daysAgoN),
    type,
  };
}

const PROTO = (key: string): VelocityProtocolInput => ({
  key,
  name: `${key} name`,
});

describe("D1 computeVelocity — top-level shape", () => {
  it("returns a stable {generated_at, protocols, summary} envelope", () => {
    const report = computeVelocity({ now: NOW, events: [] });
    expect(report.generated_at).toBe("2026-07-18T00:00:00.000Z");
    expect(Array.isArray(report.protocols)).toBe(true);
    expect(report.summary.protocols_total).toBe(0);
  });

  it("generated_at reflects the provided now (deterministic)", () => {
    const t = Date.parse("2025-01-02T03:04:05Z");
    expect(computeVelocity({ now: t, events: [] }).generated_at).toBe(
      "2025-01-02T03:04:05.000Z",
    );
  });
});

describe("D1 computeVelocity — empty / safe data", () => {
  it("no protocols and no events ⇒ empty output, null summary picks", () => {
    const { protocols, summary } = computeVelocity({ now: NOW, events: [] });
    expect(protocols).toEqual([]);
    expect(summary.most_active).toBeNull();
    expect(summary.most_dormant).toBeNull();
    expect(summary.events_total).toBe(0);
  });

  it("known protocol with zero events ⇒ dormant, nulls, momentum 0 (no NaN)", () => {
    const { protocols } = computeVelocity({
      now: NOW,
      protocols: [PROTO("eth")],
      events: [],
    });
    expect(protocols).toHaveLength(1);
    const p = protocols[0]!;
    expect(p.events_total).toBe(0);
    expect(p.days_since_last_change).toBeNull();
    expect(p.cadence_days).toBeNull();
    expect(p.momentum_score).toBe(0);
    expect(Number.isNaN(p.momentum_score)).toBe(false);
    expect(p.trend).toBe("dormant");
  });

  it("ignores unparseable timestamps without producing NaN", () => {
    const { protocols } = computeVelocity({
      now: NOW,
      events: [
        { protocol_key: "x", protocol_name: "X", created_at: "not-a-date", type: "spec_change" },
        ev("x", 1),
      ],
    });
    const p = protocols[0]!;
    expect(p.events_total).toBe(1); // the bad row is dropped
    expect(Number.isFinite(p.momentum_score)).toBe(true);
    expect(p.days_since_last_change).toBe(1);
  });

  it("a single event ⇒ cadence null (needs >= 2 dated events)", () => {
    const { protocols } = computeVelocity({ now: NOW, events: [ev("x", 3)] });
    expect(protocols[0]!.cadence_days).toBeNull();
  });
});

describe("D1 computeVelocity — window counts", () => {
  it("counts events_30d / events_90d / events_total by age", () => {
    const { protocols } = computeVelocity({
      now: NOW,
      events: [ev("x", 5), ev("x", 20), ev("x", 60), ev("x", 200)],
    });
    const p = protocols[0]!;
    expect(p.events_total).toBe(4);
    expect(p.events_30d).toBe(2); // 5d, 20d
    expect(p.events_90d).toBe(3); // 5d, 20d, 60d
    expect(p.days_since_last_change).toBe(5);
  });

  it("cadence_days is the mean gap of the most recent events", () => {
    // events at 0,10,20,30 days ago ⇒ gaps of 10 days each ⇒ cadence 10.
    const { protocols } = computeVelocity({
      now: NOW,
      events: [ev("x", 0), ev("x", 10), ev("x", 20), ev("x", 30)],
    });
    expect(protocols[0]!.cadence_days).toBe(10);
  });
});

describe("D1 computeVelocity — trend thresholds", () => {
  it("dormant: no events in the last 90 days", () => {
    const { protocols } = computeVelocity({ now: NOW, events: [ev("x", 120), ev("x", 200)] });
    expect(protocols[0]!.trend).toBe("dormant");
  });

  it("cooling: activity in 30–90d window but none in the last 30d", () => {
    const { protocols } = computeVelocity({
      now: NOW,
      events: [ev("x", 40), ev("x", 55), ev("x", 70)],
    });
    expect(protocols[0]!.trend).toBe("cooling");
  });

  it("accelerating: fresh burst from prior silence", () => {
    // 3 events all inside the last 30d, nothing in 30–90d ⇒ priorRate 0, events30d>=2.
    const { protocols } = computeVelocity({
      now: NOW,
      events: [ev("x", 1), ev("x", 5), ev("x", 12)],
    });
    expect(protocols[0]!.trend).toBe("accelerating");
  });

  it("accelerating: recent rate >= 150% of the prior rate", () => {
    // last 30d: 6 events (rate 0.2/day); prior 60d: 3 events (rate 0.05/day) ⇒ 4x.
    const recent = [2, 6, 10, 14, 18, 22].map((d) => ev("x", d));
    const prior = [40, 60, 80].map((d) => ev("x", d));
    const { protocols } = computeVelocity({ now: NOW, events: [...recent, ...prior] });
    expect(protocols[0]!.trend).toBe("accelerating");
  });

  it("cooling: recent rate <= 50% of the prior rate", () => {
    // last 30d: 1 event (0.033/day); prior 60d: 8 events (0.133/day) ⇒ ratio ~0.25.
    const recent = [10].map((d) => ev("x", d));
    const prior = [35, 45, 50, 55, 65, 70, 80, 85].map((d) => ev("x", d));
    const { protocols } = computeVelocity({ now: NOW, events: [...recent, ...prior] });
    expect(protocols[0]!.trend).toBe("cooling");
  });

  it("steady: recent and prior rates are comparable", () => {
    // last 30d: 2 events; prior 60d: 4 events ⇒ equal per-day rate.
    const recent = [10, 25].map((d) => ev("x", d));
    const prior = [40, 55, 70, 85].map((d) => ev("x", d));
    const { protocols } = computeVelocity({ now: NOW, events: [...recent, ...prior] });
    expect(protocols[0]!.trend).toBe("steady");
  });
});

describe("D1 computeVelocity — momentum bounds", () => {
  it("momentum_score stays within [0, 100]", () => {
    const many = Array.from({ length: 50 }, (_, i) => ev("busy", i % 90));
    const { protocols } = computeVelocity({
      now: NOW,
      protocols: [PROTO("busy"), PROTO("idle")],
      events: [...many, ev("idle", 300)],
    });
    for (const p of protocols) {
      expect(p.momentum_score).toBeGreaterThanOrEqual(0);
      expect(p.momentum_score).toBeLessThanOrEqual(100);
    }
  });

  it("a very active protocol scores higher than a long-dormant one", () => {
    const active = [0, 3, 6, 9, 12].map((d) => ev("hot", d));
    const { protocols } = computeVelocity({
      now: NOW,
      events: [...active, ev("cold", 200)],
    });
    const hot = protocols.find((p) => p.key === "hot")!;
    const cold = protocols.find((p) => p.key === "cold")!;
    expect(hot.momentum_score).toBeGreaterThan(cold.momentum_score);
  });
});

describe("D1 computeVelocity — summary", () => {
  it("ranks most_active by momentum and most_dormant by staleness", () => {
    const active = [0, 4, 8, 12].map((d) => ev("hot", d));
    const { summary } = computeVelocity({
      now: NOW,
      protocols: [PROTO("hot"), PROTO("cold"), PROTO("empty")],
      events: [...active, ev("cold", 100)],
    });
    expect(summary.most_active).toBe("hot");
    expect(summary.most_dormant).toBe("empty"); // zero events = maximally dormant
    expect(summary.protocols_total).toBe(3);
    expect(summary.events_total).toBe(5);
  });

  it("trend counts sum to protocols_total", () => {
    const { summary } = computeVelocity({
      now: NOW,
      protocols: [PROTO("a"), PROTO("b"), PROTO("c")],
      events: [ev("a", 1), ev("a", 5), ev("b", 50), ev("b", 60)],
    });
    const sum =
      summary.accelerating_count +
      summary.steady_count +
      summary.cooling_count +
      summary.dormant_count;
    expect(sum).toBe(summary.protocols_total);
  });

  it("protocols are ordered by momentum descending", () => {
    const { protocols } = computeVelocity({
      now: NOW,
      events: [ev("hot", 1), ev("hot", 3), ev("warm", 40), ev("cold", 300)],
    });
    const scores = protocols.map((p) => p.momentum_score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });
});
