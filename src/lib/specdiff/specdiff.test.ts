import { describe, it, expect } from "vitest";
import {
  diffSpecBodies,
  segmentSections,
  hasHeadings,
} from "./specdiff";

/**
 * Pure-core tests for the section-level spec diff (F2). No DB/network/clock: every case is a
 * deterministic function of its string inputs. The bodies mimic the observer's normalized
 * output — whitespace collapsed to single spaces — so the fixtures below reflect the real
 * shape of `observations.body`.
 */

const md = (s: string): string => s.replace(/\s+/g, " ").trim();

describe("hasHeadings", () => {
  it("detects surviving Markdown heading markers", () => {
    expect(hasHeadings("# Title body text")).toBe(true);
    expect(hasHeadings("intro ## Section more")).toBe(true);
  });
  it("is false for prose whose hashes are not heading markers", () => {
    // "issue#42" / "C#code": a '#' with no whitespace before and no space after is not a marker.
    expect(hasHeadings("issue#42 and C#code no markers here")).toBe(false);
    expect(hasHeadings("")).toBe(false);
  });
});

describe("segmentSections", () => {
  it("splits at heading markers and keeps a preamble", () => {
    const secs = segmentSections(md("preamble words # Alpha alpha body ## Beta beta body"));
    expect(secs.map((s) => s.label)).toEqual([
      "(preamble)",
      "# Alpha alpha body",
      "## Beta beta body",
    ]);
  });
  it("disambiguates duplicate heading keys deterministically", () => {
    const secs = segmentSections(md("# Dup x # Dup y"));
    expect(secs).toHaveLength(2);
    expect(secs[0]?.key).not.toBe(secs[1]?.key);
  });
});

describe("diffSpecBodies — section granularity", () => {
  const base = md("# Intro welcome ## Auth login flow ## Errors codes");

  it("reports an added section", () => {
    const to = md("# Intro welcome ## Auth login flow ## Errors codes ## Limits rate caps");
    const res = diffSpecBodies(base, to);
    expect(res.granularity).toBe("section");
    const added = res.sections.filter((s) => s.change === "added");
    expect(added).toHaveLength(1);
    expect(added[0]?.section).toContain("Limits");
    expect(res.summary.added).toBe(1);
    expect(res.summary.changed_count).toBe(1);
  });

  it("reports a removed section", () => {
    const to = md("# Intro welcome ## Auth login flow");
    const res = diffSpecBodies(base, to);
    expect(res.summary.removed).toBe(1);
    expect(res.sections.find((s) => s.change === "removed")?.section).toContain("Errors");
    expect(res.summary.changed_count).toBe(1);
  });

  it("reports a modified section when prose past the heading signature changes", () => {
    // The first HEADING_WORDS (6) words after the marker are the stable section key; a change
    // AFTER them keeps the section identity and is classified as "modified".
    const from = md("# Intro welcome text ## Errors the error codes are listed here alpha");
    const to = md("# Intro welcome text ## Errors the error codes are listed here beta");
    const res = diffSpecBodies(from, to);
    const modified = res.sections.filter((s) => s.change === "modified");
    expect(modified).toHaveLength(1);
    expect(modified[0]?.section).toContain("Errors");
    expect(res.summary.modified).toBe(1);
    expect(res.summary.changed_count).toBe(1);
  });

  it("reports all sections unchanged for identical input", () => {
    const res = diffSpecBodies(base, base);
    expect(res.summary.changed_count).toBe(0);
    expect(res.summary.unchanged).toBe(res.sections.length);
    expect(res.sections.every((s) => s.change === "unchanged")).toBe(true);
  });

  it("treats a null `from` as a first appearance (all added)", () => {
    const res = diffSpecBodies(null, base);
    expect(res.granularity).toBe("section");
    expect(res.summary.added).toBe(res.sections.length);
    expect(res.summary.removed).toBe(0);
    expect(res.sections.every((s) => s.change === "added")).toBe(true);
  });

  it("treats a null `to` as a vanish (all removed)", () => {
    const res = diffSpecBodies(base, null);
    expect(res.summary.removed).toBe(res.sections.length);
    expect(res.sections.every((s) => s.change === "removed")).toBe(true);
  });
});

describe("diffSpecBodies — line granularity fallback", () => {
  it("falls back to line hunks when there are no heading markers", () => {
    const from = md("the quick brown fox jumps over the lazy dog");
    const to = md("the quick red fox leaps over the lazy dog");
    const res = diffSpecBodies(from, to);
    expect(res.granularity).toBe("line");
    expect(res.hunks.length).toBeGreaterThan(0);
    expect(res.summary.changed_count).toBeGreaterThan(0);
  });

  it("reports unchanged for identical headingless prose", () => {
    const body = md("stable prose with no headings at all");
    const res = diffSpecBodies(body, body);
    expect(res.granularity).toBe("line");
    expect(res.summary.changed_count).toBe(0);
    expect(res.summary.unchanged).toBe(1);
    expect(res.sections[0]?.section).toBe("(document)");
  });
});

describe("diffSpecBodies — empty / invalid input", () => {
  it("returns an empty diff for two empty bodies", () => {
    const res = diffSpecBodies("", "");
    expect(res.sections).toEqual([]);
    expect(res.summary).toEqual({
      changed_count: 0,
      added: 0,
      removed: 0,
      modified: 0,
      unchanged: 0,
    });
  });

  it("returns an empty diff for two null bodies", () => {
    const res = diffSpecBodies(null, null);
    expect(res.sections).toEqual([]);
    expect(res.summary.changed_count).toBe(0);
  });

  it("is deterministic — same inputs yield byte-identical output", () => {
    const a = md("# One alpha ## Two beta");
    const b = md("# One alpha ## Two gamma");
    expect(JSON.stringify(diffSpecBodies(a, b))).toBe(
      JSON.stringify(diffSpecBodies(a, b)),
    );
  });
});
