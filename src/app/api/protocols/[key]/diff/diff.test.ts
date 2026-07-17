import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getDiff } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

function seedAndInject(): void {
  __setDbForTests(seededDb(NOW));
}

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

function ctx(key: string): { params: Promise<{ key: string }> } {
  return { params: Promise.resolve({ key }) };
}

afterEach(() => {
  __setDbForTests(null);
});

describe("feature #6 GET /api/protocols/:key/diff", () => {
  it("returns 200 JSON with a newest-first changes array for a known protocol", async () => {
    seedAndInject();
    const res = await getDiff(req("/api/protocols/mcp/diff"), ctx("mcp"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as {
      protocol: string;
      changes: Array<{
        seq: number;
        type: string;
        at: string;
        summary: string | null;
        from: string | null;
        to: string | null;
        diffs: Array<{ kind: string; detail: string | null }>;
      }>;
    };

    expect(body.protocol).toBe("mcp");
    expect(Array.isArray(body.changes)).toBe(true);
    // mcp seed: appeared -> version_bump -> spec_change (3 change events).
    expect(body.changes).toHaveLength(3);
    // Newest-first: seq strictly descending.
    const seqs = body.changes.map((c) => c.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));

    // The version_bump change surfaces before/after honestly from the stored version diff.
    const bump = body.changes.find((c) => c.type === "version_bump");
    expect(bump?.from).toBe("v1.0.0");
    expect(bump?.to).toBe("v1.1.0");
    expect(bump?.diffs.some((d) => d.kind === "version")).toBe(true);
  });

  it("respects a valid limit", async () => {
    seedAndInject();
    const res = await getDiff(req("/api/protocols/mcp/diff?limit=1"), ctx("mcp"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changes: unknown[] };
    expect(body.changes).toHaveLength(1);
  });

  it("returns 404 for an unknown protocol", async () => {
    seedAndInject();
    const res = await getDiff(req("/api/protocols/nope/diff"), ctx("nope"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("protocol_not_found");
  });

  it("returns 400 for an invalid limit", async () => {
    seedAndInject();
    for (const bad of ["0", "-1", "abc", "9999"]) {
      const res = await getDiff(
        req(`/api/protocols/mcp/diff?limit=${bad}`),
        ctx("mcp"),
      );
      expect(res.status).toBe(400);
    }
  });
});
