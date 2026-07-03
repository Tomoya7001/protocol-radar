import { describe, it, expect } from "vitest";
import type { SourceRow } from "@/lib/db";
import {
  classifyProtocol,
  classifySource,
  isStaleWarning,
  parseIsoMs,
  STALE_FACTOR,
} from "./freshness";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const HOUR_MS = 3600 * 1000;

function mkSource(partial: Partial<SourceRow>): SourceRow {
  return {
    id: 1,
    protocol_id: 1,
    kind: "http",
    url: "https://example.test/x",
    label: null,
    active: 1,
    etag: null,
    last_modified: null,
    cadence_seconds: 3600,
    last_polled_at: null,
    last_status: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

describe("F-033 source freshness", () => {
  it("inactive sources are always 'inactive'", () => {
    expect(
      classifySource(
        mkSource({ active: 0, last_polled_at: new Date(NOW).toISOString() }),
        NOW,
      ),
    ).toBe("inactive");
  });

  it("active but never-polled source is 'pending'", () => {
    expect(classifySource(mkSource({ last_polled_at: null }), NOW)).toBe(
      "pending",
    );
  });

  it("recently polled source is 'fresh'", () => {
    const src = mkSource({
      last_polled_at: new Date(NOW - 100 * 1000).toISOString(),
    });
    expect(classifySource(src, NOW)).toBe("fresh");
  });

  it("is fresh exactly at the STALE_FACTOR × cadence boundary, stale just past it", () => {
    const toleranceMs = 3600 * STALE_FACTOR * 1000;
    const atBoundary = mkSource({
      last_polled_at: new Date(NOW - toleranceMs).toISOString(),
    });
    const pastBoundary = mkSource({
      last_polled_at: new Date(NOW - toleranceMs - 1000).toISOString(),
    });
    expect(classifySource(atBoundary, NOW)).toBe("fresh");
    expect(classifySource(pastBoundary, NOW)).toBe("stale");
  });
});

describe("F-033 protocol freshness aggregation", () => {
  it("vanished status overrides everything", () => {
    const fresh = mkSource({
      last_polled_at: new Date(NOW).toISOString(),
    });
    expect(classifyProtocol("vanished", [fresh], NOW)).toBe("vanished");
  });

  it("no sources => 'unknown'", () => {
    expect(classifyProtocol("active", [], NOW)).toBe("unknown");
  });

  it("all sources inactive => 'stale' (nothing is being observed)", () => {
    expect(
      classifyProtocol(
        "active",
        [mkSource({ active: 0 }), mkSource({ id: 2, active: 0 })],
        NOW,
      ),
    ).toBe("stale");
  });

  it("any active stale source makes the protocol stale", () => {
    const fresh = mkSource({
      id: 1,
      last_polled_at: new Date(NOW - 10 * 1000).toISOString(),
    });
    const stale = mkSource({
      id: 2,
      last_polled_at: new Date(NOW - 100 * HOUR_MS).toISOString(),
    });
    expect(classifyProtocol("active", [fresh, stale], NOW)).toBe("stale");
  });

  it("fresh + pending (no stale) => 'fresh'", () => {
    const fresh = mkSource({
      id: 1,
      last_polled_at: new Date(NOW - 10 * 1000).toISOString(),
    });
    const pending = mkSource({ id: 2, last_polled_at: null });
    expect(classifyProtocol("active", [fresh, pending], NOW)).toBe("fresh");
  });

  it("only pending actives => 'pending'", () => {
    const pending = mkSource({ id: 2, last_polled_at: null });
    expect(classifyProtocol("active", [pending], NOW)).toBe("pending");
  });

  it("inactive sources are ignored when an active fresh source exists", () => {
    const fresh = mkSource({
      id: 1,
      last_polled_at: new Date(NOW - 10 * 1000).toISOString(),
    });
    const inactive = mkSource({ id: 2, active: 0 });
    expect(classifyProtocol("active", [fresh, inactive], NOW)).toBe("fresh");
  });
});

describe("F-033 helpers", () => {
  it("isStaleWarning is true only for 'stale'", () => {
    expect(isStaleWarning("stale")).toBe(true);
    expect(isStaleWarning("fresh")).toBe(false);
    expect(isStaleWarning("vanished")).toBe(false);
    expect(isStaleWarning("pending")).toBe(false);
    expect(isStaleWarning("unknown")).toBe(false);
  });

  it("parseIsoMs handles null and invalid input", () => {
    expect(parseIsoMs(null)).toBeNull();
    expect(parseIsoMs("not-a-date")).toBeNull();
    expect(parseIsoMs("2026-07-02T00:00:00.000Z")).toBe(NOW);
  });
});
