import type { PaymentRequirements } from "@/lib/payments";

/**
 * G1 — Pricing storefront model (pure, offline).
 *
 * `buildPricing` turns a set of x402 {@link PaymentRequirements} plus a handful of
 * env-derived numbers into a machine-readable plan structure that both humans (the
 * `/pricing` page) and agents (the `/api/pricing` endpoint) can consume to discover how to
 * pay for the metered agent surface (F-041 free/paid x402 gate, F-042 per-key rate limit).
 *
 * It is a DETERMINISTIC builder: every input is injected as an argument — nothing is read
 * from `process.env` here — so it unit-tests cleanly and never performs I/O.
 */

/** Atomic units + human-readable breakdown of a per-call price. */
export interface PriceView {
  /** Price in the asset's atomic units (USDC has 6 decimals), verbatim from requirements. */
  atomic: string;
  /** Number of decimal places the asset uses (USDC = 6). */
  assetDecimals: number;
  /** Human-readable decimal amount derived from `atomic` / 10^assetDecimals. */
  display: string;
}

/** The always-free metered tier (F-041 free quota). */
export interface FreeTier {
  id: "free";
  name: string;
  /** Metering model: a fixed daily-ish quota, no payment. */
  model: "quota";
  /** Free calls allowed per window (X402_FREE_TIER_LIMIT). */
  callsPerWindow: number;
  /** Length of the free-quota window in milliseconds. */
  windowMs: number;
  price: null;
}

/** The pay-per-call x402 tier (F-041 paid gate). */
export interface PaidTier {
  id: "paid";
  name: string;
  /** Metering model: x402 pay-per-call over an on-chain asset. */
  model: "x402-pay-per-call";
  /** x402 scheme (only "exact" is modelled). */
  scheme: "exact";
  /** Settlement network, e.g. "base-sepolia". */
  network: string;
  /** Asset contract address (USDC). */
  asset: string;
  /** Recipient address funds settle to. */
  payTo: string;
  /** How long the caller has to settle, in seconds. */
  maxTimeoutSeconds: number;
  /** Per-call price, passed through from the requirements. */
  price: PriceView;
}

/** A hard per-API-key request ceiling applied on top of the x402 gate (F-042). */
export interface RateLimitView {
  /** Maximum requests allowed per window per key (KEY_RATE_LIMIT). */
  limit: number;
  /** Window length in milliseconds (KEY_RATE_WINDOW_MS). */
  windowMs: number;
}

/** A premium (metered) endpoint advertised by the storefront. */
export interface PremiumEndpoint {
  /** HTTP method, e.g. "GET". */
  method: string;
  /** Route path, e.g. "/api/x402". */
  path: string;
  description: string;
}

/** The full machine-readable pricing structure. */
export interface Pricing {
  /** Schema version so agents can detect breaking changes. */
  version: 1;
  currency: {
    /** Asset contract address (USDC). */
    asset: string;
    network: string;
    decimals: number;
  };
  tiers: {
    free: FreeTier;
    paid: PaidTier;
  };
  /** Per-key hard rate limit applied to every authenticated call (F-042). */
  rateLimit: RateLimitView;
  /** The endpoints that are metered by the free/paid gate. */
  premiumEndpoints: PremiumEndpoint[];
}

/** Injected inputs for {@link buildPricing}. Everything is a value — no env, no I/O. */
export interface BuildPricingInput {
  /** The advertised x402 payment requirements (price/asset/network/payTo/timeout). */
  requirements: PaymentRequirements;
  /** Free calls allowed per window (X402_FREE_TIER_LIMIT). */
  freeTierLimit: number;
  /** Free-quota window length in milliseconds (X402_FREE_TIER_WINDOW_MS). */
  freeTierWindowMs: number;
  /** Hard per-key request ceiling (KEY_RATE_LIMIT). */
  keyRateLimit: number;
  /** Per-key rate-limit window length in milliseconds (KEY_RATE_WINDOW_MS). */
  keyRateWindowMs: number;
  /** Number of decimals the settlement asset uses (USDC = 6). */
  assetDecimals: number;
  /** The metered endpoints to advertise. */
  premiumEndpoints: readonly PremiumEndpoint[];
}

/**
 * Format an atomic integer amount as a fixed-point decimal string using `decimals` places,
 * with no floating-point rounding (string arithmetic only). Non-numeric or negative input
 * falls back to the raw atomic string.
 */
function formatAtomic(atomic: string, decimals: number): string {
  if (!/^\d+$/.test(atomic) || decimals < 0) return atomic;
  if (decimals === 0) return atomic;
  const padded = atomic.padStart(decimals + 1, "0");
  const cut = padded.length - decimals;
  const whole = padded.slice(0, cut);
  const frac = padded.slice(cut).replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

/**
 * Build the machine-readable pricing structure. Pure and deterministic: identical inputs
 * always yield an identical result.
 */
export function buildPricing(input: BuildPricingInput): Pricing {
  const { requirements: req } = input;

  const price: PriceView = {
    atomic: req.maxAmountRequired,
    assetDecimals: input.assetDecimals,
    display: formatAtomic(req.maxAmountRequired, input.assetDecimals),
  };

  const free: FreeTier = {
    id: "free",
    name: "Free",
    model: "quota",
    callsPerWindow: input.freeTierLimit,
    windowMs: input.freeTierWindowMs,
    price: null,
  };

  const paid: PaidTier = {
    id: "paid",
    name: "Pay-per-call",
    model: "x402-pay-per-call",
    scheme: req.scheme,
    network: req.network,
    asset: req.asset,
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
    price,
  };

  return {
    version: 1,
    currency: {
      asset: req.asset,
      network: req.network,
      decimals: input.assetDecimals,
    },
    tiers: { free, paid },
    rateLimit: {
      limit: input.keyRateLimit,
      windowMs: input.keyRateWindowMs,
    },
    premiumEndpoints: [...input.premiumEndpoints],
  };
}
