import { describe, it, expect, afterEach } from "vitest";
import robots from "./robots";

const PREV = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (PREV === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = PREV;
});

describe("C2 robots.txt (MetadataRoute.Robots)", () => {
  it("allows all crawlers and references the sitemap", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    expect(rules[0]?.userAgent).toBe("*");
    expect(rules[0]?.allow).toBe("/");
    expect(r.sitemap).toBe("http://localhost:3000/sitemap.xml");
    expect(r.host).toBe("http://localhost:3000");
  });

  it("derives the base URL from NEXT_PUBLIC_SITE_URL (trailing slash trimmed)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://protocol-radar.example/";
    const r = robots();
    expect(r.sitemap).toBe("https://protocol-radar.example/sitemap.xml");
    expect(r.host).toBe("https://protocol-radar.example");
  });
});
