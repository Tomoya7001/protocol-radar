import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/discovery/site";

/**
 * GET /robots.txt (Next.js MetadataRoute.Robots convention).
 *
 * C2 discoverability: allow every crawler/agent everywhere and point them at the sitemap so the
 * structured data and endpoints are easy to find. Read-only: derives the base URL from the
 * environment (see `resolveSiteUrl`); no DB access, no writes.
 */
export default function robots(): MetadataRoute.Robots {
  const base = resolveSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
