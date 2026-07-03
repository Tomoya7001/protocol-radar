import { getDb } from "./_data/db";
import { getProtocolSummaries } from "./_data/queries";
import { getDictionary, resolveLocale } from "./_i18n";
import { firstParam, parseNowParam, type SearchParams } from "./_params";
import { DashboardView } from "@/components/DashboardView";

/** Reads the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-030 dashboard page (+ F-033 decay, F-035 locale). Resolves the locale (`?lang=`) and an
 * optional deterministic `?now=`, queries every protocol summary, and renders the view.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const locale = resolveLocale(firstParam(sp.lang));
  const dict = getDictionary(locale);
  const now = parseNowParam(sp.now);

  const summaries = getProtocolSummaries(getDb(), now);

  return (
    <DashboardView
      summaries={summaries}
      dict={dict}
      locale={locale}
      now={now}
    />
  );
}
