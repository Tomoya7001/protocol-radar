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
import { observeSpecPages } from "./observeSpecPages";

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
 * One-shot real-source observation for `pnpm observe:once` (and `observe:releases`).
 *
 * Runs BOTH real sources into the SAME ledger, in one process: GitHub Releases
 * (observeReleases) then generic spec pages (observeSpecPages, A2 — 汎用 spec-page 内容ハッシュ
 * 観測ソース). A SINGLE verifyFromRaw() after both passes proves the whole appended chain (the
 * same proof /api/verify?mode=raw runs); it throws if the self-check fails so the CLI exits
 * non-zero. Spec-page observation runs alongside releases without altering the releases path.
 *
 * Refuses to run without PROTOCOL_RADAR_HMAC_SECRET (the ledger key), mirroring the worker.
 */
export async function runObserveReleasesOnce(): Promise<void> {
  assertSecretPresent();

  const db = openMigratedDatabase();
  const client = new FetchHttpClient();
  const logger = consoleLogger;
  const now = new Date();

  const releases = await observeReleases({ db, client, now, logger });
  const specPages = await observeSpecPages({ db, client, now, logger });
  const verified = verifyFromRaw(db);

  logger.info(
    `observeReleases: repos=${releases.reposPolled} events=${releases.eventsCreated} ` +
      `without_releases=${releases.reposWithoutReleases}`,
  );
  logger.info(
    `observeSpecPages: pages=${specPages.pagesPolled} events=${specPages.eventsCreated}`,
  );

  if (verified.ok) {
    logger.info("ledger verifyFromRaw: ok");
  } else {
    logger.error(
      `ledger verifyFromRaw FAILED at seq=${verified.tamperedSeq}: ` +
        `${verified.reason}`,
    );
    throw new Error("ledger verification failed after observing real sources");
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
