import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getSearch } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

afterEach(() => {
  __setDbForTests(null);
});

describe("Feature #9 GET /api/search", () => {
  it("returns 200 JSON with matching protocols and events for a known term", async () => {
    seedAndInject();
    const res = getSearch(req(`/api/search?q=mcp&now=${NOW}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as {
      query: string;
      protocols: Array<{ key: string; name: string }>;
      events: Array<{ protocol_key: string }>;
      count: number;
    };

    expect(body.query).toBe("mcp");
    expect(Array.isArray(body.protocols)).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.protocols.some((p) => p.key === "mcp")).toBe(true);
    expect(body.count).toBe(body.protocols.length + body.events.length);
    expect(body.count).toBeGreaterThan(0);
  });

  it("is case-insensitive", async () => {
    seedAndInject();
    const res = getSearch(req(`/api/search?q=MCP&now=${NOW}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { protocols: Array<{ key: string }> };
    expect(body.protocols.some((p) => p.key === "mcp")).toBe(true);
  });

  it("returns 400 for a missing or empty q", async () => {
    seedAndInject();
    for (const path of ["/api/search", "/api/search?q=", "/api/search?q=%20"]) {
      const res = getSearch(req(path));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("missing_query");
    }
  });

  it("returns 400 for an invalid limit", async () => {
    seedAndInject();
    for (const bad of ["0", "-1", "abc", "101"]) {
      const res = getSearch(req(`/api/search?q=mcp&limit=${bad}`));
      expect(res.status).toBe(400);
    }
  });

  it("respects a valid limit on each collection", async () => {
    seedAndInject();
    const res = getSearch(req(`/api/search?q=protocol&limit=1&now=${NOW}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocols: unknown[];
      events: unknown[];
    };
    expect(body.protocols.length).toBeLessThanOrEqual(1);
    expect(body.events.length).toBeLessThanOrEqual(1);
  });
});
