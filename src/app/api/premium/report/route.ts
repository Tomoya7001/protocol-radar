import { getDb } from "@/app/_data/db";
import { getProtocolSummaries, listEventsDto } from "@/app/_data/queries";
import { parseNow } from "@/app/api/_lib/http";
import { guardX402, rateLimitHeaders } from "@/app/api/_lib/x402Guard";
import { diffLandscape } from "@/lib/diff-range";
import {
  buildReport,
  windowDaysFor,
  REPORT_DAY_MS,
  type ReportPeriod,
} from "@/lib/report/report";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * G2 — x402-metered PREMIUM endpoint: the full "State of AI Protocols" report behind the pay gate.
 *
 * Unlike GET /api/report (free, public digest), this route is metered by {@link guardX402}: a
 * caller must present a valid API key and either spend free quota or carry a valid `X-PAYMENT`
 * proof. It then serves the SAME deterministic report builder (@/lib/report) at full depth — the
 * complete window diff, notable anomalies and momentum leaders as structured JSON — plus a
 * `billing` field mirroring the demo route so agents can reconcile spend per call.
 *
 * Statelessness: the PAID path is authorised solely by the per-request `X-PAYMENT` proof the gate
 * verifies (server-held meters may reset per serverless invocation). Read-only: it SELECTs from
 * the ledger and never mutates a row or touches the network.
 *
 * Contract: GET /api/premium/report?period=week|month&now=<epoch-ms>
 *   - period : "month" (default, full depth) | "week"
 *   - now    : optional epoch-ms for a reproducible snapshot
 * Auth: `Authorization: Bearer <key>` or `x-api-key`; payment via `X-PAYMENT`.
 */

/** Upper bound on events scanned for the momentum/anomaly baselines (mirrors /api/report). */
const EVENT_SCAN_LIMIT = 10_000;

/** Parse `?period=`; unknown/absent ⇒ "month" (premium serves the deeper window by default). */
function parsePeriod(raw: string | null): ReportPeriod {
  return raw === "week" ? "week" : "month";
}

export async function GET(req: Request): Promise<Response> {
  // 1–3. Authenticate + rate-limit + x402 gate. Any failure is a ready-to-return 401/429/402.
  const guard = await guardX402(req);
  if (!guard.ok) return guard.response;
  const { decision, meter } = guard;

  const url = new URL(req.url);
  const now = parseNow(url);
  const period = parsePeriod(url.searchParams.get("period"));

  // Reuse the DB wiring of /api/report at full depth: window diff → pure report builder.
  const db = getDb();
  const fromMs = now - windowDaysFor(period) * REPORT_DAY_MS;
  const diff = diffLandscape(db, fromMs, now, now);

  const summaries = getProtocolSummaries(db, now);
  const events = listEventsDto(db, { protocolKey: null, limit: EVENT_SCAN_LIMIT });

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

  const body = JSON.stringify({
    report,
    billing:
      decision.kind === "paid"
        ? { tier: "paid", settlement: decision.verification }
        : { tier: "free", free_remaining: decision.meter.remaining },
  });

  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "x-payment-tier": decision.kind,
    ...rateLimitHeaders(meter),
  };
  if (decision.kind === "paid" && decision.verification.txHash !== undefined) {
    headers["x-payment-response"] = JSON.stringify({
      success: true,
      txHash: decision.verification.txHash,
      payer: decision.verification.payer ?? null,
    });
  }
  if (decision.kind === "free") {
    headers["x-free-tier-remaining"] = String(decision.meter.remaining);
  }

  return new Response(body, { status: 200, headers });
}
