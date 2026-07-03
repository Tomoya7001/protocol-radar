/**
 * Future-spec watchlist monitor (F-020).
 *
 * Fires an `appeared` event EXACTLY ONCE the first time a watched, pre-announced spec URL
 * returns real content. It reuses the Layer A diff engine, whose `appeared` classification
 * already triggers only on the first present observation for a source — so re-polling
 * unchanged content produces no further event. This module is a thin, testable wrapper that
 * (a) exposes that first-appearance semantic directly and (b) drives it over the watchlist
 * sources the seed engine tagged with WATCHLIST_LAYER.
 */
import type { Db } from "@/lib/db";
import {
  getLatestObservation,
  listProtocols,
  listSources,
  updateSourcePoll,
} from "@/lib/db/repo";
import type { EventRow } from "@/lib/db/types";
import { classifyAndAppend } from "@/lib/diff/engine";
import { fetchSource, type FetchOutcome } from "@/lib/fetch/fetchCore";
import { pollGithub } from "@/lib/fetch/github";
import type { HttpClient, SleepFn } from "@/lib/fetch/types";
import { noSleep } from "@/lib/fetch/types";
import { consoleLogger, type Logger } from "@/lib/fetch/logger";
import { WATCHLIST_LAYER } from "@/config/sources/types";

export interface FirstAppearance {
  /** True only on the poll that first records the spec as present. */
  fired: boolean;
  event: EventRow | null;
}

export interface RecordFirstAppearanceInput {
  db: Db;
  protocolId: number;
  sourceId: number;
  fetchedAt: string;
  outcome: FetchOutcome;
  version?: string | null;
  prevVersion?: string | null;
}

/**
 * Pure, network-free core: classify one poll outcome and report whether THIS call fired the
 * first-appearance event. Idempotent — an unchanged re-poll returns { fired: false }.
 */
export function recordFirstAppearance(
  input: RecordFirstAppearanceInput,
): FirstAppearance {
  const result = classifyAndAppend(input);
  return { fired: result.eventType === "appeared", event: result.event };
}

export interface WatchPollResult {
  protocolKey: string;
  sourceUrl: string;
  /** True when this poll fired the one-time first-appearance event. */
  fired: boolean;
}

export interface RunWatchlistOptions {
  db: Db;
  client: HttpClient;
  now: Date;
  logger?: Logger;
  sleep?: SleepFn;
}

/**
 * Poll every ACTIVE watchlist source once and fire first-appearance where content newly
 * appears. A failing source is logged and skipped — it never aborts the sweep.
 */
export async function runWatchlistOnce(
  options: RunWatchlistOptions,
): Promise<WatchPollResult[]> {
  const { db, client, now } = options;
  const logger = options.logger ?? consoleLogger;
  const sleep = options.sleep ?? noSleep;
  const nowIso = now.toISOString();

  const watchProtocols = listProtocols(db).filter(
    (p) => p.layer === WATCHLIST_LAYER,
  );
  const byId = new Map(watchProtocols.map((p) => [p.id, p]));
  const results: WatchPollResult[] = [];

  for (const source of listSources(db)) {
    const proto = byId.get(source.protocol_id);
    if (!proto) continue; // not a watchlist source
    if (source.active !== 1) continue;

    try {
      let outcome: FetchOutcome;
      let version: string | null = null;
      let prevVersion: string | null = null;

      if (source.kind === "github") {
        prevVersion = getLatestObservation(db, source.id)?.body ?? null;
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

      const { fired } = recordFirstAppearance({
        db,
        protocolId: source.protocol_id,
        sourceId: source.id,
        fetchedAt: nowIso,
        outcome,
        version,
        prevVersion,
      });

      if (fired) {
        logger.info(`watchlist: ${proto.key} first appeared at ${source.url}`);
      }
      results.push({ protocolKey: proto.key, sourceUrl: source.url, fired });

      // Advance polling bookkeeping (mirrors the worker; only refresh etag on content).
      if (outcome.kind === "content") {
        updateSourcePoll(db, source.id, {
          last_polled_at: nowIso,
          last_status: outcome.httpStatus,
          etag: outcome.etag,
          last_modified: outcome.lastModified,
        });
      } else {
        const status =
          outcome.kind === "absent"
            ? outcome.httpStatus
            : outcome.kind === "not_modified"
              ? 304
              : (outcome.httpStatus ?? null);
        updateSourcePoll(db, source.id, {
          last_polled_at: nowIso,
          last_status: status,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`watchlist source ${source.url} failed: ${message}`);
    }
  }

  return results;
}
