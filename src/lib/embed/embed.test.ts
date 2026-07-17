import { describe, it, expect } from "vitest";
import { seededDb } from "@/app/_data/fixtures";
import { getProtocolDetail } from "@/app/_data/queries";
import { buildCertificate } from "@/lib/certificate/build";
import { buildEmbedCard, buildEmbedSvg, renderEmbedCard } from "./build";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

describe("embed.buildEmbedCard (C1)", () => {
  it("builds a card for a known key with status/freshness matching the shared query", () => {
    const db = seededDb(NOW);
    const card = buildEmbedCard(db, "mcp", NOW);
    expect(card).not.toBeNull();

    const detail = getProtocolDetail(db, "mcp", NOW);
    expect(card?.status).toBe(detail?.protocol.status);
    expect(card?.freshness).toBe(detail?.protocol.freshness);
    expect(card?.eventCount).toBe(detail?.protocol.event_count);
    expect(card?.name).toBe(detail?.protocol.name);
    // sanity: the fixture's mcp is an active/fresh protocol with events.
    expect(card?.status).toBe("active");
    expect(card?.freshness).toBe("fresh");
    expect(card?.eventCount).toBeGreaterThan(0);
  });

  it("copies content_hash verbatim from the existing ledger (never recomputed)", () => {
    const db = seededDb(NOW);
    const card = buildEmbedCard(db, "mcp", NOW);
    const cert = buildCertificate(db, "mcp", NOW, NOW, "raw");
    const expectedHash = cert?.state.last_change?.content_hash ?? null;

    expect(card?.contentHash).toBe(expectedHash);
    expect(card?.lastChangeType).toBe(cert?.state.last_change?.type ?? null);
    // short display is a prefix of the full existing value.
    if (card?.contentHash !== null && card?.contentHash !== undefined) {
      const short = card.contentHashShort ?? "";
      expect(card.contentHash.startsWith(short.replace(/…$/, ""))).toBe(true);
    }
  });

  it("handles a protocol with no events (ucp): null last change, zero count", () => {
    const db = seededDb(NOW);
    const card = buildEmbedCard(db, "ucp", NOW);
    expect(card).not.toBeNull();
    expect(card?.eventCount).toBe(0);
    expect(card?.lastChangeType).toBeNull();
    expect(card?.contentHash).toBeNull();
    expect(card?.contentHashShort).toBeNull();
  });

  it("returns null for an unknown key", () => {
    const db = seededDb(NOW);
    expect(buildEmbedCard(db, "does-not-exist", NOW)).toBeNull();
    expect(buildEmbedSvg(db, "does-not-exist", NOW)).toBeNull();
  });
});

describe("embed.renderEmbedCard / buildEmbedSvg (C1)", () => {
  it("produces a self-contained, well-formed SVG document for a known key", () => {
    const db = seededDb(NOW);
    const svg = buildEmbedSvg(db, "mcp", NOW);
    expect(svg).not.toBeNull();
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg?.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("protocol radar · mcp");
    expect(svg).toContain("status");
    expect(svg).toContain("freshness");
  });

  it("XML-escapes hostile protocol names (no injection surface)", () => {
    const db = seededDb(NOW);
    const detail = getProtocolDetail(db, "mcp", NOW);
    // Forge a card carrying an injection payload in fields and confirm it is escaped.
    const hostile = {
      key: "mcp",
      name: '</text><script>alert(1)</script>',
      status: 'a"onload="x',
      freshness: "fresh & new <b>",
      eventCount: 1,
      lastChangeType: "spec_change",
      contentHash: "deadbeefdeadbeef",
      contentHashShort: "deadbeefdead…",
      generatedAt: detail ? new Date(NOW).toISOString() : "",
    };
    const svg = renderEmbedCard(hostile);
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain('onload="x"');
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&quot;");
  });
});
