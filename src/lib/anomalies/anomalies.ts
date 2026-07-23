/**
 * Feature E2 — anomaly feed (pure computation layer).
 *
 * The ledger's value is that it *remembers*: a one-shot LLM query can't tell you which protocol
 * just woke from months of silence, or which one is churning three specs a week. This module
 * scans the accumulated event history and extracts the notable / abnormal patterns worth a
 * human's attention. It is a pure function (events + known protocols + `now` ⇒ anomalies) with
 * no DB, clock, or I/O access, so it is fully deterministic and unit-testable; the route layer
 * (src/app/api/anomalies/route.ts) supplies the data and `now`.
 *
 * Baseline activity metrics (events_30d / events_90d / days_since_last_change) are reused from
 * the D1 velocity layer via computeVelocity() — this module never re-implements that math.
 */

import {
  computeVelocity,
  type ProtocolVelocity,
  type VelocityEventInput,
  type VelocityProtocolInput,
} from "@/lib/velocity/velocity";

/** One ledger event, reduced to the fields anomaly detection needs. */
export interface AnomalyEventInput {
  protocol_key: string;
  protocol_name: string;
  /** ISO-8601 UTC timestamp (events.created_at). Unparseable rows are ignored, never NaN. */
  created_at: string;
  /** Event type ("appeared" | "version_bump" | "spec_change" | "vanished"). */
  type: string;
}

/** A known protocol (so zero-event protocols still feed the velocity baseline). */
export interface AnomalyProtocolInput {
  key: string;
  name: string;
}

export interface ComputeAnomaliesInput {
  /** All tracked protocols (from getProtocolSummaries). Optional; defaults to []. */
  protocols?: AnomalyProtocolInput[];
  /** Event feed across all protocols (from listEventsDto). Order does not matter. */
  events: AnomalyEventInput[];
  /** "Now" as epoch-ms, so windows are deterministic and testable. */
  now: number;
}

export type AnomalyKind = "spike" | "dormancy_break" | "vanished" | "rapid_churn";

export type Severity = "info" | "notable" | "high";

export interface Anomaly {
  key: string;
  name: string;
  kind: AnomalyKind;
  severity: Severity;
  /** ISO-8601 timestamp of the event that triggered the anomaly (real ledger data). */
  detected_at: string;
  /** Human-readable one-liner describing the pattern. */
  detail: string;
  /** Related numeric evidence for the detection (thresholds/counts). */
  evidence: Record<string, number>;
}

export interface AnomalyReport {
  generated_at: string;
  count: number;
  anomalies: Anomaly[];
}

const DAY_MS = 86_400_000;

// --- Detection thresholds (explicit constants; no magic in the logic below) ---

/** spike: window over which "recent" activity is measured. */
const SPIKE_WINDOW_DAYS = 7;
/** spike: recent per-day rate must be at least this multiple of the 30–90d baseline rate. */
const SPIKE_RATIO = 3;
/** spike: minimum recent-window event count required to fire (guards tiny-sample noise). */
const SPIKE_MIN_EVENTS = 2;
/** spike: ratio at/above which the anomaly is escalated to "high". */
const SPIKE_HIGH_RATIO = 5;

/** dormancy_break: a gap of at least this many days before the newest event counts as dormancy. */
const DORMANCY_DAYS = 30;
/** dormancy_break: the reawakening event must have occurred within this many days of `now`. */
const DORMANCY_RECENT_DAYS = 30;

/** rapid_churn: window over which version_bump/spec_change events are counted. */
const CHURN_WINDOW_DAYS = 7;
/** rapid_churn: minimum version_bump/spec_change events in the window to fire. */
const CHURN_MIN_EVENTS = 3;
/** rapid_churn: count at/above which the anomaly is escalated to "high". */
const CHURN_HIGH_EVENTS = 5;

const SEVERITY_RANK: Record<Severity, number> = { info: 0, notable: 1, high: 2 };

const CHURN_TYPES = new Set(["version_bump", "spec_change"]);

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function isoOf(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

interface Entry {
  t: number;
  type: string;
}

interface Bucket {
  key: string;
  name: string;
  /** Finite-timestamp events for this protocol; sorted newest-first before detection. */
  entries: Entry[];
}

/** spike: recent 7d per-day rate ≥ SPIKE_RATIO× the 30–90d baseline, and ≥ SPIKE_MIN_EVENTS. */
function detectSpike(
  bucket: Bucket,
  metrics: ProtocolVelocity,
  newest: Entry,
  now: number,
): Anomaly | null {
  let events7d = 0;
  for (const e of bucket.entries) {
    if (now - e.t <= SPIKE_WINDOW_DAYS * DAY_MS) events7d += 1;
  }
  if (events7d < SPIKE_MIN_EVENTS) return null;

  // Baseline = the 30–90d window (excludes the last 30d), as a per-day rate.
  const baselineCount = metrics.events_90d - metrics.events_30d;
  const baselineDaily = baselineCount / 60;
  if (baselineDaily <= 0) return null; // no prior activity to spike above

  const recentDaily = events7d / SPIKE_WINDOW_DAYS;
  const ratio = recentDaily / baselineDaily;
  if (ratio < SPIKE_RATIO) return null;

  const severity: Severity = ratio >= SPIKE_HIGH_RATIO ? "high" : "notable";
  return {
    key: bucket.key,
    name: bucket.name,
    kind: "spike",
    severity,
    detected_at: isoOf(newest.t),
    detail: `${bucket.name} の直近${SPIKE_WINDOW_DAYS}日の活動 (${events7d}件) がベースライン日次レートの約${round2(ratio)}倍に急増しています`,
    evidence: {
      events_7d: events7d,
      events_30d: metrics.events_30d,
      events_90d: metrics.events_90d,
      baseline_daily: round2(baselineDaily),
      ratio: round2(ratio),
    },
  };
}

/**
 * dormancy_break: newest event follows a ≥DORMANCY_DAYS gap and is itself recent.
 *
 * A "vanished" newest event means the source disappeared — that is a *disappearance*, not a
 * reawakening, so it is reported by detectVanished (high severity) and must NOT double-fire as
 * a dormancy break here.
 */
function detectDormancyBreak(
  bucket: Bucket,
  newest: Entry,
  now: number,
): Anomaly | null {
  if (newest.type === "vanished") return null;

  const prev = bucket.entries[1];
  if (prev === undefined) return null;

  const gapDays = (newest.t - prev.t) / DAY_MS;
  const daysSinceLast = (now - newest.t) / DAY_MS;
  if (gapDays < DORMANCY_DAYS || daysSinceLast > DORMANCY_RECENT_DAYS) return null;

  return {
    key: bucket.key,
    name: bucket.name,
    kind: "dormancy_break",
    severity: "notable",
    detected_at: isoOf(newest.t),
    detail: `${bucket.name} が約${Math.round(gapDays)}日間の休眠から新規イベントで再始動しました`,
    evidence: {
      gap_days: Math.round(gapDays),
      days_since_last_change: Math.round(daysSinceLast),
      dormancy_threshold_days: DORMANCY_DAYS,
    },
  };
}

/** vanished: the most recent event's type is "vanished" (the source disappeared). */
function detectVanished(
  bucket: Bucket,
  newest: Entry,
  now: number,
): Anomaly | null {
  if (newest.type !== "vanished") return null;
  return {
    key: bucket.key,
    name: bucket.name,
    kind: "vanished",
    severity: "high",
    detected_at: isoOf(newest.t),
    detail: `${bucket.name} の最新イベントが消失 (vanished) — ソースが観測できなくなりました`,
    evidence: {
      events_total: bucket.entries.length,
      days_since_last_change: Math.round((now - newest.t) / DAY_MS),
    },
  };
}

/** rapid_churn: ≥CHURN_MIN_EVENTS version_bump/spec_change events within CHURN_WINDOW_DAYS. */
function detectRapidChurn(bucket: Bucket, now: number): Anomaly | null {
  let churn = 0;
  let churnNewest: number | null = null;
  for (const e of bucket.entries) {
    if (now - e.t <= CHURN_WINDOW_DAYS * DAY_MS && CHURN_TYPES.has(e.type)) {
      churn += 1;
      if (churnNewest === null || e.t > churnNewest) churnNewest = e.t;
    }
  }
  if (churn < CHURN_MIN_EVENTS || churnNewest === null) return null;

  const severity: Severity = churn >= CHURN_HIGH_EVENTS ? "high" : "notable";
  return {
    key: bucket.key,
    name: bucket.name,
    kind: "rapid_churn",
    severity,
    detected_at: isoOf(churnNewest),
    detail: `${bucket.name} で直近${CHURN_WINDOW_DAYS}日に version_bump/spec_change が${churn}件集中しています`,
    evidence: {
      churn_7d: churn,
      window_days: CHURN_WINDOW_DAYS,
    },
  };
}

/**
 * Pure anomaly builder: events + known protocols + now ⇒ stable anomaly report.
 * Sorted severity desc, then detected_at desc, then key/kind asc for full determinism.
 */
export function computeAnomalies(input: ComputeAnomaliesInput): AnomalyReport {
  const { events, now } = input;
  const protocols = input.protocols ?? [];

  // Reuse the D1 velocity metrics as the activity baseline (events_30d/90d, freshness).
  const velocity = computeVelocity({
    now,
    protocols: protocols as VelocityProtocolInput[],
    events: events as VelocityEventInput[],
  });
  const metricsByKey = new Map<string, ProtocolVelocity>();
  for (const p of velocity.protocols) metricsByKey.set(p.key, p);

  // Raw per-protocol event buckets (finite timestamps only).
  const buckets = new Map<string, Bucket>();
  for (const e of events) {
    const t = Date.parse(e.created_at);
    if (!Number.isFinite(t)) continue;
    let bucket = buckets.get(e.protocol_key);
    if (bucket === undefined) {
      bucket = { key: e.protocol_key, name: e.protocol_name, entries: [] };
      buckets.set(e.protocol_key, bucket);
    }
    bucket.entries.push({ t, type: e.type });
  }

  const anomalies: Anomaly[] = [];
  for (const bucket of buckets.values()) {
    bucket.entries.sort((a, b) => b.t - a.t); // newest first
    const newest = bucket.entries[0];
    if (newest === undefined) continue; // no dated events → nothing to detect

    const metrics = metricsByKey.get(bucket.key);
    if (metrics === undefined) continue; // velocity always buckets an event's protocol

    const spike = detectSpike(bucket, metrics, newest, now);
    if (spike !== null) anomalies.push(spike);

    const dormancy = detectDormancyBreak(bucket, newest, now);
    if (dormancy !== null) anomalies.push(dormancy);

    const vanished = detectVanished(bucket, newest, now);
    if (vanished !== null) anomalies.push(vanished);

    const churn = detectRapidChurn(bucket, now);
    if (churn !== null) anomalies.push(churn);
  }

  anomalies.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      Date.parse(b.detected_at) - Date.parse(a.detected_at) ||
      a.key.localeCompare(b.key) ||
      a.kind.localeCompare(b.kind),
  );

  return {
    generated_at: isoOf(now),
    count: anomalies.length,
    anomalies,
  };
}
