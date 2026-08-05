/**
 * Feature G5 — observation freshness / coverage SLA (pure computation layer).
 *
 * This is a TRUST self-report over the continuous-observation ledger: "how current is this
 * data?". Unlike liveness (/api/health) or pattern detection (/api/anomalies), it answers the
 * single question an AI consumer needs to trust a snapshot — for each tracked protocol, when
 * was it last observed, and is that observation still within the freshness SLA. A one-shot
 * query cannot report its own recency; only an accumulating observation ledger can.
 *
 * Pure function: observations + known protocols + `now` (epoch-ms) in, freshness report out.
 * No DB, no clock, no I/O, no process.env — fully deterministic and unit-testable. The route
 * layer (src/app/api/freshness/route.ts) supplies the data and `now`.
 */

/**
 * Freshness SLA: an observation older than this is considered STALE. 48 hours — a protocol
 * should be re-observed at least every two days for its data to count as "current".
 */
export const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 172_800_000

/** One observation, reduced to the fields the freshness math needs. */
export interface FreshnessObservationInput {
  protocol_key: string;
  /** ISO-8601 UTC timestamp of the observation. Unparseable rows are ignored, never NaN. */
  observed_at: string;
}

/** A known protocol, so never-observed protocols still appear (as stale) in the output. */
export interface FreshnessProtocolInput {
  key: string;
}

export interface ComputeFreshnessInput {
  /** All tracked protocols. Optional; defaults to []. Ensures zero-observation coverage gaps show. */
  protocols?: FreshnessProtocolInput[];
  /** Observation feed across all protocols. Order does not matter. */
  observations: FreshnessObservationInput[];
}

export interface ProtocolFreshness {
  key: string;
  /** ISO-8601 UTC timestamp of the most recent observation; null when never observed. */
  lastObservedAt: string | null;
  /** Age (ms) of the most recent observation relative to `now`; null when never observed. */
  staleMs: number | null;
  /** True when the newest observation is older than STALE_THRESHOLD_MS, or never observed. */
  stale: boolean;
  /** Number of observations recorded for this protocol. */
  observationCount: number;
}

export interface FreshnessSummary {
  protocolsTracked: number;
  freshCount: number;
  staleCount: number;
  /** Largest finite staleMs among stale protocols; null when no stale protocol has an observation. */
  oldestStaleMs: number | null;
  generatedAt: string;
}

export interface FreshnessReport {
  protocols: ProtocolFreshness[];
  summary: FreshnessSummary;
}

interface Bucket {
  key: string;
  /** Observation timestamps (epoch-ms), finite only. */
  times: number[];
}

function computeProtocol(bucket: Bucket, now: number): ProtocolFreshness {
  const observationCount = bucket.times.length;

  // Newest observation drives freshness.
  let newest: number | null = null;
  for (const t of bucket.times) {
    if (newest === null || t > newest) newest = t;
  }

  if (newest === null) {
    // Never observed within the ledger ⇒ maximally stale, no finite age.
    return {
      key: bucket.key,
      lastObservedAt: null,
      staleMs: null,
      stale: true,
      observationCount,
    };
  }

  const staleMs = Math.max(0, now - newest);
  return {
    key: bucket.key,
    lastObservedAt: new Date(newest).toISOString(),
    staleMs,
    stale: staleMs > STALE_THRESHOLD_MS,
    observationCount,
  };
}

/**
 * Pure freshness builder: observations + known protocols + now ⇒ stable coverage report.
 *
 * Ordering surfaces problems first: most-stale protocols lead. Never-observed protocols
 * (staleMs null) sort ahead of every finite-age one; ties break by `key` ascending, so the
 * output is fully deterministic.
 */
export function computeFreshness(
  input: ComputeFreshnessInput,
  now: number,
): FreshnessReport {
  const observations = input.observations;
  const protocols = input.protocols ?? [];

  const buckets = new Map<string, Bucket>();
  for (const p of protocols) {
    if (!buckets.has(p.key)) buckets.set(p.key, { key: p.key, times: [] });
  }
  for (const o of observations) {
    let bucket = buckets.get(o.protocol_key);
    if (bucket === undefined) {
      bucket = { key: o.protocol_key, times: [] };
      buckets.set(o.protocol_key, bucket);
    }
    const t = Date.parse(o.observed_at);
    if (Number.isFinite(t)) bucket.times.push(t);
  }

  const list = Array.from(buckets.values()).map((b) => computeProtocol(b, now));

  // Most stale first: null (never observed) is treated as +Infinity; then key ascending.
  list.sort((a, b) => {
    const sa = a.staleMs === null ? Number.POSITIVE_INFINITY : a.staleMs;
    const sb = b.staleMs === null ? Number.POSITIVE_INFINITY : b.staleMs;
    return sb - sa || a.key.localeCompare(b.key);
  });

  return {
    protocols: list,
    summary: buildSummary(list, now),
  };
}

function buildSummary(list: ProtocolFreshness[], now: number): FreshnessSummary {
  let freshCount = 0;
  let staleCount = 0;
  let oldestStaleMs: number | null = null;

  for (const p of list) {
    if (p.stale) {
      staleCount += 1;
      if (p.staleMs !== null) {
        oldestStaleMs =
          oldestStaleMs === null
            ? p.staleMs
            : Math.max(oldestStaleMs, p.staleMs);
      }
    } else {
      freshCount += 1;
    }
  }

  return {
    protocolsTracked: list.length,
    freshCount,
    staleCount,
    oldestStaleMs,
    generatedAt: new Date(now).toISOString(),
  };
}
