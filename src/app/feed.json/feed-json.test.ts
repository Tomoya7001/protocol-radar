import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { openMigratedDatabase } from "@/lib/db";
import { GET as getJsonFeed } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

interface JsonFeedItem {
  id: string;
  url: string;
  title: string;
  content_text: string;
  date_published?: string;
  tags: string[];
}
interface JsonFeedBody {
  version: string;
  title: string;
  home_page_url: string;
  feed_url: string;
  items: JsonFeedItem[];
}

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

afterEach(() => {
  __setDbForTests(null);
});

describe("GET /feed.json", () => {
  it("returns 200 with the JSON Feed content-type and 1.1 envelope", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getJsonFeed(req("/feed.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/feed+json; charset=utf-8",
    );
    const body = (await res.json()) as JsonFeedBody;
    expect(body.version).toBe("https://jsonfeed.org/version/1.1");
    expect(body.title).toBe("Protocol Radar — changes");
    expect(body.home_page_url).toBe("http://test.local");
    expect(body.feed_url).toBe("http://test.local/feed.json");
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("shapes each item per JSON Feed 1.1", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getJsonFeed(req("/feed.json"));
    const body = (await res.json()) as JsonFeedBody;
    const first = body.items[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("expected at least one item");
    expect(typeof first.id).toBe("string");
    expect(first.id.length).toBeGreaterThan(0);
    expect(first.url).toContain("http://test.local/protocols/");
    expect(typeof first.title).toBe("string");
    expect(typeof first.content_text).toBe("string");
    // date_published is a valid RFC-3339 timestamp.
    expect(first.date_published).toBeDefined();
    if (first.date_published) {
      expect(Number.isFinite(Date.parse(first.date_published))).toBe(true);
      expect(first.date_published).toBe(
        new Date(Date.parse(first.date_published)).toISOString(),
      );
    }
    // tags carry the protocol key and event type.
    expect(Array.isArray(first.tags)).toBe(true);
    expect(first.tags.length).toBe(2);
  });

  it("returns 400 JSON for an invalid limit", async () => {
    __setDbForTests(seededDb(NOW));
    for (const bad of ["0", "-1", "abc", "9999"]) {
      const res = getJsonFeed(req(`/feed.json?limit=${bad}`));
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("respects a valid limit", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getJsonFeed(req("/feed.json?limit=2"));
    const body = (await res.json()) as JsonFeedBody;
    expect(body.items.length).toBe(2);
  });

  it("returns a valid empty feed when there are no events", async () => {
    // A migrated but unseeded DB has zero events.
    __setDbForTests(openMigratedDatabase(":memory:"));
    const res = getJsonFeed(req("/feed.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/feed+json; charset=utf-8",
    );
    const body = (await res.json()) as JsonFeedBody;
    expect(body.version).toBe("https://jsonfeed.org/version/1.1");
    expect(body.items).toEqual([]);
  });
});
