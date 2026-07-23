/**
 * Barrel for the watcher source configuration (F-010..F-020).
 */
export type {
  Priority,
  ProtocolDef,
  SourceDef,
  WatchlistEntry,
} from "./types";
export { PROTOCOL_LAYER, WATCHLIST_LAYER } from "./types";
export { PROTOCOL_DEFS, P0_PROTOCOL_KEYS } from "./protocols";
export { WATCHLIST } from "./watchlist";
export {
  GITHUB_RELEASE_REPOS,
  RELEASE_SOURCE_KIND,
  releasesUrl,
} from "./releases";
export type { GithubReleaseRepo } from "./releases";
export {
  SPEC_PAGE_SOURCES,
  SPEC_SOURCE_KIND,
  specPageUrl,
} from "./specPages";
export type { SpecPageSource } from "./specPages";
export {
  PACKAGE_SOURCES,
  PACKAGE_SOURCE_KIND,
  packageSourceUrl,
} from "./packages";
export type { PackageSource } from "./packages";
