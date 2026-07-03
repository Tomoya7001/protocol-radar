import { describe, it, expect } from "vitest";
import { truncateMiddle, formatUtc, relativeAge } from "./format";

describe("format.truncateMiddle", () => {
  it("leaves short strings unchanged", () => {
    expect(truncateMiddle("abc", 8, 8)).toBe("abc");
  });

  it("truncates a long hash in the middle keeping head and tail", () => {
    const hash = "0123456789abcdef0123456789abcdef";
    const out = truncateMiddle(hash, 6, 6);
    expect(out).toBe("012345…abcdef");
    expect(out).toContain("…");
  });
});

describe("format.formatUtc", () => {
  it("formats an ISO timestamp as a stable UTC string", () => {
    expect(formatUtc("2026-07-02T13:05:00.000Z")).toBe("2026-07-02 13:05 UTC");
  });

  it("returns the raw input when unparseable", () => {
    expect(formatUtc("nonsense")).toBe("nonsense");
  });
});

describe("format.relativeAge", () => {
  const now = Date.parse("2026-07-02T12:00:00.000Z");
  it("reports minutes, hours and days", () => {
    expect(relativeAge("2026-07-02T11:59:30.000Z", now)).toBe("just now");
    expect(relativeAge("2026-07-02T11:30:00.000Z", now)).toBe("30m ago");
    expect(relativeAge("2026-07-02T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeAge("2026-06-30T12:00:00.000Z", now)).toBe("2d ago");
  });
});
