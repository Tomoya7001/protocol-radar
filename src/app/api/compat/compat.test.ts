import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getCompat } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

afterEach(() => {
  __setDbForTests(null);
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

describe("F-051 GET /api/compat", () => {
  it("returns the compatibility matrix over tracked protocols", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getCompat();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as {
      matrix: {
        protocols: Array<{ key: string }>;
        cells: Array<Array<{ composes: boolean; self: boolean }>>;
        pairs: Array<{ a: string; b: string; note: string }>;
      };
    };
    expect(body.matrix.protocols.map((p) => p.key)).toEqual([
      "a2a",
      "mcp",
      "oldproto",
      "ucp",
      "x402",
    ]);
    expect(body.matrix.cells).toHaveLength(5);
    expect(body.matrix.pairs.map((p) => [p.a, p.b])).toEqual([
      ["a2a", "mcp"],
      ["a2a", "x402"],
      ["mcp", "x402"],
    ]);
    expect(body.matrix.pairs.every((p) => p.note.length > 0)).toBe(true);
  });
});
