import { describe, it, expect } from "vitest";
import { ja, en } from "./dictionaries";
import {
  DEFAULT_LOCALE,
  LOCALES,
  getDictionary,
  interpolate,
  isLocale,
  otherLocale,
  resolveLocale,
} from "./index";

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>)
    .flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

describe("F-035 dictionaries", () => {
  it("ja is the default locale and en is available", () => {
    expect(DEFAULT_LOCALE).toBe("ja");
    expect(LOCALES).toEqual(["ja", "en"]);
  });

  it("ja and en have identical key shapes (no missing translations)", () => {
    expect(flattenKeys(en)).toEqual(flattenKeys(ja));
  });

  it("no bundle has empty strings", () => {
    const values = (d: unknown): string[] =>
      d === null || typeof d !== "object"
        ? [d as string]
        : Object.values(d as Record<string, unknown>).flatMap(values);
    expect(values(ja).every((v) => v.length > 0)).toBe(true);
    expect(values(en).every((v) => v.length > 0)).toBe(true);
  });
});

describe("F-035 resolveLocale", () => {
  it("defaults to ja for null/unknown/empty", () => {
    expect(resolveLocale(null)).toBe("ja");
    expect(resolveLocale(undefined)).toBe("ja");
    expect(resolveLocale("")).toBe("ja");
    expect(resolveLocale("fr")).toBe("ja");
  });

  it("accepts en and region-tagged en", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("EN")).toBe("en");
    expect(resolveLocale("en-US")).toBe("en");
  });

  it("isLocale is a correct type guard", () => {
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(123)).toBe(false);
  });
});

describe("F-035 dictionary helpers", () => {
  it("getDictionary returns the requested bundle, ja by default", () => {
    expect(getDictionary("en").nav.dashboard).toBe("Dashboard");
    expect(getDictionary("ja").nav.dashboard).toBe("ダッシュボード");
    expect(getDictionary().appName).toBe("Protocol Radar");
  });

  it("otherLocale flips the locale", () => {
    expect(otherLocale("ja")).toBe("en");
    expect(otherLocale("en")).toBe("ja");
  });

  it("interpolate fills placeholders and leaves unknown ones intact", () => {
    expect(interpolate("seq {seq}", { seq: 7 })).toBe("seq 7");
    expect(interpolate("{n} events", { n: 3 })).toBe("3 events");
    expect(interpolate("{missing}", {})).toBe("{missing}");
  });
});
