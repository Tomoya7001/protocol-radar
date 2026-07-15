#!/usr/bin/env node
/**
 * Serialized Next.js build wrapper.
 *
 * The CI/auto-verify harness can launch `pnpm build` repeatedly and
 * concurrently. Two `next build` processes writing the same `.next`
 * directory clobber each other's manifests and trace files, producing
 * non-deterministic `ENOENT: ... .next/.../<something>.json` failures
 * during "Collecting page data" / "Collecting build traces".
 *
 * This wrapper takes an exclusive, PID-aware lock so only one build
 * touches `.next` at a time; concurrent invocations queue and then run
 * against a quiescent directory. Stale locks (dead PID or too old) are
 * reclaimed automatically so a killed build can never deadlock the next.
 */
import { spawn } from "node:child_process";
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

async function main() {
  await acquire();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
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
  const child = spawn(process.execPath, [nextBin, "build", ...args], {
    stdio: "inherit",
    cwd: root,
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
