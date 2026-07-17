import type { Db } from "../lib/db/connection";
import type { SourceRow } from "../lib/db/types";
import {
  getProtocolByKey,
  insertProtocol,
  insertSource,
  listSources,
  updateSourcePoll,
} from "../lib/db/repo";
import { classifyAndAppend } from "../lib/diff/engine";
import { pollSpecPage } from "../lib/fetch/specPage";
import type { HttpClient, SleepFn } from "../lib/fetch/types";
import { noSleep } from "../lib/fetch/types";
import { consoleLogger, type Logger } from "../lib/fetch/logger";
import {
  SPEC_PAGE_SOURCES,
  SPEC_SOURCE_KIND,
  specPageUrl,
  type SpecPageSource,
} from "../config/sources/specPages";

/**
 * Observe generic spec/RFC/registry pages as a real, always-on source
 * (A2 — 汎用 spec-page 内容ハッシュ観測ソース).
 *
 * This module is a MIRROR of observeReleases.ts and deliberately reuses the EXISTING
 * observation → ledger pipeline:
 *   pollSpecPage()  →  classifyAndAppend()  →  append()  (HMAC hash-chain)
 * It adds no new ledger/verify logic; it only wires real spec pages into the same diff engine.
 *
 * Provenance invariant — the single rule that keeps verifyFromRaw() (the default /api/verify
 * mode) green — is that an observation's stored `content_hash` MUST equal sha256(its body).
 * pollSpecPage() already produces a content outcome whose body is the DETERMINISTIC page
 * normalization and whose contentHash is derived from those SAME bytes, so we persist the
 * outcome unchanged. Spec pages carry no version, so the diff engine classifies a body change
 * as `spec_change` (first observation => `appeared`, 404/410 => `vanished`).
 */
export interface ObserveSpecPagesOptions {
  db: Db;
  client: HttpClient;
  /** Current time. Injected so callers/tests control it deterministically. */
  now: Date;
  /** Pages to observe. Defaults to the configured SPEC_PAGE_SOURCES. */
  sources?: SpecPageSource[];
  logger?: Logger;
  /** Injectable sleep for retry backoff (tests pass noSleep). */
  sleep?: SleepFn;
}

export interface ObserveSpecPagesResult {
  pagesPolled: number;
  /** Observations that produced a ledger event (appeared / spec_change / vanished). */
  eventsCreated: number;
}

/**
 * Find the existing http source for a protocol/url, or create it. Reuses the same
 * (protocol_id, url) uniqueness convention as the seed engine so re-runs — and any source the
 * seed already created for the same spec page — are never duplicated.
 */
function ensureSource(
  db: Db,
  protocolId: number,
  url: string,
  label: string,
  cadenceSeconds: number,
): SourceRow {
  const existing = listSources(db).find(
    (s) => s.protocol_id === protocolId && s.url === url,
  );
  if (existing) return existing;
  return insertSource(db, {
    protocol_id: protocolId,
    kind: SPEC_SOURCE_KIND,
    url,
    label,
    cadence_seconds: cadenceSeconds,
    active: true,
  });
}

/** Map a poll outcome kind to the last_status value recorded on the source row. */
function statusFor(outcome: {
  kind: "not_modified" | "content" | "absent" | "error";
  httpStatus?: number | null;
}): number | null {
  if (outcome.kind === "not_modified") return 304;
  return outcome.httpStatus ?? null;
}

/**
 * Poll every configured spec page exactly once and fold changes into the ledger. A single
 * failing page is logged and skipped — it never aborts the batch. Returns counts for the
 * caller to log/verify.
 */
export async function observeSpecPages(
  options: ObserveSpecPagesOptions,
): Promise<ObserveSpecPagesResult> {
  const { db, client, now } = options;
  const sources = options.sources ?? SPEC_PAGE_SOURCES;
  const logger = options.logger ?? consoleLogger;
  const sleep = options.sleep ?? noSleep;
  const nowIso = now.toISOString();

  let pagesPolled = 0;
  let eventsCreated = 0;

  for (const page of sources) {
    pagesPolled++;
    try {
      const protocol =
        getProtocolByKey(db, page.protocolKey) ??
        insertProtocol(db, {
          key: page.protocolKey,
          name: page.protocolName,
          layer: "B",
        });

      const url = specPageUrl(page.url);
      const source = ensureSource(
        db,
        protocol.id,
        url,
        page.label,
        page.cadenceSeconds,
      );

      const poll = await pollSpecPage(
        client,
        { url, etag: source.etag, lastModified: source.last_modified },
        { sleep },
      );

      // Every outcome — content / not_modified / absent (vanish) / error — flows through the
      // SAME diff engine: it records nothing on not_modified/error, an appeared/spec_change on
      // content, and a vanish when a previously-present page 404/410s.
      const result = classifyAndAppend({
        db,
        protocolId: protocol.id,
        sourceId: source.id,
        fetchedAt: nowIso,
        outcome: poll.outcome,
      });
      if (result.event) {
        eventsCreated++;
        logger.info(
          `spec-page ${url}: ${result.eventType} (event seq=${result.event.seq})`,
        );
      }

      // Bookkeeping: advance polling metadata. On a content outcome remember the validators so
      // the next poll can issue a conditional GET; otherwise just record status.
      if (poll.outcome.kind === "content") {
        updateSourcePoll(db, source.id, {
          last_polled_at: nowIso,
          last_status: poll.outcome.httpStatus,
          etag: poll.outcome.etag,
          last_modified: poll.outcome.lastModified,
        });
      } else {
        updateSourcePoll(db, source.id, {
          last_polled_at: nowIso,
          last_status: statusFor(poll.outcome),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`spec-page ${page.url} failed: ${message}`);
    }
  }

  return { pagesPolled, eventsCreated };
}
