import { createHash, randomBytes, randomUUID } from "node:crypto";
import { KEY_PREFIX } from "@/lib/payments";
import { queryOne, toEpochMs, toTimestamp, type SqlExecutor } from "./sql";
import type { Account, ApiKeyRecord, IssuedApiKey } from "./types";

/**
 * Accounts and API keys, persisted in Postgres.
 *
 * This replaces the in-process `ApiKeyStore` (src/lib/payments/keys.ts) for production use.
 * That store is a Map: on Vercel every serverless invocation gets a fresh process, so an
 * issued key stopped existing before the customer could use it. Nothing could be sold
 * because nothing could be remembered — persisting keys is the precondition for charging.
 *
 * Determinism: id/secret generators and the clock are injected, so tests never depend on
 * randomness or wall-clock time.
 */

/** sha256, hex-encoded. Used for every stored secret. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Canonical form used for the UNIQUE constraint on accounts.
 *
 * Trim + lower-case only. Deliberately NOT doing provider-specific normalisation (stripping
 * Gmail dots, cutting `+tags`): those rules differ per provider and guessing wrong silently
 * merges two people's accounts.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface AccountRow extends Record<string, unknown> {
  id: string;
  email: string;
  email_normalized: string;
  stripe_customer_id: string | null;
  created_at: unknown;
  deleted_at: unknown;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    emailNormalized: row.email_normalized,
    stripeCustomerId: row.stripe_customer_id,
    createdAt: toEpochMs(row.created_at) ?? 0,
    deletedAt: toEpochMs(row.deleted_at),
  };
}

const ACCOUNT_COLUMNS =
  "id, email, email_normalized, stripe_customer_id, created_at, deleted_at";

export interface CreateAccountInput {
  email: string;
  now: number;
  generateId?: () => string;
}

/**
 * Find the account for this address, or create it.
 *
 * Idempotent by design: sign-up is a public endpoint, so a double-submitted form, a retried
 * request or a race between two tabs must not create two accounts or fail with a constraint
 * violation. `ON CONFLICT DO NOTHING` plus a follow-up SELECT keeps it to at most two round
 * trips and lets the database, not the application, arbitrate the race.
 */
export async function findOrCreateAccount(
  exec: SqlExecutor,
  input: CreateAccountInput,
): Promise<Account> {
  const emailNormalized = normalizeEmail(input.email);
  const generateId = input.generateId ?? (() => randomUUID());

  const inserted = await queryOne<AccountRow>(
    exec,
    `INSERT INTO accounts (id, email, email_normalized, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email_normalized) DO NOTHING
     RETURNING ${ACCOUNT_COLUMNS}`,
    [generateId(), input.email.trim(), emailNormalized, toTimestamp(input.now)],
  );
  if (inserted !== null) return toAccount(inserted);

  const existing = await queryOne<AccountRow>(
    exec,
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE email_normalized = $1`,
    [emailNormalized],
  );
  if (existing === null) {
    // Only reachable if the row was deleted between the INSERT and the SELECT.
    throw new Error("findOrCreateAccount: account vanished mid-transaction");
  }
  return toAccount(existing);
}

/** Look up an account by address. Returns null when unknown. */
export async function findAccountByEmail(
  exec: SqlExecutor,
  email: string,
): Promise<Account | null> {
  const row = await queryOne<AccountRow>(
    exec,
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE email_normalized = $1`,
    [normalizeEmail(email)],
  );
  return row === null ? null : toAccount(row);
}

/** Attach (or update) the Stripe customer id for an account. */
export async function setStripeCustomerId(
  exec: SqlExecutor,
  accountId: string,
  stripeCustomerId: string,
): Promise<void> {
  await exec.query(
    `UPDATE accounts SET stripe_customer_id = $2 WHERE id = $1`,
    [accountId, stripeCustomerId],
  );
}

interface ApiKeyRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  label: string | null;
  created_at: unknown;
  last_used_at: unknown;
  revoked_at: unknown;
}

function toApiKey(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    label: row.label,
    createdAt: toEpochMs(row.created_at) ?? 0,
    lastUsedAt: toEpochMs(row.last_used_at),
    revokedAt: toEpochMs(row.revoked_at),
  };
}

const KEY_COLUMNS = "id, account_id, label, created_at, last_used_at, revoked_at";

export interface IssueApiKeyInput {
  accountId: string;
  now: number;
  label?: string;
  generateId?: () => string;
  generateSecret?: () => string;
}

/**
 * Issue a new API key. The plaintext is returned exactly once and never stored — only its
 * sha256 lands in the row, so a database leak cannot be replayed against the API.
 */
export async function issueApiKey(
  exec: SqlExecutor,
  input: IssueApiKeyInput,
): Promise<IssuedApiKey> {
  const generateId = input.generateId ?? (() => randomUUID());
  const generateSecret =
    input.generateSecret ??
    (() => `${KEY_PREFIX}${randomBytes(24).toString("hex")}`);

  const key = generateSecret();
  const row = await queryOne<ApiKeyRow>(
    exec,
    `INSERT INTO api_keys (id, account_id, secret_hash, label, created_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${KEY_COLUMNS}`,
    [
      generateId(),
      input.accountId,
      sha256(key),
      input.label ?? null,
      toTimestamp(input.now),
    ],
  );
  if (row === null) throw new Error("issueApiKey: insert returned no row");
  return { ...toApiKey(row), key };
}

/**
 * Authenticate a presented key and stamp its last-used time in the SAME statement.
 *
 * One UPDATE ... RETURNING rather than SELECT-then-UPDATE: a single round trip, and a
 * revoked key can never be authenticated by a read that raced the revocation. Returns null
 * for an unknown or revoked key — the caller turns that into a 401.
 */
export async function authenticateApiKey(
  exec: SqlExecutor,
  presentedKey: string,
  now: number,
): Promise<ApiKeyRecord | null> {
  const row = await queryOne<ApiKeyRow>(
    exec,
    `UPDATE api_keys
        SET last_used_at = $2
      WHERE secret_hash = $1
        AND revoked_at IS NULL
      RETURNING ${KEY_COLUMNS}`,
    [sha256(presentedKey), toTimestamp(now)],
  );
  return row === null ? null : toApiKey(row);
}

/** Revoke a key. Idempotent: re-revoking keeps the original revocation time. */
export async function revokeApiKey(
  exec: SqlExecutor,
  keyId: string,
  now: number,
): Promise<void> {
  await exec.query(
    `UPDATE api_keys
        SET revoked_at = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [keyId, toTimestamp(now)],
  );
}

/** Every key ever issued to an account, newest first. Never exposes secrets. */
export async function listApiKeys(
  exec: SqlExecutor,
  accountId: string,
): Promise<ApiKeyRecord[]> {
  const rows = await exec.query<ApiKeyRow>(
    `SELECT ${KEY_COLUMNS} FROM api_keys
      WHERE account_id = $1
      ORDER BY created_at DESC`,
    [accountId],
  );
  return rows.map(toApiKey);
}
