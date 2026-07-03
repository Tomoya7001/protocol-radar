import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb, tamperRawBody } from "@/app/_data/fixtures";
import { GET as getProtocols } from "./protocols/route";
import { GET as getProtocol } from "./protocols/[key]/route";
import { GET as getEvents } from "./events/route";
import { GET as getVerify } from "./verify/route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

afterEach(() => {
  __setDbForTests(null);
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

describe("F-032 GET /api/protocols", () => {
  it("returns 200 with JSON content-type and every protocol", async () => {
    seedAndInject();
    const res = getProtocols(req(`/api/protocols?now=${NOW}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as {
      count: number;
      protocols: Array<{
        key: string;
        freshness: string;
        stale_warning: boolean;
      }>;
    };
    expect(body.count).toBe(5);
    const a2a = body.protocols.find((p) => p.key === "a2a");
    expect(a2a?.freshness).toBe("stale");
    expect(a2a?.stale_warning).toBe(true);
  });
});

describe("F-032 GET /api/protocols/:key", () => {
  it("returns 200 with the timeline for a known protocol", async () => {
    seedAndInject();
    const res = await getProtocol(req(`/api/protocols/mcp?now=${NOW}`), {
      params: Promise.resolve({ key: "mcp" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocol: { key: string };
      events: Array<{ type: string; hash: string }>;
    };
    expect(body.protocol.key).toBe("mcp");
    expect(body.events).toHaveLength(3);
    expect(body.events[0]?.type).toBe("spec_change");
    expect(body.events[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 404 for an unknown protocol", async () => {
    seedAndInject();
    const res = await getProtocol(req("/api/protocols/nope"), {
      params: Promise.resolve({ key: "nope" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("protocol_not_found");
  });
});

describe("F-032 GET /api/events", () => {
  it("returns all events newest-first by default", async () => {
    seedAndInject();
    const res = getEvents(req("/api/events"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThan(0);
  });

  it("filters by protocol key", async () => {
    seedAndInject();
    const res = getEvents(req("/api/events?protocol=mcp"));
    const body = (await res.json()) as {
      events: Array<{ protocol_key: string }>;
    };
    expect(body.events).toHaveLength(3);
    expect(body.events.every((e) => e.protocol_key === "mcp")).toBe(true);
  });

  it("returns 404 for an unknown protocol filter", async () => {
    seedAndInject();
    const res = getEvents(req("/api/events?protocol=nope"));
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid limit", async () => {
    seedAndInject();
    for (const bad of ["0", "-1", "abc", "9999"]) {
      const res = getEvents(req(`/api/events?limit=${bad}`));
      expect(res.status).toBe(400);
    }
  });

  it("respects a valid limit", async () => {
    seedAndInject();
    const res = getEvents(req("/api/events?limit=2"));
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toHaveLength(2);
  });
});

describe("F-032 / F-034 GET /api/verify", () => {
  it("returns 200 ok:true for an intact chain", async () => {
    seedAndInject();
    const res = getVerify(req("/api/verify?mode=raw"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 200 ok:false with a tampered seq when raw content is corrupted", async () => {
    const db = seededDb(NOW);
    const seq = tamperRawBody(db);
    __setDbForTests(db);
    const res = getVerify(req("/api/verify?mode=raw"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tampered_seq?: number };
    expect(body.ok).toBe(false);
    expect(body.tampered_seq).toBe(seq);
  });

  it("returns 503 when the ledger secret is not configured", async () => {
    seedAndInject();
    delete process.env.PROTOCOL_RADAR_HMAC_SECRET;
    const res = getVerify(req("/api/verify"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { unavailable: boolean };
    expect(body.unavailable).toBe(true);
  });
});
