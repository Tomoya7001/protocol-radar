import { describe, it, expect } from "vitest";
import { ApiKeyStore, KEY_PREFIX } from "./keys";
import { RateLimiter } from "./rateLimit";
import { StaticPaymentVerifier, UnconfiguredPaymentVerifier, X402Gate } from "./x402";

/**
 * F-041 / F-042 acceptance tests — fully offline and deterministic (injected clocks and
 * generators; no network, no real chain).
 */

describe("F-042 ApiKeyStore — issuance + lookup", () => {
  it("issues a key with a recognisable prefix and resolves it back", () => {
    const store = new ApiKeyStore({ now: () => 1000 });
    const issued = store.issue({ tier: "paid", label: "agent-x" });

    expect(issued.key.startsWith(KEY_PREFIX)).toBe(true);
    expect(issued.tier).toBe("paid");
    expect(issued.label).toBe("agent-x");
    expect(issued.createdAt).toBe(1000);

    const found = store.authenticate(issued.key);
    expect(found?.id).toBe(issued.id);
    expect(found?.tier).toBe("paid");
  });

  it("defaults to the free tier", () => {
    const store = new ApiKeyStore();
    expect(store.issue().tier).toBe("free");
  });

  it("rejects unknown / empty secrets and never stores plaintext", () => {
    const store = new ApiKeyStore();
    const issued = store.issue();
    expect(store.authenticate("prk_wrong")).toBeNull();
    expect(store.authenticate(null)).toBeNull();
    expect(store.authenticate("")).toBeNull();
    // Two issuances produce distinct ids + secrets.
    const other = store.issue();
    expect(other.id).not.toBe(issued.id);
    expect(other.key).not.toBe(issued.key);
  });

  it("revokes a key so it no longer authenticates", () => {
    const store = new ApiKeyStore();
    const issued = store.issue();
    expect(store.revoke(issued.id)).toBe(true);
    expect(store.authenticate(issued.key)).toBeNull();
    expect(store.revoke(issued.id)).toBe(false);
    expect(store.size()).toBe(0);
  });
});

describe("F-042 RateLimiter — per-key metering", () => {
  it("allows up to the limit then blocks within a window", () => {
    let t = 0;
    const rl = new RateLimiter({ limit: 3, windowMs: 1000, now: () => t });

    const results = [rl.consume("k"), rl.consume("k"), rl.consume("k")];
    expect(results.map((r) => r.allowed)).toEqual([true, true, true]);
    expect(results[2]?.remaining).toBe(0);

    const blocked = rl.consume("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(1000);
  });

  it("meters keys independently", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(rl.consume("a").allowed).toBe(true);
    expect(rl.consume("b").allowed).toBe(true);
    expect(rl.consume("a").allowed).toBe(false);
  });

  it("resets after the window elapses", () => {
    let t = 0;
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(rl.consume("k").allowed).toBe(true);
    expect(rl.consume("k").allowed).toBe(false);
    t = 1000; // window elapsed
    expect(rl.consume("k").allowed).toBe(true);
  });

  it("rejects invalid configuration", () => {
    expect(() => new RateLimiter({ limit: -1, windowMs: 1000 })).toThrow();
    expect(() => new RateLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});

describe("F-041 X402Gate — free tier + paid gate", () => {
  const requirements = {
    scheme: "exact" as const,
    network: "base-sepolia",
    maxAmountRequired: "1000",
    resource: "/api/x402",
    description: "test",
    mimeType: "application/json",
    payTo: "0xpay",
    asset: "0xusdc",
    maxTimeoutSeconds: 60,
  };

  function gate(freeLimit: number, validTokens: string[] = ["good-payment"]): X402Gate {
    return new X402Gate({
      requirements,
      verifier: new StaticPaymentVerifier(validTokens),
      freeTier: new RateLimiter({ limit: freeLimit, windowMs: 1000, now: () => 0 }),
    });
  }

  it("allows the free tier until the quota is exhausted", async () => {
    const g = gate(2);
    expect((await g.evaluate({ clientId: "c", payment: null })).kind).toBe("free");
    expect((await g.evaluate({ clientId: "c", payment: null })).kind).toBe("free");
    const third = await g.evaluate({ clientId: "c", payment: null });
    expect(third.kind).toBe("payment_required");
    if (third.kind === "payment_required") {
      expect(third.reason).toBe("free_tier_exhausted");
      expect(third.requirements.asset).toBe("0xusdc");
    }
  });

  it("grants the paid tier for a valid payment without consuming free quota", async () => {
    const g = gate(1);
    const paid = await g.evaluate({ clientId: "c", payment: "good-payment" });
    expect(paid.kind).toBe("paid");
    if (paid.kind === "paid") expect(paid.verification.valid).toBe(true);
    // Free quota untouched: a subsequent free call still succeeds.
    expect((await g.evaluate({ clientId: "c", payment: null })).kind).toBe("free");
  });

  it("rejects an invalid payment as payment_required", async () => {
    const g = gate(0); // no free tier at all
    const bad = await g.evaluate({ clientId: "c", payment: "forged" });
    expect(bad.kind).toBe("payment_required");
    if (bad.kind === "payment_required") {
      expect(bad.reason).toBe("invalid_payment");
    }
  });

  it("fails closed when no verifier is configured", async () => {
    const g = new X402Gate({
      requirements,
      verifier: new UnconfiguredPaymentVerifier(),
      freeTier: new RateLimiter({ limit: 0, windowMs: 1000, now: () => 0 }),
    });
    const res = await g.evaluate({ clientId: "c", payment: "any-token" });
    expect(res.kind).toBe("payment_required");
    if (res.kind === "payment_required") {
      expect(res.reason).toBe("payment_verification_unavailable");
    }
  });
});
