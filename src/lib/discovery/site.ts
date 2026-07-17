import { normalizeBaseUrl } from "@/lib/discovery/manifest";

/**
 * C2 — canonical site URL resolver for request-less contexts (robots.ts / sitemap.ts).
 *
 * Metadata routes (`MetadataRoute.Robots` / `MetadataRoute.Sitemap`) run without a `Request`, so
 * the request origin used everywhere else (`new URL(req.url).origin`) is unavailable here. We
 * therefore read the deployment's public URL from the environment, matching the "no hardcoded
 * URLs" rule, and fall back to localhost for dev/build. Read-only: no DB, no writes.
 */
const DEV_FALLBACK = "http://localhost:3000";

/**
 * Resolve the canonical, trailing-slash-free site URL from the environment.
 * Precedence: NEXT_PUBLIC_SITE_URL → SITE_URL → localhost dev fallback.
 */
export function resolveSiteUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.NEXT_PUBLIC_SITE_URL ?? env.SITE_URL ?? DEV_FALLBACK;
  return normalizeBaseUrl(raw.trim() || DEV_FALLBACK);
}
