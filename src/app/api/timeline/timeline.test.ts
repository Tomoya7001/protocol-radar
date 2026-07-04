import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET as getTimeline } from "./route";
import { GET as getDigest } from "./digest/route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const SECRET = process.env.PROTOCOL_RADAR_HMAC_SECRET;

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

afterEach(() => {
  __setDbForTests(null);
  process.env.PROTOCOL_RADAR_HMAC_SECRET = SECRET;
});

describe("F-050 GET /api/timeline", () => {
  it("returns the merged, ranked cross-protocol timeline", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getTimeline(req("/api/timeline"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as {
      count: number;
      entries: Array<{ protocol_key: string; type: string; hash: string }>;
    };
    expect(body.count).toBe(7);
    expect(body.entries[0]?.protocol_key).toBe("mcp");
    expect(body.entries[0]?.type).toBe("spec_change");
    expect(body.entries[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("applies ?limit and rejects an invalid one with 400", async () => {
    __setDbForTests(seededDb(NOW));
    const ok = getTimeline(req("/api/timeline?limit=2"));
    const okBody = (await ok.json()) as { count: number };
    expect(ok.status).toBe(200);
    expect(okBody.count).toBe(2);

    const bad = getTimeline(req("/api/timeline?limit=0"));
    expect(bad.status).toBe(400);
  });
});

describe("F-052 GET /api/timeline/digest", () => {
  it("returns a 24h JSON digest resolved against ?now", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getDigest(req(`/api/timeline/digest?now=${NOW}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      digest: {
        total: number;
        window_hours: number;
        by_protocol: Array<{ protocol_key: string; count: number }>;
      };
    };
    expect(body.digest.total).toBe(5);
    expect(body.digest.window_hours).toBe(24);
    expect(body.digest.by_protocol.map((g) => g.protocol_key)).toEqual([
      "mcp",
      "oldproto",
      "x402",
    ]);
  });

  it("returns markdown when ?format=markdown", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getDigest(req(`/api/timeline/digest?now=${NOW}&format=markdown`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("# プロトコル・レーダー デイリーダイジェスト");
    expect(text).toContain("変更 5 件");
  });

  it("rejects an invalid ?window with 400", () => {
    __setDbForTests(seededDb(NOW));
    const res = getDigest(req(`/api/timeline/digest?now=${NOW}&window=0`));
    expect(res.status).toBe(400);
  });
});
