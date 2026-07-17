import { getDb } from "@/app/_data/db";
import { formatUtc } from "@/app/_data/format";
import { getDictionary, resolveLocale, type Locale } from "@/app/_i18n";
import { firstParam, type SearchParams } from "@/app/_params";
import { parseVerifyMode } from "@/app/_data/verify";
import { buildTrustSummary, type TrustProtocol } from "@/lib/trust/summary";
import { AppHeader } from "@/components/AppHeader";
import { Callout } from "@/components/Callout";
import { HashDisplay } from "@/components/HashDisplay";
import { IconShieldAlert, IconShieldOk, IconWarn } from "@/components/icons";

/** Reads the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * B2 - public re-verification page (`/trust`). READ-ONLY.
 *
 * The core promise of this tool is that a tamper-evident provenance ledger can be re-checked by
 * ANYONE, independently. This page surfaces that: it runs the SAME committed `runVerify` the
 * /api/verify route uses (via `buildTrustSummary`), shows the whole-chain result plus each
 * monitored protocol's last-change `content_hash` (copied verbatim from the ledger — never
 * recomputed), and tells the reader exactly how to re-verify the same claims themselves against
 * `GET /api/verify` and `GET /api/certificate`. No DB writes, no secrets.
 */

/** Page copy, kept local to this new file so no shared dictionary is edited. */
interface TrustText {
  title: string;
  intro: string;
  summaryHeading: string;
  ok: string;
  tampered: string; // {seq}
  unavailable: string;
  fieldMode: string;
  fieldChecked: string;
  fieldHead: string;
  protocolsHeading: string;
  protocolsIntro: string;
  colProtocol: string;
  colStatus: string;
  colLastChange: string;
  colContentHash: string;
  noChange: string;
  noContentHash: string;
  howHeading: string;
  howIntro: string;
  howVerify: string;
  howCertificate: string;
}

const TEXT: Record<Locale, TrustText> = {
  ja: {
    title: "信頼と再検証",
    intro:
      "この台帳は HMAC-SHA256 のハッシュチェーンで、プロトコルが「出た／変わった／消えた」来歴を改ざん不能に記録しています。ここでは今の検証結果をその場で確認でき、下の手順で誰でも同じ検証を自分で再実行できます。",
    summaryHeading: "現在の台帳検証",
    ok: "台帳は検証に合格しました（改ざんは検出されていません）。",
    tampered: "seq {seq} で不整合を検出しました。台帳が改ざんされた可能性があります。",
    unavailable: "台帳の HMAC 秘密鍵が未設定のため検証を実行できません。",
    fieldMode: "検証モード",
    fieldChecked: "検証イベント数",
    fieldHead: "チェーン先頭ハッシュ",
    protocolsHeading: "監視対象プロトコル",
    protocolsIntro:
      "各プロトコルの最終変更と、その内容ハッシュ（content_hash）です。ハッシュは台帳に記録済みの値をそのまま表示しています。",
    colProtocol: "プロトコル",
    colStatus: "状態",
    colLastChange: "最終変更",
    colContentHash: "内容ハッシュ",
    noChange: "変更なし",
    noContentHash: "—",
    howHeading: "自分で再検証する方法",
    howIntro:
      "以下の読み取り専用エンドポイントを叩けば、同じ台帳に対して独立に再検証できます（相対パスで実行できます）。",
    howVerify: "台帳全体のハッシュチェーンを原本から再計算して検証します。",
    howCertificate:
      "指定プロトコルの、指定時点（asOf）での来歴スナップショットを取得します。",
  },
  en: {
    title: "Trust & re-verification",
    intro:
      "This ledger is an HMAC-SHA256 hash chain that records — tamper-evidently — the provenance of when a protocol appeared, changed or vanished. Here you can see the current verification result on the spot, and re-run the exact same verification yourself using the steps below.",
    summaryHeading: "Current ledger verification",
    ok: "The ledger verified successfully (no tampering detected).",
    tampered:
      "Inconsistency detected at seq {seq}. The ledger may have been tampered with.",
    unavailable: "Cannot verify: the ledger HMAC secret is not configured.",
    fieldMode: "Verification mode",
    fieldChecked: "Events checked",
    fieldHead: "Chain head hash",
    protocolsHeading: "Monitored protocols",
    protocolsIntro:
      "Each protocol's last change and its content hash. Hashes are shown exactly as recorded in the ledger.",
    colProtocol: "Protocol",
    colStatus: "Status",
    colLastChange: "Last change",
    colContentHash: "Content hash",
    noChange: "No changes",
    noContentHash: "—",
    howHeading: "How to re-verify it yourself",
    howIntro:
      "Call these read-only endpoints to independently re-verify the same ledger (relative paths work).",
    howVerify:
      "Recomputes the whole-ledger hash chain from the raw records and reports the result.",
    howCertificate:
      "Fetches a provenance snapshot of one protocol as of a chosen point in time (asOf).",
  },
};

function interp(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

/** One monitored-protocol row. content_hash is copied straight from the ledger. */
function ProtocolRow({
  protocol,
  text,
  dict,
}: {
  protocol: TrustProtocol;
  text: TrustText;
  dict: ReturnType<typeof getDictionary>;
}) {
  const change = protocol.last_change;
  return (
    <tr className="border-t border-border align-top">
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-text">{protocol.name}</div>
        <code className="font-mono text-xs text-text-muted">{protocol.key}</code>
      </td>
      <td className="px-4 py-3 text-sm text-text-muted">{protocol.status}</td>
      <td className="px-4 py-3">
        {change ? (
          <div>
            <div className="text-sm text-text">{change.summary ?? change.type}</div>
            <div className="text-xs text-text-muted">
              {formatUtc(change.created_at)}
            </div>
          </div>
        ) : (
          <span className="text-sm text-text-muted">{text.noChange}</span>
        )}
      </td>
      <td className="px-4 py-3">
        {change?.content_hash ? (
          <HashDisplay value={change.content_hash} dict={dict} />
        ) : (
          <span className="text-sm text-text-muted">{text.noContentHash}</span>
        )}
      </td>
    </tr>
  );
}

/** A copyable, read-only code example (mono block, tokens-only, matches the design tone). */
function CodeExample({ command, note }: { command: string; note: string }) {
  return (
    <div className="flex flex-col gap-1">
      <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 px-4 py-3">
        <code className="font-mono text-xs text-text">{command}</code>
      </pre>
      <p className="text-sm text-text-muted">{note}</p>
    </div>
  );
}

/**
 * B2 trust page. Resolves the locale (`?lang=`) and verify mode (`?mode=`), assembles the
 * read-only summary and renders it. All provenance values are copies of the committed ledger.
 */
export default async function TrustPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const locale = resolveLocale(firstParam(sp.lang));
  const dict = getDictionary(locale);
  const mode = parseVerifyMode(firstParam(sp.mode));
  const text = TEXT[locale];

  const summary = buildTrustSummary(getDb(), mode);

  return (
    <>
      <AppHeader locale={locale} dict={dict} active="detail" basePath="/trust" />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
        <div>
          <h1 className="text-xl font-semibold text-text">{text.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">{text.intro}</p>
        </div>

        {/* Current whole-chain verification result. */}
        <section className="flex flex-col gap-3">
          <h2 className="text-md font-semibold text-text">
            {text.summaryHeading}
          </h2>
          {summary.unavailable ? (
            <Callout
              tone="warn"
              icon={<IconWarn className="h-5 w-5" />}
              title={text.unavailable}
            />
          ) : summary.ok ? (
            <Callout
              tone="ok"
              icon={<IconShieldOk className="h-5 w-5" />}
              title={text.ok}
            />
          ) : (
            <Callout
              tone="danger"
              icon={<IconShieldAlert className="h-5 w-5" />}
              title={interp(text.tampered, {
                seq: summary.tampered_seq ?? "?",
              })}
            />
          )}
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-surface px-4 py-3">
              <dt className="text-xs text-text-muted">{text.fieldMode}</dt>
              <dd className="mt-1 font-mono text-sm text-text">{summary.mode}</dd>
            </div>
            <div className="rounded-md border border-border bg-surface px-4 py-3">
              <dt className="text-xs text-text-muted">{text.fieldChecked}</dt>
              <dd className="mt-1 font-mono text-sm text-text">
                {summary.checked}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-surface px-4 py-3">
              <dt className="text-xs text-text-muted">{text.fieldHead}</dt>
              <dd className="mt-1">
                <HashDisplay value={summary.head_hash} dict={dict} />
              </dd>
            </div>
          </dl>
        </section>

        {/* Monitored protocols and their last-change content_hash (verbatim). */}
        <section className="flex flex-col gap-3">
          <h2 className="text-md font-semibold text-text">
            {text.protocolsHeading}
          </h2>
          <p className="max-w-3xl text-sm text-text-muted">
            {text.protocolsIntro}
          </p>
          <div className="overflow-x-auto rounded-md border border-border bg-surface">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-xs text-text-muted">
                  <th className="px-4 py-3 font-medium">{text.colProtocol}</th>
                  <th className="px-4 py-3 font-medium">{text.colStatus}</th>
                  <th className="px-4 py-3 font-medium">{text.colLastChange}</th>
                  <th className="px-4 py-3 font-medium">
                    {text.colContentHash}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.protocols.map((p) => (
                  <ProtocolRow
                    key={p.key}
                    protocol={p}
                    text={text}
                    dict={dict}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* How to re-verify independently. */}
        <section className="flex flex-col gap-3">
          <h2 className="text-md font-semibold text-text">{text.howHeading}</h2>
          <p className="max-w-3xl text-sm text-text-muted">{text.howIntro}</p>
          <CodeExample command="GET /api/verify" note={text.howVerify} />
          <CodeExample
            command="GET /api/certificate?protocol=<key>&asOf=<ISO>"
            note={text.howCertificate}
          />
        </section>
      </main>
    </>
  );
}
