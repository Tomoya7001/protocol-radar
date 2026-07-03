import type { Dictionary, Locale } from "@/app/_i18n";
import { IconLanguages } from "./icons";

/**
 * F-035 locale toggle. Two keyboard-reachable anchors (JA / EN); the current locale is marked
 * with `aria-current` and an info tint (selected states stay tinted, never filled — §A.4).
 * Pure/server-renderable: it navigates via hrefs, so no client JavaScript is required.
 */
export function LocaleToggle({
  locale,
  jaHref,
  enHref,
  dict,
}: {
  locale: Locale;
  jaHref: string;
  enHref: string;
  dict: Dictionary;
}) {
  const items: Array<{ code: Locale; href: string; label: string }> = [
    { code: "ja", href: jaHref, label: "日本語" },
    { code: "en", href: enHref, label: "English" },
  ];

  return (
    <nav
      aria-label={dict.common.language}
      className="inline-flex items-center gap-1"
    >
      <IconLanguages
        className="mr-1 h-4 w-4 text-text-muted"
        aria-hidden="true"
      />
      {items.map((item) => {
        const current = item.code === locale;
        const cls = current
          ? "border-primary bg-info-tint text-primary"
          : "border-border bg-surface text-text-muted hover:bg-surface-2";
        return (
          <a
            key={item.code}
            href={item.href}
            hrefLang={item.code}
            aria-current={current ? "true" : undefined}
            className={`inline-flex h-hit-min items-center rounded-sm border px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${cls}`}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
