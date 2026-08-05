import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getLlmsTxt } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

afterEach(() => {
  __setDbForTests(null);
});

describe("GET /llms.txt", () => {
  it("returns 200 as text/plain following the llms.txt convention", async () => {
    seedAndInject();
    const res = getLlmsTxt();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");

    const body = await res.text();
    // H1 title, blockquote summary, then the three Markdown-link sections.
    expect(body.startsWith("# Protocol Radar")).toBe(true);
    expect(body).toMatch(/^> .+/m);
    expect(body).toContain("## Docs");
    expect(body).toContain("## Agent endpoints");
    expect(body).toContain("## Protocols");
  });

  it("lists the read-only agent endpoints as absolute Markdown links", async () => {
    seedAndInject();
    const body = await getLlmsTxt().text();
    for (const path of [
      "/api/protocols",
      "/api/answer",
      "/api/asof",
      "/api/diff",
      "/api/report",
      "/api/velocity",
      "/api/compare",
      "/api/graph",
      "/api/anomalies",
      "/api/spec-diff",
      "/api/sdk-versions",
      "/api/changelog/{key}",
      "/api/proof/{seq}",
      "/api/certificate",
      "/api/openapi.json",
      "/api/jsonld",
    ]) {
      expect(body).toContain(`](http`);
      expect(body).toContain(path);
    }
  });

  it("includes at least one tracked protocol from the live DB", async () => {
    seedAndInject();
    const body = await getLlmsTxt().text();
    // Protocol bullets link to the per-protocol detail endpoint.
    expect(body).toMatch(/^- \[.+\]\(http.+\/api\/protocols\/.+\): tracked protocol \(.+\)\.$/m);
  });
});
