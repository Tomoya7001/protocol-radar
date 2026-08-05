import { jsonResponse } from "@/app/api/_lib/http";
import { defaultPaymentRequirements } from "@/lib/payments";
import { buildPricing, type PremiumEndpoint } from "@/lib/pricing/plans";

/** Composes env config at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * G1 — public pricing storefront endpoint.
 *
 * Advertises, machine-readably, how to pay for the metered agent surface: the free quota
 * (F-041), the x402 pay-per-call tier (F-041) and the per-key hard rate limit (F-042). Agents
 * can GET this to discover the price/asset/network/payTo before hitting `/api/x402`.
 *
 * The env-derived numbers are read HERE and injected into the pure {@link buildPricing}
 * builder, which is kept offline/deterministic. This route never touches a chain or DB.
 */

/** Read a numeric env var with a fallback (mirrors the payments runtime defaults). */
function envNum(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

/** The endpoints metered by the free/paid gate. */
const PREMIUM_ENDPOINTS: readonly PremiumEndpoint[] = [
  {
    method: "GET",
    path: "/api/x402",
    description: "Metered protocol data (free quota, then x402 pay-per-call).",
  },
];

export async function GET(): Promise<Response> {
  const requirements = defaultPaymentRequirements();
  const pricing = buildPricing({
    requirements,
    freeTierLimit: envNum("X402_FREE_TIER_LIMIT", 5),
    freeTierWindowMs: envNum("X402_FREE_TIER_WINDOW_MS", 24 * 60 * 60 * 1000),
    keyRateLimit: envNum("KEY_RATE_LIMIT", 60),
    keyRateWindowMs: envNum("KEY_RATE_WINDOW_MS", 60_000),
    assetDecimals: envNum("X402_ASSET_DECIMALS", 6),
    premiumEndpoints: PREMIUM_ENDPOINTS,
  });

  return jsonResponse(pricing);
}
