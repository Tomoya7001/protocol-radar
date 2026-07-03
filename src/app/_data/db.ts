import { openMigratedDatabase, type Db } from "@/lib/db";

/**
 * Read-side database accessor for the web surface (F-030..F-035).
 *
 * The web routes and pages are READ-ONLY consumers of the ledger the worker writes.
 * They share a single cached connection so a `:memory:` database (used by tests and by
 * the API route tests) stays consistent across calls within one process — a fresh
 * `openMigratedDatabase(":memory:")` would otherwise yield an empty, unrelated DB.
 *
 * The connection is opened lazily on first use (never at import time), so `next build`
 * can statically analyse these modules without touching the filesystem, and every route
 * that uses it declares `dynamic = "force-dynamic"`.
 */
let cached: Db | null = null;

/** Return the shared, migrated read connection, opening it lazily on first use. */
export function getDb(): Db {
  if (cached === null) {
    cached = openMigratedDatabase();
  }
  return cached;
}

/**
 * Test-only hook: inject a pre-seeded connection (or null to reset). Route/page tests
 * seed an in-memory DB, inject it here, then exercise the handlers against it. Not used
 * by production code.
 */
export function __setDbForTests(db: Db | null): void {
  cached = db;
}
