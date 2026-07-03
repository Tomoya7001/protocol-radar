import { ja, en, type Dictionary } from "./dictionaries";

/**
 * F-035 — locale resolution. Japanese is the default and canonical UI language; English is
 * the optional secondary bundle. No third language is permitted.
 */
export type Locale = "ja" | "en";

export const LOCALES: readonly Locale[] = ["ja", "en"] as const;
export const DEFAULT_LOCALE: Locale = "ja";

const DICTIONARIES: Record<Locale, Dictionary> = { ja, en };

/** Type guard for a supported locale string. */
export function isLocale(value: unknown): value is Locale {
  return value === "ja" || value === "en";
}

/**
 * Resolve an arbitrary input (query param, cookie, header fragment) to a supported locale,
 * falling back to the default (ja). Case-insensitive; a leading region subtag like "en-US"
 * resolves to "en".
 */
export function resolveLocale(value: string | null | undefined): Locale {
  if (value == null) return DEFAULT_LOCALE;
  const base = value.trim().toLowerCase().split("-")[0] ?? "";
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

/** Get the string bundle for a locale (defaults to ja for anything unsupported). */
export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/** The opposite locale — used by the toggle to build its "switch to X" link. */
export function otherLocale(locale: Locale): Locale {
  return locale === "ja" ? "en" : "ja";
}

/**
 * Replace `{name}` placeholders in a template with values from `vars`. Missing keys are left
 * as-is. Keeps templated UI strings (e.g. "seq {seq}") data-driven and testable.
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export type { Dictionary } from "./dictionaries";
