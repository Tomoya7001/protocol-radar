import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Deployment-configuration regression guard.
 *
 * Context: production served robots.txt, sitemap.xml and llms.txt with a
 * `http://localhost:3000` origin for weeks, because `NEXT_PUBLIC_SITE_URL` was never set on
 * the deployment. `resolveSiteUrl()` was correct — the DEPLOYMENT CONFIG was not, and no test
 * covered it, so nothing failed. Crawling and AI discovery were silently dead.
 *
 * These tests assert the committed files that pin the public origin agree with each other and
 * never point at localhost, so the same class of misconfiguration cannot ship again.
 *
 * The origin must be declared TWICE in vercel.json, because the discovery surfaces do not all
 * resolve it at the same moment:
 *  - `env`       — runtime, for the `force-dynamic` routes (sitemap.xml, llms.txt).
 *  - `build.env` — build time, for statically generated metadata routes (robots.ts declares no
 *                  `dynamic`, so Next.js evaluates it during `next build`, where a runtime-only
 *                  variable is not visible).
 * Declaring only `env` fixes sitemap.xml and llms.txt while leaving robots.txt on localhost —
 * exactly the half-fixed state this suite now prevents.
 */

const REPO_ROOT = join(__dirname, "..", "..");

interface VercelConfig {
  env?: Record<string, string>;
  build?: { env?: Record<string, string> };
}

interface McpServerManifest {
  websiteUrl?: string;
  remotes?: { url?: string }[];
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, relativePath), "utf8")) as T;
}

/** Origin of an absolute URL, or the input unchanged when it does not parse. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

describe("deployment config — public origin", () => {
  it("vercel.json declares NEXT_PUBLIC_SITE_URL", () => {
    const vercel = readJson<VercelConfig>("vercel.json");
    expect(vercel.env?.NEXT_PUBLIC_SITE_URL).toBeTypeOf("string");
    expect(vercel.env?.NEXT_PUBLIC_SITE_URL).not.toBe("");
  });

  it("declares the origin at BUILD time too, for statically generated routes", () => {
    const vercel = readJson<VercelConfig>("vercel.json");
    expect(vercel.build?.env?.NEXT_PUBLIC_SITE_URL).toBeTypeOf("string");
    expect(vercel.build?.env?.NEXT_PUBLIC_SITE_URL).not.toBe("");
  });

  it("keeps the build-time and runtime origins identical", () => {
    const vercel = readJson<VercelConfig>("vercel.json");
    expect(vercel.build?.env?.NEXT_PUBLIC_SITE_URL).toBe(
      vercel.env?.NEXT_PUBLIC_SITE_URL,
    );
  });

  it("the deployed origin is https and never localhost", () => {
    const vercel = readJson<VercelConfig>("vercel.json");
    const siteUrl = vercel.env?.NEXT_PUBLIC_SITE_URL ?? "";

    expect(siteUrl.startsWith("https://")).toBe(true);
    expect(siteUrl).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it("carries no trailing slash (callers concatenate paths directly)", () => {
    const vercel = readJson<VercelConfig>("vercel.json");
    expect(vercel.env?.NEXT_PUBLIC_SITE_URL ?? "").not.toMatch(/\/$/);
  });

  it("documents NEXT_PUBLIC_SITE_URL in .env.example so operators set it", () => {
    const example = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/^NEXT_PUBLIC_SITE_URL=/m);
  });

  it("keeps the MCP registry manifest on the same origin as the deployment", () => {
    const vercel = readJson<VercelConfig>("vercel.json");
    const expected = originOf(vercel.env?.NEXT_PUBLIC_SITE_URL ?? "");
    const manifest = readJson<McpServerManifest>("mcp/server.json");

    expect(originOf(manifest.websiteUrl ?? "")).toBe(expected);
    for (const remote of manifest.remotes ?? []) {
      expect(originOf(remote.url ?? "")).toBe(expected);
    }
  });
});
