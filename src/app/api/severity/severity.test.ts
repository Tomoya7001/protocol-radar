import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getSeverity } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const VALID_SEVERITIES = ["breaking", "spec", "minor", "meta"];

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

afterEach(() => {
  __setDbForTests(null);
});

describe("severity #8 GET /api/severity", () => {
  it("returns changes newest-first, each with a valid severity + reason", async () => {
    seedAndInject();
    const res = getSeverity(req("/api/severity"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as {
      changes: Array<{ seq: number; severity: string; reason: string }>;
    };
    expect(body.changes.length).toBeGreaterThan(0);
    for (const c of body.changes) {
      expect(VALID_SEVERITIES).toContain(c.severity);
      expect(typeof c.reason).toBe("string");
      expect(c.reason.length).toBeGreaterThan(0);
    }
    // newest-first: seq descending
    const seqs = body.changes.map((c) => c.seq);
    expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
  });

  it("filters by a known protocol key and echoes it back", async () => {
    seedAndInject();
    const res = getSeverity(req("/api/severity?protocol=mcp"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocol: string;
      changes: Array<{ severity: string }>;
    };
    expect(body.protocol).toBe("mcp");
    expect(body.changes).toHaveLength(3);
  });

  it("returns 404 for an unknown protocol filter", async () => {
    seedAndInject();
    const res = getSeverity(req("/api/severity?protocol=nope"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("protocol_not_found");
  });

  it("returns 400 for an invalid limit", async () => {
    seedAndInject();
    for (const bad of ["0", "-1", "abc", "9999"]) {
      const res = getSeverity(req(`/api/severity?limit=${bad}`));
      expect(res.status).toBe(400);
    }
  });

  it("respects a valid limit", async () => {
    seedAndInject();
    const res = getSeverity(req("/api/severity?limit=2"));
    const body = (await res.json()) as { changes: unknown[] };
    expect(body.changes).toHaveLength(2);
  });
});
