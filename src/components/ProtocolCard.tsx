import type { Dictionary } from "@/app/_i18n";
import type { ProtocolSummaryDto } from "@/app/_data/queries";
import { relativeAge } from "@/app/_data/format";
import { FreshnessBadge, StatusBadge } from "./badges";

/**
 * F-030 dashboard card: one protocol showing its state, last-change and freshness badge.
 * The whole card is a single keyboard-reachable link (one tab stop) with a :focus-visible
 * ring; it is NOT a filled primary CTA (§A.4 — the one primary lives in the header).
 */
export function ProtocolCard({
  summary,
  dict,
  now,
  href,
}: {
  summary: ProtocolSummaryDto;
  dict: Dictionary;
  now: number;
  href: string;
}) {
  const last = summary.last_event;
  const activeSources = summary.sources.filter((s) => s.active).length;

  return (
    <a
      href={href}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-1 transition-shadow hover:shadow-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-md font-semibold text-text">
            {summary.name}
          </h2>
          <p className="font-mono text-xs text-text-muted">{summary.key}</p>
        </div>
        <FreshnessBadge freshness={summary.freshness} dict={dict} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={summary.status} dict={dict} />
      </div>

      <div className="text-sm">
        <p className="text-text-muted">{dict.dashboard.lastChange}</p>
        {last ? (
          <p className="mt-0.5 text-text">
            <span className="font-medium">{dict.eventType[last.type]}</span>
            {last.summary ? (
              <span className="text-text-muted"> — {last.summary}</span>
            ) : null}
            <span className="text-text-muted">
              {" "}
              ({relativeAge(last.created_at, now)})
            </span>
          </p>
        ) : (
          <p className="mt-0.5 text-text-muted">{dict.dashboard.noEvents}</p>
        )}
      </div>

      <div className="mt-auto flex gap-4 border-t border-border pt-2 text-xs text-text-muted">
        <span>
          {summary.event_count} {dict.dashboard.events}
        </span>
        <span>
          {activeSources} {dict.dashboard.sources}
        </span>
      </div>
    </a>
  );
}
