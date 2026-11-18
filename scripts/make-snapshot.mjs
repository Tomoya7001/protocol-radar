// Produce a self-contained, checkpointed snapshot of the DB.
//
// Opens ./data/protocol-radar.db, switches off any placeholder (test-fixture, example.test)
// source, folds any WAL content back into the main file (TRUNCATE checkpoint), switches journal
// mode to DELETE so no -wal/-shm files remain, then copies the result to ./data/snapshot.db.
// The snapshot is a single self-contained file suitable for bundling into a read-only deployment.
//
// Placeholder guard: the first committed snapshot was copied from a local DB that had been
// seeded with the web test fixtures, and the observe-loop restores its canonical DB from the
// snapshot, so those example.test sources were carried into production forever. Every snapshot
// now deactivates them first (sources.active only — the hash-chained events are never touched)
// and REFUSES to write a snapshot that still has an active placeholder source.
//
// Run through tsx (see the "snapshot" package.json script) so it can import the TypeScript lib.
//
// Usage:
//   tsx scripts/make-snapshot.mjs              canonical DB -> data/snapshot.db
//   tsx scripts/make-snapshot.mjs --in-place   sanitize data/snapshot.db itself (no canonical DB)

import Database from "better-sqlite3";
import { copyFileSync, existsSync, statSync } from "node:fs";
import {
  deactivatePlaceholderSources,
  listActivePlaceholderSources,
} from "../src/lib/db/placeholders.ts";

const SOURCE = "./data/protocol-radar.db";
const DEST = "./data/snapshot.db";
const inPlace = process.argv.includes("--in-place");

function sanitize(db, label) {
  const ids = deactivatePlaceholderSources(db);
  if (ids.length > 0) {
    console.log(`${label}: deactivated placeholder sources ${ids.join(", ")}`);
  }
  const left = listActivePlaceholderSources(db);
  if (left.length > 0) {
    console.error(
      `${label}: placeholder sources still active: ${left.map((s) => s.url).join(", ")}`,
    );
    process.exit(1);
  }
}

const target = inPlace ? DEST : SOURCE;
if (!existsSync(target)) {
  console.error(`database not found: ${target}`);
  process.exit(1);
}

const db = new Database(target);
try {
  sanitize(db, target);
  if (!inPlace) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("journal_mode = DELETE");
  }
} finally {
  db.close();
}

if (!inPlace) copyFileSync(SOURCE, DEST);

const { size } = statSync(DEST);
console.log(`wrote ${DEST} (${size} bytes)`);
if (size <= 0) {
  console.error("snapshot is empty");
  process.exit(1);
}
