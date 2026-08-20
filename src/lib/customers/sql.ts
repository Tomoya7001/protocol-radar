/**
 * Minimal async SQL surface for the customer store (Postgres).
 *
 * Every repository function in `src/lib/customers/**` takes one of these instead of a
 * concrete client, mirroring the injected-dependency pattern used across this codebase
 * (`PaymentVerifier`, `WebhookFetch`, injected clocks). Consequences:
 *  - Unit tests run fully offline against a recording fake; no database is required in CI.
 *  - The driver stays swappable (`@neondatabase/serverless` on Vercel, `pg` on a writable
 *    host) without touching a single repository function.
 */
export interface SqlExecutor {
  /**
   * Run a parameterised statement and return the result rows.
   *
   * Implementations MUST pass `params` to the driver as bind parameters ($1, $2, ...) and
   * never interpolate them into `sql` — every caller below relies on that for injection
   * safety.
   */
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

/** Run a statement expected to match at most one row. Returns null when nothing matched. */
export async function queryOne<Row extends Record<string, unknown>>(
  exec: SqlExecutor,
  sql: string,
  params: readonly unknown[] = [],
): Promise<Row | null> {
  const rows = await exec.query<Row>(sql, params);
  return rows.length > 0 ? (rows[0] as Row) : null;
}

/** Convert a Postgres TIMESTAMPTZ column (Date or ISO string) to epoch milliseconds. */
export function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "number") return value;
  return null;
}

/** Convert epoch milliseconds to the ISO string the driver binds as TIMESTAMPTZ. */
export function toTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
