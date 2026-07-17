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
 * C2 discoverability: enumerate the crawlable surface — the root, the /trust page, and one
 * embeddable status card (/embed/{key}) per monitored protocol — so crawlers and AI agents can
 * find every protocol. The protocol list comes from the shared read layer
 * (`getProtocolSummaries`). Read-only: performs no DB writes.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = resolveSiteUrl();
  const now = Date.now();
  const protocols = getProtocolSummaries(getDb(), now);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/trust`, changeFrequency: "weekly", priority: 0.5 },
  ];

  const protocolEntries: MetadataRoute.Sitemap = protocols.map((p) => {
    const lastModified = p.last_event?.created_at;
    return {
      url: `${base}/embed/${p.key}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
      ...(lastModified ? { lastModified } : {}),
    };
  });

  return [...staticEntries, ...protocolEntries];
}
