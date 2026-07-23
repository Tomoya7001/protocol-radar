import { describe, it, expect } from "vitest";
import {
  computeAnswer,
  findNamedProtocol,
  extractWindowDays,
  SUPPORTED_INTENTS,
  UNKNOWN_INTENT,
  type AnswerProtocolInput,
  type AnswerEventInput,
  type ComputeAnswerInput,
} from "./answer";

const DAY_MS = 86_400_000;
/** Fixed "now" so every test is deterministic: 2026-07-23T00:00:00Z. */
const NOW = Date.parse("2026-07-23T00:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY_MS).toISOString();
}

function proto(
  key: string,
  over: Partial<AnswerProtocolInput> = {},
): AnswerProtocolInput {
  return {
    key,
    name: `${key.toUpperCase()} Protocol`,
    status: "active",
    freshness: "fresh",
    stale_warning: false,
    event_count: 0,
    last_event: null,
    momentum_score: 0,
    trend: "steady",
    days_since_last_change: null,
    ...over,
  };
}

function ev(
  protocol_key: string,
  daysAgoN: number,
  over: Partial<AnswerEventInput> = {},
): AnswerEventInput {
  return {
    protocol_key,
    protocol_name: `${protocol_key.toUpperCase()} Protocol`,
    type: "spec_change",
    summary: `change on ${protocol_key}`,
    created_at: daysAgo(daysAgoN),
    ...over,
  };
}

/** A representative snapshot reused across tests. */
function snapshot(q: string): ComputeAnswerInput {
  const protocols: AnswerProtocolInput[] = [
    proto("mcp", {
      status: "active",
      freshness: "fresh",
      momentum_score: 90,
      trend: "accelerating",
      event_count: 4,
      days_since_last_change: 2,
      last_event: { type: "spec_change", summary: "v1.1 released", created_at: daysAgo(2) },
    }),
    proto("x402", {
      status: "active",
      freshness: "stale",
      stale_warning: true,
      momentum_score: 30,
      trend: "cooling",
      event_count: 2,
      days_since_last_change: 40,
      last_event: { type: "source_added", summary: "new source", created_at: daysAgo(40) },
    }),
    proto("a2a", {
      status: "inactive",
      freshness: "pending",
      momentum_score: 5,
      trend: "dormant",
      event_count: 0,
      days_since_last_change: null,
      last_event: null,
    }),
  ];
  const events: AnswerEventInput[] = [
    ev("mcp", 2),
    ev("mcp", 3),
    ev("mcp", 10),
    ev("x402", 40),
    ev("x402", 100),
  ];
  return { q, now: NOW, protocols, events };
}

describe("F7 answer — top-level envelope", () => {
  it("always returns the full result shape incl. supported_intents", () => {
    const r = computeAnswer(snapshot("プロトコルは何個？"));
    expect(r).toMatchObject({
      q: "プロトコルは何個？",
      answered: true,
      intent: expect.any(String),
      answer_text: expect.any(String),
    });
    expect(Array.isArray(r.supported_intents)).toBe(true);
    expect(r.supported_intents).toBe(SUPPORTED_INTENTS);
    expect(r.supported_intents.length).toBeGreaterThanOrEqual(6);
  });
});

describe("F7 answer — recent_changes intent", () => {
  it("今週変わったプロトコル ⇒ protocols with events in a 7-day window", () => {
    const r = computeAnswer(snapshot("今週変わったプロトコルは？"));
    expect(r.answered).toBe(true);
    expect(r.intent).toBe("recent_changes");
    expect(r.data.window_days).toBe(7);
    // Only mcp has events within 7 days (2d, 3d); x402's are 40d/100d out.
    expect(r.data.count).toBe(1);
    const protos = r.data.protocols as Array<{ key: string; events_in_window: number }>;
    expect(protos.map((p) => p.key)).toEqual(["mcp"]);
    expect(protos[0]?.events_in_window).toBe(2);
    expect(r.answer_text).toContain("mcp");
  });

  it("直近 60 日 ⇒ widens the window and includes x402", () => {
    const r = computeAnswer(snapshot("直近60日に変わったプロトコルは？"));
    expect(r.intent).toBe("recent_changes");
    expect(r.data.window_days).toBe(60);
    const protos = r.data.protocols as Array<{ key: string }>;
    expect(protos.map((p) => p.key)).toEqual(["mcp", "x402"]);
  });

  it("今日 ⇒ 1-day window, none changed today", () => {
    const r = computeAnswer(snapshot("今日変わったのは？"));
    expect(r.data.window_days).toBe(1);
    expect(r.data.count).toBe(0);
    expect(r.answer_text).toContain("No protocols changed");
  });

  it("english 'changed in the last 7 days' also matches", () => {
    const r = computeAnswer(snapshot("which protocols changed in the last 7 days"));
    expect(r.intent).toBe("recent_changes");
    expect(r.data.window_days).toBe(7);
  });
});

describe("F7 answer — filter_status intent", () => {
  it("stale ⇒ freshness/stale_warning filter", () => {
    const r = computeAnswer(snapshot("stale なプロトコルは？"));
    expect(r.intent).toBe("filter_status");
    expect(r.data.filter).toBe("stale");
    const protos = r.data.protocols as Array<{ key: string }>;
    expect(protos.map((p) => p.key)).toEqual(["x402"]);
  });

  it("dormant ⇒ velocity trend filter", () => {
    const r = computeAnswer(snapshot("which protocols are dormant?"));
    expect(r.intent).toBe("filter_status");
    expect(r.data.filter).toBe("dormant");
    const protos = r.data.protocols as Array<{ key: string }>;
    expect(protos.map((p) => p.key)).toEqual(["a2a"]);
  });

  it("active ⇒ status filter (sorted keys)", () => {
    const r = computeAnswer(snapshot("active なプロトコル"));
    expect(r.intent).toBe("filter_status");
    expect(r.data.filter).toBe("active");
    const protos = r.data.protocols as Array<{ key: string }>;
    expect(protos.map((p) => p.key)).toEqual(["mcp", "x402"]);
  });

  it("no match ⇒ answered true, empty list, explicit text", () => {
    const r = computeAnswer(snapshot("vanished なプロトコルは？"));
    expect(r.intent).toBe("filter_status");
    expect(r.data.count).toBe(0);
    expect(r.answer_text).toContain("No protocols match");
  });
});

describe("F7 answer — latest_change intent", () => {
  it("mcp の最新変更 ⇒ that protocol's last_event", () => {
    const r = computeAnswer(snapshot("mcp の最新変更は？"));
    expect(r.intent).toBe("latest_change");
    expect((r.data.protocol as { key: string }).key).toBe("mcp");
    expect((r.data.last_event as { summary: string }).summary).toBe("v1.1 released");
    expect(r.answer_text).toContain("mcp");
  });

  it("english 'latest change for x402' ⇒ x402", () => {
    const r = computeAnswer(snapshot("latest change for x402"));
    expect(r.intent).toBe("latest_change");
    expect((r.data.protocol as { key: string }).key).toBe("x402");
  });

  it("named protocol with no events ⇒ 'no recorded changes'", () => {
    const r = computeAnswer(snapshot("a2a の最新変更は？"));
    expect(r.intent).toBe("latest_change");
    expect(r.data.last_event).toBeNull();
    expect(r.answer_text).toContain("no recorded changes");
  });

  it("no named protocol ⇒ most recent change across all", () => {
    const r = computeAnswer(snapshot("最新の変更は？"));
    expect(r.intent).toBe("latest_change");
    expect((r.data.protocol as { key: string }).key).toBe("mcp");
    expect(r.answer_text).toContain("most recent change");
  });
});

describe("F7 answer — count_list intent", () => {
  it("何個 ⇒ count + sorted keys", () => {
    const r = computeAnswer(snapshot("プロトコルは何個？"));
    expect(r.intent).toBe("count_list");
    expect(r.data.count).toBe(3);
    expect(r.data.keys).toEqual(["a2a", "mcp", "x402"]);
    expect(r.answer_text).toContain("3 tracked protocols");
  });

  it("english 'list all protocols'", () => {
    const r = computeAnswer(snapshot("list all protocols"));
    expect(r.intent).toBe("count_list");
    expect(r.data.count).toBe(3);
  });
});

describe("F7 answer — top_active / top_fresh intents", () => {
  it("最も活発 ⇒ highest momentum (mcp)", () => {
    const r = computeAnswer(snapshot("最も活発なプロトコルは？"));
    expect(r.intent).toBe("top_active");
    expect((r.data.most_active as { key: string }).key).toBe("mcp");
    expect(r.answer_text).toContain("Most active");
  });

  it("最も鮮度の高い ⇒ freshest ranking (mcp fresh first)", () => {
    const r = computeAnswer(snapshot("最も鮮度の高いプロトコルは？"));
    expect(r.intent).toBe("top_fresh");
    expect((r.data.freshest as { key: string; freshness: string }).key).toBe("mcp");
    expect((r.data.freshest as { freshness: string }).freshness).toBe("fresh");
  });

  it("top 2 active ⇒ respects explicit N", () => {
    const r = computeAnswer(snapshot("top 2 active protocols"));
    expect(r.intent).toBe("top_active");
    const top = r.data.top as Array<{ key: string }>;
    expect(top.length).toBe(2);
    expect(top[0]?.key).toBe("mcp");
  });
});

describe("F7 answer — unanswerable / edge cases", () => {
  it("gibberish ⇒ answered:false + supported_intents", () => {
    const r = computeAnswer(snapshot("お腹すいた lorem ipsum ?"));
    expect(r.answered).toBe(false);
    expect(r.intent).toBe(UNKNOWN_INTENT);
    expect(r.data.reason).toBe("no_intent_match");
    expect(r.supported_intents.map((s) => s.intent)).toContain("recent_changes");
  });

  it("empty query ⇒ answered:false with empty_query reason", () => {
    const r = computeAnswer(snapshot("   "));
    expect(r.answered).toBe(false);
    expect(r.intent).toBe(UNKNOWN_INTENT);
    expect(r.data.reason).toBe("empty_query");
  });

  it("empty protocol/event snapshot never throws (deterministic zeros)", () => {
    const r = computeAnswer({ q: "プロトコルは何個？", now: NOW, protocols: [], events: [] });
    expect(r.answered).toBe(true);
    expect(r.data.count).toBe(0);
    expect(r.answer_text).toContain("0 tracked protocols");
  });
});

describe("F7 answer — helper units", () => {
  it("findNamedProtocol prefers the longest / most specific match", () => {
    const protos = [proto("mcp"), proto("x402")];
    expect(findNamedProtocol("mcp latest?", protos)?.key).toBe("mcp");
    expect(findNamedProtocol("nothing here", protos)).toBeNull();
    // key must be a whole token, not a substring of another word.
    expect(findNamedProtocol("mcphotograph", protos)).toBeNull();
  });

  it("extractWindowDays parses keywords and explicit numbers", () => {
    expect(extractWindowDays("今日")).toBe(1);
    expect(extractWindowDays("今週")).toBe(7);
    expect(extractWindowDays("直近30日")).toBe(30);
    expect(extractWindowDays("last 14 days")).toBe(14);
    expect(extractWindowDays("recently changed")).toBe(7);
    expect(extractWindowDays("how many protocols")).toBeNull();
  });
});
