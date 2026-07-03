/**
 * Tiny helpers for reading Next.js App-Router `searchParams` / `params` in the page server
 * components (F-030..F-035). Kept framework-light and deterministic: `?now=<epoch-ms>` lets
 * tests and reproducible snapshots pin freshness, mirroring the read API (`parseNow`).
 */

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a possibly-repeated query param, or null when absent. */
export function firstParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Resolve `?now=` (epoch ms) for deterministic freshness; falls back to the server clock. */
export function parseNowParam(
  value: string | string[] | undefined,
): number {
  const raw = firstParam(value);
  if (raw === null) return Date.now();
  const n = Number(raw);
  return Number.isFinite(n) ? n : Date.now();
}
