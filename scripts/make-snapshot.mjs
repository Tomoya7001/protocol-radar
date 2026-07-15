// One-off script: produce a self-contained, checkpointed snapshot of the DB.
//
// Opens ./data/protocol-radar.db, folds any WAL content back into the main file
// (TRUNCATE checkpoint), switches journal mode to DELETE so no -wal/-shm files
// remain, then copies the result to ./data/snapshot.db. The snapshot is a single
// self-contained file suitable for bundling into a read-only deployment.
//
// Usage: node scripts/make-snapshot.mjs

import Database from "better-sqlite3";
import { copyFileSync, existsSync, statSync } from "node:fs";

const SOURCE = "./data/protocol-radar.db";
const DEST = "./data/snapshot.db";

if (!existsSync(SOURCE)) {
  console.error(`source database not found: ${SOURCE}`);
  process.exit(1);
}

const db = new Database(SOURCE);
try {
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("journal_mode = DELETE");
} finally {
  db.close();
}

copyFileSync(SOURCE, DEST);

const { size } = statSync(DEST);
console.log(`wrote ${DEST} (${size} bytes)`);
if (size <= 0) {
  console.error("snapshot is empty");
  process.exit(1);
}
