import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb, tamperRawBody } from "@/app/_data/fixtures";
import { GET as getExport } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

interface ExportBody {
  schema: string;
  generated_at: string;
  protocols: Array<{ key: string; event_count: number }>;
  events: Array<{ seq: number; hash: string; protocol_key: string }>;
  integrity: {
    ledger: { ok: boolean; mode: string; checked: number };
    head_hash: string | null;
    event_count: number;
  };
}

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

describe("F-010 GET /api/export.json", () => {
  it("returns 200 with JSON content-type and no-store caching", () => {
    seedAndInject();
    const res = getExport(req(`/api/export.json?now=${NOW}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("emits the versioned schema, an ISO timestamp, protocols and events", async () => {
    seedAndInject();
    const res = getExport(req(`/api/export.json?now=${NOW}`));
    const body = (await res.json()) as ExportBody;
    expect(body.schema).toBe("protocol-radar/export@1");
    expect(new Date(body.generated_at).toISOString()).toBe(body.generated_at);
    expect(body.protocols.length).toBeGreaterThan(0);
    expect(body.events.length).toBeGreaterThan(0);
  });

  it("carries a valid ledger integrity proof (raw mode, ok:true)", async () => {
    seedAndInject();
    const res = getExport(req(`/api/export.json?now=${NOW}`));
    const body = (await res.json()) as ExportBody;
    expect(body.integrity.ledger.ok).toBe(true);
    expect(body.integrity.ledger.mode).toBe("raw");
    expect(body.integrity.ledger.checked).toBe(body.integrity.event_count);
  });

  it("publishes the current chain HEAD hash (public, safe value)", async () => {
    seedAndInject();
    const res = getExport(req(`/api/export.json?now=${NOW}`));
    const body = (await res.json()) as ExportBody;
    // HEAD = newest event overall, matches the first event in the newest-first feed.
    expect(body.integrity.head_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.integrity.head_hash).toBe(body.events[0]?.hash);
  });

  it("embeds every event when limit is unspecified (event_count == events.length)", async () => {
    seedAndInject();
    const res = getExport(req(`/api/export.json?now=${NOW}`));
    const body = (await res.json()) as ExportBody;
    expect(body.integrity.event_count).toBe(body.events.length);
    // Cross-check: total equals the sum of per-protocol counts.
    const summed = body.protocols.reduce((n, p) => n + p.event_count, 0);
    expect(body.integrity.event_count).toBe(summed);
  });

  it("honours a valid ?limit while keeping the full event_count", async () => {
    seedAndInject();
    const res = getExport(req(`/api/export.json?now=${NOW}&limit=2`));
    const body = (await res.json()) as ExportBody;
    expect(body.events).toHaveLength(2);
    // event_count reflects the whole ledger, not the truncated slice.
    expect(body.integrity.event_count).toBeGreaterThanOrEqual(2);
    expect(body.integrity.event_count).toBeGreaterThan(body.events.length);
  });

  it("returns 400 for an invalid limit (same contract as /api/events)", () => {
    seedAndInject();
    for (const bad of ["0", "-1", "abc", "3000"]) {
      const res = getExport(req(`/api/export.json?limit=${bad}`));
      expect(res.status).toBe(400);
    }
  });

  it("reports ok:false when raw content is tampered, without leaking the secret", async () => {
    const db = seededDb(NOW);
    tamperRawBody(db);
    __setDbForTests(db);
    const res = getExport(req(`/api/export.json?now=${NOW}`));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(String(process.env.PROTOCOL_RADAR_HMAC_SECRET));
    const body = JSON.parse(text) as ExportBody;
    expect(body.integrity.ledger.ok).toBe(false);
  });
});
