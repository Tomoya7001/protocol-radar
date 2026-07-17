import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getBadge } from "./route";

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

describe("F-035 GET /api/badge/:key", () => {
  it("returns a 200 SVG badge for a known protocol with its status text", async () => {
    seedAndInject();
    const res = await getBadge(req(`/api/badge/mcp?now=${NOW}`), {
      params: Promise.resolve({ key: "mcp" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("protocol radar");
    // mcp seeds with the default "active" status.
    expect(body).toContain("active");
  });

  it("colours a fresh, recently-changed protocol green", async () => {
    seedAndInject();
    const res = await getBadge(req(`/api/badge/mcp?now=${NOW}`), {
      params: Promise.resolve({ key: "mcp" }),
    });
    const body = await res.text();
    expect(body).toContain("#4c1");
  });

  it("returns 404 JSON for an unknown protocol", async () => {
    seedAndInject();
    const res = await getBadge(req("/api/badge/nope"), {
      params: Promise.resolve({ key: "nope" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("protocol_not_found");
  });
});
