import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import sitemap from "./sitemap";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const PREV = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  __setDbForTests(null);
  if (PREV === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = PREV;
});

describe("C2 sitemap.xml (MetadataRoute.Sitemap)", () => {
  it("lists the root, /trust, /verify, and one /protocols/{key} per monitored protocol", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://pr.example";
    __setDbForTests(seededDb(NOW));

    const entries = sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls).toContain("https://pr.example/");
    expect(urls).toContain("https://pr.example/trust");
    expect(urls).toContain("https://pr.example/verify");

    for (const key of ["a2a", "mcp", "oldproto", "ucp", "x402"]) {
      expect(urls).toContain(`https://pr.example/protocols/${key}`);
    }
    // 3 static + 5 seeded protocols
    expect(entries.length).toBe(8);
  });

  it("sets lastModified from the protocol's last change when present", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://pr.example";
    __setDbForTests(seededDb(NOW));

    const entries = sitemap();
    const mcp = entries.find((e) => e.url.endsWith("/protocols/mcp"));
    expect(mcp).toBeDefined();
    // mcp is a fresh protocol in the fixtures → it has a last-change timestamp.
    expect(typeof mcp?.lastModified).toBe("string");
  });
  it("never advertises /embed/* — those are SVG responses, not pages", () => {
    // Regression guard: a previous version listed twelve /embed/{key} SVG endpoints and zero
    // protocol pages, so the sitemap hid all of the site's actual content from crawlers.
    process.env.NEXT_PUBLIC_SITE_URL = "https://pr.example";
    __setDbForTests(seededDb(NOW));

    for (const entry of sitemap()) {
      expect(entry.url).not.toContain("/embed/");
    }
  });
});
