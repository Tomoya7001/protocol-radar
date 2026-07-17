import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getProtocolFeed } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

/** Next 15 hands route handlers a params Promise; emulate that here. */
function ctx(key: string): { params: Promise<{ key: string }> } {
  return { params: Promise.resolve({ key }) };
}

afterEach(() => {
  __setDbForTests(null);
});

describe("GET /api/feed/[key]", () => {
  it("returns 200 RSS for a known protocol, scoped to just that protocol", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getProtocolFeed(req("/api/feed/mcp"), ctx("mcp"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain("<channel>");
    expect(xml).toContain("</rss>");
    // Title carries the protocol's display name.
    expect(xml).toContain(
      "<title>Protocol Radar — Model Context Protocol changes</title>",
    );
    expect(xml).toContain("<lastBuildDate>");
    expect(xml).toContain("<item>");
    expect(xml).toContain("/protocols/mcp");
    // No other protocol leaks into this per-protocol feed.
    expect(xml).not.toContain("/protocols/a2a");
    // Balanced item tags.
    const opens = (xml.match(/<item>/g) ?? []).length;
    const closes = (xml.match(/<\/item>/g) ?? []).length;
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBe(closes);
  });

  it("returns 404 JSON for an unknown key", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getProtocolFeed(req("/api/feed/nope"), ctx("nope"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: string; key: string };
    expect(body.error).toBe("protocol_not_found");
    expect(body.key).toBe("nope");
  });

  it("returns 400 JSON for an invalid limit", async () => {
    __setDbForTests(seededDb(NOW));
    for (const bad of ["0", "-1", "abc", "9999"]) {
      const res = await getProtocolFeed(
        req(`/api/feed/mcp?limit=${bad}`),
        ctx("mcp"),
      );
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("respects a valid limit", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getProtocolFeed(req("/api/feed/mcp?limit=1"), ctx("mcp"));
    const xml = await res.text();
    const items = (xml.match(/<item>/g) ?? []).length;
    expect(items).toBeLessThanOrEqual(1);
  });

  it("returns valid RSS with no items for a known protocol that has no events", async () => {
    // `ucp` exists in the fixture but has no sources and no events.
    __setDbForTests(seededDb(NOW));
    const res = await getProtocolFeed(req("/api/feed/ucp"), ctx("ucp"));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain(
      "<title>Protocol Radar — Universal Commerce Protocol changes</title>",
    );
    // Well-formed even with zero items: a lastBuildDate fallback is present.
    expect(xml).toContain("<lastBuildDate>");
    expect(xml).not.toContain("<item>");
  });

  it("XML-escapes special characters in dynamic text", async () => {
    const db = seededDb(NOW);
    const nasty = `A & B <tag> "q" 'x'`;
    db.prepare(
      `UPDATE events SET summary = ?
         WHERE seq = (SELECT MAX(e.seq) FROM events e
                        JOIN protocols p ON p.id = e.protocol_id
                       WHERE p.key = 'mcp')`,
    ).run(nasty);
    __setDbForTests(db);

    const res = await getProtocolFeed(req("/api/feed/mcp"), ctx("mcp"));
    const xml = await res.text();
    expect(xml).toContain("A &amp; B &lt;tag&gt; &quot;q&quot; &apos;x&apos;");
    expect(xml).not.toContain("A & B <tag>");
  });
});
