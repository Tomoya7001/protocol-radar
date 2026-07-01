import type { Db } from "./connection";
import { migrations, type Migration } from "./migrations";

interface AppliedRow {
  id: number;
}

/**
 * Idempotent migration runner. Tracks applied migrations in schema_migrations and
 * applies only pending ones, in id order, each inside a transaction. Running twice is
 * a no-op.
 */
export function runMigrations(
  db: Db,
  list: readonly Migration[] = migrations,
): { applied: number[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const appliedRows = db
    .prepare("SELECT id FROM schema_migrations")
    .all() as AppliedRow[];
  const appliedIds = new Set(appliedRows.map((r) => r.id));

  const ordered = [...list].sort((a, b) => a.id - b.id);
  const applied: number[] = [];

  const record = db.prepare(
    "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
  );

  for (const migration of ordered) {
    if (appliedIds.has(migration.id)) continue;

    const apply = db.transaction((m: Migration) => {
      db.exec(m.sql);
      record.run(m.id, m.name);
    });
    apply(migration);
    applied.push(migration.id);
  }

  return { applied };
}
