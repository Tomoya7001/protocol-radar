import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import {
  ApiKeyStore,
  RateLimiter,
  StaticPaymentVerifier,
  X402Gate,
  __setPaymentRuntimeForTests,
  defaultPaymentRequirements,
  type PaymentRuntime,
} from "@/lib/payments";
import { GET as x402Get } from "./route";

/**
 * F-041 + F-042 acceptance tests for the x402 metered endpoint. Fully offline: the payment
 * runtime is injected with a fake verifier (no chain) and fixed-clock meters.
 */

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const VALID_PAYMENT = "valid-usdc-payment";

interface Harness {
  runtime: PaymentRuntime;
  key: string;
}

/** Build an injected runtime with configurable free-tier and per-key rate limits. */
function harness(opts: { freeLimit: number; keyLimit?: number }): Harness {
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
  __setDbForTests(seededDb(NOW));
  const issued = keys.issue({ tier: "paid" });
  return { runtime, key: issued.key };
}

function get(headers: Record<string, string> = {}): Promise<Response> {
  return x402Get(
    new Request(`http://test.local/api/x402?now=${NOW}`, { headers }),
  );
}

afterEach(() => {
  __setPaymentRuntimeForTests(null);
  __setDbForTests(null);
});

describe("F-042 API-key authentication", () => {
  it("returns 401 when no key is presented", async () => {
    harness({ freeLimit: 5 });
    const res = await get();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("returns 401 for an unknown key", async () => {
    harness({ freeLimit: 5 });
    const res = await get({ authorization: "Bearer prk_not_a_real_key" });
    expect(res.status).toBe(401);
  });

  it("accepts a key via Bearer or x-api-key header", async () => {
    const h = harness({ freeLimit: 5 });
    const viaBearer = await get({ authorization: `Bearer ${h.key}` });
    expect(viaBearer.status).toBe(200);
    const viaHeader = await get({ "x-api-key": h.key });
    expect(viaHeader.status).toBe(200);
  });
});

describe("F-041 free tier", () => {
  it("allows calls up to the free quota, then requires payment", async () => {
    const h = harness({ freeLimit: 2 });
    const auth = { authorization: `Bearer ${h.key}` };

    const first = await get(auth);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-payment-tier")).toBe("free");
    const body = await first.json();
    expect(body.count).toBe(5);
    expect(body.billing.tier).toBe("free");
    expect(body.billing.free_remaining).toBe(1);

    expect((await get(auth)).status).toBe(200); // 2nd free call

    // 3rd call: free quota exhausted ⇒ 402 with x402 requirements.
    const gated = await get(auth);
    expect(gated.status).toBe(402);
    const paymentBody = await gated.json();
    expect(paymentBody.error).toBe("free_tier_exhausted");
    expect(paymentBody.x402Version).toBe(1);
    expect(paymentBody.accepts).toHaveLength(1);
    expect(paymentBody.accepts[0].scheme).toBe("exact");
    expect(paymentBody.accepts[0].maxAmountRequired).toBeDefined();
  });
});

describe("F-041 paid tier", () => {
  it("serves data for a valid X-PAYMENT even when free quota is exhausted", async () => {
    const h = harness({ freeLimit: 0 }); // no free calls
    const auth = { authorization: `Bearer ${h.key}` };

    // Without payment: gated.
    expect((await get(auth)).status).toBe(402);

    // With a valid payment: served as paid.
    const paid = await get({ ...auth, "x-payment": VALID_PAYMENT });
    expect(paid.status).toBe(200);
    expect(paid.headers.get("x-payment-tier")).toBe("paid");
    expect(paid.headers.get("x-payment-response")).toContain("txHash");
    const body = await paid.json();
    expect(body.billing.tier).toBe("paid");
    expect(body.billing.settlement.valid).toBe(true);
  });

  it("rejects an invalid X-PAYMENT with 402", async () => {
    const h = harness({ freeLimit: 0 });
    const res = await get({
      authorization: `Bearer ${h.key}`,
      "x-payment": "forged-payment",
    });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("invalid_payment");
  });
});

describe("F-042 per-key rate metering", () => {
  it("returns 429 once the hard per-key limit is exceeded", async () => {
    const h = harness({ freeLimit: 100, keyLimit: 2 });
    const auth = { authorization: `Bearer ${h.key}` };

    expect((await get(auth)).status).toBe(200);
    expect((await get(auth)).status).toBe(200);

    const limited = await get(auth);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeDefined();
    expect((await limited.json()).error).toBe("rate_limited");
  });

  it("exposes rate-limit headers on a successful call", async () => {
    const h = harness({ freeLimit: 5, keyLimit: 10 });
    const res = await get({ authorization: `Bearer ${h.key}` });
    expect(res.headers.get("x-ratelimit-limit")).toBe("10");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("9");
  });
});
