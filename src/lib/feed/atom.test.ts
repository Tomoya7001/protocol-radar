import { describe, it, expect } from "vitest";
import type { EventListItemDto } from "@/app/_data/queries";
import { buildAtomFeed, entryId, eventTitle } from "./atom";

const ORIGIN = "https://pr.example";
const GENERATED_AT = "2026-08-05T00:00:00.000Z";

function evt(over: Partial<EventListItemDto>): EventListItemDto {
  return {
    seq: 1,
    protocol_key: "acme",
    protocol_name: "Acme",
    type: "appeared",
    summary: "hello",
    created_at: "2026-08-01T12:00:00.000Z",
    hash: "abc123",
    ...over,
  };
}

describe("G6 buildAtomFeed (Atom 1.0)", () => {
  it("emits an XML prolog and exactly one <feed> element", () => {
    const xml = buildAtomFeed({ origin: ORIGIN, entries: [], generatedAt: GENERATED_AT });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect((xml.match(/<feed\b/g) ?? []).length).toBe(1);
    expect((xml.match(/<\/feed>/g) ?? []).length).toBe(1);
  });

  it("uses generatedAt for <updated> when there are no entries", () => {
    const xml = buildAtomFeed({ origin: ORIGIN, entries: [], generatedAt: GENERATED_AT });
    expect(xml).toContain(`<updated>${GENERATED_AT}</updated>`);
    expect(xml).not.toContain("<entry>");
  });

  it("renders each entry with <id>, <updated>, <title>, and an alternate <link>", () => {
    const e = evt({});
    const xml = buildAtomFeed({ origin: ORIGIN, entries: [e], generatedAt: GENERATED_AT });
    expect((xml.match(/<entry>/g) ?? []).length).toBe(1);
    expect(xml).toContain(`<id>${entryId(e)}</id>`);
    expect(xml).toContain("<updated>2026-08-01T12:00:00.000Z</updated>");
    expect(xml).toContain(`<title>${eventTitle(e)}</title>`);
    expect(xml).toContain(
      `<link rel="alternate" href="${ORIGIN}/protocols/acme"/>`,
    );
  });

  it("XML-escapes &, <, >, \" and ' in all text", () => {
    const e = evt({
      protocol_name: 'A&B <x> "q" \'z\'',
      summary: 'sum & <tag> "quote" \'apos\'',
      protocol_key: "acme",
      hash: "h&<>\"'",
    });
    const xml = buildAtomFeed({ origin: ORIGIN, entries: [e], generatedAt: GENERATED_AT });
    // No raw special characters leak inside element/attribute text.
    expect(xml).toContain("A&amp;B &lt;x&gt; &quot;q&quot; &apos;z&apos;");
    expect(xml).toContain("sum &amp; &lt;tag&gt; &quot;quote&quot; &apos;apos&apos;");
    expect(xml).toContain("urn:protocol-radar:event:h&amp;&lt;&gt;&quot;&apos;");
    // Raw ampersand must never appear unescaped (every & is part of an entity).
    expect(/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml)).toBe(false);
    expect(xml).not.toContain("<tag>");
    expect(xml).not.toContain('"q"');
  });

  it("preserves the caller-provided entry order (stable, not re-sorted)", () => {
    const a = evt({ hash: "aaa", created_at: "2026-08-01T00:00:00.000Z", summary: "A" });
    const b = evt({ hash: "bbb", created_at: "2026-08-03T00:00:00.000Z", summary: "B" });
    const c = evt({ hash: "ccc", created_at: "2026-08-02T00:00:00.000Z", summary: "C" });
    const xml = buildAtomFeed({ origin: ORIGIN, entries: [a, b, c], generatedAt: GENERATED_AT });
    const idxA = xml.indexOf(entryId(a));
    const idxB = xml.indexOf(entryId(b));
    const idxC = xml.indexOf(entryId(c));
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
    expect((xml.match(/<entry>/g) ?? []).length).toBe(3);
  });

  it("feed <updated> reflects the first (newest) entry's timestamp", () => {
    const a = evt({ hash: "aaa", created_at: "2026-08-04T09:00:00.000Z" });
    const b = evt({ hash: "bbb", created_at: "2026-08-01T00:00:00.000Z" });
    const xml = buildAtomFeed({ origin: ORIGIN, entries: [a, b], generatedAt: GENERATED_AT });
    const feedUpdated = xml.slice(0, xml.indexOf("<entry>"));
    expect(feedUpdated).toContain("<updated>2026-08-04T09:00:00.000Z</updated>");
  });

  it("is deterministic: identical input yields identical output", () => {
    const input = { origin: ORIGIN, entries: [evt({}), evt({ hash: "zzz" })], generatedAt: GENERATED_AT };
    expect(buildAtomFeed(input)).toBe(buildAtomFeed(input));
  });
});
