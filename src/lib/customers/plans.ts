import type { PlanId, Subscription } from "./types";

/**
 * Plan entitlements.
 *
 * PRICES ARE NOT DEFINED HERE ON PURPOSE. The amount a customer pays lives in Stripe and is
 * referenced by price id through the env var named below, so money has exactly one source of
 * truth. Changing a price is then a Stripe dashboard action plus an env var, never a deploy.
 * What lives here is only what the SERVER must enforce: quotas and feature gates.
 */
export interface PlanLimits {
  id: PlanId;
  /** Metered API calls allowed per calendar month. */
  apiCallsPerMonth: number;
  /** Maximum concurrent alert subscriptions. `null` means unlimited. */
  alertSubscriptions: number | null;
  /** Delivery channels this plan may use. */
  channels: readonly ("email" | "webhook" | "slack")[];
  /** True when change alerts fire per event; false means the weekly digest only. */
  instantAlerts: boolean;
  /** Access to GET /api/premium/report. */
  premiumReport: boolean;
  /**
   * Name of the env var holding this plan's Stripe price id. Absent for `free`, which is
   * never charged and therefore has no Stripe price.
   */
  stripePriceIdEnv: string | null;
}

export const PLANS: Readonly<Record<PlanId, PlanLimits>> = {
  free: {
    id: "free",
    apiCallsPerMonth: 500,
    alertSubscriptions: 1,
    channels: ["email"],
    instantAlerts: false,
    premiumReport: false,
    stripePriceIdEnv: null,
  },
  pro: {
    id: "pro",
    apiCallsPerMonth: 25_000,
    alertSubscriptions: 10,
    channels: ["email", "webhook"],
    instantAlerts: true,
    premiumReport: true,
    stripePriceIdEnv: "STRIPE_PRICE_ID_PRO",
  },
  team: {
    id: "team",
    apiCallsPerMonth: 250_000,
    alertSubscriptions: null,
    channels: ["email", "webhook", "slack"],
    instantAlerts: true,
    premiumReport: true,
    stripePriceIdEnv: "STRIPE_PRICE_ID_TEAM",
  },
};

/**
 * Stripe statuses that still entitle the customer to their paid plan.
 *
 * `past_due` is deliberately included: Stripe retries a failed payment for days, and cutting
 * a paying customer off at the first declined card is a bigger revenue loss (churn) than a
 * few days of unpaid service. `unpaid` and `canceled` are NOT here — by then Stripe has given
 * up and the entitlement genuinely ends.
 */
const ENTITLING_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

/** True when this subscription row currently entitles its account to its paid plan. */
export function isEntitling(subscription: Subscription): boolean {
  return ENTITLING_STATUSES.has(subscription.status);
}

/**
 * Resolve the plan an account is entitled to.
 *
 * Fails CLOSED to `free`: an absent, expired or non-entitling subscription yields the free
 * plan rather than throwing, so a Stripe outage degrades service instead of denying it.
 */
export function resolvePlan(subscription: Subscription | null): PlanId {
  if (subscription === null) return "free";
  return isEntitling(subscription) ? subscription.plan : "free";
}

/** Entitlements for an account, given its current subscription row (or none). */
export function limitsFor(subscription: Subscription | null): PlanLimits {
  return PLANS[resolvePlan(subscription)];
}

/** True when `plan` may deliver alerts over `channel`. */
export function allowsChannel(
  plan: PlanId,
  channel: "email" | "webhook" | "slack",
): boolean {
  return PLANS[plan].channels.includes(channel);
}
