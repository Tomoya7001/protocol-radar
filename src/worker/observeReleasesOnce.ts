import type { Db } from "../lib/db/connection";
import { openMigratedDatabase } from "../lib/db";
import { FetchHttpClient } from "../lib/fetch/httpClient";
import { consoleLogger, type Logger } from "../lib/fetch/logger";
import type { HttpClient, SleepFn } from "../lib/fetch/types";
import { verifyFromRaw, type VerifyResult } from "../lib/ledger/ledger";
import type { GithubReleaseRepo } from "../config/sources/releases";
import { assertSecretPresent } from "./index";
import {
  observeReleases,
  type ObserveReleasesResult,
} from "./observeReleases";

/**
 * Options for a single observe-and-verify pass. Mirrors ObserveReleasesOptions so every
 * dependency (db, http client, clock, repos, logger, sleep) is injectable — the CLI wraps
 * real ones, while tests and the /api/cron/observe route inject fakes/overrides.
 */
export interface ObserveReleasesRunOptions {
  db: Db;
  client: HttpClient;
  now: Date;
  repos?: GithubReleaseRepo[];
  logger?: Logger;
  sleep?: SleepFn;
}

/** Observation counts plus the post-observation ledger self-check. */
export interface ObserveReleasesRunResult extends ObserveReleasesResult {
  /** Result of verifyFromRaw() run immediately after this pass (the default verify mode). */
  verified: VerifyResult;
}

/**
 * The reusable core of "observe releases once": run a single observeReleases() pass, then
 * self-check the ledger with verifyFromRaw() (the same proof /api/verify?mode=raw runs).
 *
 * This is the SINGLE shared implementation used by every caller — the `observe:releases`
 * CLI (runObserveReleasesOnce below), the future worker tick, and the Vercel Cron route
 * (GET /api/cron/observe). Callers only differ in how they build dependencies and how they
 * surface the result (log vs. HTTP JSON); the observation + verification logic lives here so
 * it is never duplicated.
 */
export async function observeReleasesAndVerify(
  options: ObserveReleasesRunOptions,
): Promise<ObserveReleasesRunResult> {
  const result = await observeReleases(options);
  const verified = verifyFromRaw(options.db);
  return { ...result, verified };
}

/**
 * One-shot real-source observation of GitHub Releases for `npm run observe:releases`.
 *
 * Wires the real HTTP client into observeReleasesAndVerify(), runs a single pass over the
 * configured repos, logs the counts, and throws if the ledger self-check fails so the CLI
 * exits non-zero. The long-running worker (index.ts) and the cron route reuse the same core.
 *
 * Refuses to run without PROTOCOL_RADAR_HMAC_SECRET (the ledger key), mirroring the worker.
 */
export async function runObserveReleasesOnce(): Promise<void> {
  assertSecretPresent();

  const db = openMigratedDatabase();
  const client = new FetchHttpClient();
  const logger = consoleLogger;

  const result = await observeReleasesAndVerify({
    db,
    client,
    now: new Date(),
    logger,
  });

  logger.info(
    `observeReleases: repos=${result.reposPolled} events=${result.eventsCreated} ` +
      `without_releases=${result.reposWithoutReleases}`,
  );

  if (result.verified.ok) {
    logger.info("ledger verifyFromRaw: ok");
  } else {
    logger.error(
      `ledger verifyFromRaw FAILED at seq=${result.verified.tamperedSeq}: ` +
        `${result.verified.reason}`,
    );
    throw new Error("ledger verification failed after observing releases");
  }
}

// Only auto-run when executed directly (npm run observe:releases), not when imported.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /observeReleasesOnce\.(t|j)s$/.test(process.argv[1]);

if (isDirectRun) {
  runObserveReleasesOnce().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
