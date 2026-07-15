import {
  openDatabase,
  resolveDatabasePath,
  isReadonlyMode,
  type Db,
} from "./connection";
import { runMigrations } from "./migrate";

export type { Db } from "./connection";
export {
  openDatabase,
  resolveDatabasePath,
  isReadonlyMode,
} from "./connection";
export { runMigrations } from "./migrate";
export { migrations } from "./migrations";
export type { Migration } from "./migrations";
export * from "./types";
export * from "./repo";

/**
 * Open a database and ensure the schema is migrated. Convenience for app/worker startup
 * and tests. Returns a ready-to-use connection.
 *
 * In read-only mode the bundled database is already migrated, and running
 * migrations would attempt writes that fail on a read-only filesystem, so the
 * migration step is skipped.
 */
export function openMigratedDatabase(path: string = resolveDatabasePath()): Db {
  const db = openDatabase(path);
  if (isReadonlyMode()) {
    return db;
  }
  runMigrations(db);
  return db;
}
