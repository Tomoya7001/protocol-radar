import { getDb } from "@/app/_data/db";
import { getProtocolSummaries, listEventsDto } from "@/app/_data/queries";
import { runVerify } from "@/app/_data/verify";
import { parseLimit, parseNow } from "@/app/api/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-010 — GET /api/export.json
 *
 * A "signed" (tamper-evident), citable export of the whole provenance surface. The signature
 * is NOT a leaked secret: it is the ledger's hash-chain verification result plus the current
 * chain HEAD hash, so a third party can quote `integrity.head_hash` and independently re-run
 * verification against the public chain values. The HMAC secret and any raw HMAC value are
 * NEVER emitted — only the public, safe chain hashes (already exposed by the read API).
 *
 * Read-only. Reuses the shared read layer (getProtocolSummaries / listEventsDto) and the
 * shared ledger verifier (runVerify) so this endpoint can never disagree with /api/verify,
 * /api/protocols or /api/events.
 *
 * Query params:
 *  - `?limit=<1..2000>` (optional): cap the embedded event list. Absent ⇒ all events.
 *    Invalid ⇒ 400 (same contract as /api/events).
 *  - `?now=<epoch-ms>` (optional): deterministic freshness clock for reproducible exports.
 */

const MAX_LIMIT = 2000;

function jsonExport(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Provenance is live: always reflect the current ledger state, never a stale copy.
      "cache-control": "no-store",
    },
  });
}

export function GET(req: Request): Response {
  const url = new URL(req.url);
  const db = getDb();

  const hasLimit = url.searchParams.get("limit") !== null;
  const limit = parseLimit(url, MAX_LIMIT, MAX_LIMIT);
  if ("error" in limit) {
    return jsonExport({ error: "invalid_limit", detail: limit.error }, 400);
  }

  const now = parseNow(url);
  const protocols = getProtocolSummaries(db, now);

  // Total ledger event count derived purely from the shared read layer (sum of per-protocol
  // counts). Every event belongs to exactly one protocol, so this equals COUNT(*) events.
  const eventCount = protocols.reduce((n, p) => n + p.event_count, 0);

  // Absent limit ⇒ embed the full ledger (all events, newest-first). Present ⇒ honour it.
  const effectiveLimit = hasLimit ? limit.value : Math.max(eventCount, 1);
  const events = listEventsDto(db, { limit: effectiveLimit });

  // Tamper-evidence proof: recompute the raw content hashes and re-walk the chain.
  const outcome = runVerify(db, "raw");

  // HEAD = newest event overall (highest seq). Public, safe chain value. Null if no events.
  const head = listEventsDto(db, { limit: 1 });
  const headHash = head[0]?.hash ?? null;

  return jsonExport({
    schema: "protocol-radar/export@1",
    generated_at: new Date().toISOString(),
    protocols,
    events,
    integrity: {
      ledger: { ok: outcome.ok, mode: outcome.mode, checked: outcome.checked },
      head_hash: headHash,
      event_count: eventCount,
    },
  });
}
