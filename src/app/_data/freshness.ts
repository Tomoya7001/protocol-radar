import type { SourceRow, ProtocolStatus } from "@/lib/db";

/**
 * F-033 — Freshness / decay indicator.
 *
 * A source is considered "fresh" while it has been polled within a tolerance window of its
 * configured cadence. Once it is overdue by more than STALE_FACTOR × cadence it is "stale"
 * (the worker has stopped observing it, so the recorded state may be behind reality). All
 * computations are PURE and take an explicit `now` (epoch ms) so they are fully deterministic
 * and testable offline.
 */

/** How many cadence intervals a source may miss before it is flagged stale. */
export const STALE_FACTOR = 2;

/** Per-source freshness classification. */
export type SourceFreshness =
  | "fresh" // polled within STALE_FACTOR × cadence
  | "stale" // active but overdue
  | "pending" // active, never polled yet
  | "inactive"; // source is switched off (e.g. URL 404'd, or vanished)

/** Per-protocol freshness, aggregated from its sources (plus the vanished override). */
export type ProtocolFreshness =
  "fresh" | "stale" | "pending" | "vanished" | "unknown"; // no sources at all

const MS_PER_SECOND = 1000;

/** Parse an ISO-8601 timestamp to epoch ms; returns null for null/invalid input. */
export function parseIsoMs(value: string | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Classify a single source. Inactive sources are reported as "inactive" regardless of
 * timing. An active source that has never been polled is "pending"; otherwise it is "fresh"
 * while `now - last_polled_at <= STALE_FACTOR × cadence`, and "stale" once it exceeds that.
 */
export function classifySource(
  source: SourceRow,
  now: number,
): SourceFreshness {
  if (source.active !== 1) return "inactive";

  const polledMs = parseIsoMs(source.last_polled_at);
  if (polledMs === null) return "pending";

  const toleranceMs = source.cadence_seconds * STALE_FACTOR * MS_PER_SECOND;
  const ageMs = now - polledMs;
  return ageMs <= toleranceMs ? "fresh" : "stale";
}

/**
 * Aggregate protocol-level freshness from its sources.
 *  - A protocol whose status is "vanished" is always "vanished" (the strongest signal).
 *  - With no sources at all: "unknown".
 *  - Otherwise it takes the worst state among its ACTIVE sources: any stale ⇒ "stale";
 *    else any fresh ⇒ "fresh"; else (only pending actives) ⇒ "pending".
 *  - If every source is inactive (none active) the protocol reads as "stale" — nothing is
 *    being observed, which is exactly the decay warning F-033 must surface.
 */
export function classifyProtocol(
  status: ProtocolStatus,
  sources: SourceRow[],
  now: number,
): ProtocolFreshness {
  if (status === "vanished") return "vanished";
  if (sources.length === 0) return "unknown";

  const active = sources.filter((s) => s.active === 1);
  if (active.length === 0) return "stale";

  let sawFresh = false;
  let sawPending = false;
  for (const source of active) {
    const state = classifySource(source, now);
    if (state === "stale") return "stale";
    if (state === "fresh") sawFresh = true;
    if (state === "pending") sawPending = true;
  }
  if (sawFresh) return "fresh";
  if (sawPending) return "pending";
  // Unreachable in practice (active sources are fresh|stale|pending), kept for totality.
  return "unknown";
}

/** True when the protocol should surface a decay/stale warning in the UI and API. */
export function isStaleWarning(freshness: ProtocolFreshness): boolean {
  return freshness === "stale";
}
