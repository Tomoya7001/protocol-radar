/**
 * Shared helpers for the public read API (F-032). Framework-light: handlers use the Web
 * `Request`/`Response` standard so they are unit-testable without a Next.js server.
 */

/** Serialise a JSON body with an explicit status and a stable content-type. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Freshness is computed against "now". Callers may pass `?now=<epoch-ms>` for deterministic
 * output (used by tests and reproducible snapshots); otherwise the server clock is used.
 */
export function parseNow(url: URL): number {
  const raw = url.searchParams.get("now");
  if (raw === null) return Date.now();
  const n = Number(raw);
  return Number.isFinite(n) ? n : Date.now();
}

export type LimitResult = { value: number } | { error: string };

/**
 * Parse a `?limit=` query param. Absent ⇒ default. Present but not an integer in [1, max] ⇒
 * an error (mapped to HTTP 400 by the caller).
 */
export function parseLimit(url: URL, def: number, max: number): LimitResult {
  const raw = url.searchParams.get("limit");
  if (raw === null) return { value: def };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    return { error: `limit must be an integer between 1 and ${max}` };
  }
  return { value: n };
}
