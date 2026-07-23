/**
 * Feature F7 — deterministic Q&A engine (pure computation layer).
 *
 * The product accumulates a change ledger through continuous observation. This module turns a
 * natural-language-ish query string into a CONFIDENT, reproducible answer by keyword/regex
 * intent matching over that already-aggregated data — NO LLM, NO network, NO clock, NO DB.
 * It is a pure function (query + snapshot + `now` in, structured answer out) so it is fully
 * deterministic and unit-testable offline; the route layer (src/app/api/answer/route.ts)
 * supplies the data and `now`.
 *
 * Nothing here mutates state. All array indexing is guarded for strict/noUncheckedIndexedAccess.
 */

const DAY_MS = 86_400_000;

/** Per-protocol snapshot the engine reasons over (merged from summaries + velocity). */
export interface AnswerProtocolInput {
  key: string;
  name: string;
  /** protocols.status — "active" | "inactive" | "vanished". */
  status: string;
  /** aggregated freshness — "fresh" | "stale" | "pending" | "vanished" | "unknown". */
  freshness: string;
  stale_warning: boolean;
  event_count: number;
  last_event: {
    type: string;
    summary: string | null;
    created_at: string;
  } | null;
  /** velocity momentum_score (0–100); 0 when unknown. */
  momentum_score: number;
  /** velocity trend — "accelerating" | "steady" | "cooling" | "dormant". */
  trend: string;
  /** whole days since the most recent change; null when no events. */
  days_since_last_change: number | null;
}

/** One ledger event reduced to the fields the engine needs. */
export interface AnswerEventInput {
  protocol_key: string;
  protocol_name: string;
  type: string;
  summary: string | null;
  /** ISO-8601 UTC timestamp; unparseable rows are ignored, never NaN. */
  created_at: string;
}

export interface ComputeAnswerInput {
  /** The raw `?q=` query string (may be empty). */
  q: string;
  /** All tracked protocols (deterministically ordered by the caller). */
  protocols: AnswerProtocolInput[];
  /** Cross-protocol event feed. Order does not matter. */
  events: AnswerEventInput[];
  /** "Now" as epoch-ms so time-window intents are deterministic. */
  now: number;
}

/** A machine-readable description of one supported intent (always returned). */
export interface SupportedIntent {
  intent: string;
  description: string;
  examples: string[];
}

export interface AnswerResult {
  q: string;
  answered: boolean;
  intent: string;
  answer_text: string;
  data: Record<string, unknown>;
  supported_intents: SupportedIntent[];
}

/** The stable catalogue of intents this engine can answer (part of the API contract). */
export const SUPPORTED_INTENTS: SupportedIntent[] = [
  {
    intent: "recent_changes",
    description:
      "Protocols that changed within a time window (today / this week / last N days).",
    examples: ["今週変わったプロトコルは？", "protocols changed in the last 7 days", "今日変わったのは？"],
  },
  {
    intent: "filter_status",
    description:
      "Protocols filtered by status or freshness (active / inactive / vanished / stale / fresh / pending / dormant).",
    examples: ["stale なプロトコルは？", "which protocols are dormant?", "active なプロトコル"],
  },
  {
    intent: "latest_change",
    description:
      "The latest change for a named protocol (or the most recent change across all protocols).",
    examples: ["mcp の最新変更は？", "latest change for x402", "最新の変更は？"],
  },
  {
    intent: "count_list",
    description: "How many protocols are tracked, and their keys.",
    examples: ["プロトコルは何個？", "list all protocols", "how many protocols?"],
  },
  {
    intent: "top_active",
    description: "The most active protocol(s) ranked by momentum.",
    examples: ["最も活発なプロトコルは？", "most active protocol", "top active protocols"],
  },
  {
    intent: "top_fresh",
    description: "The freshest protocol(s) ranked by freshness and recency.",
    examples: ["最も鮮度の高いプロトコルは？", "freshest protocol"],
  },
];

/** Intent identifier returned when nothing matches. */
export const UNKNOWN_INTENT = "unknown";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMs(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Find the protocol a query names, if any. Matches a name as a case-insensitive substring, or a
 * key as a whole token (bounded by non-alphanumerics), and prefers the LONGEST match so the more
 * specific reference wins. Returns null when no protocol is referenced.
 */
export function findNamedProtocol(
  q: string,
  protocols: AnswerProtocolInput[],
): AnswerProtocolInput | null {
  const lq = q.toLowerCase();
  let best: AnswerProtocolInput | null = null;
  let bestLen = 0;

  for (const p of protocols) {
    const name = p.name.toLowerCase();
    if (name.length > bestLen && lq.includes(name)) {
      best = p;
      bestLen = name.length;
    }
    const key = p.key.toLowerCase();
    if (key.length > 0) {
      const keyRe = new RegExp(`(^|[^a-z0-9])${escapeRegExp(key)}([^a-z0-9]|$)`);
      if (key.length > bestLen && keyRe.test(lq)) {
        best = p;
        bestLen = key.length;
      }
    }
  }
  return best;
}

/** Extract an explicit day-window from the query, defaulting per keyword. Returns null if none. */
export function extractWindowDays(q: string): number | null {
  const lq = q.toLowerCase();

  // "today" / "今日" ⇒ 1 day.
  if (/今日|\btoday\b/.test(lq)) return 1;
  // "this week" / "今週" ⇒ 7 days.
  if (/今週|this\s*week/.test(lq)) return 7;

  // Explicit "N 日" / "last N days" / "past N days" / "直近 N 日".
  const jp = lq.match(/(\d+)\s*日/);
  if (jp && jp[1] !== undefined) {
    const n = Number(jp[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const en = lq.match(/(?:last|past|直近|recent)\s*(\d+)\s*(?:days?)?/);
  if (en && en[1] !== undefined) {
    const n = Number(en[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }

  // Bare recency keywords ⇒ a 7-day default window.
  if (/直近|最近|recent|recently|変わった|変更があった|changed/.test(lq)) return 7;

  return null;
}

const STATUS_FRESHNESS_TERMS: Array<{
  re: RegExp;
  label: string;
  match: (p: AnswerProtocolInput) => boolean;
}> = [
  { re: /\bactive\b|アクティブ|稼働/, label: "active", match: (p) => p.status === "active" },
  { re: /\binactive\b|非アクティブ|停止/, label: "inactive", match: (p) => p.status === "inactive" },
  { re: /\bvanished\b|消滅/, label: "vanished", match: (p) => p.status === "vanished" || p.freshness === "vanished" },
  { re: /\bstale\b|停滞|陳腐/, label: "stale", match: (p) => p.freshness === "stale" || p.stale_warning },
  { re: /\bfresh\b|新鮮/, label: "fresh", match: (p) => p.freshness === "fresh" },
  { re: /\bpending\b|保留/, label: "pending", match: (p) => p.freshness === "pending" },
  { re: /\bdormant\b|休眠|活動停止/, label: "dormant", match: (p) => p.trend === "dormant" },
];

function detectStatusTerm(q: string): (typeof STATUS_FRESHNESS_TERMS)[number] | null {
  const lq = q.toLowerCase();
  for (const term of STATUS_FRESHNESS_TERMS) {
    if (term.re.test(lq)) return term;
  }
  return null;
}

function hasLatestKeyword(q: string): boolean {
  return /最新|直近の変更|最近の変更|latest|most\s*recent/.test(q.toLowerCase());
}

function hasSuperlative(q: string): boolean {
  return /最も|一番|most|top|highest|上位/.test(q.toLowerCase());
}

function wantsFreshRanking(q: string): boolean {
  return /鮮度|freshest|fresh|新鮮/.test(q.toLowerCase());
}

function hasCountListKeyword(q: string): boolean {
  return /何個|何件|いくつ|幾つ|一覧|リスト|全部で|\blist\b|how\s*many|number\s*of|\bcount\b/.test(
    q.toLowerCase(),
  );
}

function freshnessRank(f: string): number {
  switch (f) {
    case "fresh":
      return 0;
    case "pending":
      return 1;
    case "stale":
      return 2;
    case "unknown":
      return 3;
    case "vanished":
      return 4;
    default:
      return 5;
  }
}

/** Deterministic result envelope helper. */
function result(
  q: string,
  answered: boolean,
  intent: string,
  answer_text: string,
  data: Record<string, unknown>,
): AnswerResult {
  return { q, answered, intent, answer_text, data, supported_intents: SUPPORTED_INTENTS };
}

function unanswered(q: string): AnswerResult {
  return result(
    q,
    false,
    UNKNOWN_INTENT,
    "Could not determine the intent of this query. See supported_intents for what can be asked.",
    { reason: q.trim() === "" ? "empty_query" : "no_intent_match" },
  );
}

// ---------------------------------------------------------------------------
// Intent handlers
// ---------------------------------------------------------------------------

function answerRecentChanges(input: ComputeAnswerInput, windowDays: number): AnswerResult {
  const { q, protocols, events, now } = input;
  const cutoff = now - windowDays * DAY_MS;

  const changedKeys = new Set<string>();
  const counts = new Map<string, number>();
  for (const e of events) {
    const t = parseMs(e.created_at);
    // Window is inclusive of `now` but exclusive of the far edge, so an event exactly
    // `windowDays` old (e.g. 24h ago for a 1-day "today" window) is NOT counted.
    if (t === null || t <= cutoff || t > now) continue;
    changedKeys.add(e.protocol_key);
    counts.set(e.protocol_key, (counts.get(e.protocol_key) ?? 0) + 1);
  }

  const nameByKey = new Map(protocols.map((p) => [p.key, p.name]));
  const changed = Array.from(changedKeys)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key,
      name: nameByKey.get(key) ?? key,
      events_in_window: counts.get(key) ?? 0,
    }));

  const answer_text =
    changed.length === 0
      ? `No protocols changed in the last ${windowDays} day(s).`
      : `${changed.length} protocol(s) changed in the last ${windowDays} day(s): ${changed
          .map((c) => c.key)
          .join(", ")}.`;

  return result(q, true, "recent_changes", answer_text, {
    window_days: windowDays,
    count: changed.length,
    protocols: changed,
  });
}

function answerFilterStatus(
  input: ComputeAnswerInput,
  term: (typeof STATUS_FRESHNESS_TERMS)[number],
): AnswerResult {
  const { q, protocols } = input;
  const matched = protocols
    .filter((p) => term.match(p))
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => ({
      key: p.key,
      name: p.name,
      status: p.status,
      freshness: p.freshness,
      trend: p.trend,
    }));

  const answer_text =
    matched.length === 0
      ? `No protocols match '${term.label}'.`
      : `${matched.length} protocol(s) match '${term.label}': ${matched.map((m) => m.key).join(", ")}.`;

  return result(q, true, "filter_status", answer_text, {
    filter: term.label,
    count: matched.length,
    protocols: matched,
  });
}

function answerLatestChange(
  input: ComputeAnswerInput,
  named: AnswerProtocolInput | null,
): AnswerResult {
  const { q, protocols, events } = input;

  if (named !== null) {
    const last = named.last_event;
    const answer_text =
      last === null
        ? `${named.key} (${named.name}) has no recorded changes yet.`
        : `The latest change for ${named.key} (${named.name}) is a ${last.type} on ${last.created_at}${
            last.summary ? `: ${last.summary}` : ""
          }.`;
    return result(q, true, "latest_change", answer_text, {
      protocol: { key: named.key, name: named.name },
      last_event: last,
    });
  }

  // No named protocol ⇒ most recent change across all protocols.
  let newest: AnswerEventInput | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    const t = parseMs(e.created_at);
    if (t === null) continue;
    if (t > newestMs) {
      newestMs = t;
      newest = e;
    }
  }

  if (newest === null) {
    return result(q, true, "latest_change", "No changes have been recorded yet.", {
      protocol: null,
      last_event: null,
      protocols_total: protocols.length,
    });
  }

  const answer_text = `The most recent change across all protocols is a ${newest.type} for ${newest.protocol_key} (${newest.protocol_name}) on ${newest.created_at}${
    newest.summary ? `: ${newest.summary}` : ""
  }.`;
  return result(q, true, "latest_change", answer_text, {
    protocol: { key: newest.protocol_key, name: newest.protocol_name },
    last_event: {
      type: newest.type,
      summary: newest.summary,
      created_at: newest.created_at,
    },
  });
}

function answerCountList(input: ComputeAnswerInput): AnswerResult {
  const { q, protocols } = input;
  const keys = protocols.map((p) => p.key).slice().sort((a, b) => a.localeCompare(b));
  const answer_text =
    keys.length === 0
      ? "There are 0 tracked protocols."
      : `There are ${keys.length} tracked protocols: ${keys.join(", ")}.`;
  return result(q, true, "count_list", answer_text, {
    count: keys.length,
    keys,
    protocols: protocols
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((p) => ({ key: p.key, name: p.name, status: p.status })),
  });
}

function answerTopActive(input: ComputeAnswerInput, topN: number): AnswerResult {
  const { q, protocols } = input;
  const ranked = protocols
    .slice()
    .sort(
      (a, b) =>
        b.momentum_score - a.momentum_score ||
        (a.days_since_last_change ?? Number.POSITIVE_INFINITY) -
          (b.days_since_last_change ?? Number.POSITIVE_INFINITY) ||
        a.key.localeCompare(b.key),
    )
    .map((p) => ({
      key: p.key,
      name: p.name,
      momentum_score: p.momentum_score,
      trend: p.trend,
    }));

  const top = ranked.slice(0, Math.max(1, topN));
  const best = top[0] ?? null;
  const answer_text =
    best === null
      ? "No protocols are tracked yet."
      : `Most active protocol: ${best.key} (${best.name}), momentum ${best.momentum_score}.`;

  return result(q, true, "top_active", answer_text, {
    top,
    most_active: best,
  });
}

function answerTopFresh(input: ComputeAnswerInput, topN: number): AnswerResult {
  const { q, protocols } = input;
  const ranked = protocols
    .slice()
    .sort(
      (a, b) =>
        freshnessRank(a.freshness) - freshnessRank(b.freshness) ||
        (a.days_since_last_change ?? Number.POSITIVE_INFINITY) -
          (b.days_since_last_change ?? Number.POSITIVE_INFINITY) ||
        a.key.localeCompare(b.key),
    )
    .map((p) => ({
      key: p.key,
      name: p.name,
      freshness: p.freshness,
      days_since_last_change: p.days_since_last_change,
    }));

  const top = ranked.slice(0, Math.max(1, topN));
  const best = top[0] ?? null;
  const answer_text =
    best === null
      ? "No protocols are tracked yet."
      : `Freshest protocol: ${best.key} (${best.name}), freshness ${best.freshness}.`;

  return result(q, true, "top_fresh", answer_text, {
    top,
    freshest: best,
  });
}

function extractTopN(q: string): number {
  const m = q.toLowerCase().match(/(?:top|上位)\s*(\d+)/);
  if (m && m[1] !== undefined) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return 3;
}

/**
 * Core deterministic dispatcher. Intents are tried in priority order (most specific first):
 *   latest_change → top_active/top_fresh → recent_changes → filter_status → count_list.
 * Anything unmatched returns answered:false plus the supported-intent catalogue.
 */
export function computeAnswer(input: ComputeAnswerInput): AnswerResult {
  const q = input.q ?? "";
  if (q.trim() === "") return unanswered(q);

  const named = findNamedProtocol(q, input.protocols);

  // 1) latest_change — "X の最新変更は？" (named) or a bare "最新の変更は？" (global).
  if (hasLatestKeyword(q)) {
    return answerLatestChange(input, named);
  }

  // 2) superlative rankings — "最も活発/鮮度の高い / most active / top N".
  if (hasSuperlative(q) && !hasCountListKeyword(q)) {
    const topN = extractTopN(q);
    if (wantsFreshRanking(q)) return answerTopFresh(input, topN);
    // Default superlative is momentum-based activity.
    return answerTopActive(input, topN);
  }

  // 3) recent_changes — any time-window phrasing.
  const windowDays = extractWindowDays(q);
  if (windowDays !== null) {
    return answerRecentChanges(input, windowDays);
  }

  // 4) filter_status — status/freshness keyword present.
  const term = detectStatusTerm(q);
  if (term !== null) {
    return answerFilterStatus(input, term);
  }

  // 5) count_list — "何個 / 一覧 / list / how many".
  if (hasCountListKeyword(q)) {
    return answerCountList(input);
  }

  return unanswered(q);
}
