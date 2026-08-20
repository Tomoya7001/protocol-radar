import { createHash } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import { __setCustomerDbForTests } from "@/lib/customers/db";
import type { SqlExecutor } from "@/lib/customers/sql";
import { GET, POST } from "./route";

/**
 * Route tests for the sign-up front door. A queued fake stands in for Postgres, so the whole
 * issuance path is covered with no database.
 */

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

const NOW = Date.parse("2026-08-20T04:00:00.000Z");

const ACCOUNT_ROW = {
  id: "acc-1",
  email: "tom@example.com",
  email_normalized: "tom@example.com",
  stripe_customer_id: null,
  created_at: new Date(NOW),
  deleted_at: null,
};

const KEY_ROW = {
  id: "key-1",
  account_id: "acc-1",
  label: null,
  created_at: new Date(NOW),
  last_used_at: null,
  revoked_at: null,
};

/** Queue for a successful POST: account insert, key insert, subscription lookup, usage count. */
function signupQueue(): Record<string, unknown>[][] {
  return [[ACCOUNT_ROW], [KEY_ROW], [], [{ count: "0" }]];
}

function postRequest(body: unknown): Request {
  return new Request(`https://radar.test/api/keys?now=${NOW}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  __setCustomerDbForTests(undefined);
});

describe("POST /api/keys", () => {
  it("creates the account, issues a key and reports the free-plan quota", async () => {
    __setCustomerDbForTests(new FakeExecutor(signupQueue()));

    const res = await POST(postRequest({ email: "tom@example.com" }));
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.key_id).toBe("key-1");
    expect(body.plan).toBe("free");
    expect(body.quota).toEqual({
      api_calls_per_month: 500,
      used: 0,
      resets_at: "2026-09-01T00:00:00.000Z",
    });
    expect(String(body.key)).toMatch(/^prk_/);
  });

  it("never returns or stores the key as anything but a one-time plaintext", async () => {
    const exec = new FakeExecutor(signupQueue());
    __setCustomerDbForTests(exec);

    const res = await POST(postRequest({ email: "tom@example.com" }));
    const body = (await res.json()) as { key: string };

    const insert = exec.calls.find((c) => /INSERT INTO api_keys/.test(c.sql));
    expect(insert?.params).toContain(
      createHash("sha256").update(body.key).digest("hex"),
    );
    expect(insert?.params).not.toContain(body.key);
    expect(JSON.stringify(body)).not.toContain("secret_hash");
  });

  it("rejects a malformed address before touching the database", async () => {
    const exec = new FakeExecutor(signupQueue());
    __setCustomerDbForTests(exec);

    const res = await POST(postRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_email");
    expect(exec.calls).toHaveLength(0);
  });

  it("rejects a body that is not JSON", async () => {
    __setCustomerDbForTests(new FakeExecutor(signupQueue()));
    const res = await POST(postRequest("{not json"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_json");
  });

  it("truncates an over-long label instead of failing the sign-up", async () => {
    const exec = new FakeExecutor(signupQueue());
    __setCustomerDbForTests(exec);

    await POST(postRequest({ email: "tom@example.com", label: "x".repeat(200) }));
    const insert = exec.calls.find((c) => /INSERT INTO api_keys/.test(c.sql));
    const label = (insert?.params ?? []).find(
      (p): p is string => typeof p === "string" && p.startsWith("xxx"),
    );
    expect(label?.length).toBe(64);
  });

  it("answers 503, not 500, when no customer database is configured", async () => {
    __setCustomerDbForTests(null);
    const res = await POST(postRequest({ email: "tom@example.com" }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(
      "accounts_unavailable",
    );
  });
});

describe("GET /api/keys", () => {
  function getRequest(headers: Record<string, string> = {}): Request {
    return new Request(`https://radar.test/api/keys?now=${NOW}`, { headers });
  }

  it("requires a key", async () => {
    __setCustomerDbForTests(new FakeExecutor([]));
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it("rejects an unknown or revoked key", async () => {
    __setCustomerDbForTests(new FakeExecutor([[]]));
    const res = await GET(getRequest({ authorization: "Bearer prk_nope" }));
    expect(res.status).toBe(401);
  });

  it("reports plan, remaining quota and key metadata without any secret", async () => {
    __setCustomerDbForTests(
      new FakeExecutor([
        [KEY_ROW], // authenticate
        [], // no live subscription
        [{ count: "120" }], // usage this month
        [KEY_ROW], // key list
      ]),
    );

    const res = await GET(getRequest({ "x-api-key": "prk_valid" }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, any>;
    expect(body.plan).toBe("free");
    expect(body.quota).toEqual({
      limit: 500,
      used: 120,
      remaining: 380,
      resets_at: "2026-09-01T00:00:00.000Z",
    });
    expect(body.subscription).toBeNull();
    expect(body.keys[0]).toEqual({
      id: "key-1",
      label: null,
      created_at: new Date(NOW).toISOString(),
      last_used_at: null,
      revoked: false,
    });
    expect(JSON.stringify(body)).not.toMatch(/prk_|secret/);
  });

  it("reports the paid plan and entitlements for a subscribed account", async () => {
    __setCustomerDbForTests(
      new FakeExecutor([
        [KEY_ROW],
        [
          {
            id: "sub-1",
            account_id: "acc-1",
            stripe_subscription_id: "sub_x",
            plan: "pro",
            status: "past_due",
            current_period_end: new Date(NOW + 86_400_000),
            cancel_at_period_end: false,
            updated_at: new Date(NOW),
          },
        ],
        [{ count: "10" }],
        [KEY_ROW],
      ]),
    );

    const body = (await (await GET(getRequest({ "x-api-key": "prk_valid" }))).json()) as
      Record<string, any>;

    // past_due still entitles: Stripe is retrying the card, the customer keeps service.
    expect(body.plan).toBe("pro");
    expect(body.entitlements.api_calls_per_month).toBe(25_000);
    expect(body.entitlements.instant_alerts).toBe(true);
    expect(body.subscription.status).toBe("past_due");
  });
});
