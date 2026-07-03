/**
 * Typed source definitions for the protocol watchers (F-010..F-020).
 *
 * A definition is DECLARATIVE data only — the seed engine (src/watchers/seed.ts) turns it
 * into `protocols` + `sources` rows via the Layer A repo. The integrity rule
 * (docs/spec/99_EXECUTION.md) is encoded here: a source whose canonical URL is not yet
 * verified ships `active: false` with a mandatory `todo` explaining why — we NEVER invent a
 * URL to make a source look live. Provenance integrity is the product.
 */
import type { SourceKind } from "@/lib/db/types";

export type Priority = "P0" | "P1" | "P2";

/** Layer tag stored on normal protocol rows (mirrors the spec's "Layer B"). */
export const PROTOCOL_LAYER = "B";
/** Layer tag stored on future-spec watchlist rows so the monitor can find them. */
export const WATCHLIST_LAYER = "watchlist";

export interface SourceDef {
  kind: SourceKind;
  /** Real, known-good URL. For GitHub sources this is the tags/releases API endpoint. */
  url: string;
  /** Human-readable English label describing what this source tracks. */
  label: string;
  /** Poll cadence in seconds. */
  cadenceSeconds: number;
  /**
   * Defaults to true. Set false when the canonical location is NOT yet verified — the seed
   * engine keeps it inactive and logs `todo` instead of guessing a URL.
   */
  active?: boolean;
  /** Required when `active === false`: why the source ships inactive and what to re-source. */
  todo?: string;
}

export interface ProtocolDef {
  /** Stable protocol key (DB `protocols.key`, UNIQUE). */
  key: string;
  name: string;
  /** Feature id this protocol belongs to, e.g. "F-010". */
  feature: string;
  priority: Priority;
  sources: SourceDef[];
}

/**
 * A pre-announced / future spec we watch for FIRST APPEARANCE (F-020). Until it appears its
 * canonical URL is usually unknown, so most entries ship inactive with a TODO and are
 * activated once the real endpoint is published — again, we do not guess.
 */
export interface WatchlistEntry {
  key: string;
  name: string;
  feature: string;
  kind: SourceKind;
  url: string;
  /** Description of the pre-announced spec (English). */
  note: string;
  active?: boolean;
  todo?: string;
}
