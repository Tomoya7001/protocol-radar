import { consoleLogger, type Logger } from "./logger";
import type { HttpClient, HttpResponse } from "./types";

export interface ValidateResult {
  ok: boolean;
  status: number | null;
  /** True when the source should be marked inactive (404/410/permanent failure). */
  markInactive: boolean;
}

/**
 * Startup check for a configured source URL. Uses a lightweight HEAD (falls back to GET is
 * the caller's choice — we HEAD here). On 404/410 or a permanent network failure, returns
 * markInactive=true and logs a TODO line; the caller flags the source inactive and
 * CONTINUES. This NEVER throws — a bad URL must not abort the run, and we NEVER invent or
 * guess a replacement URL (provenance integrity is the product).
 */
export async function validateSourceUrl(
  client: HttpClient,
  url: string,
  logger: Logger = consoleLogger,
): Promise<ValidateResult> {
  let res: HttpResponse;
  try {
    res = await client.send({ url, method: "HEAD", timeoutMs: 10000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.todo(
      `source url unreachable, marking inactive (do NOT invent a replacement): ${url} — ${message}`,
    );
    return { ok: false, status: null, markInactive: true };
  }

  if (res.status === 404 || res.status === 410) {
    logger.todo(
      `source url returned ${res.status}, marking inactive (re-source, do NOT guess a URL): ${url}`,
    );
    return { ok: false, status: res.status, markInactive: true };
  }

  // Some servers reject HEAD with 405; treat as reachable (not a 404) — keep active.
  if (res.status >= 200 && res.status < 400) {
    return { ok: true, status: res.status, markInactive: false };
  }
  if (res.status === 405) {
    return { ok: true, status: res.status, markInactive: false };
  }

  // 401/403/5xx at startup: reachable but not confirmable now. Keep active, log a warning.
  logger.warn(
    `source url validate got status ${res.status} (keeping active, will retry on poll): ${url}`,
  );
  return { ok: false, status: res.status, markInactive: false };
}
