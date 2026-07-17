import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getHealth } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

afterEach(() => {
  __setDbForTests(null);
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

describe("F-035 GET /api/health", () => {
  it("returns 200 with JSON content-type and the operational snapshot", async () => {
    seedAndInject();
    const res = getHealth(req(`/api/health?now=${NOW}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as {
      ok: boolean;
      generated_at: string;
      protocols_total: number;
      events_total: number;
      freshness_counts: Record<string, number>;
      oldest_observation_at: string | null;
      newest_observation_at: string | null;
      ledger: { ok: boolean; mode: string; checked: number };
    };

    expect(body.protocols_total).toBe(5);
    expect(body.events_total).toBeGreaterThan(0);
    expect(body.generated_at).toBe(new Date(NOW).toISOString());
    expect(body.oldest_observation_at).not.toBeNull();
    expect(body.newest_observation_at).not.toBeNull();
  });

  it("freshness_counts sums to protocols_total", async () => {
    seedAndInject();
    const res = getHealth(req(`/api/health?now=${NOW}`));
    const body = (await res.json()) as {
      protocols_total: number;
      freshness_counts: Record<string, number>;
    };
    const sum = Object.values(body.freshness_counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(body.protocols_total);
  });

  it("reports a verifying ledger and overall ok for an intact chain", async () => {
    seedAndInject();
    const res = getHealth(req(`/api/health?now=${NOW}`));
    const body = (await res.json()) as {
      ok: boolean;
      ledger: { ok: boolean; mode: string; checked: number };
    };
    expect(body.ledger.ok).toBe(true);
    expect(body.ledger.mode).toBe("raw");
    expect(body.ledger.checked).toBeGreaterThan(0);
    expect(body.ok).toBe(true);
  });
});
