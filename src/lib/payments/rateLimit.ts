/**
 * F-042 — per-key rate metering.
 *
 * A fixed-window counter keyed by an arbitrary string (e.g. an API-key id). Deterministic
 * and offline: the clock is injectable, so tests can advance time explicitly. Also reused by
 * the x402 gate (F-041) to meter the free tier — where a limit of 0 models a "paid-only"
 * (no free calls) configuration.
 */

export interface RateLimitOptions {
  /** Maximum number of allowed units per window (>= 0; 0 blocks every call). */
  limit: number;
  /** Window length in milliseconds (>= 1). */
  windowMs: number;
  /** Injectable clock (epoch ms). Defaults to Date.now. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Units left in the current window after this call. */
  remaining: number;
  /** Epoch ms at which the current window resets. */
  resetAt: number;
  /** Milliseconds until the window resets; 0 when allowed. */
  retryAfterMs: number;
}

interface WindowState {
  windowStart: number;
  count: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, WindowState>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(opts: RateLimitOptions) {
    if (!Number.isInteger(opts.limit) || opts.limit < 0) {
      throw new Error("rate limit must be an integer >= 0");
    }
    if (!Number.isFinite(opts.windowMs) || opts.windowMs < 1) {
      throw new Error("window must be >= 1ms");
    }
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Consume one unit for `key`; returns whether it was allowed plus metering metadata. */
  consume(key: string): RateLimitResult {
    const t = this.now();
    let state = this.buckets.get(key);
    if (state === undefined || t - state.windowStart >= this.windowMs) {
      state = { windowStart: t, count: 0 };
      this.buckets.set(key, state);
    }
    const resetAt = state.windowStart + this.windowMs;
    if (state.count >= this.limit) {
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, resetAt - t),
      };
    }
    state.count += 1;
    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - state.count,
      resetAt,
      retryAfterMs: 0,
    };
  }

  /** Inspect the current window for `key` WITHOUT consuming a unit. */
  peek(key: string): RateLimitResult {
    const t = this.now();
    const state = this.buckets.get(key);
    if (state === undefined || t - state.windowStart >= this.windowMs) {
      return {
        allowed: this.limit > 0,
        limit: this.limit,
        remaining: this.limit,
        resetAt: t + this.windowMs,
        retryAfterMs: 0,
      };
    }
    const resetAt = state.windowStart + this.windowMs;
    const remaining = Math.max(0, this.limit - state.count);
    return {
      allowed: remaining > 0,
      limit: this.limit,
      remaining,
      resetAt,
      retryAfterMs: remaining > 0 ? 0 : Math.max(0, resetAt - t),
    };
  }

  /** Reset one key's window, or all windows when `key` is omitted. */
  reset(key?: string): void {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }
}
