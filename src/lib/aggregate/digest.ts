import type { Db } from "@/lib/db";
import { buildTimeline, type TimelineEntry } from "./timeline";

/**
 * Layer C aggregation — F-052 daily digest builder.
 *
 * Produces both a JSON structure and a rendered markdown report of the changes that occurred
 * within a relative time window (default: the last 24 hours). The window is resolved from an
 * INJECTED `now` (epoch ms) — the pure core never reads the wall-clock — so the digest is
 * fully deterministic and offline-testable. A change is "in the window" when its occurrence
 * timestamp (observation.fetched_at, see timeline.ts) falls in `(since, now]`.
 */

const HOUR_MS = 3600 * 1000;
const DEFAULT_WINDOW_HOURS = 24;

export interface DigestGroup {
  protocol_key: string;
  protocol_name: string;
  count: number;
  entries: TimelineEntry[];
}

export interface Digest {
  /** ISO-8601 of the injected `now`. */
  generated_at: string;
  window_hours: number;
  /** ISO-8601 window bounds: (since, until]. */
  since: string;
  until: string;
  /** Total number of changes in the window. */
  total: number;
  /** Flat list of in-window changes, most recent first (F-050 ranking). */
  entries: TimelineEntry[];
  /** Same changes grouped by protocol, groups ordered by protocol key. */
  by_protocol: DigestGroup[];
}

export interface DigestOptions {
  /** Length of the look-back window in hours. Defaults to 24. */
  windowHours?: number;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Build the digest (F-052). Selects the timeline entries whose occurrence falls in the
 * window `(now - windowHours, now]`, keeps the deterministic most-recent-first ordering, and
 * groups them by protocol.
 */
export function buildDigest(
  db: Db,
  now: number,
  opts: DigestOptions = {},
): Digest {
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const sinceMs = now - windowHours * HOUR_MS;

  const entries = buildTimeline(db).filter((e) => {
    const t = Date.parse(e.occurred_at);
    return t > sinceMs && t <= now;
  });

  const groups = new Map<string, DigestGroup>();
  for (const e of entries) {
    let g = groups.get(e.protocol_key);
    if (g === undefined) {
      g = {
        protocol_key: e.protocol_key,
        protocol_name: e.protocol_name,
        count: 0,
        entries: [],
      };
      groups.set(e.protocol_key, g);
    }
    g.count += 1;
    g.entries.push(e);
  }

  const by_protocol = [...groups.values()].sort((a, b) =>
    a.protocol_key.localeCompare(b.protocol_key),
  );

  return {
    generated_at: isoOf(now),
    window_hours: windowHours,
    since: isoOf(sinceMs),
    until: isoOf(now),
    total: entries.length,
    entries,
    by_protocol,
  };
}

/** Human-readable event-type labels (Japanese, user-facing). */
const TYPE_LABELS_JA: Record<string, string> = {
  appeared: "新規出現",
  version_bump: "バージョン更新",
  spec_change: "仕様変更",
  vanished: "消失",
};

function typeLabel(type: string): string {
  return TYPE_LABELS_JA[type] ?? type;
}

/**
 * Render a digest as markdown (Japanese, user-facing). Structural labels are Japanese per the
 * language guard; protocol names and event summaries are the stored data values verbatim.
 * Pure: derives everything from the passed digest, no wall-clock.
 */
export function digestToMarkdown(digest: Digest): string {
  const lines: string[] = [];
  lines.push("# プロトコル・レーダー デイリーダイジェスト");
  lines.push("");
  lines.push(
    `対象期間: ${digest.since} 〜 ${digest.until}（過去${digest.window_hours}時間）`,
  );
  lines.push("");

  if (digest.total === 0) {
    lines.push("この期間に記録された変更はありません。");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`変更 ${digest.total} 件`);
  lines.push("");

  for (const group of digest.by_protocol) {
    lines.push(
      `## ${group.protocol_name}（${group.protocol_key}） — ${group.count} 件`,
    );
    for (const e of group.entries) {
      const summary = e.summary ?? "";
      lines.push(`- ${e.occurred_at} [${typeLabel(e.type)}] ${summary}`.trimEnd());
    }
    lines.push("");
  }

  return lines.join("\n");
}
