import { ApiKeyStore } from "./keys";
import { RateLimiter } from "./rateLimit";
import {
  UnconfiguredPaymentVerifier,
  X402Gate,
  type PaymentRequirements,
  type PaymentVerifier,
} from "./x402";

/**
 * Shared, process-wide payment/metering runtime for the agent surface (F-041/F-042).
 *
 * Routes are stateless per request, so the key store and meters must be singletons. The
 * runtime is built lazily from environment config and can be swapped wholesale in tests via
 * {@link __setPaymentRuntimeForTests} — no route needs to know how it was constructed.
 */
export interface PaymentRuntime {
  /** API-key issuance + lookup (F-042). */
  keys: ApiKeyStore;
  /** Hard per-key request ceiling for abuse protection (F-042). */
  keyRateLimiter: RateLimiter;
  /** Free-tier + USDC paid gate (F-041). */
  x402Gate: X402Gate;
}

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function str(name: string, def: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.length === 0 ? def : raw;
}

/** Advertised x402 payment requirements, configurable via env (safe testnet defaults). */
export function defaultPaymentRequirements(): PaymentRequirements {
  return {
    scheme: "exact",
    network: str("X402_NETWORK", "base-sepolia"),
    // 0.001 USDC (6 decimals) by default.
    maxAmountRequired: str("X402_PRICE_ATOMIC", "1000"),
    resource: str("X402_RESOURCE", "/api/x402"),
    description: "Protocol Radar metered protocol data",
    mimeType: "application/json",
    payTo: str("X402_PAY_TO", "0x0000000000000000000000000000000000000000"),
    // USDC on Base Sepolia.
    asset: str("X402_ASSET", "0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
    maxTimeoutSeconds: num("X402_TIMEOUT_SECONDS", 60),
  };
}

/**
 * Build the default runtime from env. The payment verifier defaults to fail-closed
 * (no facilitator configured) so the paid tier is never granted without an injected,
 * real verifier — the offline build never touches a chain.
 */
export function buildDefaultRuntime(
  verifier: PaymentVerifier = new UnconfiguredPaymentVerifier(),
): PaymentRuntime {
  const keys = new ApiKeyStore();
  const keyRateLimiter = new RateLimiter({
    limit: num("KEY_RATE_LIMIT", 60),
    windowMs: num("KEY_RATE_WINDOW_MS", 60_000),
  });
  const freeTier = new RateLimiter({
    limit: num("X402_FREE_TIER_LIMIT", 5),
    windowMs: num("X402_FREE_TIER_WINDOW_MS", 24 * 60 * 60 * 1000),
  });
  const x402Gate = new X402Gate({
    requirements: defaultPaymentRequirements(),
    verifier,
    freeTier,
  });
  return { keys, keyRateLimiter, x402Gate };
}

let cached: PaymentRuntime | null = null;

/** Return the shared runtime, building it lazily on first use. */
export function getPaymentRuntime(): PaymentRuntime {
  if (cached === null) cached = buildDefaultRuntime();
  return cached;
}

/** Test-only hook: inject a runtime (or null to reset to lazy default). */
export function __setPaymentRuntimeForTests(runtime: PaymentRuntime | null): void {
  cached = runtime;
}
