import type { Db } from "../db/connection";
import type { EventRow, EventType, ObservationRow } from "../db/types";
import {
  getLatestObservation,
  insertDiff,
  insertObservation,
  setProtocolStatus,
  setSourceActive,
} from "../db/repo";
import { append } from "../ledger/ledger";
import type { FetchOutcome } from "../fetch/fetchCore";
import { compareVersions } from "./version";
import { summarizeBodyDiff } from "./bodyDiff";

/**
 * Input to the diff engine for a single source poll. `outcome` is the result from the
 * fetch core. `version` / `prevVersion` are the tag/version derived by the caller (e.g.
 * GitHub latestRef); null for plain HTTP body sources.
 */
export interface DiffInput {
  db: Db;
  protocolId: number;
  sourceId: number;
  fetchedAt: string;
  outcome: FetchOutcome;
  /** Version/tag observed now (GitHub sources). */
  version?: string | null;
  /** Version/tag from the last observation (GitHub sources). */
  prevVersion?: string | null;
}

export interface DiffResult {
  /** The event appended, if any. Null when there was no change / not_modified. */
  event: EventRow | null;
  eventType: EventType | null;
  observation: ObservationRow | null;
}

/**
 * Classify a poll result against the previous observation and append the right event
 * through the hash-chain ledger. Writes an observation row for content/vanish outcomes and
 * a diffs row where applicable, and updates protocol/source status on vanish.
 *
 * Classification:
 *  - not_modified / error  => no observation, no event.
 *  - content, no previous observation (first ever) => 'appeared'.
 *  - content, version differs => 'version_bump'.
 *  - content, content_hash differs (not a version bump) => 'spec_change' + body diff.
 *  - content, unchanged hash/version => no event.
 *  - absent (404/410), previously present => 'vanished' + status update.
 *  - absent, and already absent/first-time => no event.
 */
export function classifyAndAppend(input: DiffInput): DiffResult {
  const {
    db,
    protocolId,
    sourceId,
    fetchedAt,
    outcome,
    version = null,
    prevVersion = null,
  } = input;

  const previous = getLatestObservation(db, sourceId);

  // No new data on not_modified or transient error.
  if (outcome.kind === "not_modified" || outcome.kind === "error") {
    return { event: null, eventType: null, observation: null };
  }

  // ---- vanish path ----
  if (outcome.kind === "absent") {
    const wasPresent = previous?.is_present === 1;
    if (!wasPresent) {
      // Never seen, or already recorded absent: nothing new to record.
      return { event: null, eventType: null, observation: null };
    }

    const observation = insertObservation(db, {
      source_id: sourceId,
      fetched_at: fetchedAt,
      http_status: outcome.httpStatus,
      content_hash: null,
      body: null,
      is_present: false,
    });

    const event = append(db, {
      protocol_id: protocolId,
      source_id: sourceId,
      type: "vanished",
      summary: `source vanished (HTTP ${outcome.httpStatus})`,
      ref_observation_id: observation.id,
    });

    insertDiff(db, {
      event_id: event.id,
      from_observation_id: previous?.id ?? null,
      to_observation_id: observation.id,
      kind: "vanish",
      detail: `previously present, now HTTP ${outcome.httpStatus}`,
    });

    setSourceActive(db, sourceId, false);
    setProtocolStatus(db, protocolId, "vanished");

    return { event, eventType: "vanished", observation };
  }

  // ---- content path ----
  const observationExists = previous !== undefined;
  const hashChanged =
    previous?.content_hash != null &&
    outcome.contentHash !== previous.content_hash;
  const versionChanged =
    version != null &&
    prevVersion != null &&
    compareVersions(prevVersion, version) !== 0;

  // First-ever observation for this source => appeared.
  if (!observationExists || previous?.is_present === 0) {
    // If the previous observation exists but was 'absent', a return of content is still a
    // reappearance: treat as appeared and re-activate.
    const observation = insertObservation(db, {
      source_id: sourceId,
      fetched_at: fetchedAt,
      http_status: outcome.httpStatus,
      content_hash: outcome.contentHash,
      body: outcome.body,
      is_present: true,
    });

    const event = append(db, {
      protocol_id: protocolId,
      source_id: sourceId,
      type: "appeared",
      summary: version ? `appeared at ${version}` : "appeared",
      ref_observation_id: observation.id,
    });

    insertDiff(db, {
      event_id: event.id,
      from_observation_id: previous?.id ?? null,
      to_observation_id: observation.id,
      kind: "appear",
      detail: version ? `first observed version ${version}` : "first observed",
    });

    if (previous?.is_present === 0) {
      setSourceActive(db, sourceId, true);
      setProtocolStatus(db, protocolId, "active");
    }

    return { event, eventType: "appeared", observation };
  }

  // No change at all => no observation, no event.
  if (!versionChanged && !hashChanged) {
    return { event: null, eventType: null, observation: null };
  }

  // Record the new observation for any real change.
  const observation = insertObservation(db, {
    source_id: sourceId,
    fetched_at: fetchedAt,
    http_status: outcome.httpStatus,
    content_hash: outcome.contentHash,
    body: outcome.body,
    is_present: true,
  });

  if (versionChanged) {
    const event = append(db, {
      protocol_id: protocolId,
      source_id: sourceId,
      type: "version_bump",
      summary: `version ${prevVersion} -> ${version}`,
      ref_observation_id: observation.id,
    });
    insertDiff(db, {
      event_id: event.id,
      from_observation_id: previous?.id ?? null,
      to_observation_id: observation.id,
      kind: "version",
      detail: `${prevVersion} -> ${version}`,
    });
    return { event, eventType: "version_bump", observation };
  }

  // Body change without a version bump => spec_change.
  const summary = summarizeBodyDiff(previous?.body ?? "", outcome.body);
  const event = append(db, {
    protocol_id: protocolId,
    source_id: sourceId,
    type: "spec_change",
    summary: summary.summary,
    ref_observation_id: observation.id,
  });
  insertDiff(db, {
    event_id: event.id,
    from_observation_id: previous?.id ?? null,
    to_observation_id: observation.id,
    kind: "body",
    detail: summary.summary,
  });
  return { event, eventType: "spec_change", observation };
}
