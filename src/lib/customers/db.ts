import { neon } from "@neondatabase/serverless";
import type { SqlExecutor } from "./sql";

/**
 * Connection wiring for the customer store.
 *
 * Deliberately returns `null` when `DATABASE_URL` is absent instead of throwing at import
 * time. The public read surface — dashboard, ledger API, verify page — must keep serving
 * even with no customer database configured; only the paid/account routes degrade. That also
 * keeps `next build` and every existing test green on a machine that has never seen Postgres.
 */

/** Wrap the Neon HTTP driver in the repository-facing {@link SqlExecutor} contract. */
export function createNeonExecutor(connectionString: string): SqlExecutor {
  const sql = neon(connectionString);
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      params: readonly unknown[] = [],
    ): Promise<Row[]> {
      const rows = await sql.query(text, [...params]);
      return rows as Row[];
    },
  };
}

/** `undefined` = not resolved yet; `null` = resolved and deliberately absent. */
let cached: SqlExecutor | null | undefined;

/**
 * The shared customer-store executor, or null when the deployment has no `DATABASE_URL`.
 * Callers MUST handle null (503 "billing not configured"), never assume a connection.
 */
export function getCustomerDb(
  env: NodeJS.ProcessEnv = process.env,
): SqlExecutor | null {
  if (cached === undefined) {
    const url = env.DATABASE_URL;
    cached = url === undefined || url.length === 0 ? null : createNeonExecutor(url);
  }
  return cached;
}

/** Test-only hook: inject a fake executor, or `undefined` to re-resolve from the env. */
export function __setCustomerDbForTests(
  exec: SqlExecutor | null | undefined,
): void {
  cached = exec;
}
