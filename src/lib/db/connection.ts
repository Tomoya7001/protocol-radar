import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

/**
 * Resolve the configured database path. Default is ./data/protocol-radar.db.
 * The special value ":memory:" yields an ephemeral in-memory database (used by tests).
 */
export function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  return configured && configured.length > 0
    ? configured
    : "./data/protocol-radar.db";
}

function isMemory(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

/**
 * Open a SQLite database with sensible pragmas.
 * - foreign_keys ON always (referential integrity).
 * - WAL journal mode for file databases (better concurrent read/write); skipped for
 *   in-memory databases where WAL is not applicable.
 */
export function openDatabase(path: string = resolveDatabasePath()): Db {
  if (!isMemory(path)) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  if (!isMemory(path)) {
    db.pragma("journal_mode = WAL");
  }
  return db;
}
