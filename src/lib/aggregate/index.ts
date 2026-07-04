/**
 * Layer C aggregation (integrator) public surface.
 *
 * Pure, deterministic aggregation functions over the ledger the worker writes:
 *  - F-050 buildTimeline      — cross-protocol "latest moves" feed, ranked.
 *  - F-051 buildCompatMatrix  — which tracked protocols compose.
 *  - F-052 buildDigest        — last-N-hours change digest (+ markdown renderer).
 *
 * None of these read the wall-clock; time-relative behaviour takes an injected `now`.
 */

export {
  buildTimeline,
  compareTimelineEntries,
  type TimelineEntry,
  type TimelineOptions,
} from "./timeline";

export {
  buildCompatMatrix,
  type CompatMatrix,
  type CompatCell,
  type CompatPair,
} from "./compat";

export {
  buildDigest,
  digestToMarkdown,
  type Digest,
  type DigestGroup,
  type DigestOptions,
} from "./digest";
