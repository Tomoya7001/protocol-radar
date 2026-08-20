import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import {
  authenticateApiKey,
  findOrCreateAccount,
  issueApiKey,
  listApiKeys,
} from "@/lib/customers/accounts";
import { getCustomerDb } from "@/lib/customers/db";
import { limitsFor, resolvePlan } from "@/lib/customers/plans";
import { findLiveSubscription } from "@/lib/customers/subscriptions";
import { checkMonthlyQuota } from "@/lib/customers/usage";

/** Reads and writes the customer store at request time; never prerendered. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * API-key issuance and self-service inspection.
 *
 *   POST /api/keys  { email, label? }   -> 201 with the plaintext key, shown ONCE
 *   GET  /api/keys  (Bearer <key>)      -> 200 with the caller's plan, quota and key list
 *
 * Until this route existed the metered surface was unreachable: keys could only be minted
 * inside a test, so every request to /api/x402 answered 401 and no customer could reach even
 * the free tier. This is the front door.
 *
 * Deliberately no email verification before issuance. Requiring a round trip through an inbox
 * to try an API is the friction that loses developer sign-ups, and the blast radius is small:
 * quota is enforced per ACCOUNT (see countAccountUsageInWindow), so minting extra keys grants
 * no extra capacity. Verification gates outbound EMAIL ALERTS instead, where the risk is
 * actually sending mail to an address its owner never confirmed.
 */

/**
 * Pragmatic address check: one @, no whitespace, a dot in the domain. Not RFC 5322 — a
 * stricter regex rejects valid addresses, and the only authority on deliverability is a real
 * send, which happens later during alert verification.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Longest accepted key label; long enough to name a service, short enough to bound a row. */
const MAX_LABEL_LENGTH = 64;

/** The 503 body used whenever the deployment has no customer database configured. */
function accountsUnavailable(): Response {
  return jsonResponse(
    {
      error: "accounts_unavailable",
      detail:
        "This deployment has no customer database configured (DATABASE_URL is unset), so API keys cannot be issued.",
    },
    503,
  );
}

/** Extract the presented API key from `Authorization: Bearer ...` or `x-api-key`. */
function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth !== null) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m && m[1]) return m[1].trim();
  }
  const header = req.headers.get("x-api-key");
  return header !== null && header.length > 0 ? header : null;
}

interface KeyRequestBody {
  email?: unknown;
  label?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const db = getCustomerDb();
  if (db === null) return accountsUnavailable();

  let body: KeyRequestBody;
  try {
    body = (await req.json()) as KeyRequestBody;
  } catch {
    return jsonResponse(
      { error: "invalid_json", detail: "The request body must be a JSON object." },
      400,
    );
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_PATTERN.test(email)) {
    return jsonResponse(
      { error: "invalid_email", detail: "Provide a valid email address as `email`." },
      400,
    );
  }

  const label =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim().slice(0, MAX_LABEL_LENGTH)
      : undefined;

  const now = parseNow(new URL(req.url));

  const account = await findOrCreateAccount(db, { email, now });
  const issued = await issueApiKey(db, {
    accountId: account.id,
    now,
    ...(label === undefined ? {} : { label }),
  });
  const subscription = await findLiveSubscription(db, account.id);
  const limits = limitsFor(subscription);
  const quota = await checkMonthlyQuota(db, {
    accountId: account.id,
    limit: limits.apiCallsPerMonth,
    now,
  });

  return jsonResponse(
    {
      // The ONLY time this value is ever returned. It is stored as a sha256 hash.
      key: issued.key,
      key_id: issued.id,
      label: issued.label,
      account: { id: account.id, email: account.email },
      plan: resolvePlan(subscription),
      quota: {
        api_calls_per_month: quota.limit,
        used: quota.used,
        resets_at: new Date(quota.resetAt).toISOString(),
      },
      notice:
        "Store this key now. It is shown exactly once and cannot be recovered — issue a new one if it is lost.",
    },
    201,
  );
}

export async function GET(req: Request): Promise<Response> {
  const db = getCustomerDb();
  if (db === null) return accountsUnavailable();

  const presented = extractApiKey(req);
  if (presented === null) {
    return jsonResponse(
      {
        error: "unauthorized",
        detail: "Present an API key as `Authorization: Bearer <key>` or `x-api-key`.",
      },
      401,
    );
  }

  const now = parseNow(new URL(req.url));
  const authenticated = await authenticateApiKey(db, presented, now);
  if (authenticated === null) {
    return jsonResponse(
      { error: "unauthorized", detail: "Unknown or revoked API key." },
      401,
    );
  }

  const subscription = await findLiveSubscription(db, authenticated.accountId);
  const limits = limitsFor(subscription);
  const quota = await checkMonthlyQuota(db, {
    accountId: authenticated.accountId,
    limit: limits.apiCallsPerMonth,
    now,
  });
  const keys = await listApiKeys(db, authenticated.accountId);

  return jsonResponse({
    account_id: authenticated.accountId,
    plan: resolvePlan(subscription),
    entitlements: {
      api_calls_per_month: limits.apiCallsPerMonth,
      alert_subscriptions: limits.alertSubscriptions,
      channels: limits.channels,
      instant_alerts: limits.instantAlerts,
      premium_report: limits.premiumReport,
    },
    quota: {
      limit: quota.limit,
      used: quota.used,
      remaining: Math.max(0, quota.limit - quota.used),
      resets_at: new Date(quota.resetAt).toISOString(),
    },
    subscription:
      subscription === null
        ? null
        : {
            status: subscription.status,
            cancel_at_period_end: subscription.cancelAtPeriodEnd,
            current_period_end:
              subscription.currentPeriodEnd === null
                ? null
                : new Date(subscription.currentPeriodEnd).toISOString(),
          },
    // Metadata only — no secret, and no hash, ever leaves the database.
    keys: keys.map((k) => ({
      id: k.id,
      label: k.label,
      created_at: new Date(k.createdAt).toISOString(),
      last_used_at: k.lastUsedAt === null ? null : new Date(k.lastUsedAt).toISOString(),
      revoked: k.revokedAt !== null,
    })),
  });
}
