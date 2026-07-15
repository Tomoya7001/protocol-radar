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
 * Read-only mode is used for deployments where the filesystem is read-only and
 * a pre-built, already-migrated database is bundled with the app (e.g. Vercel
 * serverless). In this mode we must not create directories, must not open the
 * database for writing, and must not change the journal mode.
 *
 * Triggered by PROTOCOL_RADAR_DB_READONLY=1 (explicit) or VERCEL=1 (Vercel sets
 * this automatically at build and runtime).
 */
export function isReadonlyMode(): boolean {
  return (
    process.env.PROTOCOL_RADAR_DB_READONLY === "1" ||
    process.env.VERCEL === "1"
  );
}

/**
 * Open a SQLite database with sensible pragmas.
 * - foreign_keys ON always (referential integrity).
 * - WAL journal mode for file databases (better concurrent read/write); skipped for
 *   in-memory databases where WAL is not applicable.
 *
 * In read-only mode (see isReadonlyMode): the directory is not created, the
 * connection is opened readonly with fileMustExist, and journal_mode is left
 * untouched (a readonly connection cannot change it, and doing so would fail on
 * a read-only filesystem).
 */
export function openDatabase(path: string = resolveDatabasePath()): Db {
  if (isReadonlyMode() && !isMemory(path)) {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("foreign_keys = ON");
    return db;
  }

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
