import { describe, it, expect } from "vitest";
import {
  compareToLatest,
  latestVersion,
  normalizeVersion,
  parseVersionBump,
} from "./version";

/**
 * The badge is embedded in other people's READMEs, so a false "outdated" is expensive: the
 * maintainer removes the badge and never comes back. These tests pin the tolerance rules.
 */

describe("parseVersionBump", () => {
  it("reads the post-change version out of the diff engine's summary format", () => {
    expect(parseVersionBump("version v1.0.0 -> v1.1.0")).toBe("v1.1.0");
    expect(parseVersionBump("version 1.15.16 -> 1.15.17")).toBe("1.15.17");
  });

  it("handles the real upstream shapes observed in production", () => {
    expect(parseVersionBump("version MCP 2026-07-28 RC -> 2026-07-28")).toBe(
      "2026-07-28",
    );
    expect(parseVersionBump("version Release 2026-08-17 -> Release 2026-08-18")).toBe(
      "Release 2026-08-18",
    );
    expect(
      parseVersionBump("version langgraph==1.2.11 -> langgraph-sdk==0.4.3"),
    ).toBe("langgraph-sdk==0.4.3");
  });

  it("returns null for anything that is not a version bump", () => {
    expect(parseVersionBump(null)).toBeNull();
    expect(parseVersionBump("12 lines added, 3 removed")).toBeNull();
    expect(parseVersionBump("appeared at v1.0.0")).toBeNull();
    expect(parseVersionBump("version  -> ")).toBeNull();
  });
});

describe("latestVersion", () => {
  const bump = (summary: string, created_at: string) => ({
    type: "version_bump",
    summary,
    created_at,
  });

  it("picks the newest bump by timestamp, not by array order", () => {
    const events = [
      bump("version 1.0.0 -> 1.1.0", "2026-01-01T00:00:00.000Z"),
      bump("version 1.1.0 -> 2.0.0", "2026-06-01T00:00:00.000Z"),
      bump("version 0.9.0 -> 1.0.0", "2025-01-01T00:00:00.000Z"),
    ];
    expect(latestVersion(events)).toBe("2.0.0");
  });

  it("ignores non-version events", () => {
    expect(
      latestVersion([
        { type: "spec_change", summary: "12 lines added", created_at: "2026-07-01T00:00:00.000Z" },
        bump("version 1.0.0 -> 1.1.0", "2026-01-01T00:00:00.000Z"),
      ]),
    ).toBe("1.1.0");
  });

  it("returns null when nothing has been observed", () => {
    expect(latestVersion([])).toBeNull();
    expect(
      latestVersion([
        { type: "appeared", summary: "appeared at v1", created_at: "2026-01-01T00:00:00.000Z" },
      ]),
    ).toBeNull();
  });
});

describe("normalizeVersion", () => {
  it("treats cosmetic upstream labelling as the same release", () => {
    expect(normalizeVersion("v1.1.0")).toBe(normalizeVersion("1.1.0"));
    expect(normalizeVersion("Release 2026-08-18")).toBe(normalizeVersion("2026-08-18"));
    expect(normalizeVersion("MCP 2026-07-28")).toBe(normalizeVersion("2026-07-28"));
    expect(normalizeVersion("  2026-07-28  ")).toBe(normalizeVersion("2026-07-28"));
  });

  it("does NOT collapse genuinely different versions", () => {
    expect(normalizeVersion("1.1.0")).not.toBe(normalizeVersion("1.1.1"));
    expect(normalizeVersion("2026-07-28")).not.toBe(normalizeVersion("2026-07-29"));
    // A release candidate is not the release.
    expect(normalizeVersion("2026-07-28-rc")).not.toBe(normalizeVersion("2026-07-28"));
  });
});

describe("compareToLatest", () => {
  it("is 'current' only on a match", () => {
    expect(compareToLatest("v1.1.0", "1.1.0")).toBe("current");
    expect(compareToLatest("v1.0.0", "1.1.0")).toBe("outdated");
  });

  it("never claims a verdict without evidence on both sides", () => {
    expect(compareToLatest(null, "1.1.0")).toBe("unknown");
    expect(compareToLatest("1.1.0", null)).toBe("unknown");
    expect(compareToLatest(null, null)).toBe("unknown");
  });
});
