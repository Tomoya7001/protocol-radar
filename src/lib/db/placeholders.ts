import type { Db } from "./connection";

/**
 * Placeholder (test-fixture) sources must never be observed in production.
 *
 * Why this exists: the very first committed snapshot (c736098, 2026-07-15) was copied by
 * scripts/make-snapshot.mjs from a local ./data/protocol-radar.db that had been seeded with the
 * web-surface test fixtures (src/app/_data/fixtures.ts `seedSampleData`, run on 2026-07-04).
 * The observe-loop then restores its canonical DB FROM that snapshot on every pass, so the
 * fixture sources (https://example.test/mcp, /a2a, /x402, ...) were carried forward forever,
 * still `active = 1` with their fabricated poll times — which made mcp/a2a read "stale" in
 * production although their real sources were polled fresh.
 *
 * `example.test` is an RFC 6761 reserved TLD: it can never resolve, so a source on it is a
 * placeholder by definition and is never a real observation target.
 *
 * The ledger (events) is NOT touched: fixture events are part of the hash chain and removing
 * them would break /api/verify. Only the `sources.active` flag is cleared, which the ledger
 * does not hash.
 */
export const PLACEHOLDER_SOURCE_HOST = "example.test";

/** True when `url` points at the reserved placeholder host (or a subdomain of it). */
export function isPlaceholderSourceUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === PLACEHOLDER_SOURCE_HOST ||
    host.endsWith(`.${PLACEHOLDER_SOURCE_HOST}`)
  );
}

/**
 * Switch every ACTIVE placeholder source off. Idempotent: a second call changes nothing.
 * Returns the ids it deactivated (empty when the DB is already clean).
 */
export function deactivatePlaceholderSources(db: Db): number[] {
  const rows = db
    .prepare("SELECT id, url FROM sources WHERE active = 1 ORDER BY id")
    .all() as { id: number; url: string }[];
  const ids = rows.filter((r) => isPlaceholderSourceUrl(r.url)).map((r) => r.id);
  if (ids.length === 0) return [];
  const stmt = db.prepare("UPDATE sources SET active = 0 WHERE id = ?");
  db.transaction(() => {
    for (const id of ids) stmt.run(id);
  })();
  return ids;
}

/** Ids of placeholder sources that are still ACTIVE (should always be empty in production). */
export function listActivePlaceholderSources(db: Db): { id: number; url: string }[] {
  const rows = db
    .prepare("SELECT id, url FROM sources WHERE active = 1 ORDER BY id")
    .all() as { id: number; url: string }[];
  return rows.filter((r) => isPlaceholderSourceUrl(r.url));
}
