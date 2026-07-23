import { getDb } from "@/app/_data/db";
import { getProtocolSummaries, listEventsDto } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import { computeAnswer, type AnswerProtocolInput } from "@/lib/answer/answer";
import { computeVelocity } from "@/lib/velocity/velocity";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upper bound on events scanned. The ledger is small (one row per observed change), so a
 * generous cap captures every event while staying O(bounded). Mirrors /api/velocity.
 */
const EVENT_SCAN_LIMIT = 10_000;

/**
 * Feature F7 — GET /api/answer?q=<natural-language-ish query>
 *
 * Read-only, fully DETERMINISTIC Q&A: NO LLM, NO network, NO clock beyond `?now=`. It aggregates
 * the existing read layer (getProtocolSummaries + listEventsDto) plus the velocity metrics, then
 * hands a plain snapshot to the pure computeAnswer() engine (src/lib/answer/answer.ts), which
 * matches the query to a supported intent by keyword/regex and returns a confident structured
 * answer. This route only wires data in — no schema, shared-query, or DTO changes.
 *
 * Query params:
 *   q   — the question (required for a real answer; absent/empty ⇒ answered:false).
 *   now — optional epoch-ms base time for "today / this week / last N days" (via parseNow).
 *
 * Shape: { q, answered, intent, answer_text, data, supported_intents } — always HTTP 200.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const q = url.searchParams.get("q") ?? "";
  const db = getDb();

  const summaries = getProtocolSummaries(db, now);
  const events = listEventsDto(db, {
    protocolKey: null,
    limit: EVENT_SCAN_LIMIT,
  });

  const answerEvents = events.map((e) => ({
    protocol_key: e.protocol_key,
    protocol_name: e.protocol_name,
    type: e.type,
    summary: e.summary,
    created_at: e.created_at,
  }));

  // Reuse velocity momentum/trend so the "most active" and "dormant" intents stay consistent
  // with /api/velocity without re-implementing the math here.
  const velocity = computeVelocity({
    now,
    protocols: summaries.map((s) => ({ key: s.key, name: s.name })),
    events: answerEvents,
  });
  const velByKey = new Map(velocity.protocols.map((p) => [p.key, p]));

  const protocols: AnswerProtocolInput[] = summaries.map((s) => {
    const v = velByKey.get(s.key);
    return {
      key: s.key,
      name: s.name,
      status: s.status,
      freshness: s.freshness,
      stale_warning: s.stale_warning,
      event_count: s.event_count,
      last_event:
        s.last_event === null
          ? null
          : {
              type: s.last_event.type,
              summary: s.last_event.summary,
              created_at: s.last_event.created_at,
            },
      momentum_score: v?.momentum_score ?? 0,
      trend: v?.trend ?? "dormant",
      days_since_last_change: v?.days_since_last_change ?? null,
    };
  });

  const answer = computeAnswer({ q, now, protocols, events: answerEvents });

  return jsonResponse(answer);
}
