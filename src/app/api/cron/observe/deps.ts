import type { Db } from "@/lib/db";
import type { HttpClient } from "@/lib/fetch/types";
import type { GithubReleaseRepo } from "@/config/sources/releases";

/**
 * Test-only dependency override for the /api/cron/observe route (real HTTP + wall clock
 * otherwise). This lives in a plain module — NOT the route.ts file — because Next.js only
 * permits a fixed set of exports from a Route file (`GET`, `runtime`, `dynamic`, ...). Any
 * extra export there fails the build ("... is not a valid Route export field").
 */
export interface ObserveDeps {
  db: Db;
  client: HttpClient;
  now: Date;
  repos?: GithubReleaseRepo[];
}

let depsOverride: Partial<ObserveDeps> | null = null;

/**
 * Test-only hook: inject a fake HTTP client, fixed clock, seeded DB, and/or a repo subset so
 * the handler can be exercised offline without real network I/O. Not used by production code.
 */
export function __setObserveDepsForTests(deps: Partial<ObserveDeps> | null): void {
  depsOverride = deps;
}

/** Current test override (null in production, so the route uses real dependencies). */
export function getObserveDepsOverride(): Partial<ObserveDeps> | null {
  return depsOverride;
}
