import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { contentHash } from "@/lib/fetch";
import { GET as getCertificate } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

// Append a deterministic `now` so generatedAt/default-asOf are stable, preserving any query.
function req(path: string): Request {
  const sep = path.includes("?") ? "&" : "?";
  return new Request(`http://test.local${path}${sep}now=${NOW}`);
}

interface CertBody {
  protocol: string;
  name: string;
  asOf: string;
  state: {
    status: string;
    layer: string | null;
    freshness: string;
    stale_warning: boolean;
    event_count: number;
    last_change: {
      seq: number;
      type: string;
      summary: string | null;
      content_hash: string | null;
      created_at: string;
      observed_at: string | null;
    } | null;
  };
  ledger: {
    head_hash: string;
    checked: number;
    verified: boolean;
    mode: string;
  };
  events: Array<{
    seq: number;
    type: string;
    summary: string | null;
    content_hash: string | null;
    created_at: string;
    observed_at: string | null;
  }>;
  generatedAt: string;
}

afterEach(() => {
  __setDbForTests(null);
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

describe("B1 GET /api/certificate", () => {
  it("returns a complete, ledger-verified certificate for a known protocol", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getCertificate(req("/api/certificate?protocol=mcp"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as CertBody;

    // Every required top-level field is present.
    expect(body.protocol).toBe("mcp");
    expect(body.name).toBe("Model Context Protocol");
    expect(typeof body.asOf).toBe("string");
    expect(typeof body.generatedAt).toBe("string");
    expect(body.state).toBeDefined();
    expect(body.ledger).toBeDefined();
    expect(Array.isArray(body.events)).toBe(true);

    // As of NOW, all three mcp events are in scope.
    expect(body.events).toHaveLength(3);
    expect(body.state.event_count).toBe(3);
    expect(body.state.status).toBe("active");
    expect(body.state.last_change).not.toBeNull();
    expect(body.state.last_change?.type).toBe("spec_change");

    // The ledger block verifies (whole-chain), anchored to a real 64-hex head hash.
    expect(body.ledger.verified).toBe(true);
    expect(body.ledger.mode).toBe("raw");
    expect(body.ledger.head_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.ledger.checked).toBeGreaterThan(0);
  });

  it("supports ?mode=chain and still verifies", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getCertificate(
      req("/api/certificate?protocol=mcp&mode=chain"),
    );
    const body = (await res.json()) as CertBody;
    expect(body.ledger.mode).toBe("chain");
    expect(body.ledger.verified).toBe(true);
  });

  it("resolves a protocol by its human name too", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getCertificate(
      req("/api/certificate?protocol=Model Context Protocol"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CertBody;
    expect(body.protocol).toBe("mcp");
  });

  it("excludes events observed after the asOf cutoff", async () => {
    __setDbForTests(seededDb(NOW));
    // mcp events were observed at now-3h, now-2h, now-1h. Cut at now-1.5h.
    const asOf = new Date(NOW - 1.5 * 3600 * 1000).toISOString();
    const res = await getCertificate(
      req(`/api/certificate?protocol=mcp&asOf=${encodeURIComponent(asOf)}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CertBody;

    // Only the two earlier events remain; the spec_change (now-1h) is excluded.
    expect(body.events).toHaveLength(2);
    const types = body.events.map((e) => e.type);
    expect(types).not.toContain("spec_change");
    expect(types).toEqual(["version_bump", "appeared"]);
    expect(body.state.event_count).toBe(2);
    expect(body.asOf).toBe(asOf);
    // No in-scope event may fall after the cutoff.
    for (const e of body.events) {
      expect(e.observed_at! <= asOf).toBe(true);
    }
  });

  it("accepts a unix-seconds asOf", async () => {
    __setDbForTests(seededDb(NOW));
    const asOfSec = Math.floor((NOW - 1.5 * 3600 * 1000) / 1000);
    const res = await getCertificate(
      req(`/api/certificate?protocol=mcp&asOf=${asOfSec}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CertBody;
    expect(body.events).toHaveLength(2);
  });

  it("copies content_hash verbatim from the existing observation (invariant preserved)", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getCertificate(req("/api/certificate?protocol=mcp"));
    const body = (await res.json()) as CertBody;

    // The "appeared" event references the observation with body "spec body v1".
    const appeared = body.events.find((e) => e.type === "appeared");
    expect(appeared).toBeDefined();
    expect(appeared?.content_hash).toBe(contentHash("spec body v1"));
  });

  it("returns 400 when protocol is missing", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getCertificate(req("/api/certificate"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("protocol_required");
  });

  it("returns 400 for an unparseable asOf", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getCertificate(
      req("/api/certificate?protocol=mcp&asOf=not-a-time"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_asof");
  });

  it("returns 404 for an unknown protocol", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getCertificate(req("/api/certificate?protocol=nope"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; key: string };
    expect(body.error).toBe("protocol_not_found");
    expect(body.key).toBe("nope");
  });
});
