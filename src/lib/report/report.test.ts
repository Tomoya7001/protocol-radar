import { describe, it, expect } from "vitest";
import {
  buildReport,
  renderMarkdown,
  windowDaysFor,
  REPORT_DAY_MS,
  type BuildReportInput,
  type ReportEventInput,
  type ReportProtocolInput,
} from "./report";
import type { LandscapeDiff, ProtocolDiff } from "@/lib/diff-range";

/** Fixed "now" so every test is deterministic: 2026-07-18T00:00:00Z. */
const NOW = Date.parse("2026-07-18T00:00:00Z");

/** ISO timestamp for `daysAgo` days before NOW. */
function daysAgo(n: number): string {
  return new Date(NOW - n * REPORT_DAY_MS).toISOString();
}

const PROTO = (key: string): ReportProtocolInput => ({
  key,
  name: `${key} name`,
});

function ev(
  key: string,
  daysAgoN: number,
  type = "spec_change",
): ReportEventInput {
  return {
    protocol_key: key,
    protocol_name: `${key} name`,
    created_at: daysAgo(daysAgoN),
    type,
  };
}

/** Build a LandscapeDiff literal for the window ending at NOW. */
function diffOf(
  changes: ProtocolDiff[],
  windowDays: number,
): LandscapeDiff {
  let events_added = 0;
  let appeared = 0;
  let vanished = 0;
  for (const c of changes) {
    events_added += c.events_added_count;
    if (c.change_kinds.includes("appeared")) appeared += 1;
    if (c.change_kinds.includes("vanished")) vanished += 1;
  }
  return {
    from: new Date(NOW - windowDays * REPORT_DAY_MS).toISOString(),
    to: new Date(NOW).toISOString(),
    generated_at: new Date(NOW).toISOString(),
    summary: {
      protocols_changed: changes.length,
      events_added,
      appeared,
      vanished,
    },
    changes,
  };
}

const CHANGED: ProtocolDiff = {
  key: "acme",
  name: "acme name",
  change_kinds: ["appeared", "new_events"],
  from_status: "inactive",
  to_status: "active",
  events_added_count: 2,
  events_between: [
    { type: "appeared", summary: "first seen", at: daysAgo(3) },
    { type: "spec_change", summary: "spec v2", at: daysAgo(1) },
  ],
};

describe("F4 buildReport — envelope & determinism", () => {
  it("returns a stable top-level shape for empty data", () => {
    const input: BuildReportInput = {
      protocols: [],
      events: [],
      diff: diffOf([], 7),
    };
    const report = buildReport(input, { now: NOW });

    expect(report.period).toBe("week");
    expect(report.generated_at).toBe("2026-07-18T00:00:00.000Z");
    expect(report.window.days).toBe(7);
    expect(report.summary.protocol_count).toBe(0);
    expect(report.summary.events_in_period).toBe(0);
    expect(report.summary.protocols_changed).toBe(0);
    expect(report.summary.appeared).toBe(0);
    expect(report.summary.vanished).toBe(0);
    expect(report.changed_protocols).toEqual([]);
    expect(report.anomalies).toEqual([]);
    expect(report.momentum).toEqual([]);
  });

  it("is deterministic: identical inputs produce identical output", () => {
    const input: BuildReportInput = {
      protocols: [PROTO("acme"), PROTO("beta")],
      events: [ev("acme", 1), ev("acme", 3), ev("beta", 40)],
      diff: diffOf([CHANGED], 7),
    };
    const a = buildReport(input, { now: NOW, period: "week" });
    const b = buildReport(input, { now: NOW, period: "week" });
    expect(a).toEqual(b);
    expect(renderMarkdown(a)).toBe(renderMarkdown(b));
  });
});

describe("F4 buildReport — period switching", () => {
  it("defaults to week (7d window)", () => {
    const report = buildReport(
      { protocols: [], events: [], diff: diffOf([], 7) },
      { now: NOW },
    );
    expect(report.period).toBe("week");
    expect(report.window.days).toBe(7);
    expect(windowDaysFor("week")).toBe(7);
  });

  it("supports month (30d window)", () => {
    const report = buildReport(
      { protocols: [], events: [], diff: diffOf([], 30) },
      { now: NOW, period: "month" },
    );
    expect(report.period).toBe("month");
    expect(report.window.days).toBe(30);
    expect(windowDaysFor("month")).toBe(30);
  });
});

describe("F4 buildReport — summary reflects the window diff", () => {
  it("copies appeared/vanished/events_added/changed from the diff", () => {
    const vanishedDiff: ProtocolDiff = {
      key: "gone",
      name: "gone name",
      change_kinds: ["vanished", "status_changed"],
      from_status: "active",
      to_status: "vanished",
      events_added_count: 1,
      events_between: [{ type: "vanished", summary: null, at: daysAgo(2) }],
    };
    const report = buildReport(
      {
        protocols: [PROTO("acme"), PROTO("gone")],
        events: [ev("acme", 1), ev("gone", 2, "vanished")],
        diff: diffOf([CHANGED, vanishedDiff], 7),
      },
      { now: NOW },
    );

    expect(report.summary.protocol_count).toBe(2);
    expect(report.summary.protocols_changed).toBe(2);
    expect(report.summary.events_in_period).toBe(3); // 2 + 1
    expect(report.summary.appeared).toBe(1);
    expect(report.summary.vanished).toBe(1);
    expect(report.changed_protocols).toHaveLength(2);
  });
});

describe("F4 buildReport — anomalies & momentum sections", () => {
  it("surfaces momentum leaders and caps them", () => {
    // 8 protocols, each with a recent event → momentum list should cap at 5.
    const protocols: ReportProtocolInput[] = [];
    const events: ReportEventInput[] = [];
    for (let i = 0; i < 8; i++) {
      const key = `p${i}`;
      protocols.push(PROTO(key));
      events.push(ev(key, 1));
    }
    const report = buildReport(
      { protocols, events, diff: diffOf([], 7) },
      { now: NOW },
    );
    expect(report.momentum.length).toBe(5);
    // Momentum-sorted desc.
    for (let i = 1; i < report.momentum.length; i++) {
      const prev = report.momentum[i - 1];
      const cur = report.momentum[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      if (prev && cur) {
        expect(prev.momentum_score).toBeGreaterThanOrEqual(cur.momentum_score);
      }
    }
  });

  it("detects a vanished anomaly and includes it", () => {
    const report = buildReport(
      {
        protocols: [PROTO("gone")],
        events: [ev("gone", 100), ev("gone", 2, "vanished")],
        diff: diffOf([], 7),
      },
      { now: NOW },
    );
    expect(report.anomalies.length).toBeGreaterThan(0);
    const kinds = report.anomalies.map((a) => a.kind);
    expect(kinds).toContain("vanished");
    expect(report.anomalies.length).toBeLessThanOrEqual(5);
  });
});

describe("F4 renderMarkdown — section coverage & format", () => {
  it("emits every section with a full report", () => {
    const md = renderMarkdown(
      buildReport(
        {
          protocols: [PROTO("acme"), PROTO("gone")],
          events: [
            ev("acme", 1),
            ev("acme", 3),
            ev("gone", 200),
            ev("gone", 2, "vanished"),
          ],
          diff: diffOf([CHANGED], 7),
        },
        { now: NOW },
      ),
    );

    expect(md).toContain("# State of AI Protocols — Weekly Report");
    expect(md).toContain("## Summary");
    expect(md).toContain("## Changed protocols");
    expect(md).toContain("## Notable anomalies");
    expect(md).toContain("## Momentum leaders");
    // Changed-protocol line rendered.
    expect(md).toContain("**acme name** (`acme`)");
    // Momentum table header.
    expect(md).toContain("| Protocol | Momentum | Trend |");
  });

  it("renders month title for period=month", () => {
    const md = renderMarkdown(
      buildReport(
        { protocols: [], events: [], diff: diffOf([], 30) },
        { now: NOW, period: "month" },
      ),
    );
    expect(md).toContain("# State of AI Protocols — Monthly Report");
  });

  it("shows empty-state placeholders when nothing changed", () => {
    const md = renderMarkdown(
      buildReport(
        { protocols: [], events: [], diff: diffOf([], 7) },
        { now: NOW },
      ),
    );
    expect(md).toContain("_No protocols changed in this window._");
    expect(md).toContain("_No anomalies detected._");
    expect(md).toContain("_No protocols tracked._");
  });

  it("is deterministic across two renders of the same report", () => {
    const report = buildReport(
      {
        protocols: [PROTO("acme")],
        events: [ev("acme", 1)],
        diff: diffOf([CHANGED], 7),
      },
      { now: NOW },
    );
    expect(renderMarkdown(report)).toBe(renderMarkdown(report));
  });
});
