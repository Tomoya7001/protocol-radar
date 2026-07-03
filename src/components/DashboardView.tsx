import type { Dictionary, Locale } from "@/app/_i18n";
import type { ProtocolSummaryDto } from "@/app/_data/queries";
import { AppHeader } from "./AppHeader";
import { ProtocolGrid } from "./ProtocolGrid";
import { Callout } from "./Callout";
import { IconWarn } from "./icons";

/**
 * F-030 dashboard view (+ F-033 decay surfacing). Pure/synchronous so it renders identically
 * on the server and in tests via renderToStaticMarkup — the async page wrapper resolves the
 * data and hands it in already shaped.
 *
 * Layout: shared header (owns the SINGLE filled primary CTA — "Verify ledger"), a page title,
 * an aggregate stale-source warning Callout when any protocol has decayed, then the grid of
 * protocol cards (each card carries its own per-protocol FreshnessBadge).
 */
export function DashboardView({
  summaries,
  dict,
  locale,
  now,
}: {
  summaries: ProtocolSummaryDto[];
  dict: Dictionary;
  locale: Locale;
  now: number;
}) {
  const stale = summaries.filter((p) => p.stale_warning);

  return (
    <>
      <AppHeader
        locale={locale}
        dict={dict}
        active="dashboard"
        basePath="/"
      />
      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
        <div>
          <h1 className="text-xl font-semibold text-text">
            {dict.dashboard.title}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {dict.dashboard.subtitle}
          </p>
        </div>

        {stale.length > 0 ? (
          <Callout
            tone="warn"
            icon={<IconWarn className="h-5 w-5" />}
            title={dict.freshness.stale}
          >
            <span>{stale.map((p) => p.name).join("、")}</span>
          </Callout>
        ) : null}

        <ProtocolGrid
          protocols={summaries}
          dict={dict}
          locale={locale}
          now={now}
        />
      </main>
    </>
  );
}
