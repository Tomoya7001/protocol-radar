/**
 * F4 — HTTP entry point for GET /api/report (kept OUT of route.ts).
 *
 * Next.js route files may only export the framework-recognised `GET` / `runtime` / `dynamic`
 * fields; exporting a handler helper from route.ts fails the build. So all request wiring lives
 * here and route.ts simply delegates.
 *
 * Read-only: this module SELECTs from the ledger (via the shared read layer + the DB-backed
 * diffLandscape) and never mutates a row. The window diff, protocol summaries and event feed are
 * fetched here, then handed to the PURE buildReport / renderMarkdown functions. Deterministic
 * given `?now=<epoch-ms>`.
 *
 * Contract: GET /api/report?period=week|month&format=md|json&now=<epoch-ms>
 *   - period : "week" (default) | "month"
 *   - format : "md" (default) → text/markdown; "json" → structured JSON
 *   - now    : optional epoch-ms for a reproducible snapshot
 */

import { getDb } from "@/app/_data/db";
import { getProtocolSummaries, listEventsDto } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import { diffLandscape } from "@/lib/diff-range";
import {
  buildReport,
  renderMarkdown,
  windowDaysFor,
  REPORT_DAY_MS,
  type ReportPeriod,
} from "@/lib/report/report";

/**
 * Upper bound on events scanned for the momentum/anomaly baselines. The ledger is small (one row
 * per observed change), so a generous cap captures every event while staying O(bounded). Mirrors
 * /api/velocity and /api/anomalies.
 */
const EVENT_SCAN_LIMIT = 10_000;

type ReportFormat = "md" | "json";

/** Parse `?period=`; unknown/absent ⇒ "week". */
function parsePeriod(raw: string | null): ReportPeriod {
  return raw === "month" ? "month" : "week";
}

/** Parse `?format=`; unknown/absent ⇒ "md". */
function parseFormat(raw: string | null): ReportFormat {
  return raw === "json" ? "json" : "md";
}

/** Serialise Markdown with a stable content-type. */
function markdownResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

/**
 * Build the report Response. Runs the DB-backed window diff, then the pure report builder, then
 * serialises to Markdown (default) or structured JSON.
 */
export function buildReportResponse(req: Request): Response {
  const url = new URL(req.url);
  const now = parseNow(url);
  const period = parsePeriod(url.searchParams.get("period"));
  const format = parseFormat(url.searchParams.get("format"));

  const db = getDb();

  // Window [now - periodDays, now]; reuse diffLandscape (which reuses @/lib/asof) unchanged.
  const fromMs = now - windowDaysFor(period) * REPORT_DAY_MS;
  const diff = diffLandscape(db, fromMs, now, now);

  const summaries = getProtocolSummaries(db, now);
  const events = listEventsDto(db, {
    protocolKey: null,
    limit: EVENT_SCAN_LIMIT,
  });

  const report = buildReport(
    {
      protocols: summaries.map((s) => ({ key: s.key, name: s.name })),
      events: events.map((e) => ({
        protocol_key: e.protocol_key,
        protocol_name: e.protocol_name,
        created_at: e.created_at,
        type: e.type,
      })),
      diff,
    },
    { now, period },
  );

  if (format === "json") {
    return jsonResponse(report);
  }
  return markdownResponse(renderMarkdown(report));
}
