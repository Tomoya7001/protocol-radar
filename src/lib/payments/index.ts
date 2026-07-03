/**
 * Payment, metering and API-key primitives for the agent surface (F-041 x402 metering,
 * F-042 API-key issuance + per-key rate metering). Pure and offline: all on-chain
 * verification is abstracted behind {@link PaymentVerifier} and injected — this package
 * never performs network I/O.
 */

export {
  ApiKeyStore,
  KEY_PREFIX,
  type ApiKeyRecord,
  type ApiTier,
  type IssuedApiKey,
  type KeyStoreOptions,
} from "./keys";

export {
  RateLimiter,
  type RateLimitOptions,
  type RateLimitResult,
} from "./rateLimit";

export {
  X402Gate,
  StaticPaymentVerifier,
  UnconfiguredPaymentVerifier,
  type PaymentRequirements,
  type PaymentVerification,
  type PaymentVerifier,
  type X402Decision,
  type X402GateOptions,
} from "./x402";

export {
  buildDefaultRuntime,
  defaultPaymentRequirements,
  getPaymentRuntime,
  __setPaymentRuntimeForTests,
  type PaymentRuntime,
} from "./runtime";
