import { getDb } from "@/app/_data/db";
import { getProtocolDetail } from "@/app/_data/queries";
import { getDictionary, resolveLocale } from "@/app/_i18n";
import { firstParam, parseNowParam, type SearchParams } from "@/app/_params";
import { ProtocolDetailView } from "@/components/ProtocolDetailView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-031 protocol detail page (+ F-033 decay, F-035 locale). Resolves the `[key]` route param,
 * locale and deterministic `?now=`, loads the protocol timeline, and renders the view. An
 * unknown key renders an in-page not-found state (the view handles `detail === null`).
 */
export default async function ProtocolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const locale = resolveLocale(firstParam(sp.lang));
  const dict = getDictionary(locale);
  const now = parseNowParam(sp.now);

  const detail = getProtocolDetail(getDb(), key, now);

  return (
    <ProtocolDetailView
      detail={detail}
      dict={dict}
      locale={locale}
      now={now}
      protocolKey={key}
    />
  );
}
