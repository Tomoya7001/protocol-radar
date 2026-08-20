import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { KEY_PREFIX } from "@/lib/payments";
import {
  authenticateApiKey,
  findOrCreateAccount,
  issueApiKey,
  listApiKeys,
  normalizeEmail,
  revokeApiKey,
} from "./accounts";
import { PLANS, allowsChannel, isEntitling, limitsFor, resolvePlan } from "./plans";
import type { SqlExecutor } from "./sql";
import type { Subscription } from "./types";

/**
 * Offline tests for the customer store. A recording fake stands in for Postgres, so these
 * assert the CONTRACT the repository relies on — parameter binding, hashing, revocation
 * filters, column lists — without needing a database in CI.
 */

interface Call {
  sql: string;
  params: readonly unknown[];
}

/** Records every statement and replays a queued result per call. */
class FakeExecutor implements SqlExecutor {
  readonly calls: Call[] = [];
  private readonly queue: Record<string, unknown>[][];

  constructor(queue: Record<string, unknown>[][] = []) {
    this.queue = [...queue];
  }

  async query<Row extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    this.calls.push({ sql, params });
    return (this.queue.shift() ?? []) as Row[];
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const NOW = Date.parse("2026-08-20T00:00:00.000Z");

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc-1",
    email: "Tom@Example.com",
    email_normalized: "tom@example.com",
    stripe_customer_id: null,
    created_at: new Date(NOW),
    deleted_at: null,
    ...overrides,
  };
}

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    account_id: "acc-1",
    label: null,
    created_at: new Date(NOW),
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Tom@Example.COM ")).toBe("tom@example.com");
  });

  it("does NOT apply provider-specific rules that could merge two people", () => {
    expect(normalizeEmail("t.o.m+radar@gmail.com")).toBe("t.o.m+radar@gmail.com");
  });
});

describe("findOrCreateAccount", () => {
  it("inserts with ON CONFLICT DO NOTHING and binds the normalized address", async () => {
    const exec = new FakeExecutor([[accountRow()]]);
    const account = await findOrCreateAccount(exec, {
      email: "  Tom@Example.com ",
      now: NOW,
      generateId: () => "acc-1",
    });

    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]?.sql).toMatch(/ON CONFLICT \(email_normalized\) DO NOTHING/);
    expect(exec.calls[0]?.params).toEqual([
      "acc-1",
      "Tom@Example.com",
      "tom@example.com",
      new Date(NOW).toISOString(),
    ]);
    expect(account.id).toBe("acc-1");
    expect(account.createdAt).toBe(NOW);
  });

  it("returns the existing account when the insert hits the unique constraint", async () => {
    // First call (INSERT) returns no row => conflict; second call (SELECT) finds the owner.
    const exec = new FakeExecutor([[], [accountRow({ id: "acc-existing" })]]);
    const account = await findOrCreateAccount(exec, {
      email: "tom@example.com",
      now: NOW,
      generateId: () => "acc-new",
    });

    expect(account.id).toBe("acc-existing");
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[1]?.sql).toMatch(/SELECT .* FROM accounts WHERE email_normalized/);
  });
});

describe("issueApiKey", () => {
  it("stores only the sha256 hash and returns the plaintext once", async () => {
    const exec = new FakeExecutor([[keyRow()]]);
    const issued = await issueApiKey(exec, {
      accountId: "acc-1",
      now: NOW,
      label: "ci",
      generateId: () => "key-1",
      generateSecret: () => "prk_deadbeef",
    });

    const params = exec.calls[0]?.params ?? [];
    expect(params).toContain(sha256("prk_deadbeef"));
    expect(params).not.toContain("prk_deadbeef");
    expect(issued.key).toBe("prk_deadbeef");
    expect(issued.accountId).toBe("acc-1");
  });

  it("generates prefixed secrets by default so a leaked key is greppable", async () => {
    const exec = new FakeExecutor([[keyRow()]]);
    const issued = await issueApiKey(exec, { accountId: "acc-1", now: NOW });
    expect(issued.key.startsWith(KEY_PREFIX)).toBe(true);
    expect(issued.key.length).toBeGreaterThan(KEY_PREFIX.length + 32);
  });
});

describe("authenticateApiKey", () => {
  it("authenticates and stamps last_used_at in one statement, ignoring revoked keys", async () => {
    const exec = new FakeExecutor([[keyRow({ last_used_at: new Date(NOW) })]]);
    const record = await authenticateApiKey(exec, "prk_deadbeef", NOW);

    expect(exec.calls).toHaveLength(1);
    const { sql, params } = exec.calls[0] ?? { sql: "", params: [] };
    expect(sql).toMatch(/UPDATE api_keys/);
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(params[0]).toBe(sha256("prk_deadbeef"));
    expect(record?.lastUsedAt).toBe(NOW);
  });

  it("returns null for an unknown or revoked key", async () => {
    const exec = new FakeExecutor([[]]);
    expect(await authenticateApiKey(exec, "prk_nope", NOW)).toBeNull();
  });

  it("never binds the plaintext key", async () => {
    const exec = new FakeExecutor([[]]);
    await authenticateApiKey(exec, "prk_secret", NOW);
    expect(exec.calls[0]?.params).not.toContain("prk_secret");
  });
});

describe("revokeApiKey", () => {
  it("only writes when the key is not already revoked, preserving the first timestamp", async () => {
    const exec = new FakeExecutor([[]]);
    await revokeApiKey(exec, "key-1", NOW);
    expect(exec.calls[0]?.sql).toMatch(/revoked_at IS NULL/);
    expect(exec.calls[0]?.params).toEqual(["key-1", new Date(NOW).toISOString()]);
  });
});

describe("listApiKeys", () => {
  it("never selects the secret hash", async () => {
    const exec = new FakeExecutor([[keyRow()]]);
    await listApiKeys(exec, "acc-1");
    expect(exec.calls[0]?.sql).not.toMatch(/secret_hash/);
  });
});

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    accountId: "acc-1",
    stripeSubscriptionId: "sub_stripe",
    plan: "pro",
    status: "active",
    currentPeriodEnd: NOW + 30 * 86_400_000,
    cancelAtPeriodEnd: false,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("plan resolution", () => {
  it("falls closed to free when there is no subscription", () => {
    expect(resolvePlan(null)).toBe("free");
    expect(limitsFor(null).id).toBe("free");
  });

  it("keeps entitling a customer whose payment is retrying (past_due)", () => {
    expect(isEntitling(subscription({ status: "past_due" }))).toBe(true);
    expect(resolvePlan(subscription({ status: "past_due" }))).toBe("pro");
  });

  it("drops to free once Stripe has given up", () => {
    expect(resolvePlan(subscription({ status: "canceled" }))).toBe("free");
    expect(resolvePlan(subscription({ status: "unpaid" }))).toBe("free");
  });

  it("gates channels per plan", () => {
    expect(allowsChannel("free", "email")).toBe(true);
    expect(allowsChannel("free", "webhook")).toBe(false);
    expect(allowsChannel("pro", "webhook")).toBe(true);
    expect(allowsChannel("pro", "slack")).toBe(false);
    expect(allowsChannel("team", "slack")).toBe(true);
  });

  it("defines no prices in code — money lives in Stripe only", () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan).not.toHaveProperty("price");
      expect(plan).not.toHaveProperty("amount");
    }
    expect(PLANS.free.stripePriceIdEnv).toBeNull();
    expect(PLANS.pro.stripePriceIdEnv).toBe("STRIPE_PRICE_ID_PRO");
    expect(PLANS.team.stripePriceIdEnv).toBe("STRIPE_PRICE_ID_TEAM");
  });

  it("escalates quotas and features monotonically across plans", () => {
    expect(PLANS.free.apiCallsPerMonth).toBeLessThan(PLANS.pro.apiCallsPerMonth);
    expect(PLANS.pro.apiCallsPerMonth).toBeLessThan(PLANS.team.apiCallsPerMonth);
    expect(PLANS.free.instantAlerts).toBe(false);
    expect(PLANS.pro.instantAlerts).toBe(true);
    expect(PLANS.team.alertSubscriptions).toBeNull();
  });
});
