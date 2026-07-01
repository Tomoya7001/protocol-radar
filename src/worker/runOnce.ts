import type { Db } from "../lib/db/connection";
import type { SourceRow } from "../lib/db/types";
import {
  finishRun,
  getLatestObservation,
  insertRun,
  listSources,
  updateSourcePoll,
} from "../lib/db/repo";
import { classifyAndAppend } from "../lib/diff/engine";
import { fetchSource, type FetchOutcome } from "../lib/fetch/fetchCore";
import { pollGithub } from "../lib/fetch/github";
import type { HttpClient, SleepFn } from "../lib/fetch/types";
import { noSleep } from "../lib/fetch/types";
import { consoleLogger, type Logger } from "../lib/fetch/logger";
import { acquireLock, releaseLock } from "./lock";

export interface RunOnceOptions {
  db: Db;
  client: HttpClient;
  /** Current time. Injected so tests control cadence deterministically. */
  now: Date;
  logger?: Logger;
  /** Injectable sleep for retry backoff (tests pass noSleep). */
  sleep?: SleepFn;
}

export interface RunOnceResult {
  /** False when the lock was already held (skipped to avoid double-polling). */
  ran: boolean;
  sourcesPolled: number;
  eventsCreated: number;
  runId: number | null;
}

/** Latest version/tag previously observed for a github source, if any. */
function previousVersion(db: Db, source: SourceRow): string | null {
  if (source.kind !== "github") return null;
  const latest = getLatestObservation(db, source.id);
  // For github sources we store the resolved ref name in the observation body.
  return latest?.body ?? null;
}

function isDue(source: SourceRow, now: Date): boolean {
  if (source.active !== 1) return false;
  if (!source.last_polled_at) return true;
  const last = Date.parse(source.last_polled_at);
  if (Number.isNaN(last)) return true;
  return last + source.cadence_seconds * 1000 <= now.getTime();
}

/**
 * Poll all due active sources exactly once. Acquires the advisory lock first; if a
 * concurrent run holds it, returns { ran: false } without touching any source. For each
 * due source it fetches (F-003), classifies + appends (F-004/F-002), updates polling
 * bookkeeping, and writes a runs row (run log). A single failing source is logged and
 * skipped — it never aborts the run.
 */
export async function runOnce(options: RunOnceOptions): Promise<RunOnceResult> {
  const { db, client, now } = options;
  const logger = options.logger ?? consoleLogger;
  const sleep = options.sleep ?? noSleep;
  const nowIso = now.toISOString();

  if (!acquireLock(db, nowIso)) {
    logger.warn("runOnce skipped: another run holds the lock");
    return { ran: false, sourcesPolled: 0, eventsCreated: 0, runId: null };
  }

  const run = insertRun(db, { started_at: nowIso });
  let sourcesPolled = 0;
  let eventsCreated = 0;
  let ok = true;

  try {
    const due = listSources(db).filter((s) => isDue(s, now));

    for (const source of due) {
      sourcesPolled++;
      try {
        let outcome: FetchOutcome;
        let version: string | null = null;
        const prevVersion = previousVersion(db, source);

        if (source.kind === "github") {
          const poll = await pollGithub(
            client,
            {
              url: source.url,
              etag: source.etag,
              lastModified: source.last_modified,
            },
            { sleep },
          );
          outcome = poll.outcome;
          version = poll.latestRef ?? null;
          // Store the resolved ref as the observation body so the next run can compare.
          if (outcome.kind === "content" && version) {
            outcome = { ...outcome, body: version };
          }
        } else {
          outcome = await fetchSource(
            client,
            {
              url: source.url,
              kind: "http",
              etag: source.etag,
              lastModified: source.last_modified,
            },
            { sleep },
          );
        }

        const result = classifyAndAppend({
          db,
          protocolId: source.protocol_id,
          sourceId: source.id,
          fetchedAt: nowIso,
          outcome,
          version,
          prevVersion,
        });
        if (result.event) eventsCreated++;

        // Update polling bookkeeping. Only overwrite etag/last_modified on fresh content.
        const status =
          outcome.kind === "content"
            ? outcome.httpStatus
            : outcome.kind === "absent"
              ? outcome.httpStatus
              : outcome.kind === "not_modified"
                ? 304
                : (outcome.httpStatus ?? null);

        if (outcome.kind === "content") {
          updateSourcePoll(db, source.id, {
            last_polled_at: nowIso,
            last_status: status,
            etag: outcome.etag,
            last_modified: outcome.lastModified,
          });
        } else {
          updateSourcePoll(db, source.id, {
            last_polled_at: nowIso,
            last_status: status,
          });
        }
      } catch (err) {
        ok = false;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`source ${source.id} (${source.url}) failed: ${message}`);
        // Still record that we attempted it, so cadence advances and we don't hot-loop.
        updateSourcePoll(db, source.id, {
          last_polled_at: nowIso,
          last_status: null,
        });
      }
    }

    finishRun(db, run.id, {
      finished_at: new Date().toISOString(),
      sources_polled: sourcesPolled,
      events_created: eventsCreated,
      ok,
      note: ok ? null : "one or more sources failed",
    });

    return { ran: true, sourcesPolled, eventsCreated, runId: run.id };
  } finally {
    releaseLock(db);
  }
}
