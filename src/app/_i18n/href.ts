import type { Locale } from "./index";

/**
 * Build a locale-aware href. Japanese is the default and needs no query param; other locales
 * are carried via `?lang=`. Keeps links deterministic and server-renderable (no client hooks).
 */
export function withLang(path: string, locale: Locale): string {
  if (locale === "ja") return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}lang=${locale}`;
}
