import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { parseTs, statusFromLatestEvent } from "@/lib/asof";
import { GET as getAsOf } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const HOUR_MS = 3600 * 1000;

// Append a deterministic `now` so `generated_at` is stable, preserving any existing query.
function req(path: string): Request {
  const sep = path.includes("?") ? "&" : "?";
  return new Request(`http://test.local${path}${sep}now=${NOW}`);
}

interface AsOfBody {
  asof: string;
  generated_at: string;
  protocol_count: number;
  protocols: Array<{
    key: string;
    name: string;
    known_at_ts: boolean;
    status: string;
    last_change_at: string | null;
    last_event: { type: string; summary: string | null; at: string } | null;
    events_upto_ts: number;
  }>;
}

function byKey(body: AsOfBody, key: string): AsOfBody["protocols"][number] {
  const p = body.protocols.find((x) => x.key === key);
  if (p === undefined) throw new Error(`protocol ${key} missing from landscape`);
  return p;
}

afterEach(() => {
  __setDbForTests(null);
});

describe("E1 pure logic", () => {
  it("derives status purely from the latest in-scope event type", () => {
    expect(statusFromLatestEvent(null)).toBe("inactive");
    expect(statusFromLatestEvent("appeared")).toBe("active");
    expect(statusFromLatestEvent("version_bump")).toBe("active");
    expect(statusFromLatestEvent("spec_change")).toBe("active");
    expect(statusFromLatestEvent("vanished")).toBe("vanished");
  });

  it("parses ISO, unix-ms and unix-seconds, and rejects garbage", () => {
    const iso = parseTs("2026-07-02T00:00:00.000Z");
    expect(iso).toEqual({ ms: NOW });
    // >= 1e12 is treated as milliseconds.
    expect(parseTs(String(NOW))).toEqual({ ms: NOW });
    // < 1e12 is treated as seconds.
    expect(parseTs("1000")).toEqual({ ms: 1_000_000 });
    expect("error" in parseTs("not-a-time")).toBe(true);
    expect("error" in parseTs("   ")).toBe(true);
  });
});

describe("E1 GET /api/asof", () => {
  it("reconstructs the full landscape as of NOW (all events reflected)", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getAsOf(req(`/api/asof?ts=${encodeURIComponent(new Date(NOW).toISOString())}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as AsOfBody;
    expect(body.asof).toBe(new Date(NOW).toISOString());
    expect(typeof body.generated_at).toBe("string");
    expect(body.protocol_count).toBe(5);
    // Stable, key-sorted listing.
    expect(body.protocols.map((p) => p.key)).toEqual([
      "a2a",
      "mcp",
      "oldproto",
      "ucp",
      "x402",
    ]);

    const mcp = byKey(body, "mcp");
    expect(mcp.known_at_ts).toBe(true);
    expect(mcp.status).toBe("active");
    expect(mcp.events_upto_ts).toBe(3);
    expect(mcp.last_event?.type).toBe("spec_change");
    expect(mcp.last_change_at).toBe(mcp.last_event?.at);

    // ucp has no events at all -> empty state.
    const ucp = byKey(body, "ucp");
    expect(ucp.known_at_ts).toBe(false);
    expect(ucp.status).toBe("inactive");
    expect(ucp.events_upto_ts).toBe(0);
    expect(ucp.last_event).toBeNull();
    expect(ucp.last_change_at).toBeNull();

    // oldproto appeared then vanished -> vanished by NOW.
    const old = byKey(body, "oldproto");
    expect(old.known_at_ts).toBe(true);
    expect(old.status).toBe("vanished");
    expect(old.events_upto_ts).toBe(2);
    expect(old.last_event?.type).toBe("vanished");
  });

  it("reflects only events observed up to a past intermediate ts (counts shrink)", async () => {
    __setDbForTests(seededDb(NOW));
    // Cut at NOW-1.5h: mcp's spec_change (NOW-1h) is excluded, version_bump/appeared remain.
    const ts = new Date(NOW - 1.5 * HOUR_MS).toISOString();
    const res = await getAsOf(req(`/api/asof?ts=${encodeURIComponent(ts)}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AsOfBody;
    expect(body.asof).toBe(ts);

    const mcp = byKey(body, "mcp");
    expect(mcp.events_upto_ts).toBe(2); // was 3 as of NOW
    expect(mcp.status).toBe("active");
    expect(mcp.last_event?.type).toBe("version_bump");
    // No in-scope change may fall after the cutoff.
    expect(mcp.last_change_at !== null && mcp.last_change_at <= ts).toBe(true);
  });

  it("returns a valid empty landscape when ts precedes the oldest event", async () => {
    __setDbForTests(seededDb(NOW));
    // Oldest event is oldproto's appeared at NOW-200h; go before everything.
    const ts = new Date(NOW - 300 * HOUR_MS).toISOString();
    const res = await getAsOf(req(`/api/asof?ts=${encodeURIComponent(ts)}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AsOfBody;

    expect(body.protocol_count).toBe(5);
    for (const p of body.protocols) {
      expect(p.known_at_ts).toBe(false);
      expect(p.status).toBe("inactive");
      expect(p.events_upto_ts).toBe(0);
      expect(p.last_event).toBeNull();
      expect(p.last_change_at).toBeNull();
    }
  });

  it("accepts a unix-ms ts equivalently to the ISO form", async () => {
    __setDbForTests(seededDb(NOW));
    const isoRes = await getAsOf(
      req(`/api/asof?ts=${encodeURIComponent(new Date(NOW).toISOString())}`),
    );
    const msRes = await getAsOf(req(`/api/asof?ts=${NOW}`));
    const isoBody = (await isoRes.json()) as AsOfBody;
    const msBody = (await msRes.json()) as AsOfBody;
    expect(msBody.asof).toBe(isoBody.asof);
    expect(msBody.protocols).toEqual(isoBody.protocols);
  });

  it("returns 400 when ts is missing", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getAsOf(req("/api/asof"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ts_required");
  });

  it("returns 400 for an unparseable ts", async () => {
    __setDbForTests(seededDb(NOW));
    const res = await getAsOf(req("/api/asof?ts=not-a-time"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_ts");
  });
});
