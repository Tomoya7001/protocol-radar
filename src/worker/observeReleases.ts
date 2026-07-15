import type { Db } from "../lib/db/connection";
import type { SourceRow } from "../lib/db/types";
import {
  getLatestObservation,
  getProtocolByKey,
  insertProtocol,
  insertSource,
  listSources,
  updateSourcePoll,
} from "../lib/db/repo";
import { classifyAndAppend } from "../lib/diff/engine";
import { contentHash } from "../lib/fetch/hash";
import { parseGithubRefs, pollGithub } from "../lib/fetch/github";
import type { FetchOutcome } from "../lib/fetch/fetchCore";
import type { HttpClient, SleepFn } from "../lib/fetch/types";
import { noSleep } from "../lib/fetch/types";
import { consoleLogger, type Logger } from "../lib/fetch/logger";
import {
  GITHUB_RELEASE_REPOS,
  RELEASE_SOURCE_KIND,
  releasesUrl,
  type GithubReleaseRepo,
} from "../config/sources/releases";

/**
 * Observe GitHub Releases as a real, always-on source (残② — 実ソースの常時観測).
 *
 * This module deliberately reuses the EXISTING observation → ledger pipeline:
 *   pollGithub()  →  classifyAndAppend()  →  append()  (HMAC hash-chain)
 * It adds no new ledger logic; it only wires a real GitHub Releases feed into it.
 *
 * Provenance integrity — the single rule that makes verifyFromRaw() (the default /api/verify
 * mode) stay green — is that an observation's stored `content_hash` MUST equal
 * sha256(observation.body). We therefore persist a NORMALIZED body (the JSON list of release
 * tag names at observation time) and compute its content hash from that exact bytes, instead
 * of the runOnce github path's ref-name substitution (which stores body=ref but
 * content_hash=hash(full JSON) and would break raw verification).
 */
export interface ObserveReleasesOptions {
  db: Db;
  client: HttpClient;
  /** Current time. Injected so callers/tests control it deterministically. */
  now: Date;
  /** Repos to observe. Defaults to the configured GITHUB_RELEASE_REPOS. */
  repos?: GithubReleaseRepo[];
  logger?: Logger;
  /** Injectable sleep for retry backoff (tests pass noSleep). */
  sleep?: SleepFn;
}

export interface ObserveReleasesResult {
  reposPolled: number;
  /** Observations that produced a ledger event (appeared / version_bump / spec_change). */
  eventsCreated: number;
  /** Repos skipped because they have published no releases yet. */
  reposWithoutReleases: number;
}

/** Normalize a ref list into a stable, hashable body: JSON array of `{ name }` objects. */
function normalizeBody(names: string[]): string {
  return JSON.stringify(names.map((name) => ({ name })));
}

/** Latest release tag recorded in a prior observation's (normalized) body, or null. */
function previousVersion(body: string | null): string | null {
  if (!body) return null;
  return parseGithubRefs(body)[0]?.name ?? null;
}

/**
 * Find the existing releases source for a protocol/url, or create it. Reuses the same
 * (protocol_id, url) uniqueness convention as the seed engine so re-runs never duplicate.
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
    kind: RELEASE_SOURCE_KIND,
    url,
    label,
    cadence_seconds: cadenceSeconds,
    active: true,
  });
}

/**
 * Poll every configured releases feed exactly once and fold changes into the ledger. A
 * single failing repo is logged and skipped — it never aborts the batch. Returns counts for
 * the caller to log/verify.
 */
export async function observeReleases(
  options: ObserveReleasesOptions,
): Promise<ObserveReleasesResult> {
  const { db, client, now } = options;
  const repos = options.repos ?? GITHUB_RELEASE_REPOS;
  const logger = options.logger ?? consoleLogger;
  const sleep = options.sleep ?? noSleep;
  const nowIso = now.toISOString();

  let reposPolled = 0;
  let eventsCreated = 0;
  let reposWithoutReleases = 0;

  for (const repo of repos) {
    reposPolled++;
    try {
      const protocol =
        getProtocolByKey(db, repo.protocolKey) ??
        insertProtocol(db, {
          key: repo.protocolKey,
          name: repo.protocolName,
          layer: "B",
        });

      const url = releasesUrl(repo.repo);
      const source = ensureSource(
        db,
        protocol.id,
        url,
        repo.label,
        repo.cadenceSeconds,
      );

      const prev = getLatestObservation(db, source.id);
      const prevVersion = previousVersion(prev?.body ?? null);

      const poll = await pollGithub(
        client,
        { url, etag: source.etag, lastModified: source.last_modified },
        { sleep },
      );

      // Non-content outcomes (not_modified / absent / error) pass straight through the diff
      // engine, which correctly records nothing new (or a vanish if it was present before).
      if (poll.outcome.kind !== "content") {
        classifyAndAppend({
          db,
          protocolId: protocol.id,
          sourceId: source.id,
          fetchedAt: nowIso,
          outcome: poll.outcome,
        });
        updateSourcePoll(db, source.id, {
          last_polled_at: nowIso,
          last_status:
            poll.outcome.kind === "not_modified"
              ? 304
              : poll.outcome.kind === "absent"
                ? poll.outcome.httpStatus
                : (poll.outcome.httpStatus ?? null),
        });
        continue;
      }

      const refs = poll.refs ?? [];
      if (refs.length === 0) {
        // Repo exists but has published no releases yet: first-appearance rule — record no
        // event, just advance polling bookkeeping (and remember the etag for conditional GET).
        reposWithoutReleases++;
        updateSourcePoll(db, source.id, {
          last_polled_at: nowIso,
          last_status: poll.outcome.httpStatus,
          etag: poll.outcome.etag,
          last_modified: poll.outcome.lastModified,
        });
        continue;
      }

      const names = refs.map((r) => r.name);
      const body = normalizeBody(names);
      // Provenance invariant: content_hash is derived from the SAME bytes we store as body,
      // so verifyFromRaw() (sha256(body) === content_hash) holds for every release event.
      const normalized: FetchOutcome = {
        kind: "content",
        httpStatus: poll.outcome.httpStatus,
        body,
        contentHash: contentHash(body),
        etag: poll.outcome.etag,
        lastModified: poll.outcome.lastModified,
      };

      const result = classifyAndAppend({
        db,
        protocolId: protocol.id,
        sourceId: source.id,
        fetchedAt: nowIso,
        outcome: normalized,
        version: names[0],
        prevVersion,
      });
      if (result.event) {
        eventsCreated++;
        logger.info(
          `releases ${repo.repo}: ${result.eventType} @ ${names[0]} (event seq=${result.event.seq})`,
        );
      }

      updateSourcePoll(db, source.id, {
        last_polled_at: nowIso,
        last_status: poll.outcome.httpStatus,
        etag: poll.outcome.etag,
        last_modified: poll.outcome.lastModified,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`releases ${repo.repo} failed: ${message}`);
    }
  }

  return { reposPolled, eventsCreated, reposWithoutReleases };
}
