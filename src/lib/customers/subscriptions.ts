import { randomUUID } from "node:crypto";
import { PLANS } from "./plans";
import { queryOne, toEpochMs, toTimestamp, type SqlExecutor } from "./sql";
import type { PlanId, Subscription } from "./types";

/**
 * Subscription state, mirrored from Stripe.
 *
 * Stripe is the source of truth for money; this table is a local READ MODEL so an entitlement
 * check is one indexed query instead of a network call to Stripe on every request. It is
 * written only by the webhook handler, and every field it stores is something Stripe sent.
 */

/** Statuses that entitle. Mirrors the partial unique index in schema/0001_init.sql. */
const LIVE_STATUSES = ["active", "trialing", "past_due"] as const;

interface SubscriptionRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  stripe_subscription_id: string;
  plan: string;
  status: string;
  current_period_end: unknown;
  cancel_at_period_end: boolean;
  updated_at: unknown;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    accountId: row.account_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    plan: row.plan as PlanId,
    status: row.status,
    currentPeriodEnd: toEpochMs(row.current_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    updatedAt: toEpochMs(row.updated_at) ?? 0,
  };
}

const SUBSCRIPTION_COLUMNS =
  "id, account_id, stripe_subscription_id, plan, status, current_period_end, cancel_at_period_end, updated_at";

/**
 * Map a Stripe price id onto an internal plan.
 *
 * Returns null for an unrecognised price — an unknown price must NOT silently grant a plan.
 * The webhook handler turns null into a logged no-op so a mis-configured price id shows up as
 * "customer paid but got nothing", which is loud, rather than "customer got the top tier free".
 */
export function planFromPriceId(
  priceId: string,
  env: NodeJS.ProcessEnv = process.env,
): PlanId | null {
  for (const plan of Object.values(PLANS)) {
    if (plan.stripePriceIdEnv === null) continue;
    const configured = env[plan.stripePriceIdEnv];
    if (configured !== undefined && configured.length > 0 && configured === priceId) {
      return plan.id;
    }
  }
  return null;
}

export interface UpsertSubscriptionInput {
  accountId: string;
  stripeSubscriptionId: string;
  plan: PlanId;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  now: number;
  generateId?: () => string;
}

/**
 * Insert or refresh the local mirror of a Stripe subscription.
 *
 * Keyed on `stripe_subscription_id`, so Stripe's at-least-once webhook delivery is safe:
 * replaying the same event converges on the same row instead of creating duplicates.
 *
 * May reject with a unique-violation from `subscriptions_one_live_per_account_idx` when an
 * account would end up with two entitling subscriptions. That is intentional — it means the
 * customer is about to be charged twice, and the caller must surface it rather than write it.
 */
export async function upsertSubscription(
  exec: SqlExecutor,
  input: UpsertSubscriptionInput,
): Promise<Subscription> {
  const generateId = input.generateId ?? (() => randomUUID());
  const row = await queryOne<SubscriptionRow>(
    exec,
    `INSERT INTO subscriptions (
       id, account_id, stripe_subscription_id, plan, status,
       current_period_end, cancel_at_period_end, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       plan                 = EXCLUDED.plan,
       status               = EXCLUDED.status,
       current_period_end   = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at           = EXCLUDED.updated_at
     RETURNING ${SUBSCRIPTION_COLUMNS}`,
    [
      generateId(),
      input.accountId,
      input.stripeSubscriptionId,
      input.plan,
      input.status,
      input.currentPeriodEnd === null ? null : toTimestamp(input.currentPeriodEnd),
      input.cancelAtPeriodEnd,
      toTimestamp(input.now),
    ],
  );
  if (row === null) throw new Error("upsertSubscription: upsert returned no row");
  return toSubscription(row);
}

/** The account's entitling subscription, or null when it is on the free plan. */
export async function findLiveSubscription(
  exec: SqlExecutor,
  accountId: string,
): Promise<Subscription | null> {
  const row = await queryOne<SubscriptionRow>(
    exec,
    `SELECT ${SUBSCRIPTION_COLUMNS}
       FROM subscriptions
      WHERE account_id = $1
        AND status = ANY($2)
      ORDER BY updated_at DESC
      LIMIT 1`,
    [accountId, [...LIVE_STATUSES]],
  );
  return row === null ? null : toSubscription(row);
}

/** Resolve the account a Stripe customer belongs to. Null when the id is unknown to us. */
export async function findAccountIdByStripeCustomerId(
  exec: SqlExecutor,
  stripeCustomerId: string,
): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    exec,
    `SELECT id FROM accounts WHERE stripe_customer_id = $1`,
    [stripeCustomerId],
  );
  return row === null ? null : row.id;
}
