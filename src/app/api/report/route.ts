import { buildReportResponse } from "@/lib/report/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F4 - GET /api/report?period=week|month&format=md|json&now=<epoch-ms>
 *
 * Auto-generated "State of AI Protocols" digest: bundles the accumulated ledger signals (window
 * diff, anomalies, momentum) into a quotable week/month report. `format=md` (default) returns
 * Markdown (text/markdown); `format=json` returns the structured sections.
 *
 * All logic lives in @/lib/report (pure builder) and @/lib/report/response (DB wiring); this
 * Route file only exports the Next.js-allowed runtime/dynamic/GET, never a handler field Next.js
 * rejects at build.
 */
export function GET(req: Request): Response {
  return buildReportResponse(req);
}
