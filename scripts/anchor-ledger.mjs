#!/usr/bin/env node
/**
 * B3 - anchor the ledger head into git tag history.
 *
 * Opens the canonical DB read-only, reads the current head hash + checked count via the
 * tested pure helper computeLedgerHead(), and - if that head is not already anchored -
 * creates an annotated `ledger/<time>Z` git tag noting the head hash and coverage. This pins
 * the current provenance state into git's near-immutable, third-party-observable history, so a
 * later rewrite of the (mutable) production DB becomes externally detectable.
 *
 * Strictly READ-ONLY over the DB (it never writes a row) and idempotent: re-running when the
 * head is unchanged is a no-op. Pushing is OFF by default and only happens under ANCHOR_PUSH=1
 * so a local run can never accidentally publish a tag; CI opts in explicitly.
 *
 * Run through tsx (see the "anchor" package.json script) so it can import the TypeScript lib
 * and REUSE computeLedgerHead rather than re-deriving the head hash here.
 *
 * Usage:
 *   pnpm anchor                # create the tag locally (no push)
 *   ANCHOR_PUSH=1 pnpm anchor  # create AND push the tag (used by CI)
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import {
  computeLedgerHead,
  anchorTagName,
  anchorTagMessage,
  isHeadAlreadyAnchored,
} from "../src/lib/anchor/index.ts";

const DB_PATH = process.env.DATABASE_PATH?.trim() || "./data/protocol-radar.db";
const TAG_PREFIX = "ledger";

/** Run git, returning trimmed stdout. Throws on non-zero exit. */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/**
 * Annotation bodies of the existing ledger/* tags (one string per tag; [] if none).
 *
 * List the matching tag NAMES first, then read each tag's full annotation body on its own. A
 * single --format call with a NUL separator is NOT usable here: Node's execFileSync rejects any
 * argument containing a null byte, so per-tag reads are both correct and unambiguous.
 */
function existingAnchorMessages() {
  const names = execFileSync("git", ["tag", "-l", `${TAG_PREFIX}/*`], {
    encoding: "utf8",
  })
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return names
    .map((name) =>
      execFileSync("git", ["tag", "-l", "--format=%(contents)", name], {
        encoding: "utf8",
      }).trim(),
    )
    .filter((s) => s.length > 0);
}

function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`anchor-ledger: canonical DB not found: ${DB_PATH}`);
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
    `anchor-ledger: head_hash=${head.headHash} checked=${head.checked}`,
  );

  const existing = existingAnchorMessages();
  if (isHeadAlreadyAnchored(head.headHash, existing)) {
    console.log(
      "anchor-ledger: head already anchored by an existing tag; nothing to do",
    );
    return;
  }

  const dateISO = new Date().toISOString();
  const tagName = anchorTagName(dateISO);
  const message = anchorTagMessage({
    headHash: head.headHash,
    checked: head.checked,
    dateISO,
  });

  // A tag with this exact name may already exist (same-minute rerun on a new head). We do NOT
  // overwrite an existing anchor - report and stop instead of rewriting history.
  const nameExists =
    execFileSync("git", ["tag", "-l", tagName], { encoding: "utf8" }).trim()
      .length > 0;
  if (nameExists) {
    console.log(
      `anchor-ledger: tag ${tagName} already exists (different head, same minute); skipping`,
    );
    return;
  }

  git(["tag", "-a", tagName, "-m", message]);
  console.log(`anchor-ledger: created annotated tag ${tagName}`);

  if (process.env.ANCHOR_PUSH === "1") {
    const remote = process.env.ANCHOR_REMOTE?.trim() || "origin";
    git(["push", remote, `refs/tags/${tagName}`]);
    console.log(`anchor-ledger: pushed ${tagName} to ${remote}`);
  } else {
    console.log(
      "anchor-ledger: ANCHOR_PUSH not set; tag created locally, not pushed",
    );
  }
}

main();
