import { describe, it, expect } from "vitest";
import {
  checkMonthlyQuota,
  countAccountUsageInWindow,
  countUsageInWindow,
  monthWindow,
  recordUsage,
} from "./usage";
import {
  findLiveSubscription,
  planFromPriceId,
  upsertSubscription,
} from "./subscriptions";
import type { SqlExecutor } from "./sql";

/** Records every statement and replays a queued result per call. */
class FakeExecutor implements SqlExecutor {
  readonly calls: { sql: string; params: readonly unknown[] }[] = [];
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

const MID_MONTH = Date.parse("2026-08-20T04:00:00.000Z");

describe("monthWindow", () => {
  it("spans the UTC calendar month containing the instant", () => {
    const w = monthWindow(MID_MONTH);
    expect(new Date(w.start).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(new Date(w.end).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls the year over at December", () => {
    const w = monthWindow(Date.parse("2026-12-31T23:59:59.000Z"));
    expect(new Date(w.end).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("treats the first millisecond of a month as that month", () => {
    const w = monthWindow(Date.parse("2026-08-01T00:00:00.000Z"));
    expect(new Date(w.start).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("recordUsage", () => {
  it("appends one row with the decision and an ISO timestamp", async () => {
    const exec = new FakeExecutor();
    await recordUsage(exec, {
      apiKeyId: "key-1",
      endpoint: "/api/x402",
      decision: "free",
      now: MID_MONTH,
    });

    const call = exec.calls[0];
    expect(call?.sql).toMatch(/INSERT INTO usage_events/);
    expect(call?.params).toEqual([
      "key-1",
      "/api/x402",
      "free",
      new Date(MID_MONTH).toISOString(),
    ]);
  });
});

describe("countUsageInWindow", () => {
  it("excludes denied requests so retries cannot burn quota", async () => {
    const exec = new FakeExecutor([[{ count: "7" }]]);
    const used = await countUsageInWindow(exec, "key-1", monthWindow(MID_MONTH));

    expect(exec.calls[0]?.sql).toMatch(/decision <> 'denied'/);
    expect(used).toBe(7);
  });

  it("coerces the bigint COUNT the HTTP driver returns as a string", async () => {
    const exec = new FakeExecutor([[{ count: "12345" }]]);
    expect(await countUsageInWindow(exec, "key-1", monthWindow(MID_MONTH))).toBe(12345);
  });

  it("reads zero when the key has no rows at all", async () => {
    const exec = new FakeExecutor([[]]);
    expect(await countUsageInWindow(exec, "key-1", monthWindow(MID_MONTH))).toBe(0);
  });
});


describe("countAccountUsageInWindow", () => {
  it("counts across every key of the account, so extra keys are not a quota bypass", async () => {
    const exec = new FakeExecutor([[{ count: "42" }]]);
    const used = await countAccountUsageInWindow(exec, "acc-1", monthWindow(MID_MONTH));

    const sql = exec.calls[0]?.sql ?? "";
    expect(sql).toMatch(/JOIN api_keys k ON k\.id = u\.api_key_id/);
    expect(sql).toMatch(/k\.account_id = \$1/);
    expect(exec.calls[0]?.params?.[0]).toBe("acc-1");
    expect(used).toBe(42);
  });

  it("still excludes denied requests", async () => {
    const exec = new FakeExecutor([[{ count: "0" }]]);
    await countAccountUsageInWindow(exec, "acc-1", monthWindow(MID_MONTH));
    expect(exec.calls[0]?.sql).toMatch(/decision <> 'denied'/);
  });
});

describe("checkMonthlyQuota", () => {
  it("allows a request below the limit and reports the reset instant", async () => {
    const exec = new FakeExecutor([[{ count: "499" }]]);
    const check = await checkMonthlyQuota(exec, {
      accountId: "acc-1",
      limit: 500,
      now: MID_MONTH,
    });

    expect(check.allowed).toBe(true);
    expect(check.used).toBe(499);
    expect(new Date(check.resetAt).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("denies exactly at the limit, not one call past it", async () => {
    const exec = new FakeExecutor([[{ count: "500" }]]);
    const check = await checkMonthlyQuota(exec, {
      accountId: "acc-1",
      limit: 500,
      now: MID_MONTH,
    });
    expect(check.allowed).toBe(false);
  });
});

describe("planFromPriceId", () => {
  const env = {
    STRIPE_PRICE_ID_PRO: "price_pro_123",
    STRIPE_PRICE_ID_TEAM: "price_team_456",
  } as NodeJS.ProcessEnv;

  it("maps configured price ids onto plans", () => {
    expect(planFromPriceId("price_pro_123", env)).toBe("pro");
    expect(planFromPriceId("price_team_456", env)).toBe("team");
  });

  it("returns null for an unknown price rather than granting a plan", () => {
    expect(planFromPriceId("price_someone_elses", env)).toBeNull();
  });

  it("returns null when the price env vars are not configured at all", () => {
    expect(planFromPriceId("price_pro_123", {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("never matches an empty configured value against an empty price id", () => {
    const blank = { STRIPE_PRICE_ID_PRO: "" } as NodeJS.ProcessEnv;
    expect(planFromPriceId("", blank)).toBeNull();
  });
});

describe("upsertSubscription", () => {
  const row = {
    id: "sub-row-1",
    account_id: "acc-1",
    stripe_subscription_id: "sub_stripe_1",
    plan: "pro",
    status: "active",
    current_period_end: new Date(MID_MONTH + 2_592_000_000),
    cancel_at_period_end: false,
    updated_at: new Date(MID_MONTH),
  };

  it("is keyed on the Stripe id so replayed webhooks converge instead of duplicating", async () => {
    const exec = new FakeExecutor([[row]]);
    const sub = await upsertSubscription(exec, {
      accountId: "acc-1",
      stripeSubscriptionId: "sub_stripe_1",
      plan: "pro",
      status: "active",
      currentPeriodEnd: MID_MONTH + 2_592_000_000,
      cancelAtPeriodEnd: false,
      now: MID_MONTH,
      generateId: () => "sub-row-1",
    });

    expect(exec.calls[0]?.sql).toMatch(
      /ON CONFLICT \(stripe_subscription_id\) DO UPDATE/,
    );
    expect(sub.plan).toBe("pro");
    expect(sub.cancelAtPeriodEnd).toBe(false);
  });

  it("stores a null period end without crashing the timestamp conversion", async () => {
    const exec = new FakeExecutor([[{ ...row, current_period_end: null }]]);
    const sub = await upsertSubscription(exec, {
      accountId: "acc-1",
      stripeSubscriptionId: "sub_stripe_1",
      plan: "pro",
      status: "incomplete",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      now: MID_MONTH,
    });
    expect(sub.currentPeriodEnd).toBeNull();
    expect(exec.calls[0]?.params).toContain(null);
  });
});

describe("findLiveSubscription", () => {
  it("only considers statuses that entitle", async () => {
    const exec = new FakeExecutor([[]]);
    await findLiveSubscription(exec, "acc-1");

    const params = exec.calls[0]?.params ?? [];
    expect(params[1]).toEqual(["active", "trialing", "past_due"]);
    expect(await findLiveSubscription(new FakeExecutor([[]]), "acc-1")).toBeNull();
  });
});
