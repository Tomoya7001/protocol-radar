/**
 * Feature D1 — velocity / momentum metrics (pure computation layer).
 *
 * The product's edge is signal that only *continuous observation* can produce: how fast each
 * protocol is actually changing. A one-shot LLM query cannot answer "is this spec accelerating
 * or going dormant?" — but the accumulated event ledger can. This module turns the raw event
 * stream into stable, machine-readable per-protocol momentum indicators. It is a pure function
 * (events in, metrics out) with no DB, clock, or I/O access, so it is fully deterministic and
 * unit-testable; the route layer (src/app/api/velocity/route.ts) supplies the data and `now`.
 */

export type Trend = "accelerating" | "steady" | "cooling" | "dormant";

/** One ledger event, reduced to the fields momentum math needs. */
export interface VelocityEventInput {
  protocol_key: string;
  protocol_name: string;
  /** ISO-8601 UTC timestamp (events.created_at). Unparseable rows are ignored, never NaN. */
  created_at: string;
  type: string;
}

/** A known protocol, so zero-event protocols still appear (as dormant) in the output. */
export interface VelocityProtocolInput {
  key: string;
  name: string;
}

export interface ComputeVelocityInput {
  /** All tracked protocols (from getProtocolSummaries). Optional; defaults to []. */
  protocols?: VelocityProtocolInput[];
  /** Event feed across all protocols (from listEventsDto). Order does not matter. */
  events: VelocityEventInput[];
  /** "Now" as epoch-ms, so windows/freshness are deterministic and testable. */
  now: number;
}

export interface ProtocolVelocity {
  key: string;
  name: string;
  events_total: number;
  events_30d: number;
  events_90d: number;
  /** Whole days since the most recent change; null when the protocol has no events. */
  days_since_last_change: number | null;
  /** Mean interval (days) between the most recent events; null when < 2 dated events. */
  cadence_days: number | null;
  /** 0–100 activity+freshness index. Definition in computeMomentum() below. */
  momentum_score: number;
  trend: Trend;
}

export interface VelocitySummary {
  protocols_total: number;
  events_total: number;
  events_30d: number;
  events_90d: number;
  /** Highest-momentum protocol key (null when there are no protocols). */
  most_active: string | null;
  /** Most dormant protocol key — longest since last change (null when none). */
  most_dormant: string | null;
  accelerating_count: number;
  steady_count: number;
  cooling_count: number;
  dormant_count: number;
}

export interface VelocityReport {
  generated_at: string;
  protocols: ProtocolVelocity[];
  summary: VelocitySummary;
}

const DAY_MS = 86_400_000;
/** How many of the most-recent events feed the cadence (rolling average) estimate. */
const CADENCE_WINDOW = 5;
/** events_30d*2 + older-in-90d that saturates the activity component of momentum. */
const ACTIVITY_SATURATION = 12;

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * momentum_score (0–100) = round(100 * (0.6*recency + 0.4*activity)).
 *   recency  = clamp01(1 - days_since_last_change / 90)   — 0 when no events / >90d cold.
 *   activity = clamp01((events_30d*2 + (events_90d - events_30d)) / 12) — recent changes
 *              weighted double vs. those aged 30–90d; saturates at ACTIVITY_SATURATION.
 * A protocol changed today with several recent events approaches 100; a long-silent one → 0.
 */
function computeMomentum(
  daysSinceLast: number | null,
  events30d: number,
  events90d: number,
): number {
  const recency = daysSinceLast === null ? 0 : clamp01(1 - daysSinceLast / 90);
  const olderInWindow = events90d - events30d; // ≥ 0: 30d is a subset of 90d
  const activity = clamp01(
    (events30d * 2 + olderInWindow) / ACTIVITY_SATURATION,
  );
  return Math.round(100 * (0.6 * recency + 0.4 * activity));
}

/**
 * trend, from the last-30d rate vs. the prior 30–90d rate (per-day):
 *   dormant       — no events in the last 90 days.
 *   cooling       — events in the 30–90d window but none in the last 30d,
 *                   or the recent rate fell to ≤ 50% of the prior rate.
 *   accelerating  — recent rate ≥ 150% of the prior rate (or a fresh burst from silence).
 *   steady        — everything in between.
 */
function computeTrend(events30d: number, events90d: number): Trend {
  if (events90d === 0) return "dormant";
  if (events30d === 0) return "cooling";
  const recentRate = events30d / 30;
  const priorRate = (events90d - events30d) / 60;
  if (priorRate === 0) return events30d >= 2 ? "accelerating" : "steady";
  if (recentRate >= priorRate * 1.5) return "accelerating";
  if (recentRate <= priorRate * 0.5) return "cooling";
  return "steady";
}

interface Bucket {
  key: string;
  name: string;
  /** Event timestamps (epoch-ms), finite only. Sorted descending before metrics. */
  times: number[];
}

function computeProtocol(bucket: Bucket, now: number): ProtocolVelocity {
  const times = bucket.times.slice().sort((a, b) => b - a); // newest first
  const eventsTotal = times.length;

  let events30d = 0;
  let events90d = 0;
  for (const t of times) {
    const age = now - t;
    if (age <= 30 * DAY_MS) events30d += 1;
    if (age <= 90 * DAY_MS) events90d += 1;
  }

  const newest = times[0]; // undefined when there are no events
  const daysSinceLast =
    newest === undefined
      ? null
      : Math.max(0, Math.round((now - newest) / DAY_MS));

  // Cadence: mean gap (days) across up to CADENCE_WINDOW most-recent events.
  let cadenceDays: number | null = null;
  const recent = times.slice(0, CADENCE_WINDOW);
  if (recent.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      const newer = recent[i - 1];
      const older = recent[i];
      if (newer === undefined || older === undefined) continue;
      gaps.push((newer - older) / DAY_MS);
    }
    if (gaps.length > 0) {
      const total = gaps.reduce((sum, g) => sum + g, 0);
      cadenceDays = round1(total / gaps.length);
    }
  }

  return {
    key: bucket.key,
    name: bucket.name,
    events_total: eventsTotal,
    events_30d: events30d,
    events_90d: events90d,
    days_since_last_change: daysSinceLast,
    cadence_days: cadenceDays,
    momentum_score: computeMomentum(daysSinceLast, events30d, events90d),
    trend: computeTrend(events30d, events90d),
  };
}

/** Pure metrics builder: events + known protocols + now ⇒ stable velocity report. */
export function computeVelocity(input: ComputeVelocityInput): VelocityReport {
  const { events, now } = input;
  const protocols = input.protocols ?? [];

  const buckets = new Map<string, Bucket>();
  for (const p of protocols) {
    if (!buckets.has(p.key)) {
      buckets.set(p.key, { key: p.key, name: p.name, times: [] });
    }
  }
  for (const e of events) {
    let bucket = buckets.get(e.protocol_key);
    if (bucket === undefined) {
      bucket = { key: e.protocol_key, name: e.protocol_name, times: [] };
      buckets.set(e.protocol_key, bucket);
    }
    const t = Date.parse(e.created_at);
    if (Number.isFinite(t)) bucket.times.push(t);
  }

  const list = Array.from(buckets.values()).map((b) => computeProtocol(b, now));

  // Stable ordering: momentum desc, then more recent activity, then key asc.
  list.sort(
    (a, b) =>
      b.momentum_score - a.momentum_score ||
      b.events_30d - a.events_30d ||
      a.key.localeCompare(b.key),
  );

  const summary = buildSummary(list);

  return {
    generated_at: new Date(now).toISOString(),
    protocols: list,
    summary,
  };
}

function buildSummary(list: ProtocolVelocity[]): VelocitySummary {
  let events_total = 0;
  let events_30d = 0;
  let events_90d = 0;
  let accelerating = 0;
  let steady = 0;
  let cooling = 0;
  let dormant = 0;

  for (const p of list) {
    events_total += p.events_total;
    events_30d += p.events_30d;
    events_90d += p.events_90d;
    if (p.trend === "accelerating") accelerating += 1;
    else if (p.trend === "steady") steady += 1;
    else if (p.trend === "cooling") cooling += 1;
    else dormant += 1;
  }

  // list is momentum-sorted, so the first entry is the most active.
  const first = list[0];
  const most_active = first === undefined ? null : first.key;

  // Most dormant: longest since last change; a null (no events) counts as maximally dormant.
  let most_dormant: string | null = null;
  let worst = -1;
  for (const p of list) {
    const dormancy =
      p.days_since_last_change === null
        ? Number.POSITIVE_INFINITY
        : p.days_since_last_change;
    if (dormancy > worst) {
      worst = dormancy;
      most_dormant = p.key;
    }
  }

  return {
    protocols_total: list.length,
    events_total,
    events_30d,
    events_90d,
    most_active,
    most_dormant,
    accelerating_count: accelerating,
    steady_count: steady,
    cooling_count: cooling,
    dormant_count: dormant,
  };
}
