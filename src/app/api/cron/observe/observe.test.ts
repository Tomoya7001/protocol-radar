import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db/connection";
import { runMigrations } from "@/lib/db/migrate";
import { listEvents } from "@/lib/db/repo";
import { verifyFromRaw } from "@/lib/ledger/ledger";
import { FakeHttpClient, response } from "@/lib/fetch/fakeClient";
import type { GithubReleaseRepo } from "@/config/sources/releases";
import { GET } from "./route";
import { __setObserveDepsForTests } from "./deps";

/**
 * 残② GET /api/cron/observe acceptance tests. Fully offline: a fake HTTP client is injected
 * via __setObserveDepsForTests and the DB is in-memory. Verifies auth guarding, the
 * observe -> ledger append path, ledger raw-verifiability, idempotency, and the read-only
 * deployment guard.
 */

const CRON_SECRET = "test-cron-secret";
const NOW = new Date("2026-07-14T00:00:00.000Z");

const REPO: GithubReleaseRepo = {
  protocolKey: "mcp",
  protocolName: "Model Context Protocol",
  repo: "modelcontextprotocol/modelcontextprotocol",
  label: "MCP spec repo releases",
  cadenceSeconds: 3600,
};

function db(): Db {
  const d = openDatabase(":memory:");
  runMigrations(d);
  return d;
}

/** A minimal GitHub Releases API payload (only the fields the poller consumes). */
function releasesJson(tags: string[]): string {
  return JSON.stringify(tags.map((t) => ({ tag_name: t, name: t })));
}

/** A cron request carrying the Vercel-style bearer auth header. */
function authedRequest(): Request {
  return new Request("https://example.com/api/cron/observe", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
});

afterEach(() => {
  __setObserveDepsForTests(null);
  delete process.env.CRON_SECRET;
  delete process.env.PROTOCOL_RADAR_DB_READONLY;
});

describe("GET /api/cron/observe", () => {
  it("rejects a request with no auth header as 401", async () => {
    const res = await GET(new Request("https://example.com/api/cron/observe"));
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong bearer token as 401", async () => {
    const res = await GET(
      new Request("https://example.com/api/cron/observe", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(authedRequest());
    expect(res.status).toBe(401);
  });

  it("observes releases, appends to the ledger, and stays raw-verifiable", async () => {
    const d = db();
    __setObserveDepsForTests({
      db: d,
      client: new FakeHttpClient([response(200, releasesJson(["v1.2.0", "v1.1.0"]))]),
      now: NOW,
      repos: [REPO],
    });

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reposPolled).toBe(1);
    expect(body.eventsCreated).toBe(1);
    expect(body.verified).toEqual({ ok: true });

    const events = listEvents(d);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("appeared");
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("is idempotent: a second unchanged pass adds no new event", async () => {
    const d = db();
    const payload = releasesJson(["v1.2.0", "v1.1.0"]);

    __setObserveDepsForTests({
      db: d,
      client: new FakeHttpClient([response(200, payload)]),
      now: NOW,
      repos: [REPO],
    });
    const first = await GET(authedRequest());
    expect((await first.json()).eventsCreated).toBe(1);

    __setObserveDepsForTests({
      db: d,
      client: new FakeHttpClient([response(200, payload)]),
      now: new Date("2026-07-14T06:00:00.000Z"),
      repos: [REPO],
    });
    const second = await GET(authedRequest());
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body.eventsCreated).toBe(0);
    expect(listEvents(d)).toHaveLength(1);
    expect(verifyFromRaw(d)).toEqual({ ok: true });
  });

  it("skips observation in read-only deployment mode without writing", async () => {
    process.env.PROTOCOL_RADAR_DB_READONLY = "1";
    // No deps injected: the handler must not reach the DB or client in read-only mode.
    const res = await GET(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.skipped).toBe("readonly-deployment");
  });
});
