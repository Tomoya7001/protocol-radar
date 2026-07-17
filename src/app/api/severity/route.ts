import { getDb } from "@/app/_data/db";
import { listEventsDto, protocolExists } from "@/app/_data/queries";
import { jsonResponse, parseLimit } from "@/app/api/_lib/http";
import { classifySeverity } from "@/lib/severity/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Feature #8 — GET /api/severity
 * Read-only. Returns recent changes, newest-first, each annotated with a severity label
 * (breaking/spec/minor/meta) and the reason behind it — so an AI can reason about *what a
 * change means* without re-reading raw diffs.
 *
 * Query params mirror /api/events:
 *   - `?protocol=<key>` — optional filter; unknown ⇒ 404 protocol_not_found.
 *   - `?limit=<1..500>` — optional; invalid ⇒ 400 invalid_limit.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const db = getDb();

  const limit = parseLimit(url, DEFAULT_LIMIT, MAX_LIMIT);
  if ("error" in limit) {
    return jsonResponse({ error: "invalid_limit", detail: limit.error }, 400);
  }

  const protocolKey = url.searchParams.get("protocol");
  if (protocolKey !== null && !protocolExists(db, protocolKey)) {
    return jsonResponse({ error: "protocol_not_found", key: protocolKey }, 404);
  }

  const events = listEventsDto(db, { protocolKey, limit: limit.value });
  const changes = events.map((e) => {
    const { severity, reason } = classifySeverity({ type: e.type });
    return {
      seq: e.seq,
      type: e.type,
      at: e.created_at,
      summary: e.summary,
      severity,
      reason,
    };
  });

  return jsonResponse(
    protocolKey !== null ? { protocol: protocolKey, changes } : { changes },
  );
}
