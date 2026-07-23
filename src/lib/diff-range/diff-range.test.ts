import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import type { AsOfProtocolState } from "@/lib/asof";
import { changeKindsFor, parseInterval } from "@/lib/diff-range";
import { GET as getDiff } from "@/app/api/diff/route";

/**
 * F3 tests. The seeded fixture (see @/app/_data/fixtures) lays events on a timeline expressed
 * relative to `now`:
 *   - mcp:      appeared @ now-3h, version_bump @ now-2h, spec_change @ now-1h
 *   - a2a:      appeared @ now-90h
 *   - oldproto: appeared @ now-200h, vanished @ now-10h
 * We slice `(from, to]` windows around those instants to force each change kind.
 */

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const HOUR_MS = 3600 * 1000;

/** Build a GET /api/diff request; `now` is appended so `generated_at` is deterministic. */
function req(fromMs: number | null, toMs: number | null): Request {
  const params = new URLSearchParams();
  if (fromMs !== null) params.set("from", String(fromMs));
  if (toMs !== null) params.set("to", String(toMs));
  params.set("now", String(NOW));
  return new Request(`http://test.local/api/diff?${params.toString()}`);
}

interface DiffBody {
  from: string;
  to: string;
  generated_at: string;
  summary: {
    protocols_changed: number;
    events_added: number;
    appeared: number;
    vanished: number;
  };
  changes: Array<{
    key: string;
    name: string;
    change_kinds: string[];
    from_status: string;
    to_status: string;
    events_added_count: number;
    events_between: Array<{ type: string; summary: string | null; at: string }>;
  }>;
}

function byKey(body: DiffBody, key: string): DiffBody["changes"][number] {
  const c = body.changes.find((x) => x.key === key);
  if (c === undefined) throw new Error(`protocol ${key} missing from changes`);
  return c;
}

/** Minimal AsOfProtocolState builder for the pure-logic tests. */
function state(over: Partial<AsOfProtocolState>): AsOfProtocolState {
  return {
    key: "p",
    name: "P",
    known_at_ts: true,
    status: "active",
    last_change_at: null,
    last_event: null,
    events_upto_ts: 0,
    ...over,
  };
}

afterEach(() => {
  __setDbForTests(null);
});

describe("F3 pure logic", () => {
  it("parseInterval rejects missing operands, bad parses and from>to", () => {
    expect(parseInterval(null, "1000")).toEqual({ error: "from_required" });
    expect(parseInterval("1000", null)).toEqual({ error: "to_required" });
    expect(parseInterval("nope", "1000")).toEqual({ error: "invalid_from" });
    expect(parseInterval("1000", "nope")).toEqual({ error: "invalid_to" });
    expect(parseInterval("2000", "1000")).toEqual({ error: "from_after_to" });
    // from == to is allowed (empty interval).
    expect(parseInterval("1000", "1000")).toEqual({
      from_ms: 1_000_000,
      to_ms: 1_000_000,
    });
  });

  it("changeKindsFor flags appearance, status change, new events and vanish", () => {
    // appeared: unknown -> known active, with events.
    expect(
      changeKindsFor(
        state({ known_at_ts: false, status: "inactive" }),
        state({ known_at_ts: true, status: "active" }),
        1,
      ),
    ).toEqual(["appeared", "status_changed", "new_events"]);

    // new events only, no status change.
    expect(
      changeKindsFor(
        state({ status: "active" }),
        state({ status: "active" }),
        2,
      ),
    ).toEqual(["new_events"]);

    // vanish: active -> vanished with an event.
    expect(
      changeKindsFor(
        state({ status: "active" }),
        state({ status: "vanished" }),
        1,
      ),
    ).toEqual(["status_changed", "new_events", "vanished"]);

    // no change at all.
    expect(
      changeKindsFor(state({ status: "active" }), state({ status: "active" }), 0),
    ).toEqual([]);
  });
});

describe("F3 GET /api/diff", () => {
  it("captures new events inside the interval and ignores those outside", async () => {
    __setDbForTests(seededDb(NOW));
    // (now-2.5h, now-0.5h] -> mcp version_bump(now-2h) + spec_change(now-1h) only.
    const res = getDiff(req(NOW - 2.5 * HOUR_MS, NOW - 0.5 * HOUR_MS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiffBody;

    const mcp = byKey(body, "mcp");
    expect(mcp.change_kinds).toEqual(["new_events"]);
    expect(mcp.from_status).toBe("active");
    expect(mcp.to_status).toBe("active");
    expect(mcp.events_added_count).toBe(2);
    expect(mcp.events_between.map((e) => e.type)).toEqual([
      "version_bump",
      "spec_change",
    ]);
    // mcp's appeared(now-3h) is before `from`; not counted.
    expect(mcp.events_between.every((e) => e.type !== "appeared")).toBe(true);

    // Only mcp changed in this window.
    expect(body.changes.map((c) => c.key)).toEqual(["mcp"]);
    expect(body.summary.protocols_changed).toBe(1);
    expect(body.summary.events_added).toBe(2);
    expect(body.summary.appeared).toBe(0);
    expect(body.summary.vanished).toBe(0);
  });

  it("flags a protocol that appeared during the interval", async () => {
    __setDbForTests(seededDb(NOW));
    // (now-3.5h, now-2.5h] -> mcp appeared(now-3h) only.
    const res = getDiff(req(NOW - 3.5 * HOUR_MS, NOW - 2.5 * HOUR_MS));
    const body = (await res.json()) as DiffBody;

    const mcp = byKey(body, "mcp");
    expect(mcp.change_kinds).toEqual([
      "appeared",
      "status_changed",
      "new_events",
    ]);
    expect(mcp.from_status).toBe("inactive");
    expect(mcp.to_status).toBe("active");
    expect(mcp.events_added_count).toBe(1);
    expect(mcp.events_between.map((e) => e.type)).toEqual(["appeared"]);
    expect(body.summary.appeared).toBe(1);
  });

  it("flags a protocol that vanished during the interval", async () => {
    __setDbForTests(seededDb(NOW));
    // (now-11h, now-9h] -> oldproto vanished(now-10h).
    const res = getDiff(req(NOW - 11 * HOUR_MS, NOW - 9 * HOUR_MS));
    const body = (await res.json()) as DiffBody;

    const old = byKey(body, "oldproto");
    expect(old.change_kinds).toEqual([
      "status_changed",
      "new_events",
      "vanished",
    ]);
    expect(old.from_status).toBe("active");
    expect(old.to_status).toBe("vanished");
    expect(old.events_between.map((e) => e.type)).toEqual(["vanished"]);
    expect(body.summary.vanished).toBe(1);
  });

  it("returns an empty diff when no events fall inside the interval", async () => {
    __setDbForTests(seededDb(NOW));
    // (now-0.4h, now-0.1h] -> no seeded event lands here.
    const res = getDiff(req(NOW - 0.4 * HOUR_MS, NOW - 0.1 * HOUR_MS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiffBody;
    expect(body.changes).toEqual([]);
    expect(body.summary).toEqual({
      protocols_changed: 0,
      events_added: 0,
      appeared: 0,
      vanished: 0,
    });
  });

  it("rejects from > to with 400 from_after_to", async () => {
    __setDbForTests(seededDb(NOW));
    const res = getDiff(req(NOW, NOW - HOUR_MS));
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "from_after_to" });
  });

  it("rejects a missing operand with 400", async () => {
    __setDbForTests(seededDb(NOW));
    const missingFrom = getDiff(req(null, NOW));
    expect(missingFrom.status).toBe(400);
    expect((await missingFrom.json()) as unknown).toEqual({
      error: "from_required",
    });

    const missingTo = getDiff(req(NOW - HOUR_MS, null));
    expect(missingTo.status).toBe(400);
    expect((await missingTo.json()) as unknown).toEqual({ error: "to_required" });
  });
});
