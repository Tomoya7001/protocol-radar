import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getFeed } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

afterEach(() => {
  __setDbForTests(null);
});

describe("GET /api/feed", () => {
  it("returns 200 with the RSS content-type", () => {
    __setDbForTests(seededDb(NOW));
    const res = getFeed(req("/api/feed"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
  });

  it("has a well-formed RSS body with rss/channel/item and channel metadata", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getFeed(req("/api/feed"));
    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain("<channel>");
    expect(xml).toContain("</channel>");
    expect(xml).toContain("</rss>");
    expect(xml).toContain("<title>Protocol Radar — changes</title>");
    expect(xml).toContain("<lastBuildDate>");
    expect(xml).toContain("<item>");
    // Absolute link derived from request origin.
    expect(xml).toContain("<link>http://test.local/protocols/");
    // guid is a non-permalink stable hash.
    expect(xml).toContain('<guid isPermaLink="false">');
    // Item tags are balanced.
    const opens = (xml.match(/<item>/g) ?? []).length;
    const closes = (xml.match(/<\/item>/g) ?? []).length;
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBe(closes);
  });

  it("filters by protocol key", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getFeed(req("/api/feed?protocol=mcp"));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<item>");
    expect(xml).toContain("/protocols/mcp");
    // No other protocol pages leak into the filtered feed.
    expect(xml).not.toContain("/protocols/a2a");
  });

  it("returns 404 JSON for an unknown protocol filter", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getFeed(req("/api/feed?protocol=nope"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("protocol_not_found");
  });

  it("returns 400 JSON for an invalid limit", async () => {
    __setDbForTests(seededDb(NOW));
    for (const bad of ["0", "-1", "abc", "9999"]) {
      const res = getFeed(req(`/api/feed?limit=${bad}`));
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("respects a valid limit", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getFeed(req("/api/feed?limit=2"));
    const xml = await res.text();
    const items = (xml.match(/<item>/g) ?? []).length;
    expect(items).toBe(2);
  });

  it("XML-escapes special characters in dynamic text", async () => {
    const db = seededDb(NOW);
    // Tamper an event summary with characters that MUST be escaped. The feed is a pure
    // read path and does not verify the hash chain, so this exercises escaping directly.
    const nasty = `A & B <tag> "q" 'x'`;
    db.prepare(
      "UPDATE events SET summary = ? WHERE seq = (SELECT MAX(seq) FROM events)",
    ).run(nasty);
    __setDbForTests(db);

    const res = getFeed(req("/api/feed"));
    const xml = await res.text();
    // Escaped forms present...
    expect(xml).toContain("A &amp; B &lt;tag&gt; &quot;q&quot; &apos;x&apos;");
    // ...and the raw dangerous sequence is absent from the output.
    expect(xml).not.toContain("A & B <tag>");
  });
});
