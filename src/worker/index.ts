import { openMigratedDatabase } from "../lib/db";
import { FetchHttpClient } from "../lib/fetch/httpClient";
import { consoleLogger } from "../lib/fetch/logger";
import { runOnce } from "./runOnce";

/**
 * Long-running worker entry. Sets up a cron-like loop that calls runOnce on a fixed tick;
 * runOnce itself only polls sources whose per-source cadence is due, and the advisory lock
 * prevents overlapping ticks from double-polling.
 *
 * The worker REFUSES to start if PROTOCOL_RADAR_HMAC_SECRET is unset — the ledger cannot
 * operate without its key, so there is no point running.
 */
export function assertSecretPresent(): void {
  const secret = process.env.PROTOCOL_RADAR_HMAC_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new Error(
      "PROTOCOL_RADAR_HMAC_SECRET is unset; the worker refuses to start without the " +
        "ledger key.",
    );
  }
}

/** How often the loop wakes to check for due sources (ms). */
const TICK_MS = 60_000;

export async function startWorker(): Promise<void> {
  assertSecretPresent();

  const db = openMigratedDatabase();
  const client = new FetchHttpClient();
  const logger = consoleLogger;

  logger.info(`worker started; tick=${TICK_MS}ms`);

  const tick = async () => {
    try {
      const result = await runOnce({ db, client, now: new Date(), logger });
      if (result.ran) {
        logger.info(
          `run ${result.runId}: polled=${result.sourcesPolled} events=${result.eventsCreated}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`tick failed: ${message}`);
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, TICK_MS);
}

// Only auto-start when executed directly (npm run worker), not when imported by tests.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /worker[/\\]index\.(t|j)s$/.test(process.argv[1]);

if (isDirectRun) {
  startWorker().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
