import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getLlmsTxt } from "./route";

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

describe("GET /llms.txt", () => {
  it("returns 200 as text/plain with the expected discovery document", async () => {
    seedAndInject();
    const res = getLlmsTxt(req(`/llms.txt?now=${NOW}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");

    const body = await res.text();
    expect(body).toContain("# Protocol Radar");
    expect(body).toContain("## Monitored protocols");
    expect(body).toContain("## API");
    // At least one protocol bullet line generated from the live list.
    expect(body).toMatch(/^- .+ \(.+\): status .+, last change .+$/m);
    // API endpoints are absolute URLs derived from the request origin.
    expect(body).toContain("http://test.local/api/protocols");
  });
});
