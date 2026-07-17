import { describe, it, expect } from "vitest";
import { buildComparison, parseKeys } from "./compare";
import { seededDb } from "@/app/_data/fixtures";
import { getProtocolSummaries } from "@/app/_data/queries";
import type { ProtocolSummaryDto } from "@/app/_data/queries";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

function summaries(): ProtocolSummaryDto[] {
  return getProtocolSummaries(seededDb(NOW), NOW);
}

describe("D2 parseKeys", () => {
  it("returns [] for an absent param (⇒ compare all)", () => {
    expect(parseKeys(null)).toEqual([]);
  });

  it("splits, trims, drops blanks and preserves order", () => {
    expect(parseKeys(" mcp , a2a ,, x402 ")).toEqual(["mcp", "a2a", "x402"]);
  });

  it("de-duplicates while keeping first occurrence", () => {
    expect(parseKeys("mcp,a2a,mcp")).toEqual(["mcp", "a2a"]);
  });

  it("returns [] for an all-blank value", () => {
    expect(parseKeys("  , ,")).toEqual([]);
  });
});

describe("D2 buildComparison — multiple keys", () => {
  it("compares several protocols in the requested order", () => {
    const result = buildComparison(summaries(), ["a2a", "mcp"], NOW);

    expect(result.count).toBe(2);
    expect(result.protocols.map((p) => p.key)).toEqual(["a2a", "mcp"]);
    expect(result.generated_at).toBe("2026-07-02T00:00:00.000Z");
  });

  it("reuses existing status/freshness and derives change metrics", () => {
    const result = buildComparison(summaries(), ["mcp"], NOW);
    const mcp = result.protocols[0];

    expect(mcp?.found).toBe(true);
    expect(mcp?.name).toBe("Model Context Protocol");
    expect(mcp?.status).toBe("active");
    expect(mcp?.freshness).toBe("fresh");
    expect(mcp?.events_total).toBe(3);
    // latest seeded event for mcp is the spec_change at now-1h.
    expect(mcp?.latest_event?.type).toBe("spec_change");
    expect(mcp?.last_change_at).toBe(mcp?.latest_event?.at ?? null);
    expect(mcp?.days_since_last_change).toBe(0);
  });

  it("carries the vanished lifecycle status through", () => {
    const result = buildComparison(summaries(), ["oldproto"], NOW);
    const old = result.protocols[0];

    expect(old?.found).toBe(true);
    expect(old?.status).toBe("vanished");
    expect(old?.freshness).toBe("vanished");
    expect(old?.latest_event?.type).toBe("vanished");
  });
});

describe("D2 buildComparison — unknown keys mixed in", () => {
  it("returns unknown keys in-band as { found: false } without dropping valid ones", () => {
    const result = buildComparison(summaries(), ["mcp", "nope", "a2a"], NOW);

    expect(result.protocols.map((p) => p.key)).toEqual(["mcp", "nope", "a2a"]);
    const nope = result.protocols[1];
    expect(nope?.found).toBe(false);
    expect(nope?.name).toBeNull();
    expect(nope?.status).toBeNull();
    expect(nope?.freshness).toBeNull();
    expect(nope?.events_total).toBe(0);
    expect(nope?.last_change_at).toBeNull();
    expect(nope?.days_since_last_change).toBeNull();
    expect(nope?.latest_event).toBeNull();
    // valid neighbours are unaffected
    expect(result.protocols[0]?.found).toBe(true);
    expect(result.protocols[2]?.found).toBe(true);
  });
});

describe("D2 buildComparison — empty keys ⇒ all protocols", () => {
  it("compares every protocol in the summaries' stable order", () => {
    const all = summaries();
    const result = buildComparison(all, [], NOW);

    expect(result.count).toBe(all.length);
    expect(result.protocols.map((p) => p.key)).toEqual(all.map((s) => s.key));
    expect(result.protocols.every((p) => p.found)).toBe(true);
  });

  it("handles a protocol with no events (null last change)", () => {
    const result = buildComparison(summaries(), ["ucp"], NOW);
    const ucp = result.protocols[0];

    expect(ucp?.found).toBe(true);
    expect(ucp?.events_total).toBe(0);
    expect(ucp?.last_change_at).toBeNull();
    expect(ucp?.days_since_last_change).toBeNull();
    expect(ucp?.latest_event).toBeNull();
  });
});

describe("D2 buildComparison — empty data", () => {
  it("does not throw and returns an empty comparison for no protocols, no keys", () => {
    const result = buildComparison([], [], NOW);
    expect(result.count).toBe(0);
    expect(result.protocols).toEqual([]);
    expect(result.generated_at).toBe("2026-07-02T00:00:00.000Z");
  });

  it("marks requested keys as not-found when there is no data at all", () => {
    const result = buildComparison([], ["mcp", "a2a"], NOW);
    expect(result.count).toBe(2);
    expect(result.protocols.every((p) => !p.found)).toBe(true);
    expect(result.protocols.map((p) => p.key)).toEqual(["mcp", "a2a"]);
  });
});
