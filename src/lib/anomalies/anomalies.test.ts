import { describe, it, expect } from "vitest";
import { computeAnomalies, type AnomalyEventInput } from "./anomalies";

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
): AnomalyEventInput {
  return {
    protocol_key,
    protocol_name: `${protocol_key} name`,
    created_at: daysAgo(daysAgoN),
    type,
  };
}

describe("E2 computeAnomalies — top-level shape", () => {
  it("returns a stable {generated_at, count, anomalies} envelope", () => {
    const report = computeAnomalies({ now: NOW, events: [] });
    expect(report.generated_at).toBe("2026-07-18T00:00:00.000Z");
    expect(report.count).toBe(0);
    expect(report.anomalies).toEqual([]);
  });

  it("generated_at reflects the provided now", () => {
    const t = Date.parse("2025-01-02T03:04:05Z");
    expect(computeAnomalies({ now: t, events: [] }).generated_at).toBe(
      "2025-01-02T03:04:05.000Z",
    );
  });

  it("ignores events with unparseable timestamps (never NaN)", () => {
    const bad: AnomalyEventInput = {
      protocol_key: "x",
      protocol_name: "x name",
      created_at: "not-a-date",
      type: "vanished",
    };
    expect(computeAnomalies({ now: NOW, events: [bad] }).anomalies).toEqual([]);
  });
});

describe("E2 computeAnomalies — empty / no-anomaly cases", () => {
  it("returns [] when there are no events at all", () => {
    expect(computeAnomalies({ now: NOW, events: [] }).anomalies).toEqual([]);
  });

  it("returns [] for steady, evenly-spaced activity (nothing abnormal)", () => {
    // ~15d spacing, newest 5d ago, "appeared" (not churn): no spike/dormancy/churn/vanished.
    const events = [
      ev("steady", 5, "appeared"),
      ev("steady", 20, "appeared"),
      ev("steady", 35, "appeared"),
      ev("steady", 50, "appeared"),
    ];
    expect(computeAnomalies({ now: NOW, events }).anomalies).toEqual([]);
  });
});

describe("E2 computeAnomalies — per-kind detection", () => {
  it("fires `vanished` when the newest event type is vanished", () => {
    const events = [ev("gone", 30, "appeared"), ev("gone", 4, "vanished")];
    const anomalies = computeAnomalies({ now: NOW, events }).anomalies;
    expect(anomalies).toHaveLength(1);
    const a = anomalies[0];
    expect(a?.kind).toBe("vanished");
    expect(a?.severity).toBe("high");
    expect(a?.detected_at).toBe(daysAgo(4));
    expect(a?.evidence.events_total).toBe(2);
  });

  it("fires `dormancy_break` when a new event follows a >=30d gap", () => {
    // 200d gap, then a fresh event 3d ago.
    const events = [ev("waker", 203, "appeared"), ev("waker", 3, "appeared")];
    const anomalies = computeAnomalies({ now: NOW, events }).anomalies;
    expect(anomalies).toHaveLength(1);
    const a = anomalies[0];
    expect(a?.kind).toBe("dormancy_break");
    expect(a?.severity).toBe("notable");
    expect(a?.detected_at).toBe(daysAgo(3));
    expect(a?.evidence.gap_days).toBe(200);
  });

  it("fires `spike` when recent rate far exceeds the 30-90d baseline", () => {
    // baseline: 3 events in the 30-90d window; recent: 3 events in the last 7d.
    const events = [
      ev("hot", 40, "appeared"),
      ev("hot", 55, "appeared"),
      ev("hot", 70, "appeared"),
      ev("hot", 1, "appeared"),
      ev("hot", 2, "appeared"),
      ev("hot", 3, "appeared"),
    ];
    const anomalies = computeAnomalies({ now: NOW, events }).anomalies;
    expect(anomalies).toHaveLength(1);
    const a = anomalies[0];
    expect(a?.kind).toBe("spike");
    expect(a?.evidence.events_7d).toBe(3);
    expect(typeof a?.evidence.ratio).toBe("number");
    expect((a?.evidence.ratio ?? 0) >= 3).toBe(true);
  });

  it("does NOT fire `spike` with fewer than 2 recent events", () => {
    const events = [
      ev("cold", 40, "appeared"),
      ev("cold", 55, "appeared"),
      ev("cold", 70, "appeared"),
      ev("cold", 2, "appeared"), // only 1 recent event
    ];
    const kinds = computeAnomalies({ now: NOW, events }).anomalies.map(
      (a) => a.kind,
    );
    expect(kinds).not.toContain("spike");
  });

  it("fires `rapid_churn` on 3+ version_bump/spec_change within 7d", () => {
    // No 30-90d baseline, so spike stays quiet; isolate churn.
    const events = [
      ev("churny", 1, "version_bump"),
      ev("churny", 2, "spec_change"),
      ev("churny", 4, "version_bump"),
    ];
    const anomalies = computeAnomalies({ now: NOW, events }).anomalies;
    expect(anomalies).toHaveLength(1);
    const a = anomalies[0];
    expect(a?.kind).toBe("rapid_churn");
    expect(a?.severity).toBe("notable");
    expect(a?.evidence.churn_7d).toBe(3);
    expect(a?.detected_at).toBe(daysAgo(1)); // newest churn event
  });

  it("escalates `rapid_churn` to high at 5+ events", () => {
    const events = [
      ev("storm", 1, "version_bump"),
      ev("storm", 2, "spec_change"),
      ev("storm", 3, "version_bump"),
      ev("storm", 4, "spec_change"),
      ev("storm", 6, "version_bump"),
    ];
    const a = computeAnomalies({ now: NOW, events }).anomalies.find(
      (x) => x.kind === "rapid_churn",
    );
    expect(a?.severity).toBe("high");
    expect(a?.evidence.churn_7d).toBe(5);
  });
});

describe("E2 computeAnomalies — sort order", () => {
  it("sorts by severity desc, then detected_at desc", () => {
    const events = [
      // high severity (vanished) at 5d ago
      ev("pv", 20, "appeared"),
      ev("pv", 5, "vanished"),
      // notable (rapid_churn), newest event 1d ago
      ev("pc", 1, "version_bump"),
      ev("pc", 2, "spec_change"),
      ev("pc", 3, "version_bump"),
      // notable (dormancy_break), newest event 10d ago
      ev("pd", 210, "appeared"),
      ev("pd", 10, "appeared"),
    ];
    const anomalies = computeAnomalies({ now: NOW, events }).anomalies;
    expect(anomalies.map((a) => a.kind)).toEqual([
      "vanished", // high
      "rapid_churn", // notable, detected 1d ago (most recent)
      "dormancy_break", // notable, detected 10d ago
    ]);
    // Severity is monotonically non-increasing.
    const rank = { info: 0, notable: 1, high: 2 } as const;
    for (let i = 1; i < anomalies.length; i++) {
      const prev = anomalies[i - 1];
      const cur = anomalies[i];
      if (prev && cur) {
        expect(rank[prev.severity]).toBeGreaterThanOrEqual(rank[cur.severity]);
      }
    }
  });
});
