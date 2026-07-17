import { describe, it, expect } from "vitest";
import { buildProtocolsJsonLd } from "./build";
import { seededDb } from "@/app/_data/fixtures";
import { getProtocolSummaries } from "@/app/_data/queries";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const BASE = "http://test.local";

describe("C2 buildProtocolsJsonLd", () => {
  it("emits a valid schema.org Dataset wrapping an ItemList", () => {
    const summaries = getProtocolSummaries(seededDb(NOW), NOW);
    const doc = buildProtocolsJsonLd(summaries, BASE);

    expect(doc["@context"]).toBe("https://schema.org");
    expect(doc["@type"]).toBe("Dataset");
    expect(doc.url).toBe(`${BASE}/`);
    expect(Array.isArray(doc.keywords)).toBe(true);
    expect(doc.mainEntity["@type"]).toBe("ItemList");
    expect(doc.mainEntity.numberOfItems).toBe(summaries.length);
    expect(doc.mainEntity.itemListElement.length).toBe(summaries.length);
  });

  it("produces sequential ListItem positions and protocol URLs", () => {
    const summaries = getProtocolSummaries(seededDb(NOW), NOW);
    const doc = buildProtocolsJsonLd(summaries, BASE);

    doc.mainEntity.itemListElement.forEach((item, i) => {
      expect(item["@type"]).toBe("ListItem");
      expect(item.position).toBe(i + 1);
      expect(item.url.startsWith(`${BASE}/protocols/`)).toBe(true);
      expect(item.name).toBeTruthy();
      expect(item.status).toBeTruthy();
    });
  });

  it("carries the last-change timestamp as dateModified (null when no events)", () => {
    const summaries = getProtocolSummaries(seededDb(NOW), NOW);
    const doc = buildProtocolsJsonLd(summaries, BASE);
    const byName = Object.fromEntries(
      doc.mainEntity.itemListElement.map((i) => [i.name, i]),
    );
    const first = doc.mainEntity.itemListElement[0];
    const source = summaries.find((s) => s.name === first?.name);
    expect(byName[first?.name ?? ""]?.dateModified).toBe(
      source?.last_event?.created_at ?? null,
    );
  });

  it("returns an empty ItemList for no protocols", () => {
    const doc = buildProtocolsJsonLd([], BASE);
    expect(doc.mainEntity.numberOfItems).toBe(0);
    expect(doc.mainEntity.itemListElement).toEqual([]);
  });
});
