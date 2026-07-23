/**
 * DB wiring for GET /api/spec-diff (feature F2). This is the ONLY layer that touches the
 * database; the diff itself is the pure, deterministic core in ./specdiff. Read-only: it opens
 * the shared read connection, reconstructs the two spec-page body snapshots requested by
 * `from`/`to`, hands them to diffSpecBodies(), and serializes the result. No writes, no network,
 * no LLM.
 *
 * The route file (src/app/api/spec-diff/route.ts) exports only GET/runtime/dynamic and delegates
 * here — Next.js forbids exporting a handler helper from a route module, so the real logic lives
 * outside route.ts on purpose.
 */
import { getDb } from "@/app/_data/db";
import { getProtocolByKey } from "@/lib/db";
import { jsonResponse } from "@/app/api/_lib/http";
import { parseTs } from "@/lib/asof";
import { SPEC_PAGE_SOURCES } from "@/config/sources/specPages";
import { diffSpecBodies } from "./specdiff";

/** A single spec-page body snapshot pulled from the observations table. */
interface Snapshot {
  id: number;
  fetched_at: string;
  body: string;
}

interface SourceIdRow {
  id: number;
}

interface ObservationSnapRow {
  id: number;
  fetched_at: string;
  body: string;
}

const NOTE =
  "Section granularity is derived from surviving Markdown heading markers in the " +
  "normalized spec body; HTML pages that normalize to prose have no headings and fall " +
  "back to line hunks (granularity: 'line'). Body newlines are collapsed upstream, so " +
  "section identity is a deterministic best-effort signature, not a fabricated source.";

/**
 * Locate the protocol's spec-page source id. Primary: the http source whose URL matches the
 * declared SPEC_PAGE_SOURCES entry for this protocol. Fallback: any source that has ever emitted
 * a spec_change event. Returns null when the protocol has no observable spec page.
 */
function findSpecSourceId(
  db: ReturnType<typeof getDb>,
  protocolId: number,
  protocolKey: string,
): number | null {
  const configured = SPEC_PAGE_SOURCES.find((s) => s.protocolKey === protocolKey);
  if (configured) {
    const row = db
      .prepare("SELECT id FROM sources WHERE protocol_id = ? AND url = ? LIMIT 1")
      .get(protocolId, configured.url) as SourceIdRow | undefined;
    if (row) return row.id;
  }
  const fallback = db
    .prepare(
      `SELECT s.id AS id FROM sources s
        WHERE s.protocol_id = ?
          AND s.id IN (SELECT source_id FROM events
                        WHERE protocol_id = ? AND type = 'spec_change' AND source_id IS NOT NULL)
        ORDER BY s.id ASC LIMIT 1`,
    )
    .get(protocolId, protocolId) as SourceIdRow | undefined;
  return fallback ? fallback.id : null;
}

/** All body-bearing spec snapshots for a source, oldest → newest (stable tie-break by id). */
function loadSnapshots(db: ReturnType<typeof getDb>, sourceId: number): Snapshot[] {
  const rows = db
    .prepare(
      `SELECT id, fetched_at, body FROM observations
        WHERE source_id = ? AND is_present = 1 AND body IS NOT NULL
        ORDER BY fetched_at ASC, id ASC`,
    )
    .all(sourceId) as ObservationSnapRow[];
  return rows.map((r) => ({ id: r.id, fetched_at: r.fetched_at, body: r.body }));
}

/** Latest snapshot at-or-before `ms` (as-of semantics), or null when none qualifies. */
function asOf(snaps: Snapshot[], ms: number): Snapshot | null {
  let chosen: Snapshot | null = null;
  for (const s of snaps) {
    const t = Date.parse(s.fetched_at);
    if (!Number.isFinite(t)) continue;
    if (t <= ms) chosen = s;
    else break;
  }
  return chosen;
}

/** Public endpoint used by GET /api/spec-diff. Pure request → Response, no side effects. */
export function handleSpecDiff(req: Request): Response {
  const url = new URL(req.url);
  const db = getDb();

  const key = url.searchParams.get("key");
  if (key === null || key.trim().length === 0) {
    return jsonResponse({ error: "missing_key", detail: "query param 'key' is required" }, 400);
  }

  const protocol = getProtocolByKey(db, key);
  if (protocol === undefined) {
    return jsonResponse({ error: "protocol_not_found", key }, 404);
  }

  const sourceId = findSpecSourceId(db, protocol.id, key);
  if (sourceId === null) {
    return jsonResponse({ error: "spec_source_not_found", key }, 404);
  }

  const snaps = loadSnapshots(db, sourceId);

  // Resolve the `to` time point → snapshot.
  const toParam = url.searchParams.get("to");
  let toSnap: Snapshot | null;
  if (toParam !== null) {
    const parsed = parseTs(toParam);
    if ("error" in parsed) {
      return jsonResponse({ error: "invalid_to", detail: parsed.error }, 400);
    }
    toSnap = asOf(snaps, parsed.ms);
  } else {
    toSnap = snaps.length > 0 ? (snaps[snaps.length - 1] ?? null) : null;
  }

  // Resolve the `from` time point → snapshot. Default: the snapshot immediately before `to`.
  const fromParam = url.searchParams.get("from");
  let fromSnap: Snapshot | null;
  if (fromParam !== null) {
    const parsed = parseTs(fromParam);
    if ("error" in parsed) {
      return jsonResponse({ error: "invalid_from", detail: parsed.error }, 400);
    }
    fromSnap = asOf(snaps, parsed.ms);
  } else if (toSnap !== null) {
    const anchorId = toSnap.id;
    const idx = snaps.findIndex((s) => s.id === anchorId);
    fromSnap = idx > 0 ? (snaps[idx - 1] ?? null) : null;
  } else {
    fromSnap = null;
  }

  const diff = diffSpecBodies(fromSnap?.body ?? null, toSnap?.body ?? null);

  return jsonResponse({
    protocol_key: key,
    from: { ts: fromSnap?.fetched_at ?? null, observation_id: fromSnap?.id ?? null },
    to: { ts: toSnap?.fetched_at ?? null, observation_id: toSnap?.id ?? null },
    granularity: diff.granularity,
    sections: diff.sections,
    hunks: diff.hunks,
    summary: diff.summary,
    snapshot_count: snaps.length,
    note: NOTE,
  });
}
