import type { Dictionary, Locale } from "@/app/_i18n";
import { withLang } from "@/app/_i18n/href";
import { LocaleToggle } from "./LocaleToggle";
import { IconRadar, IconShieldOk } from "./icons";

/**
 * Shared app header: brand, primary navigation, locale toggle, and the SINGLE filled primary
 * CTA of every view (§A.4) — "Verify ledger". Because the one primary CTA lives here, page
 * bodies use only tinted/ghost actions, guaranteeing exactly one primary per view.
 */
export function AppHeader({
  locale,
  dict,
  active,
  basePath,
}: {
  locale: Locale;
  dict: Dictionary;
  active: "dashboard" | "verify" | "detail";
  /** Path of the current page, used to build the locale-toggle hrefs. */
  basePath: string;
}) {
  const dashHref = withLang("/", locale);
  const verifyHref = withLang("/verify", locale);

  const navLink = (href: string, label: string, isActive: boolean) =>
    isActive ? (
      <a
        href={href}
        aria-current="page"
        className="inline-flex h-control-h items-center rounded-sm border border-primary bg-info-tint px-3 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {label}
      </a>
    ) : (
      <a
        href={href}
        className="inline-flex h-control-h items-center rounded-sm border border-transparent px-3 text-sm font-medium text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {label}
      </a>
    );

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <a
          href={dashHref}
          className="inline-flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <IconRadar className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-lg font-semibold text-text">
            {dict.appName}
          </span>
        </a>

        <nav aria-label={dict.appName} className="flex items-center gap-2">
          {navLink(dashHref, dict.nav.dashboard, active === "dashboard")}
          {/* The single filled primary CTA for every view. */}
          <a
            href={verifyHref}
            aria-current={active === "verify" ? "page" : undefined}
            className="inline-flex h-control-h items-center gap-1 rounded-sm bg-primary px-3 text-sm font-medium text-primary-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <IconShieldOk className="h-4 w-4" aria-hidden="true" />
            {dict.nav.verify}
          </a>
          <LocaleToggle
            locale={locale}
            jaHref={withLang(basePath, "ja")}
            enHref={withLang(basePath, "en")}
            dict={dict}
          />
        </nav>
      </div>
    </header>
  );
}
