import { RateLimiter, type RateLimitResult } from "./rateLimit";

/**
 * F-041 — x402 metered access: a free tier plus a USDC-per-call paid tier.
 *
 * The on-chain settlement is abstracted behind {@link PaymentVerifier} so the gate can be
 * exercised fully offline — production wires a real x402 facilitator client, tests inject a
 * fake. This module NEVER performs network I/O itself.
 *
 * Protocol shape follows the x402 spec: a caller without an accepted payment receives HTTP
 * 402 with a set of `accepts` payment requirements; it retries with an `X-PAYMENT` header
 * whose (opaque, base64) payload is verified here.
 */

export interface PaymentRequirements {
  /** x402 scheme; only "exact" is modelled here. */
  scheme: "exact";
  /** Settlement network, e.g. "base-sepolia". */
  network: string;
  /** Price in the asset's atomic units (USDC has 6 decimals). */
  maxAmountRequired: string;
  /** The resource being paid for (URL/path). */
  resource: string;
  description: string;
  mimeType: string;
  /** Recipient address. */
  payTo: string;
  /** Asset contract address (USDC). */
  asset: string;
  /** How long the caller has to settle, in seconds. */
  maxTimeoutSeconds: number;
}

export interface PaymentVerification {
  valid: boolean;
  /** Machine-readable reason when `valid` is false. */
  reason?: string;
  /** Settlement transaction hash when valid (opaque to this module). */
  txHash?: string;
  /** Payer address when known. */
  payer?: string;
}

/**
 * Verifies (and conceptually settles) an x402 payment. Implementations MUST NOT be trusted
 * to touch the network in tests — inject a fake. `payment` is the raw `X-PAYMENT` header.
 */
export interface PaymentVerifier {
  verify(
    payment: string,
    requirements: PaymentRequirements,
  ): PaymentVerification | Promise<PaymentVerification>;
}

/**
 * Default verifier for environments where no facilitator is configured. It rejects every
 * payment (fail-closed) so the paid tier is never accidentally granted for free.
 */
export class UnconfiguredPaymentVerifier implements PaymentVerifier {
  verify(): PaymentVerification {
    return { valid: false, reason: "payment_verification_unavailable" };
  }
}

/**
 * Deterministic verifier for tests: accepts any payment token in `validTokens`. Never hits a
 * chain. Optionally checks the requirements passed to it via `onVerify`.
 */
export class StaticPaymentVerifier implements PaymentVerifier {
  private readonly valid: Set<string>;
  constructor(
    validTokens: Iterable<string>,
    private readonly settlement: Omit<PaymentVerification, "valid" | "reason"> = {
      txHash: "0xtest",
      payer: "0xpayer",
    },
  ) {
    this.valid = new Set(validTokens);
  }
  verify(payment: string): PaymentVerification {
    if (this.valid.has(payment)) return { valid: true, ...this.settlement };
    return { valid: false, reason: "invalid_payment" };
  }
}

export type X402Decision =
  | { kind: "free"; meter: RateLimitResult }
  | { kind: "paid"; verification: PaymentVerification }
  | {
      kind: "payment_required";
      requirements: PaymentRequirements;
      reason: string;
      verification?: PaymentVerification;
    };

export interface X402GateOptions {
  requirements: PaymentRequirements;
  verifier: PaymentVerifier;
  /** Meters the free tier; when exhausted the caller must pay per call. */
  freeTier: RateLimiter;
}

export class X402Gate {
  private readonly requirements: PaymentRequirements;
  private readonly verifier: PaymentVerifier;
  private readonly freeTier: RateLimiter;

  constructor(opts: X402GateOptions) {
    this.requirements = opts.requirements;
    this.verifier = opts.verifier;
    this.freeTier = opts.freeTier;
  }

  /** The payment requirements advertised in a 402 response. */
  paymentRequirements(): PaymentRequirements {
    return this.requirements;
  }

  /**
   * Decide whether a request may proceed.
   *  - A valid `X-PAYMENT` header ⇒ paid (does NOT consume free quota).
   *  - An invalid payment ⇒ payment_required (with the verification reason).
   *  - No payment + free quota remaining ⇒ free (consumes one free unit).
   *  - No payment + free quota exhausted ⇒ payment_required.
   */
  async evaluate(input: {
    clientId: string;
    payment: string | null;
  }): Promise<X402Decision> {
    if (input.payment !== null && input.payment.length > 0) {
      const verification = await this.verifier.verify(
        input.payment,
        this.requirements,
      );
      if (verification.valid) return { kind: "paid", verification };
      return {
        kind: "payment_required",
        requirements: this.requirements,
        reason: verification.reason ?? "invalid_payment",
        verification,
      };
    }
    const meter = this.freeTier.consume(input.clientId);
    if (meter.allowed) return { kind: "free", meter };
    return {
      kind: "payment_required",
      requirements: this.requirements,
      reason: "free_tier_exhausted",
    };
  }
}
