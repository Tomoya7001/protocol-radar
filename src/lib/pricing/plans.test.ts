import { describe, it, expect } from "vitest";
import type { PaymentRequirements } from "@/lib/payments";
import { buildPricing, type BuildPricingInput } from "./plans";

/**
 * G1 — pure pricing-builder tests. Fully offline and deterministic (all inputs injected;
 * no env, no I/O).
 */

const REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "1000", // 0.001 USDC (6 decimals)
  resource: "/api/x402",
  description: "Protocol Radar metered protocol data",
  mimeType: "application/json",
  payTo: "0x00000000000000000000000000000000000000ff",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  maxTimeoutSeconds: 60,
};

function input(overrides: Partial<BuildPricingInput> = {}): BuildPricingInput {
  return {
    requirements: REQUIREMENTS,
    freeTierLimit: 5,
    freeTierWindowMs: 24 * 60 * 60 * 1000,
    keyRateLimit: 60,
    keyRateWindowMs: 60_000,
    assetDecimals: 6,
    premiumEndpoints: [
      { method: "GET", path: "/api/x402", description: "Metered protocol data" },
    ],
    ...overrides,
  };
}

describe("G1 buildPricing — tier shape", () => {
  it("models a free quota tier and a paid x402 pay-per-call tier", () => {
    const pricing = buildPricing(input());

    expect(pricing.version).toBe(1);

    expect(pricing.tiers.free.id).toBe("free");
    expect(pricing.tiers.free.model).toBe("quota");
    expect(pricing.tiers.free.price).toBeNull();

    expect(pricing.tiers.paid.id).toBe("paid");
    expect(pricing.tiers.paid.model).toBe("x402-pay-per-call");
    expect(pricing.tiers.paid.scheme).toBe("exact");
  });
});

describe("G1 buildPricing — free-quota number", () => {
  it("passes the free-tier limit and window through verbatim", () => {
    const pricing = buildPricing(input({ freeTierLimit: 5 }));
    expect(pricing.tiers.free.callsPerWindow).toBe(5);
    expect(pricing.tiers.free.windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("reflects a different injected free quota deterministically", () => {
    const pricing = buildPricing(input({ freeTierLimit: 0 }));
    expect(pricing.tiers.free.callsPerWindow).toBe(0);
  });
});

describe("G1 buildPricing — price passthrough", () => {
  it("passes the x402 price/asset/network/payTo through from the requirements", () => {
    const pricing = buildPricing(input());
    const paid = pricing.tiers.paid;

    expect(paid.price.atomic).toBe("1000");
    expect(paid.price.assetDecimals).toBe(6);
    expect(paid.price.display).toBe("0.001");
    expect(paid.network).toBe("base-sepolia");
    expect(paid.asset).toBe(REQUIREMENTS.asset);
    expect(paid.payTo).toBe(REQUIREMENTS.payTo);
    expect(paid.maxTimeoutSeconds).toBe(60);

    expect(pricing.currency).toEqual({
      asset: REQUIREMENTS.asset,
      network: "base-sepolia",
      decimals: 6,
    });
  });

  it("formats atomic prices without floating-point rounding", () => {
    const whole = buildPricing(
      input({
        requirements: { ...REQUIREMENTS, maxAmountRequired: "2500000" },
      }),
    );
    expect(whole.tiers.paid.price.display).toBe("2.5");

    const tiny = buildPricing(
      input({
        requirements: { ...REQUIREMENTS, maxAmountRequired: "1" },
      }),
    );
    expect(tiny.tiers.paid.price.display).toBe("0.000001");
  });
});

describe("G1 buildPricing — rate limit + endpoints", () => {
  it("exposes the per-key hard rate limit", () => {
    const pricing = buildPricing(input({ keyRateLimit: 60, keyRateWindowMs: 60_000 }));
    expect(pricing.rateLimit).toEqual({ limit: 60, windowMs: 60_000 });
  });

  it("copies the premium endpoint list (defensively, not by reference)", () => {
    const endpoints = [
      { method: "GET", path: "/api/x402", description: "Metered protocol data" },
    ];
    const pricing = buildPricing(input({ premiumEndpoints: endpoints }));
    expect(pricing.premiumEndpoints).toEqual(endpoints);
    expect(pricing.premiumEndpoints).not.toBe(endpoints);
  });
});
