/**
 * Pure display formatters shared by the pages and (where useful) the API. No React, no I/O,
 * so they are trivially unit-testable and deterministic.
 */

/**
 * Truncate a long hash/version in the MIDDLE, keeping the leading and trailing characters,
 * per 02_DESIGN.md ("Hash/version display: mono token, truncate-middle"). Short strings are
 * returned unchanged. `head`/`tail` are the number of characters kept on each side.
 */
export function truncateMiddle(value: string, head = 8, tail = 8): string {
  const keep = head + tail;
  if (value.length <= keep + 1) return value;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/**
 * Format an ISO-8601 timestamp as a stable, locale-independent UTC string
 * (YYYY-MM-DD HH:MM UTC). Deterministic regardless of the server's timezone. Returns the
 * raw input unchanged when it cannot be parsed.
 */
export function formatUtc(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
  );
}

/**
 * Compact human age between `iso` and `now` (epoch ms), e.g. "3d ago", "5m ago", "just now".
 * Used for the dashboard "last-change" hint. Deterministic given an explicit `now`.
 */
export function relativeAge(iso: string, now: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const deltaS = Math.max(0, Math.floor((now - ms) / 1000));
  if (deltaS < 60) return "just now";
  const mins = Math.floor(deltaS / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
