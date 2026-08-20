import type { MetadataRoute } from "next";
import { getDb } from "@/app/_data/db";
import { getProtocolSummaries } from "@/app/_data/queries";
import { resolveSiteUrl } from "@/lib/discovery/site";

/** Read the monitored-protocol list from the ledger DB at request time. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sitemap.xml (Next.js MetadataRoute.Sitemap convention).
 *
 * Lists the crawlable HTML surface: the dashboard, /trust, /verify, and one
 * /protocols/{key} detail page per monitored protocol.
 *
 * It deliberately does NOT list /embed/{key}. Those are route handlers returning
 * `image/svg+xml`, not pages — a previous version advertised twelve of them and zero
 * protocol pages, so the sitemap described the site as twelve images plus a homepage and
 * hid every piece of actual content from crawlers. Images belong in an image sitemap, if
 * anywhere; they are not landing pages.
 *
 * Read-only: reuses the shared read layer, performs no DB writes.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = resolveSiteUrl();
  const now = Date.now();
  const protocols = getProtocolSummaries(getDb(), now);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/trust`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/verify`, changeFrequency: "weekly", priority: 0.5 },
  ];

  const protocolEntries: MetadataRoute.Sitemap = protocols.map((p) => {
    // `lastModified` is emitted ONLY from a real observed change. Google uses lastmod only
    // when it is "consistently and verifiably accurate", so stamping every rebuild would
    // train it to ignore the field on a site whose whole value proposition is freshness.
    const lastModified = p.last_event?.created_at;
    return {
      url: `${base}/protocols/${p.key}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
      ...(lastModified ? { lastModified } : {}),
    };
  });

  return [...staticEntries, ...protocolEntries];
}
