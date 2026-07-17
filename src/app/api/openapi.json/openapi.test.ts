import { describe, it, expect } from "vitest";
import { GET as getOpenApi } from "./route";

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

describe("Feature #4 GET /api/openapi.json", () => {
  it("returns 200 with JSON content-type and a 3.1 OpenAPI document", async () => {
    const res = getOpenApi(req("/api/openapi.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string };
      servers: Array<{ url: string }>;
      paths: Record<string, unknown>;
    };

    expect(doc.openapi.startsWith("3.1")).toBe(true);
    expect(doc.info.title).toBe("Protocol Radar API");
  });

  it("derives the server url from the request origin", async () => {
    const res = getOpenApi(req("/api/openapi.json"));
    const doc = (await res.json()) as { servers: Array<{ url: string }> };
    expect(doc.servers[0]?.url).toBe("http://test.local");
  });

  it("documents the core paths", async () => {
    const res = getOpenApi(req("/api/openapi.json"));
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty("/api/protocols");
    expect(doc.paths).toHaveProperty("/api/events");
    expect(doc.paths).toHaveProperty("/api/feed");
  });

  it("documents the events limit query parameter", async () => {
    const res = getOpenApi(req("/api/openapi.json"));
    const doc = (await res.json()) as {
      paths: {
        "/api/events": {
          get: { parameters: Array<{ name: string; in: string }> };
        };
      };
    };
    const params = doc.paths["/api/events"].get.parameters;
    const limit = params.find((p) => p.name === "limit");
    expect(limit).toBeDefined();
    expect(limit?.in).toBe("query");
  });
});
