/**
 * Barrel for the protocol watchers (F-010..F-020): the idempotent seed engine and the
 * future-spec first-appearance monitor.
 */
export { seedSources } from "./seed";
export type { SeedOptions, SeedResult } from "./seed";
export {
  recordFirstAppearance,
  runWatchlistOnce,
} from "./watchlist";
export type {
  FirstAppearance,
  RecordFirstAppearanceInput,
  RunWatchlistOptions,
  WatchPollResult,
} from "./watchlist";
