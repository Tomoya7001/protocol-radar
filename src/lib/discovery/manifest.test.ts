import { describe, it, expect } from "vitest";
import {
  buildDiscoveryManifest,
  normalizeBaseUrl,
  type DiscoveryManifest,
} from "./manifest";

const BASE = "http://test.local";

describe("C2 buildDiscoveryManifest", () => {
  it("normalizeBaseUrl strips a single trailing slash", () => {
    expect(normalizeBaseUrl("http://x.dev/")).toBe("http://x.dev");
    expect(normalizeBaseUrl("http://x.dev")).toBe("http://x.dev");
  });

  it("returns the manifest shape with origin-prefixed endpoints", () => {
    const m: DiscoveryManifest = buildDiscoveryManifest(BASE);
    expect(m.$schema).toBe("https://protocol-radar.dev/schema/discovery/v1");
    expect(m.name).toBe("Protocol Radar");
    expect(m.baseUrl).toBe(BASE);
    expect(Array.isArray(m.endpoints)).toBe(true);
    expect(m.endpoints.length).toBeGreaterThan(0);
    for (const e of m.endpoints) {
      expect(e.url.startsWith(`${BASE}/`)).toBe(true);
      expect(e.id).toBeTruthy();
      expect(e.contentType).toBeTruthy();
      expect(e.description).toBeTruthy();
    }
  });

  it("advertises every agent-facing endpoint id", () => {
    const m = buildDiscoveryManifest(BASE);
    const ids = m.endpoints.map((e) => e.id).sort();
    expect(ids).toEqual(
      [
        "certificate",
        "embed",
        "feed",
        "health",
        "jsonld",
        "llms_txt",
        "mcp",
        "openapi",
        "security",
      ].sort(),
    );
  });

  it("maps ids to the real route paths", () => {
    const m = buildDiscoveryManifest(BASE);
    const byId = Object.fromEntries(m.endpoints.map((e) => [e.id, e.url]));
    expect(byId.llms_txt).toBe(`${BASE}/llms.txt`);
    expect(byId.openapi).toBe(`${BASE}/api/openapi.json`);
    expect(byId.feed).toBe(`${BASE}/api/feed`);
    expect(byId.mcp).toBe(`${BASE}/api/mcp`);
    expect(byId.certificate).toBe(`${BASE}/api/certificate`);
    expect(byId.security).toBe(`${BASE}/api/security`);
    expect(byId.health).toBe(`${BASE}/api/health`);
    expect(byId.jsonld).toBe(`${BASE}/api/jsonld`);
    expect(byId.embed).toBe(`${BASE}/embed/{key}`);
  });

  it("does not produce double slashes when base has a trailing slash", () => {
    const m = buildDiscoveryManifest(`${BASE}/`);
    for (const e of m.endpoints) {
      expect(e.url.includes("//api") || e.url.includes("//embed")).toBe(false);
    }
  });
});
