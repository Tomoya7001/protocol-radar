import { describe, it, expect, afterEach } from "vitest";
import {
  ApiKeyStore,
  RateLimiter,
  StaticPaymentVerifier,
  X402Gate,
  __setPaymentRuntimeForTests,
  defaultPaymentRequirements,
  type PaymentRuntime,
} from "@/lib/payments";
import { guardX402 } from "./x402Guard";

/**
 * G2 — decision-mapping tests for the reusable x402 guard. Fully offline: the payment runtime is
 * injected via __setPaymentRuntimeForTests with a fake verifier (no chain) and fixed-clock meters,
 * following the pattern in src/lib/payments/payments.test.ts.
 */

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const VALID_PAYMENT = "valid-usdc-payment";

/** Build + inject a runtime with configurable free/per-key limits; returns a freshly issued key. */
function harness(opts: { freeLimit: number; keyLimit?: number }): { key: string } {
  const keys = new ApiKeyStore({ now: () => NOW });
  const runtime: PaymentRuntime = {
    keys,
    keyRateLimiter: new RateLimiter({
      limit: opts.keyLimit ?? 1000,
      windowMs: 60_000,
      now: () => NOW,
    }),
    x402Gate: new X402Gate({
      requirements: defaultPaymentRequirements(),
      verifier: new StaticPaymentVerifier([VALID_PAYMENT]),
      freeTier: new RateLimiter({
        limit: opts.freeLimit,
        windowMs: 60_000,
        now: () => NOW,
      }),
    }),
  };
  __setPaymentRuntimeForTests(runtime);
  return { key: keys.issue({ tier: "paid" }).key };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://test.local/api/premium/report", { headers });
}

afterEach(() => {
  __setPaymentRuntimeForTests(null);
});

describe("guardX402 — decision mapping", () => {
  it("maps a missing API key to a 401 gate response", async () => {
    harness({ freeLimit: 5 });
    const result = await guardX402(req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect((await result.response.json()).error).toBe("unauthorized");
    }
  });

  it("maps an unknown key to a 401 gate response", async () => {
    harness({ freeLimit: 5 });
    const result = await guardX402(req({ authorization: "Bearer prk_not_real" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("grants the free tier while quota remains", async () => {
    const h = harness({ freeLimit: 2 });
    const result = await guardX402(req({ authorization: `Bearer ${h.key}` }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.kind).toBe("free");
      expect(result.keyId).toMatch(/.+/);
      if (result.decision.kind === "free") {
        expect(result.decision.meter.remaining).toBe(1);
      }
    }
  });

  it("maps free-tier exhaustion to a 402 with x402 accepts requirements", async () => {
    const h = harness({ freeLimit: 0 }); // no free quota at all
    const result = await guardX402(req({ authorization: `Bearer ${h.key}` }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(402);
      expect(result.response.headers.get("x-payment-required")).toBe("true");
      const body = await result.response.json();
      expect(body.x402Version).toBe(1);
      expect(body.error).toBe("free_tier_exhausted");
      expect(body.accepts).toHaveLength(1);
      expect(body.accepts[0].scheme).toBe("exact");
      expect(body.accepts[0].maxAmountRequired).toBeDefined();
    }
  });

  it("maps an invalid X-PAYMENT to a 402 payment_required", async () => {
    const h = harness({ freeLimit: 0 });
    const result = await guardX402(
      req({ authorization: `Bearer ${h.key}`, "x-payment": "forged" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(402);
      expect((await result.response.json()).error).toBe("invalid_payment");
    }
  });

  it("grants the paid tier for a valid X-PAYMENT without consuming free quota", async () => {
    const h = harness({ freeLimit: 0 });
    const result = await guardX402(
      req({ authorization: `Bearer ${h.key}`, "x-payment": VALID_PAYMENT }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.decision.kind === "paid") {
      expect(result.decision.verification.valid).toBe(true);
    }
  });

  it("maps exceeding the per-key hard limit to a 429 with Retry-After", async () => {
    const h = harness({ freeLimit: 100, keyLimit: 1 });
    const auth = { authorization: `Bearer ${h.key}` };
    expect((await guardX402(req(auth))).ok).toBe(true); // 1st consumes the only slot
    const limited = await guardX402(req(auth));
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.response.status).toBe(429);
      expect(limited.response.headers.get("retry-after")).toBeDefined();
      expect((await limited.response.json()).error).toBe("rate_limited");
    }
  });
});
