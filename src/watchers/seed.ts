/**
 * Seed engine (F-010..F-020).
 *
 * Idempotently upserts the configured protocol sources + future-spec watchlist into the DB
 * via the Layer A repo, then (optionally) HEAD-validates every active URL at startup.
 *
 * Guarantees:
 *  - Re-running is a no-op for rows that already exist (matched by protocol key and by
 *    (protocol_id, url)) — no duplicates.
 *  - A configured source that ships `active: false` is inserted inactive and its TODO is
 *    surfaced (integrity: we never invent a URL just to look live).
 *  - Startup validation of an active URL that 404s/410s (or is unreachable) flips the source
 *    inactive + logs a TODO; the run CONTINUES (a bad source never aborts seeding).
 */
import type { Db } from "@/lib/db";
import {
  getProtocolByKey,
  insertProtocol,
  insertSource,
  listSources,
  setSourceActive,
} from "@/lib/db/repo";
import type { ProtocolRow } from "@/lib/db/types";
import { validateSourceUrl } from "@/lib/fetch/validate";
import type { HttpClient } from "@/lib/fetch/types";
import { consoleLogger, type Logger } from "@/lib/fetch/logger";
import type { ProtocolDef, SourceDef, WatchlistEntry } from "@/config/sources/types";
import { PROTOCOL_LAYER, WATCHLIST_LAYER } from "@/config/sources/types";
import { PROTOCOL_DEFS, WATCHLIST } from "@/config/sources";

export interface SeedOptions {
  db: Db;
  /** Protocol definitions to seed. Defaults to the full configured set. */
  defs?: ProtocolDef[];
  /** Watchlist entries to seed. Defaults to the full configured set. */
  watchlist?: WatchlistEntry[];
  /**
   * When provided, every ACTIVE source URL is HEAD-validated at startup (offline in tests
   * via an injected fake client). Omit to skip validation (config-only seed).
   */
  client?: HttpClient;
  logger?: Logger;
}

export interface SeedResult {
  protocolsInserted: number;
  protocolsExisting: number;
  sourcesInserted: number;
  sourcesExisting: number;
  /** Active sources checked against the network (only when a client is supplied). */
  sourcesValidated: number;
  /** Active sources flipped inactive because validation returned 404/410/unreachable. */
  sourcesDeactivated: number;
  /** Integrity TODOs raised this run (inactive-by-config + failed-validation). */
  todos: string[];
}

function emptyResult(): SeedResult {
  return {
    protocolsInserted: 0,
    protocolsExisting: 0,
    sourcesInserted: 0,
    sourcesExisting: 0,
    sourcesValidated: 0,
    sourcesDeactivated: 0,
    todos: [],
  };
}

/** Insert the protocol if its key is new; otherwise reuse the existing row (no overwrite). */
function upsertProtocol(
  db: Db,
  key: string,
  name: string,
  layer: string,
  result: SeedResult,
): ProtocolRow {
  const existing = getProtocolByKey(db, key);
  if (existing) {
    result.protocolsExisting++;
    return existing;
  }
  const row = insertProtocol(db, { key, name, layer });
  result.protocolsInserted++;
  return row;
}

/**
 * Insert a source once per (protocol_id, url). Existing rows are left untouched so a re-run
 * never duplicates and never resurrects a source an operator/validator deactivated.
 */
function upsertSource(
  db: Db,
  protocolId: number,
  src: SourceDef,
  logger: Logger,
  result: SeedResult,
): void {
  const already = listSources(db).some(
    (s) => s.protocol_id === protocolId && s.url === src.url,
  );
  if (already) {
    result.sourcesExisting++;
    return;
  }

  const active = src.active !== false; // default active
  insertSource(db, {
    protocol_id: protocolId,
    kind: src.kind,
    url: src.url,
    label: src.label,
    cadence_seconds: src.cadenceSeconds,
    active,
  });
  result.sourcesInserted++;

  if (!active) {
    const todo = `source ships INACTIVE (config): ${src.url} — ${src.todo ?? "canonical URL unverified; do NOT guess"}`;
    result.todos.push(todo);
    logger.todo(todo);
  }
}

/**
 * Seed the configured sources + watchlist and (optionally) validate active URLs. Never
 * throws for a bad URL — it flips the source inactive and records a TODO, then continues.
 */
export async function seedSources(options: SeedOptions): Promise<SeedResult> {
  const db = options.db;
  const defs = options.defs ?? PROTOCOL_DEFS;
  const watchlist = options.watchlist ?? WATCHLIST;
  const logger = options.logger ?? consoleLogger;
  const client = options.client;
  const result = emptyResult();

  // 1. Protocol source definitions.
  for (const def of defs) {
    const proto = upsertProtocol(db, def.key, def.name, PROTOCOL_LAYER, result);
    for (const src of def.sources) {
      upsertSource(db, proto.id, src, logger, result);
    }
  }

  // 2. Future-spec watchlist entries (each its own protocol + source, tagged for the monitor).
  for (const entry of watchlist) {
    const proto = upsertProtocol(
      db,
      entry.key,
      entry.name,
      WATCHLIST_LAYER,
      result,
    );
    upsertSource(
      db,
      proto.id,
      {
        kind: entry.kind,
        url: entry.url,
        label: entry.note,
        cadenceSeconds: 24 * 3600,
        active: entry.active,
        todo: entry.todo,
      },
      logger,
      result,
    );
  }

  // 3. Startup URL validation (only active sources; offline via injected client in tests).
  if (client) {
    for (const source of listSources(db)) {
      if (source.active !== 1) continue;
      result.sourcesValidated++;
      const check = await validateSourceUrl(client, source.url, logger);
      if (check.markInactive) {
        setSourceActive(db, source.id, false);
        result.sourcesDeactivated++;
        // validateSourceUrl already logged a [TODO]; record it in the result too.
        result.todos.push(
          `source failed startup validation (HTTP ${check.status ?? "unreachable"}), marked inactive — re-source, do NOT guess: ${source.url}`,
        );
      }
    }
  }

  return result;
}
