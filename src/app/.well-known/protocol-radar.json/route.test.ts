import { describe, it, expect } from "vitest";
import { GET } from "./route";

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

describe("C2 GET /.well-known/protocol-radar.json", () => {
  it("returns 200 application/json with an origin-derived manifest", async () => {
    const res = GET(req("/.well-known/protocol-radar.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as {
      baseUrl: string;
      endpoints: Array<{ id: string; url: string }>;
    };
    expect(body.baseUrl).toBe("http://test.local");
    const ids = body.endpoints.map((e) => e.id);
    expect(ids).toContain("mcp");
    expect(ids).toContain("openapi");
    expect(ids).toContain("embed");
    for (const e of body.endpoints) {
      expect(e.url.startsWith("http://test.local/")).toBe(true);
    }
  });
});
