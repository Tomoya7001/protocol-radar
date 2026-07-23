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
import type { FetchOutcome } from "../lib/fetch/fetchCore";
import {
  normalizePackageBody,
  packageContentHash,
  pollPackageVersion,
  previousPackageVersion,
} from "../lib/fetch/packageRegistry";
import type { HttpClient, SleepFn } from "../lib/fetch/types";
import { noSleep } from "../lib/fetch/types";
import { consoleLogger, type Logger } from "../lib/fetch/logger";
import {
  PACKAGE_SOURCES,
  PACKAGE_SOURCE_KIND,
  packageSourceUrl,
  type PackageSource,
} from "../config/sources/packages";

/**
 * Observe SDK package versions (npm + PyPI) as a real, always-on source
 * (F1 — npm + PyPI パッケージバージョン観測ソース).
 *
 * This module is a MIRROR of observeReleases.ts and deliberately reuses the EXISTING
 * observation → ledger pipeline:
 *   pollPackageVersion()  →  classifyAndAppend()  →  append()  (HMAC hash-chain)
 * It adds no new ledger/verify logic; it only wires the registry "latest version" into the same
 * diff engine. A first-seen package => `appeared`, a newer published version => `version_bump`,
 * an unchanged version => no event, and a package that 404/410s after being present => `vanished`.
 *
 * Provenance invariant — the single rule that keeps verifyFromRaw() (the default /api/verify
 * mode) green — is that an observation's stored `content_hash` MUST equal sha256(its body). We
 * therefore persist the DETERMINISTIC normalizePackageBody() string and compute content_hash
 * from those SAME bytes (instead of the raw registry JSON, which would break raw verification).
 */
export interface ObservePackagesOptions {
  db: Db;
  client: HttpClient;
  /** Current time. Injected so callers/tests control it deterministically. */
  now: Date;
  /** Packages to observe. Defaults to the configured PACKAGE_SOURCES. */
  sources?: PackageSource[];
  logger?: Logger;
  /** Injectable sleep for retry backoff (tests pass noSleep). */
  sleep?: SleepFn;
}

export interface ObservePackagesResult {
  packagesPolled: number;
  /** Observations that produced a ledger event (appeared / version_bump / vanished). */
  eventsCreated: number;
  /** Packages skipped because the registry returned 200 but exposed no parseable version. */
  packagesWithoutVersion: number;
}

/**
 * Find the existing package source for a protocol/url, or create it. Reuses the same
 * (protocol_id, url) uniqueness convention as the other observers so re-runs — and any source a
 * prior pass already created for the same package — are never duplicated.
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
    kind: PACKAGE_SOURCE_KIND,
    url,
    label,
    cadence_seconds: cadenceSeconds,
    active: true,
  });
}

/** Map a non-content poll outcome to the last_status value recorded on the source row. */
function nonContentStatus(outcome: {
  kind: "not_modified" | "absent" | "error";
  httpStatus?: number | null;
}): number | null {
  if (outcome.kind === "not_modified") return 304;
  return outcome.httpStatus ?? null;
}

/**
 * Poll every configured package feed exactly once and fold changes into the ledger. A single
 * failing package is logged and skipped — it never aborts the batch. Returns counts for the
 * caller to log/verify.
 */
export async function observePackages(
  options: ObservePackagesOptions,
): Promise<ObservePackagesResult> {
  const { db, client, now } = options;
  const sources = options.sources ?? PACKAGE_SOURCES;
  const logger = options.logger ?? consoleLogger;
  const sleep = options.sleep ?? noSleep;
  const nowIso = now.toISOString();

  let packagesPolled = 0;
  let eventsCreated = 0;
  let packagesWithoutVersion = 0;

  for (const pkg of sources) {
    packagesPolled++;
    try {
      const protocol =
        getProtocolByKey(db, pkg.protocolKey) ??
        insertProtocol(db, {
          key: pkg.protocolKey,
          name: pkg.protocolName,
          layer: "B",
        });

      const url = packageSourceUrl(pkg);
      const source = ensureSource(
        db,
        protocol.id,
        url,
        pkg.label,
        pkg.cadenceSeconds,
      );

      const prev = getLatestObservation(db, source.id);
      const prevVersion = previousPackageVersion(prev?.body ?? null);

      const poll = await pollPackageVersion(
        client,
        {
          registry: pkg.registry,
          url,
          etag: source.etag,
          lastModified: source.last_modified,
        },
        { sleep },
      );

      // Non-content outcomes (not_modified / absent / error) pass straight through the diff
      // engine, which records nothing new — or a `vanished` event if the package was present
      // before (404/410). That vanish IS a real ledger event, so it is counted here too.
      if (poll.outcome.kind !== "content") {
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
            `packages ${pkg.registry}:${pkg.packageName}: ${result.eventType} ` +
              `(event seq=${result.event.seq})`,
          );
        }
        updateSourcePoll(db, source.id, {
          last_polled_at: nowIso,
          last_status: nonContentStatus(poll.outcome),
        });
        continue;
      }

      const version = poll.version ?? null;
      if (version === null) {
        // Registry answered 200 but exposed no version we could parse: never fabricate one —
        // record no event, just advance bookkeeping (and remember validators for the next GET).
        packagesWithoutVersion++;
        updateSourcePoll(db, source.id, {
          last_polled_at: nowIso,
          last_status: poll.outcome.httpStatus,
          etag: poll.outcome.etag,
          last_modified: poll.outcome.lastModified,
        });
        continue;
      }

      const body = normalizePackageBody(pkg.registry, pkg.packageName, version);
      // Provenance invariant: content_hash is derived from the SAME bytes we store as body, so
      // verifyFromRaw() (sha256(body) === content_hash) holds for every package event.
      const normalized: FetchOutcome = {
        kind: "content",
        httpStatus: poll.outcome.httpStatus,
        body,
        contentHash: packageContentHash(pkg.registry, pkg.packageName, version),
        etag: poll.outcome.etag,
        lastModified: poll.outcome.lastModified,
      };

      const result = classifyAndAppend({
        db,
        protocolId: protocol.id,
        sourceId: source.id,
        fetchedAt: nowIso,
        outcome: normalized,
        version,
        prevVersion,
      });
      if (result.event) {
        eventsCreated++;
        logger.info(
          `packages ${pkg.registry}:${pkg.packageName}: ${result.eventType} @ ${version} ` +
            `(event seq=${result.event.seq})`,
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
      logger.error(
        `packages ${pkg.registry}:${pkg.packageName} failed: ${message}`,
      );
    }
  }

  return { packagesPolled, eventsCreated, packagesWithoutVersion };
}
