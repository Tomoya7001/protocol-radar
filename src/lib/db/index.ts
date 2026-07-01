import { openDatabase, resolveDatabasePath, type Db } from "./connection";
import { runMigrations } from "./migrate";

export type { Db } from "./connection";
export { openDatabase, resolveDatabasePath } from "./connection";
export { runMigrations } from "./migrate";
export { migrations } from "./migrations";
export type { Migration } from "./migrations";
export * from "./types";
export * from "./repo";

/**
 * Open a database and ensure the schema is migrated. Convenience for app/worker startup
 * and tests. Returns a ready-to-use connection.
 */
export function openMigratedDatabase(path: string = resolveDatabasePath()): Db {
  const db = openDatabase(path);
  runMigrations(db);
  return db;
}
