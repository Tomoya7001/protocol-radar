#!/usr/bin/env node
/**
 * F6 - anchor the ledger head into the Bitcoin blockchain via OpenTimestamps.
 *
 * Complementary to B3 (which pins the head into git tag history): this stamps the SAME head hash
 * into OpenTimestamps so provenance is verifiable WITHOUT trusting GitHub. Runs on the writable
 * observe host, exactly like B3's anchor script, and REUSES computeLedgerHead so it never
 * re-derives the head hash.
 *
 * Each run does two things, both idempotent:
 *   1. STAMP: if no `data/anchors/<head>.ots` exists for the current head, create a fresh
 *      OpenTimestamps stamp of the head-hash bytes and write it (binary). Idempotent by filename.
 *   2. UPGRADE: for every existing `.ots` still pending, try to upgrade it to Bitcoin-confirmed
 *      and rewrite it if it changed, so proofs mature over the following hours/days.
 *
 * CRITICAL: every calendar-server network call is BEST-EFFORT and NON-FATAL. A calendar timeout
 * or failure is logged and swallowed - it must NEVER fail the observe run or change the process
 * exit code (the snapshot, already committed by the workflow, is the primary output). The network
 * wait is also bounded by a short timeout so a hung calendar cannot stall the loop. The writable
 * side effect (writing `.ots` files) lives here, exactly as B3 keeps its `git` side effect in its
 * own script; committing/pushing the files is the workflow's job (see observe.yml).
 *
 * Run through tsx (see the "timestamp" package.json script) so it can import the TypeScript lib
 * and reuse the tested, offline helpers rather than re-deriving anything here.
 *
 * Usage:
 *   pnpm timestamp   # stamp the current head (if new) and upgrade pending proofs (best-effort)
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import OpenTimestamps from "opentimestamps";
import { computeLedgerHead } from "../src/lib/anchor/index.ts";
import {
  ANCHORS_DIR,
  detachedForHead,
  deserializeProof,
  otsFileName,
  serializeProof,
} from "../src/lib/timestamp/index.ts";

const DB_PATH = process.env.DATABASE_PATH?.trim() || "./data/protocol-radar.db";

// Bound the calendar wait so a hung/slow server can never stall the observe loop. The stamp
// still records the pending calendar attestations locally; a later `upgrade` run confirms them.
const CALENDAR_TIMEOUT_MS = Number(
  process.env.TIMESTAMP_CALENDAR_TIMEOUT_MS?.trim() || "15000",
);

/** Resolve a value or reject after `ms`, so no network call can block indefinitely. */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Create a fresh OpenTimestamps stamp for `headHash` and write it. Best-effort / non-fatal. */
async function stampHead(headHash) {
  const detached = detachedForHead(headHash);
  try {
    await withTimeout(
      OpenTimestamps.stamp(detached),
      CALENDAR_TIMEOUT_MS,
      "OpenTimestamps.stamp",
    );
  } catch (err) {
    // Calendar unreachable/slow: do NOT fail the run. Skip writing so a later run can retry
    // cleanly from scratch (an empty, calendar-less proof would be useless to commit).
    console.warn(
      `timestamp-ledger: stamp calendar call failed (non-fatal): ${err?.message ?? err}`,
    );
    return false;
  }

  const outPath = join(ANCHORS_DIR, otsFileName(headHash));
  writeFileSync(outPath, Buffer.from(serializeProof(detached)));
  console.log(`timestamp-ledger: wrote new stamp ${outPath}`);
  return true;
}

/** Try to upgrade one pending `.ots` file in place. Best-effort / non-fatal. */
async function upgradeFile(path) {
  let detached;
  try {
    detached = deserializeProof(new Uint8Array(readFileSync(path)));
  } catch (err) {
    console.warn(
      `timestamp-ledger: skipping unparseable proof ${path}: ${err?.message ?? err}`,
    );
    return;
  }

  if (detached.timestamp.isTimestampComplete()) {
    return; // already Bitcoin-confirmed; nothing to do
  }

  try {
    const changed = await withTimeout(
      OpenTimestamps.upgrade(detached),
      CALENDAR_TIMEOUT_MS,
      "OpenTimestamps.upgrade",
    );
    if (changed) {
      writeFileSync(path, Buffer.from(serializeProof(detached)));
      const complete = detached.timestamp.isTimestampComplete();
      console.log(
        `timestamp-ledger: upgraded ${path}` +
          (complete ? " (now Bitcoin-confirmed)" : " (still pending)"),
      );
    }
  } catch (err) {
    // A calendar hiccup during upgrade is non-fatal; the next run retries.
    console.warn(
      `timestamp-ledger: upgrade calendar call failed for ${path} (non-fatal): ${err?.message ?? err}`,
    );
  }
}

/** Upgrade every existing `.ots` proof under the anchors dir (best-effort). */
async function upgradeExisting() {
  if (!existsSync(ANCHORS_DIR)) return;
  const files = readdirSync(ANCHORS_DIR).filter((f) => f.endsWith(".ots"));
  for (const f of files) {
    await upgradeFile(join(ANCHORS_DIR, f));
  }
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`timestamp-ledger: canonical DB not found: ${DB_PATH}`);
    process.exit(1);
  }

  // Read-only connection: this script must never mutate the ledger.
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  let head;
  try {
    head = computeLedgerHead(db);
  } finally {
    db.close();
  }

  console.log(
    `timestamp-ledger: head_hash=${head.headHash} checked=${head.checked}`,
  );

  mkdirSync(ANCHORS_DIR, { recursive: true });

  // 1. Stamp the current head if it isn't already anchored (idempotent by filename).
  const outPath = join(ANCHORS_DIR, otsFileName(head.headHash));
  if (existsSync(outPath)) {
    console.log(
      `timestamp-ledger: head already stamped (${outPath}); skipping stamp`,
    );
  } else {
    await stampHead(head.headHash);
  }

  // 2. Best-effort upgrade of every pending proof so it becomes Bitcoin-confirmed over time.
  await upgradeExisting();
}

// A calendar/network failure must never fail the observe run: log and exit 0 on ANY error.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.warn(
      `timestamp-ledger: non-fatal error, continuing: ${err?.message ?? err}`,
    );
    process.exit(0);
  });
