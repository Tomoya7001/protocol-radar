import { getDictionary, resolveLocale, type Locale } from "@/app/_i18n";
import { firstParam, type SearchParams } from "@/app/_params";
import { defaultPaymentRequirements } from "@/lib/payments";
import { buildPricing, type PremiumEndpoint, type Pricing } from "@/lib/pricing/plans";
import { AppHeader } from "@/components/AppHeader";

/** Composes env config at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * G1 — public pricing storefront page (`/pricing`). READ-ONLY.
 *
 * Renders the same machine-readable plan structure served by `GET /api/pricing`: the free
 * quota tier (F-041), the x402 pay-per-call tier (F-041) and the per-key hard rate limit
 * (F-042), plus the list of premium endpoints. No DB, no secrets, no chain.
 */

/** Read a numeric env var with a fallback (mirrors the payments runtime defaults). */
function envNum(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

/** The endpoints metered by the free/paid gate. */
const PREMIUM_ENDPOINTS: readonly PremiumEndpoint[] = [
  {
    method: "GET",
    path: "/api/x402",
    description: "Metered protocol data (free quota, then x402 pay-per-call).",
  },
];

/** Page copy, kept local to this new file so no shared dictionary is edited. */
interface PricingText {
  title: string;
  intro: string;
  freeName: string;
  freeTagline: string;
  paidName: string;
  paidTagline: string;
  perWindow: (n: number, window: string) => string;
  freeCalls: string;
  price: string;
  network: string;
  asset: string;
  payTo: string;
  timeout: string;
  scheme: string;
  free: string;
  rateLimitHeading: string;
  rateLimitBody: (limit: number, window: string) => string;
  endpointsHeading: string;
  endpointsIntro: string;
  discoverHeading: string;
  discoverIntro: string;
  seconds: (n: number) => string;
}

/** Render a millisecond window as a short human phrase. */
function windowLabel(ms: number, locale: Locale): string {
  const day = 24 * 60 * 60 * 1000;
  if (locale === "ja") {
    if (ms === day) return "1日あたり";
    if (ms === 60 * 60 * 1000) return "1時間あたり";
    if (ms === 60_000) return "1分あたり";
    return `${Math.round(ms / 1000)}秒あたり`;
  }
  if (ms === day) return "per day";
  if (ms === 60 * 60 * 1000) return "per hour";
  if (ms === 60_000) return "per minute";
  return `per ${Math.round(ms / 1000)}s`;
}

const TEXT: Record<Locale, PricingText> = {
  ja: {
    title: "料金",
    intro:
      "このAPIは、まず無料枠で試せて、使い切ったらx402で1コールごとに支払える段階制です。人間もエージェントも、ここに書かれた価格・資産・ネットワーク・支払先を見れば支払い方法を発見できます。",
    freeName: "無料",
    freeTagline: "APIキーだけで、無料枠の範囲内で利用できます。",
    paidName: "従量課金",
    paidTagline: "無料枠を使い切った後は、x402で1コールごとに支払います。",
    perWindow: (n, w) => `${w} ${n} コール`,
    freeCalls: "無料コール数",
    price: "1コールあたりの価格",
    network: "ネットワーク",
    asset: "資産（コントラクト）",
    payTo: "支払先アドレス",
    timeout: "決済猶予",
    scheme: "スキーム",
    free: "無料",
    rateLimitHeading: "キーごとのレート制限",
    rateLimitBody: (limit, w) =>
      `不正利用防止のため、認証済みリクエストにはキーごとの上限 ${w} ${limit} 回 が適用されます。`,
    endpointsHeading: "課金対象エンドポイント",
    endpointsIntro: "以下のエンドポイントが無料／有料ゲートで計測されます。",
    discoverHeading: "エージェント向けの発見方法",
    discoverIntro:
      "機械可読な同じ料金体系はエンドポイントからも取得できます（相対パスで実行できます）。",
    seconds: (n) => `${n} 秒`,
  },
  en: {
    title: "Pricing",
    intro:
      "This API is tiered: start free, then pay per call with x402 once the free quota is used up. Both humans and agents can discover how to pay from the price, asset, network and pay-to address shown here.",
    freeName: "Free",
    freeTagline: "Use it within the free quota with just an API key.",
    paidName: "Pay-per-call",
    paidTagline: "After the free quota is exhausted, pay per call with x402.",
    perWindow: (n, w) => `${n} calls ${w}`,
    freeCalls: "Free calls",
    price: "Price per call",
    network: "Network",
    asset: "Asset (contract)",
    payTo: "Pay-to address",
    timeout: "Settlement window",
    scheme: "Scheme",
    free: "Free",
    rateLimitHeading: "Per-key rate limit",
    rateLimitBody: (limit, w) =>
      `For abuse protection, every authenticated request is subject to a hard per-key ceiling of ${limit} requests ${w}.`,
    endpointsHeading: "Premium endpoints",
    endpointsIntro: "These endpoints are metered by the free/paid gate.",
    discoverHeading: "How agents discover it",
    discoverIntro:
      "The same machine-readable pricing is available from an endpoint (relative paths work).",
    seconds: (n) => `${n}s`,
  },
};

/** One key/value field cell, matching the trust page's tone. */
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={`mt-1 text-sm text-text ${mono ? "font-mono break-all" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * G1 pricing page. Resolves the locale (`?lang=`), builds the read-only pricing model from
 * the advertised x402 requirements + env-derived numbers and renders it.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const locale = resolveLocale(firstParam(sp.lang));
  const dict = getDictionary(locale);
  const text = TEXT[locale];

  const pricing: Pricing = buildPricing({
    requirements: defaultPaymentRequirements(),
    freeTierLimit: envNum("X402_FREE_TIER_LIMIT", 5),
    freeTierWindowMs: envNum("X402_FREE_TIER_WINDOW_MS", 24 * 60 * 60 * 1000),
    keyRateLimit: envNum("KEY_RATE_LIMIT", 60),
    keyRateWindowMs: envNum("KEY_RATE_WINDOW_MS", 60_000),
    assetDecimals: envNum("X402_ASSET_DECIMALS", 6),
    premiumEndpoints: PREMIUM_ENDPOINTS,
  });

  const { free, paid } = pricing.tiers;
  const freeWindow = windowLabel(free.windowMs, locale);
  const rateWindow = windowLabel(pricing.rateLimit.windowMs, locale);

  return (
    <>
      <AppHeader locale={locale} dict={dict} active="detail" basePath="/pricing" />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
        <div>
          <h1 className="text-xl font-semibold text-text">{text.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">{text.intro}</p>
        </div>

        {/* Free vs paid tiers. */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Free tier. */}
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
            <div>
              <h2 className="text-md font-semibold text-text">{text.freeName}</h2>
              <p className="mt-1 text-sm text-text-muted">{text.freeTagline}</p>
            </div>
            <div className="text-2xl font-semibold text-text">{text.free}</div>
            <dl className="grid grid-cols-1 gap-3">
              <Field
                label={text.freeCalls}
                value={text.perWindow(free.callsPerWindow, freeWindow)}
              />
            </dl>
          </div>

          {/* Paid tier. */}
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
            <div>
              <h2 className="text-md font-semibold text-text">{text.paidName}</h2>
              <p className="mt-1 text-sm text-text-muted">{text.paidTagline}</p>
            </div>
            <div className="text-2xl font-semibold text-text">
              {paid.price.display}{" "}
              <span className="text-sm font-normal text-text-muted">
                {pricing.currency.network} · USDC
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={text.scheme} value={paid.scheme} mono />
              <Field label={text.network} value={paid.network} mono />
              <Field label={text.price} value={`${paid.price.atomic} (atomic)`} mono />
              <Field
                label={text.timeout}
                value={text.seconds(paid.maxTimeoutSeconds)}
              />
              <Field label={text.asset} value={paid.asset} mono />
              <Field label={text.payTo} value={paid.payTo} mono />
            </dl>
          </div>
        </section>

        {/* Per-key rate limit. */}
        <section className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-text">{text.rateLimitHeading}</h2>
          <p className="max-w-3xl text-sm text-text-muted">
            {text.rateLimitBody(pricing.rateLimit.limit, rateWindow)}
          </p>
        </section>

        {/* Premium endpoints. */}
        <section className="flex flex-col gap-3">
          <h2 className="text-md font-semibold text-text">{text.endpointsHeading}</h2>
          <p className="max-w-3xl text-sm text-text-muted">{text.endpointsIntro}</p>
          <div className="overflow-x-auto rounded-md border border-border bg-surface">
            <table className="w-full border-collapse text-left">
              <tbody>
                {pricing.premiumEndpoints.map((ep) => (
                  <tr
                    key={`${ep.method} ${ep.path}`}
                    className="border-t border-border align-top first:border-t-0"
                  >
                    <td className="px-4 py-3">
                      <code className="font-mono text-xs text-text">
                        {ep.method} {ep.path}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {ep.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Agent discovery. */}
        <section className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-text">{text.discoverHeading}</h2>
          <p className="max-w-3xl text-sm text-text-muted">{text.discoverIntro}</p>
          <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 px-4 py-3">
            <code className="font-mono text-xs text-text">GET /api/pricing</code>
          </pre>
        </section>
      </main>
    </>
  );
}
