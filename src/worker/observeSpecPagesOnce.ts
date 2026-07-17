import type { Db } from "../lib/db/connection";
import { openMigratedDatabase } from "../lib/db";
import { FetchHttpClient } from "../lib/fetch/httpClient";
import { consoleLogger, type Logger } from "../lib/fetch/logger";
import type { HttpClient, SleepFn } from "../lib/fetch/types";
import { verifyFromRaw, type VerifyResult } from "../lib/ledger/ledger";
import type { SpecPageSource } from "../config/sources/specPages";
import { assertSecretPresent } from "./index";
import {
  observeSpecPages,
  type ObserveSpecPagesResult,
} from "./observeSpecPages";

/**
 * Options for a single spec-page observe-and-verify pass (A2). Mirrors ObserveReleasesRunOptions
 * so every dependency (db, http client, clock, sources, logger, sleep) is injectable — the CLI
 * wraps real ones, while tests inject fakes/overrides.
 */
export interface ObserveSpecPagesRunOptions {
  db: Db;
  client: HttpClient;
  now: Date;
  sources?: SpecPageSource[];
  logger?: Logger;
  sleep?: SleepFn;
}

/** Observation counts plus the post-observation ledger self-check. */
export interface ObserveSpecPagesRunResult extends ObserveSpecPagesResult {
  /** Result of verifyFromRaw() run immediately after this pass (the default verify mode). */
  verified: VerifyResult;
}

/**
 * The reusable core of "observe spec pages once": run a single observeSpecPages() pass, then
 * self-check the ledger with verifyFromRaw() (the same proof /api/verify?mode=raw runs).
 *
 * Mirrors observeReleasesAndVerify() — it adds no new ledger/verify logic; when the observe
 * loop runs BOTH sources in one process (see runObserveReleasesOnce), a single verifyFromRaw()
 * after both passes is enough and this wrapper is used for standalone spec-page runs.
 */
export async function observeSpecPagesAndVerify(
  options: ObserveSpecPagesRunOptions,
): Promise<ObserveSpecPagesRunResult> {
  const result = await observeSpecPages(options);
  const verified = verifyFromRaw(options.db);
  return { ...result, verified };
}

/**
 * One-shot real-source observation of spec pages for a standalone run
 * (`tsx src/worker/observeSpecPagesOnce.ts`).
 *
 * Wires the real HTTP client into observeSpecPagesAndVerify(), runs a single pass over the
 * configured spec pages, logs the counts, and throws if the ledger self-check fails so the
 * process exits non-zero. Refuses to run without PROTOCOL_RADAR_HMAC_SECRET (the ledger key).
 */
export async function runObserveSpecPagesOnce(): Promise<void> {
  assertSecretPresent();

  const db = openMigratedDatabase();
  const client = new FetchHttpClient();
  const logger = consoleLogger;

  const result = await observeSpecPagesAndVerify({
    db,
    client,
    now: new Date(),
    logger,
  });

  logger.info(
    `observeSpecPages: pages=${result.pagesPolled} events=${result.eventsCreated}`,
  );

  if (result.verified.ok) {
    logger.info("ledger verifyFromRaw: ok");
  } else {
    logger.error(
      `ledger verifyFromRaw FAILED at seq=${result.verified.tamperedSeq}: ` +
        `${result.verified.reason}`,
    );
    throw new Error("ledger verification failed after observing spec pages");
  }
}

// Only auto-run when executed directly, not when imported by the combined observe loop.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /observeSpecPagesOnce\.(t|j)s$/.test(process.argv[1]);

if (isDirectRun) {
  runObserveSpecPagesOnce().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
