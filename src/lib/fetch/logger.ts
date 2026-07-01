/**
 * Minimal structured logger. English-only messages (log language guard). Kept tiny and
 * injectable so tests can capture lines instead of writing to the console.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /**
   * A deferred integrity task (e.g. a source URL that 404s and must be re-sourced). These
   * are surfaced prominently because source-URL integrity is the product.
   */
  todo(message: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.info(`[info] ${m}`),
  warn: (m) => console.warn(`[warn] ${m}`),
  error: (m) => console.error(`[error] ${m}`),
  todo: (m) => console.warn(`[TODO] ${m}`),
};

/** A logger that records lines in memory; useful for tests. */
export function createMemoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`[info] ${m}`),
    warn: (m) => lines.push(`[warn] ${m}`),
    error: (m) => lines.push(`[error] ${m}`),
    todo: (m) => lines.push(`[TODO] ${m}`),
  };
}
