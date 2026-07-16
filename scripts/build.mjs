#!/usr/bin/env node
/**
 * Serialized Next.js build wrapper.
 *
 * The CI/auto-verify harness (and parallel agents) can launch `pnpm build`
 * repeatedly and concurrently. Two `next build` processes touching the same
 * `.next` directory AND sharing the same compiled webpack runtime clobber
 * each other, producing non-deterministic failures such as:
 *   - `_webpack.WebpackError is not a constructor` (compile/minify phase)
 *   - `Cannot find module '.../module.compiled'` (collect-build-traces)
 *   - `ENOENT: .next/.../<something>.json` (page-data / trace collection)
 *
 * Two mechanisms keep builds hermetic:
 *
 *  1. An exclusive, PID-aware lock so only one build runs at a time;
 *     concurrent invocations queue and then run against a quiescent tree.
 *     Stale locks (dead PID or too old) are reclaimed so a killed build can
 *     never deadlock the next.
 *
 *  2. Orphan reaping. `next build` spawns jest-worker children. If this
 *     wrapper is signalled/killed between verify runs without tearing down
 *     that subtree, the orphaned `next build` keeps running, holds NO lock,
 *     and collides with the next build — the exact race that produces the
 *     errors above. We therefore (a) run the child in its own process group
 *     and kill the whole group on every exit path, and (b) sweep any stray
 *     next-build/jest-worker processes for THIS repo after acquiring the
 *     lock (safe: while we hold the lock no legitimate build is running).
 */
import { spawn, spawnSync } from "node:child_process";
import { openSync, writeSync, closeSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, ".next-build.lock");
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");

const STALE_MS = 10 * 60 * 1000; // reclaim locks older than 10 min
const POLL_MS = 400;
const MAX_WAIT_MS = 15 * 60 * 1000; // never block a verify run forever

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists but owned by another user
  }
}

function readLock() {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const [pidStr, tsStr] = raw.split(":");
    return { pid: Number(pidStr), ts: Number(tsStr) };
  } catch {
    return null;
  }
}

function tryAcquire() {
  try {
    const fd = openSync(lockPath, "wx"); // atomic exclusive create
    writeSync(fd, `${process.pid}:${Date.now()}`);
    closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    return false;
  }
}

function reclaimIfStale() {
  const info = readLock();
  if (!info) return; // vanished; caller will retry acquire
  const dead = !Number.isFinite(info.pid) || !pidAlive(info.pid);
  const old = !Number.isFinite(info.ts) || Date.now() - info.ts > STALE_MS;
  if (dead || old) {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      /* someone else reclaimed it; fine */
    }
  }
}

async function acquire() {
  const start = Date.now();
  while (!tryAcquire()) {
    if (Date.now() - start > MAX_WAIT_MS) {
      // Last resort: force-reclaim rather than fail the build outright.
      try {
        rmSync(lockPath, { force: true });
      } catch {}
      if (tryAcquire()) break;
      throw new Error("could not acquire build lock");
    }
    reclaimIfStale();
    await sleep(POLL_MS);
  }
}

function release() {
  const info = readLock();
  if (info && info.pid === process.pid) {
    try {
      rmSync(lockPath, { force: true });
    } catch {}
  }
}

/**
 * Kill any stray `next build` / jest-worker processes belonging to THIS repo.
 * Only ever called while we hold the build lock, so no legitimate concurrent
 * build exists — every match is an orphan from a prior killed build and is
 * safe to terminate. Scoped to `root` so sibling projects are never touched.
 */
function sweepStrays() {
  // pkill -f matches against the full command line; the repo path in the
  // pattern makes this specific to this checkout. -9 because orphans that
  // survived a SIGTERM won't respond to anything gentler.
  const patterns = [
    // main `next build` process (symlinked and resolved pnpm paths)
    `${root}/node_modules/.*next/dist/bin/next build`,
    // jest-worker children spawned by `next build`
    `${root}/node_modules/.*next/dist/compiled/jest-worker`,
  ];
  for (const pat of patterns) {
    try {
      spawnSync("pkill", ["-9", "-f", pat], { stdio: "ignore" });
    } catch {
      /* pkill missing or nothing matched; not fatal */
    }
  }
}

async function main() {
  await acquire();

  // Reap orphans from any previously-killed build before we start ours.
  sweepStrays();

  let child = null;
  let cleaned = false;

  const killChild = () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    // Child is a process-group leader (detached), so negating the pid
    // signals the whole group — reaping `next build` AND its jest-workers.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {}
    }
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    killChild();
    release();
  };

  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      cleanup();
      process.exit(1);
    });
  }

  const args = process.argv.slice(2);
  child = spawn(process.execPath, [nextBin, "build", ...args], {
    stdio: "inherit",
    cwd: root,
    detached: true, // own process group so we can reap the whole subtree
  });

  const code = await new Promise((resolve) => {
    child.on("exit", (c, signal) => resolve(signal ? 1 : c ?? 1));
    child.on("error", () => resolve(1));
  });

  cleanup();
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  release();
  process.exit(1);
});
