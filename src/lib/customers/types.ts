/** Shared row/domain types for the customer store. */

/** Internal plan identifier. Stripe prices map onto these; the ledger never sees them. */
export type PlanId = "free" | "pro" | "team";

/** How a metered request was resolved, recorded on every usage event. */
export type UsageDecision = "free" | "paid" | "denied";

/** Delivery channel for change alerts. */
export type AlertChannel = "email" | "webhook" | "slack";

export interface Account {
  id: string;
  email: string;
  emailNormalized: string;
  stripeCustomerId: string | null;
  createdAt: number;
  deletedAt: number | null;
}

/** Public metadata about an API key. Never carries the plaintext secret. */
export interface ApiKeyRecord {
  id: string;
  accountId: string;
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** Issuance result. `key` is the ONLY time the plaintext exists outside the caller. */
export interface IssuedApiKey extends ApiKeyRecord {
  key: string;
}

export interface Subscription {
  id: string;
  accountId: string;
  stripeSubscriptionId: string;
  plan: PlanId;
  /** Stripe status verbatim: 'active' | 'trialing' | 'past_due' | 'canceled' | ... */
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: number;
}
