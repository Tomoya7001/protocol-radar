/**
 * Feature H1 — cross-protocol leaderboard (pure computation layer).
 *
 * Ranks every tracked protocol by a single composite "activity" score so the product can answer
 * "which protocols are moving right now?" in one place. Like the velocity module, this is a pure
 * function: protocol summaries + their events + `now` go in, a ranked list comes out. There is no
 * DB, clock, env, or I/O access — the route layer (src/app/api/leaderboard/route.ts) injects the
 * data and `now`, which keeps the ranking fully deterministic and unit-testable.
 *
 * COMPOSITE SCORE (0–100) — a documented, deterministic blend of three signals:
 *
 *   score_raw = 100 * ( ACTIVITY_WEIGHT  * activity
 *                     + MOMENTUM_WEIGHT  * momentum
 *                     + FRESHNESS_WEIGHT * freshness )
 *   score     = round( score_raw * (stale ? STALE_PENALTY : 1) )
 *
 *   • activity  — recent change volume.
 *                 clamp01(events_30d / ACTIVITY_SATURATION). Saturates so a burst of changes
 *                 cannot dominate the blend outright.
 *   • momentum  — acceleration of the recent rate vs. the prior 30–90d rate.
 *                 recentRate = events_30d / 30, priorRate = (events_90d - events_30d) / 60.
 *                 No prior activity  ⇒ 1 if there is a fresh burst (events_30d > 0), else 0.
 *                 Otherwise momentum = clamp01(recentRate / priorRate - 0.5):
 *                 steady (ratio 1.0) → 0.5, accelerating (ratio ≥ 1.5) → 1, cooling (≤ 0.5) → 0.
 *   • freshness — observation recency; penalises stale/cold protocols.
 *                 clamp01(1 - days_since_last_change / FRESHNESS_HORIZON_DAYS); 0 when a protocol
 *                 has never produced an event or its last change is older than the horizon.
 *
 * A protocol explicitly flagged stale by the read layer is additionally scaled by STALE_PENALTY,
 * so a stale protocol always ranks below an otherwise-identical fresh one. A protocol with zero
 * activity, no momentum and no fresh observation scores 0 and therefore sorts last.
 *
 * Ranking is stable and deterministic: score descending, then key ascending (lexicographic).
 */

/** The tunable blend — exported so callers/tests can reference the exact weighting. */
export const ACTIVITY_WEIGHT = 0.5;
export const MOMENTUM_WEIGHT = 0.3;
export const FRESHNESS_WEIGHT = 0.2;
/** events_30d that saturates the activity component (reaches 1.0). */
export const ACTIVITY_SATURATION = 8;
/** Days since the last change beyond which the freshness component decays to 0. */
export const FRESHNESS_HORIZON_DAYS = 90;
/** Multiplier applied to the raw score when the read layer flags the protocol stale. */
export const STALE_PENALTY = 0.5;

const DAY_MS = 86_400_000;

/** A tracked protocol. `stale` mirrors the read layer's stale_warning (freshness signal). */
export interface LeaderboardProtocolInput {
  key: string;
  name: string;
  stale: boolean;
}

/** One ledger event, reduced to the fields the ranking needs. */
export interface LeaderboardEventInput {
  protocol_key: string;
  /** ISO-8601 UTC timestamp (events.created_at). Unparseable rows are ignored, never NaN. */
  created_at: string;
}

export interface BuildLeaderboardInput {
  /** All tracked protocols (from getProtocolSummaries). Optional; defaults to []. */
  protocols?: LeaderboardProtocolInput[];
  /** Event feed across all protocols (from listEventsDto). Order does not matter. */
  events: LeaderboardEventInput[];
}

/** The three normalised (0–1) signals that make up a protocol's composite score. */
export interface ScoreComponents {
  activity: number;
  momentum: number;
  freshness: number;
}

export interface LeaderboardEntry {
  rank: number;
  key: string;
  name: string;
  /** Composite 0–100 score (see module doc). Deterministic; integer. */
  score: number;
  events_30d: number;
  events_90d: number;
  /** Whole days since the most recent change; null when the protocol has no events. */
  days_since_last_change: number | null;
  stale: boolean;
  components: ScoreComponents;
}

export interface Leaderboard {
  generated_at: string;
  entries: LeaderboardEntry[];
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function activityComponent(events30d: number): number {
  return clamp01(events30d / ACTIVITY_SATURATION);
}

function momentumComponent(events30d: number, events90d: number): number {
  const recentRate = events30d / 30;
  const priorRate = (events90d - events30d) / 60; // 30d ⊂ 90d ⇒ ≥ 0
  if (priorRate === 0) return events30d > 0 ? 1 : 0;
  return clamp01(recentRate / priorRate - 0.5);
}

function freshnessComponent(daysSinceLast: number | null): number {
  if (daysSinceLast === null) return 0;
  return clamp01(1 - daysSinceLast / FRESHNESS_HORIZON_DAYS);
}

interface Bucket {
  key: string;
  name: string;
  stale: boolean;
  /** Event timestamps (epoch-ms), finite only. */
  times: number[];
}

function computeEntry(
  bucket: Bucket,
  now: number,
): Omit<LeaderboardEntry, "rank"> {
  let events30d = 0;
  let events90d = 0;
  let newest: number | null = null;
  for (const t of bucket.times) {
    const age = now - t;
    if (age <= 30 * DAY_MS) events30d += 1;
    if (age <= 90 * DAY_MS) events90d += 1;
    if (newest === null || t > newest) newest = t;
  }

  const daysSinceLast =
    newest === null ? null : Math.max(0, Math.round((now - newest) / DAY_MS));

  const components: ScoreComponents = {
    activity: round3(activityComponent(events30d)),
    momentum: round3(momentumComponent(events30d, events90d)),
    freshness: round3(freshnessComponent(daysSinceLast)),
  };

  const raw =
    100 *
    (ACTIVITY_WEIGHT * components.activity +
      MOMENTUM_WEIGHT * components.momentum +
      FRESHNESS_WEIGHT * components.freshness);
  const score = Math.round(raw * (bucket.stale ? STALE_PENALTY : 1));

  return {
    key: bucket.key,
    name: bucket.name,
    score,
    events_30d: events30d,
    events_90d: events90d,
    days_since_last_change: daysSinceLast,
    stale: bucket.stale,
    components,
  };
}

/**
 * Pure ranking builder: protocols + events + now ⇒ a stable, highest-first leaderboard.
 * `nowMs` is epoch-ms so windows, freshness, and generated_at are deterministic and testable.
 */
export function buildLeaderboard(
  input: BuildLeaderboardInput,
  nowMs: number,
): Leaderboard {
  const protocols = input.protocols ?? [];

  const buckets = new Map<string, Bucket>();
  for (const p of protocols) {
    if (!buckets.has(p.key)) {
      buckets.set(p.key, {
        key: p.key,
        name: p.name,
        stale: p.stale,
        times: [],
      });
    }
  }
  for (const e of input.events) {
    const bucket = buckets.get(e.protocol_key);
    if (bucket === undefined) continue; // events without a known protocol are ignored
    const t = Date.parse(e.created_at);
    if (Number.isFinite(t)) bucket.times.push(t);
  }

  const scored = Array.from(buckets.values()).map((b) => computeEntry(b, nowMs));

  // Stable ranking: score desc, then key asc (lexicographic) as a deterministic tiebreak.
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  const entries: LeaderboardEntry[] = scored.map((e, i) => ({
    rank: i + 1,
    ...e,
  }));

  return {
    generated_at: new Date(nowMs).toISOString(),
    entries,
  };
}
