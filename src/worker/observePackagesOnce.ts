import type { Db } from "../lib/db/connection";
import { openMigratedDatabase } from "../lib/db";
import { FetchHttpClient } from "../lib/fetch/httpClient";
import { consoleLogger, type Logger } from "../lib/fetch/logger";
import type { HttpClient, SleepFn } from "../lib/fetch/types";
import { verifyFromRaw, type VerifyResult } from "../lib/ledger/ledger";
import type { PackageSource } from "../config/sources/packages";
import { assertSecretPresent } from "./index";
import {
  observePackages,
  type ObservePackagesResult,
} from "./observePackages";

/**
 * Options for a single package observe-and-verify pass (F1). Mirrors ObserveSpecPagesRunOptions
 * so every dependency (db, http client, clock, sources, logger, sleep) is injectable — the CLI
 * wraps real ones, while tests inject fakes/overrides.
 */
export interface ObservePackagesRunOptions {
  db: Db;
  client: HttpClient;
  now: Date;
  sources?: PackageSource[];
  logger?: Logger;
  sleep?: SleepFn;
}

/** Observation counts plus the post-observation ledger self-check. */
export interface ObservePackagesRunResult extends ObservePackagesResult {
  /** Result of verifyFromRaw() run immediately after this pass (the default verify mode). */
  verified: VerifyResult;
}

/**
 * The reusable core of "observe packages once": run a single observePackages() pass, then
 * self-check the ledger with verifyFromRaw() (the same proof /api/verify?mode=raw runs).
 *
 * Mirrors observeSpecPagesAndVerify() — it adds no new ledger/verify logic; when the combined
 * observe loop runs ALL sources in one process (see runObserveReleasesOnce), a single
 * verifyFromRaw() after every pass is enough and this wrapper is used for standalone runs.
 */
export async function observePackagesAndVerify(
  options: ObservePackagesRunOptions,
): Promise<ObservePackagesRunResult> {
  const result = await observePackages(options);
  const verified = verifyFromRaw(options.db);
  return { ...result, verified };
}

/**
 * One-shot real-source observation of SDK package versions for a standalone run
 * (`tsx src/worker/observePackagesOnce.ts`).
 *
 * Wires the real HTTP client into observePackagesAndVerify(), runs a single pass over the
 * configured packages, logs the counts, and throws if the ledger self-check fails so the process
 * exits non-zero. Refuses to run without PROTOCOL_RADAR_HMAC_SECRET (the ledger key).
 */
export async function runObservePackagesOnce(): Promise<void> {
  assertSecretPresent();

  const db = openMigratedDatabase();
  const client = new FetchHttpClient();
  const logger = consoleLogger;

  const result = await observePackagesAndVerify({
    db,
    client,
    now: new Date(),
    logger,
  });

  logger.info(
    `observePackages: packages=${result.packagesPolled} events=${result.eventsCreated} ` +
      `without_version=${result.packagesWithoutVersion}`,
  );

  if (result.verified.ok) {
    logger.info("ledger verifyFromRaw: ok");
  } else {
    logger.error(
      `ledger verifyFromRaw FAILED at seq=${result.verified.tamperedSeq}: ` +
        `${result.verified.reason}`,
    );
    throw new Error("ledger verification failed after observing packages");
  }
}

// Only auto-run when executed directly, not when imported by the combined observe loop.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /observePackagesOnce\.(t|j)s$/.test(process.argv[1]);

if (isDirectRun) {
  runObservePackagesOnce().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
