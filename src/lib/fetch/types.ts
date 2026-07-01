/**
 * HTTP client abstraction. The default implementation wraps global fetch; tests inject
 * a deterministic fake. Nothing here performs real network I/O directly — that keeps the
 * fetch core testable offline.
 */

export interface HttpRequest {
  url: string;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Response body text; may be empty for HEAD or 304. */
  body: string;
}

/**
 * A pluggable HTTP client. Implementations should reject (throw) on network-level errors
 * (DNS, connection reset, timeout) and RESOLVE with an HttpResponse for any HTTP status
 * (including 4xx/5xx). The fetch core distinguishes these to drive retry vs. classify.
 */
export interface HttpClient {
  send(req: HttpRequest): Promise<HttpResponse>;
}

/** Injectable sleep, so tests use a zero/instant delay instead of real timers. */
export type SleepFn = (ms: number) => Promise<void>;

export const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A no-op sleep for deterministic, fast tests. */
export const noSleep: SleepFn = () => Promise.resolve();
