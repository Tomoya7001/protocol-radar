/**
 * Gate for every surface that offers something for sale.
 *
 * Vercel's fair-use guidelines restrict the free Hobby plan to non-commercial personal use,
 * and define commercial usage to include "advertising the sale of a product or service" and
 * "any method of requesting or processing payment from visitors" — not merely receiving
 * money. A published pricing page or an HTTP 402 carrying payment requirements therefore
 * makes a deployment commercial before it has a single customer, and the penalty is an
 * account-wide pause that takes every project down at once.
 *
 * So the paid surfaces ship, fully tested, but stay dark until the deployment is on a plan
 * that permits commerce. Flipping one environment variable turns them all on together.
 */

/** Env var that opens the paid surfaces. Set to "1" once the deployment is on a paid plan. */
export const BILLING_PUBLIC_ENV = "PROTOCOL_RADAR_BILLING_PUBLIC";

/**
 * True when commercial surfaces may be served.
 *
 * Fails CLOSED: anything other than exactly "1" keeps them hidden, so a typo or an unset
 * variable can never accidentally expose a storefront on a non-commercial plan.
 */
export function isBillingSurfacePublic(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[BILLING_PUBLIC_ENV] === "1";
}
