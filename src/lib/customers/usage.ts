import { toTimestamp, type SqlExecutor } from "./sql";
import type { UsageDecision } from "./types";

/**
 * Metering: one row per metered request, counted against the plan's monthly quota.
 *
 * Why rows rather than a counter column: a counter cannot answer "what did this customer
 * actually use, and when" — which is exactly what a billing dispute, an abuse investigation
 * and a usage dashboard all need. The (api_key_id, occurred_at DESC) index keeps the count
 * cheap, and rows can be rolled up or pruned later without changing this contract.
 */

/** Half-open interval [start, end) in epoch milliseconds. */
export interface UsageWindow {
  start: number;
  end: number;
}

/**
 * The UTC calendar month containing `now`.
 *
 * UTC, not the customer's local month: quotas must reset at one globally agreed instant, or
 * a customer travelling across a date line could consume two months of quota in one day.
 */
export function monthWindow(now: number): UsageWindow {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end };
}

export interface RecordUsageInput {
  apiKeyId: string;
  endpoint: string;
  decision: UsageDecision;
  now: number;
}

/** Append one usage event. Called on served AND denied requests, so denials stay auditable. */
export async function recordUsage(
  exec: SqlExecutor,
  input: RecordUsageInput,
): Promise<void> {
  await exec.query(
    `INSERT INTO usage_events (api_key_id, endpoint, decision, occurred_at)
     VALUES ($1, $2, $3, $4)`,
    [input.apiKeyId, input.endpoint, input.decision, toTimestamp(input.now)],
  );
}

/**
 * Count the requests that consumed quota in `window`.
 *
 * `decision = 'denied'` rows are excluded on purpose: a request rejected for being over
 * quota must not itself consume quota, or a customer who hits the ceiling would be pushed
 * further past it by their own retries.
 */
export async function countUsageInWindow(
  exec: SqlExecutor,
  apiKeyId: string,
  window: UsageWindow,
): Promise<number> {
  const rows = await exec.query<{ count: unknown }>(
    `SELECT COUNT(*) AS count
       FROM usage_events
      WHERE api_key_id = $1
        AND decision <> 'denied'
        AND occurred_at >= $2
        AND occurred_at < $3`,
    [apiKeyId, toTimestamp(window.start), toTimestamp(window.end)],
  );
  // Postgres COUNT(*) arrives as a bigint string through the HTTP driver.
  return Number(rows[0]?.count ?? 0);
}

/**
 * Count quota-consuming requests for EVERY key belonging to an account.
 *
 * Quota is enforced per ACCOUNT, never per key. Keys are free to issue, so a per-key ceiling
 * would be defeated by simply asking for another key — the customer could mint unlimited free
 * capacity. Scoping the count to the account makes extra keys a convenience (one per service,
 * revocable independently) instead of a quota bypass.
 */
export async function countAccountUsageInWindow(
  exec: SqlExecutor,
  accountId: string,
  window: UsageWindow,
): Promise<number> {
  const rows = await exec.query<{ count: unknown }>(
    `SELECT COUNT(*) AS count
       FROM usage_events u
       JOIN api_keys k ON k.id = u.api_key_id
      WHERE k.account_id = $1
        AND u.decision <> 'denied'
        AND u.occurred_at >= $2
        AND u.occurred_at < $3`,
    [accountId, toTimestamp(window.start), toTimestamp(window.end)],
  );
  return Number(rows[0]?.count ?? 0);
}

export interface QuotaCheck {
  allowed: boolean;
  used: number;
  limit: number;
  /** When the quota resets — the start of the next window, for a Retry-After header. */
  resetAt: number;
}

/**
 * Evaluate an account's monthly quota without recording anything.
 *
 * Takes an account id, not a key id: see {@link countAccountUsageInWindow} for why enforcing
 * per key would let a customer mint unlimited free capacity.
 */
export async function checkMonthlyQuota(
  exec: SqlExecutor,
  input: { accountId: string; limit: number; now: number },
): Promise<QuotaCheck> {
  const window = monthWindow(input.now);
  const used = await countAccountUsageInWindow(exec, input.accountId, window);
  return {
    allowed: used < input.limit,
    used,
    limit: input.limit,
    resetAt: window.end,
  };
}
