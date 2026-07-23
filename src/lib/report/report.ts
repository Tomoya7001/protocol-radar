/**
 * F4 — STATE OF AI PROTOCOLS (auto-generated report, pure computation layer).
 *
 * The ledger's accumulated history is only worth something if a human can *quote* it. This module
 * bundles the signals other features already derive — the interval diff (@/lib/diff-range, itself
 * built on @/lib/asof), the anomaly feed (@/lib/anomalies) and the momentum metrics
 * (@/lib/velocity) — into a single, deterministic week/month digest that can be pasted verbatim
 * into a status update or newsletter.
 *
 * It is a PURE function: (already-fetched protocols + events + a pre-computed window diff + now +
 * period) ⇒ a structured report, and a second pure function renders that report to Markdown. No
 * DB, clock, network, LLM or I/O access lives here, so output is fully deterministic and
 * unit-testable. The route layer (src/app/api/report/route.ts) supplies the data (running the
 * DB-backed diffLandscape) and injects `now` via `?now=<epoch-ms>`.
 *
 * The anomaly and momentum sections REUSE computeAnomalies / computeVelocity unchanged; the
 * changed-protocol section and the appeared/vanished counts REUSE the LandscapeDiff produced by
 * diffLandscape. Nothing here re-implements that math.
 */

import { computeAnomalies, type Anomaly } from "@/lib/anomalies/anomalies";
import {
  computeVelocity,
  type ProtocolVelocity,
} from "@/lib/velocity/velocity";
import type { LandscapeDiff, ProtocolDiff } from "@/lib/diff-range";

const DAY_MS = 86_400_000;

export type ReportPeriod = "week" | "month";

/** How many days each period spans (also the diff window the route must supply). */
const PERIOD_DAYS: Record<ReportPeriod, number> = { week: 7, month: 30 };

/** Upper bound on anomalies quoted in the "notable" section. */
const TOP_ANOMALIES = 5;
/** Upper bound on protocols quoted in the "momentum" section. */
const TOP_MOMENTUM = 5;

/** One protocol, reduced to the identity fields the momentum/anomaly baselines need. */
export interface ReportProtocolInput {
  key: string;
  name: string;
}

/** One ledger event across all protocols (from listEventsDto). Order does not matter. */
export interface ReportEventInput {
  protocol_key: string;
  protocol_name: string;
  /** ISO-8601 UTC timestamp (events.created_at). */
  created_at: string;
  type: string;
}

/**
 * Everything the pure builder needs. `diff` MUST be the window diff for this period, i.e. the
 * output of diffLandscape(db, now - PERIOD_DAYS*DAY, now, now); the route guarantees this.
 */
export interface BuildReportInput {
  protocols: ReportProtocolInput[];
  events: ReportEventInput[];
  diff: LandscapeDiff;
}

export interface BuildReportOptions {
  /** "Now" as epoch-ms, so windows/timestamps are deterministic and testable. */
  now: number;
  /** Reporting cadence; defaults to "week". */
  period?: ReportPeriod;
}

/** The bundled top-of-report figures. */
export interface ReportSummary {
  /** Total protocols observed (the tracked set). */
  protocol_count: number;
  /** Events that landed inside the window `(from, to]`. */
  events_in_period: number;
  /** Protocols that changed in any way during the window. */
  protocols_changed: number;
  /** Protocols that appeared (first-ever event) during the window. */
  appeared: number;
  /** Protocols whose source vanished during the window. */
  vanished: number;
}

export interface ReportWindow {
  /** Window start instant (ISO-8601, UTC) — mirrors diff.from. */
  from: string;
  /** Window end instant (ISO-8601, UTC) — mirrors diff.to. */
  to: string;
  /** Span in whole days (7 for week, 30 for month). */
  days: number;
}

/** The structured, machine-readable report (what `format=json` returns). */
export interface Report {
  period: ReportPeriod;
  /** When this document was produced (ISO-8601, UTC). */
  generated_at: string;
  window: ReportWindow;
  summary: ReportSummary;
  /** Every protocol that changed in the window (ordered by key, from the diff). */
  changed_protocols: ProtocolDiff[];
  /** The most notable anomalies (severity-desc, capped at TOP_ANOMALIES). */
  anomalies: Anomaly[];
  /** The highest-momentum protocols (momentum-desc, capped at TOP_MOMENTUM). */
  momentum: ProtocolVelocity[];
}

function isoOf(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Whole-day span this period is intended to cover. Exposed so the route can derive the diff
 * window (`now - windowDaysFor(period) * DAY`) from the SAME source of truth the report uses.
 */
export function windowDaysFor(period: ReportPeriod): number {
  return PERIOD_DAYS[period];
}

/** One day in ms — re-exported so callers can build the window without a magic number. */
export const REPORT_DAY_MS = DAY_MS;

/**
 * Pure report builder: bundles the pre-computed window diff with fresh anomaly/momentum
 * computations into one deterministic, machine-readable digest. Given identical inputs it always
 * returns an identical object.
 */
export function buildReport(
  input: BuildReportInput,
  options: BuildReportOptions,
): Report {
  const period: ReportPeriod = options.period ?? "week";
  const now = options.now;
  const days = PERIOD_DAYS[period];

  const { protocols, events, diff } = input;

  const velocity = computeVelocity({ now, protocols, events });
  const anomalyReport = computeAnomalies({ now, protocols, events });

  const summary: ReportSummary = {
    protocol_count: protocols.length,
    events_in_period: diff.summary.events_added,
    protocols_changed: diff.summary.protocols_changed,
    appeared: diff.summary.appeared,
    vanished: diff.summary.vanished,
  };

  return {
    period,
    generated_at: isoOf(now),
    window: { from: diff.from, to: diff.to, days },
    summary,
    changed_protocols: diff.changes,
    anomalies: anomalyReport.anomalies.slice(0, TOP_ANOMALIES),
    momentum: velocity.protocols.slice(0, TOP_MOMENTUM),
  };
}

// --- Markdown rendering (pure, deterministic) --------------------------------------------------

const PERIOD_LABEL: Record<ReportPeriod, string> = {
  week: "Weekly",
  month: "Monthly",
};

/** Format a possibly-null number for a table cell. */
function num(n: number | null): string {
  return n === null ? "—" : String(n);
}

/** Render one changed-protocol line: name (key) — kinds; N events; status transition. */
function renderChangedLine(c: ProtocolDiff): string {
  const kinds = c.change_kinds.length > 0 ? c.change_kinds.join(", ") : "—";
  const transition =
    c.from_status === c.to_status
      ? c.to_status
      : `${c.from_status} → ${c.to_status}`;
  return `- **${c.name}** (\`${c.key}\`) — ${kinds}; ${c.events_added_count} event(s); status ${transition}`;
}

/** Render one anomaly line. */
function renderAnomalyLine(a: Anomaly): string {
  return `- **[${a.severity}] ${a.name}** (\`${a.key}\`) — ${a.kind}: ${a.detail}`;
}

/** Render one momentum table row. */
function renderMomentumRow(p: ProtocolVelocity): string {
  return `| ${p.name} (\`${p.key}\`) | ${p.momentum_score} | ${p.trend} | ${p.events_30d} | ${p.events_90d} | ${num(p.days_since_last_change)} |`;
}

/**
 * Render a Report to a stable Markdown string. Purely a function of its input, so identical
 * reports render identical Markdown — safe to quote verbatim.
 */
export function renderMarkdown(report: Report): string {
  const { period, generated_at, window, summary } = report;
  const lines: string[] = [];

  lines.push(`# State of AI Protocols — ${PERIOD_LABEL[period]} Report`);
  lines.push("");
  lines.push(
    `_Generated ${generated_at} · window ${window.from} → ${window.to} (${window.days}d)_`,
  );
  lines.push("");

  // (a) Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Protocols observed: **${summary.protocol_count}**`);
  lines.push(`- Events in period: **${summary.events_in_period}**`);
  lines.push(`- Protocols changed: **${summary.protocols_changed}**`);
  lines.push(
    `- Appeared: **${summary.appeared}** · Vanished: **${summary.vanished}**`,
  );
  lines.push("");

  // (b) Changed protocols
  lines.push("## Changed protocols");
  lines.push("");
  if (report.changed_protocols.length === 0) {
    lines.push("_No protocols changed in this window._");
  } else {
    for (const c of report.changed_protocols) {
      lines.push(renderChangedLine(c));
    }
  }
  lines.push("");

  // (c) Notable anomalies
  lines.push("## Notable anomalies");
  lines.push("");
  if (report.anomalies.length === 0) {
    lines.push("_No anomalies detected._");
  } else {
    for (const a of report.anomalies) {
      lines.push(renderAnomalyLine(a));
    }
  }
  lines.push("");

  // (d) Momentum leaders
  lines.push("## Momentum leaders");
  lines.push("");
  if (report.momentum.length === 0) {
    lines.push("_No protocols tracked._");
  } else {
    lines.push(
      "| Protocol | Momentum | Trend | 30d | 90d | Days since change |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const p of report.momentum) {
      lines.push(renderMomentumRow(p));
    }
  }
  lines.push("");

  return lines.join("\n");
}
