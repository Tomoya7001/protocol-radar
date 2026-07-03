import { getDb } from "@/app/_data/db";
import { parseVerifyMode, runVerify } from "@/app/_data/verify";
import { getDictionary, resolveLocale } from "@/app/_i18n";
import { firstParam, type SearchParams } from "@/app/_params";
import { VerifyView } from "@/components/VerifyView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-034 verify page (+ F-035 locale). Recomputes the hash chain (`?mode=raw` default, or
 * `?mode=chain`) via the shared `runVerify` — the exact outcome the /api/verify route returns
 * — and renders OK / tampered / unavailable.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const locale = resolveLocale(firstParam(sp.lang));
  const dict = getDictionary(locale);
  const mode = parseVerifyMode(firstParam(sp.mode));

  const outcome = runVerify(getDb(), mode);

  return (
    <VerifyView outcome={outcome} dict={dict} locale={locale} mode={mode} />
  );
}
