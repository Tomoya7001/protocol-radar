import { contentHash } from "./hash";
import {
  noSleep,
  realSleep,
  type HttpClient,
  type HttpResponse,
  type SleepFn,
} from "./types";

/**
 * Conditional-GET inputs for a source. etag / last_modified come from the source row and
 * drive If-None-Match / If-Modified-Since so unchanged content returns 304 (no new
 * observation).
 */
export interface FetchInput {
  url: string;
  kind: "http" | "github";
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
}

export interface RetryOptions {
  /** Max total attempts (>= 1). Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms; attempt k waits baseDelayMs * 2^(k-1). Default 200. */
  baseDelayMs?: number;
  /** Injectable sleep (tests pass noSleep). Default realSleep. */
  sleep?: SleepFn;
}

export type FetchOutcome =
  | {
      kind: "not_modified";
      httpStatus: 304;
    }
  | {
      kind: "content";
      httpStatus: number;
      body: string;
      contentHash: string;
      etag: string | null;
      lastModified: string | null;
    }
  | {
      kind: "absent";
      httpStatus: number; // e.g. 404 or 410
    }
  | {
      kind: "error";
      httpStatus: number | null; // last seen status (5xx) or null on network error
      message: string;
    };

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

function isAbsentStatus(status: number): boolean {
  return status === 404 || status === 410;
}

function header(res: HttpResponse, name: string): string | null {
  return res.headers[name.toLowerCase()] ?? null;
}

/**
 * Build request headers for a source fetch. GitHub's REST API MANDATES a User-Agent (it
 * returns 403 without one) and OPTIONALLY accepts a bearer token to raise the rate limit —
 * neither is hardcoded: the UA has a safe default and the token is read from the environment
 * (GITHUB_TOKEN / GITHUB_API_TOKEN) so the fetch works unauthenticated when no token is set.
 */
function buildHeaders(input: FetchInput): Record<string, string> {
  const headers: Record<string, string> = {
    accept: input.kind === "github" ? "application/vnd.github+json" : "*/*",
  };
  if (input.etag) headers["if-none-match"] = input.etag;
  if (input.lastModified) headers["if-modified-since"] = input.lastModified;

  if (input.kind === "github") {
    // Required by the GitHub API. Overridable via env for a custom identity.
    headers["user-agent"] =
      process.env.GITHUB_API_USER_AGENT?.trim() || "protocol-radar";
    headers["x-github-api-version"] = "2022-11-28";
    const token = (
      process.env.GITHUB_TOKEN ??
      process.env.GITHUB_API_TOKEN ??
      ""
    ).trim();
    if (token.length > 0) headers["authorization"] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Fetch a source with conditional GET, bounded retry/backoff, and timeout handling.
 * Retries only on network error / 5xx (up to maxAttempts). Delays are injectable (0 in
 * tests). Never throws — always resolves to a FetchOutcome so a single bad source cannot
 * abort a worker run.
 */
export async function fetchSource(
  client: HttpClient,
  input: FetchInput,
  options: RetryOptions = {},
): Promise<FetchOutcome> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 200;
  const sleep = options.sleep ?? realSleep;

  const headers = buildHeaders(input);

  let lastError = "unknown error";
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: HttpResponse;
    try {
      res = await client.send({
        url: input.url,
        method: "GET",
        headers,
        timeoutMs: input.timeoutMs,
      });
    } catch (err) {
      // Network-level failure / timeout: retry with backoff if attempts remain.
      lastError = err instanceof Error ? err.message : String(err);
      lastStatus = null;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return { kind: "error", httpStatus: null, message: lastError };
    }

    if (res.status === 304) {
      return { kind: "not_modified", httpStatus: 304 };
    }

    if (isAbsentStatus(res.status)) {
      return { kind: "absent", httpStatus: res.status };
    }

    if (isRetryableStatus(res.status)) {
      lastError = `upstream ${res.status}`;
      lastStatus = res.status;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return { kind: "error", httpStatus: res.status, message: lastError };
    }

    if (res.status >= 200 && res.status < 300) {
      return {
        kind: "content",
        httpStatus: res.status,
        body: res.body,
        contentHash: contentHash(res.body),
        etag: header(res, "etag"),
        lastModified: header(res, "last-modified"),
      };
    }

    // Other 4xx (401/403/etc.): non-retryable client error. Report as error.
    return {
      kind: "error",
      httpStatus: res.status,
      message: `unexpected status ${res.status}`,
    };
  }

  return { kind: "error", httpStatus: lastStatus, message: lastError };
}

export { noSleep };
