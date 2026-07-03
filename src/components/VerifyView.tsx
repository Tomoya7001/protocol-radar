import type { Dictionary, Locale } from "@/app/_i18n";
import { interpolate } from "@/app/_i18n";
import { withLang } from "@/app/_i18n/href";
import type { VerifyMode, VerifyOutcome } from "@/app/_data/verify";
import { AppHeader } from "./AppHeader";
import { Callout } from "./Callout";
import { IconShieldAlert, IconShieldOk, IconWarn } from "./icons";

/** Two-item mode selector: raw (recompute) / chain. Selected stays tinted, never filled. */
function ModeToggle({
  mode,
  locale,
  dict,
}: {
  mode: VerifyMode;
  locale: Locale;
  dict: Dictionary;
}) {
  const items: Array<{ value: VerifyMode; label: string }> = [
    { value: "raw", label: dict.verify.modeRaw },
    { value: "chain", label: dict.verify.modeChain },
  ];
  return (
    <nav
      aria-label={dict.verify.title}
      className="inline-flex items-center gap-1"
    >
      {items.map((item) => {
        const current = item.value === mode;
        // "raw" is the default mode, so its href needs no ?mode= param.
        const path = item.value === "raw" ? "/verify" : "/verify?mode=chain";
        const cls = current
          ? "border-primary bg-info-tint text-primary"
          : "border-border bg-surface text-text-muted hover:bg-surface-2 hover:text-text";
        return (
          <a
            key={item.value}
            href={withLang(path, locale)}
            aria-current={current ? "true" : undefined}
            className={`inline-flex h-control-h items-center rounded-sm border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${cls}`}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

/** Result Callout: OK (ok) / tampered (danger) / secret-unavailable (warn). */
function VerifyResult({
  outcome,
  dict,
}: {
  outcome: VerifyOutcome;
  dict: Dictionary;
}) {
  if (outcome.ok) {
    return (
      <Callout
        tone="ok"
        icon={<IconShieldOk className="h-5 w-5" />}
        title={dict.verify.ok}
      >
        <span>{interpolate(dict.verify.checked, { n: outcome.checked })}</span>
      </Callout>
    );
  }
  if (outcome.unavailable === true) {
    return (
      <Callout
        tone="warn"
        icon={<IconWarn className="h-5 w-5" />}
        title={dict.verify.unavailable}
      />
    );
  }
  return (
    <Callout
      tone="danger"
      icon={<IconShieldAlert className="h-5 w-5" />}
      title={interpolate(dict.verify.tampered, { seq: outcome.tampered_seq })}
    >
      <span>{interpolate(dict.verify.checked, { n: outcome.checked })}</span>
    </Callout>
  );
}

/**
 * F-034 verify view. Re-computes the hash chain from raw records (or runs the field-level
 * chain check) via the committed verify _data layer and shows OK / tampered / unavailable.
 * Uses exactly the same `runVerify` outcome the /api/verify route returns, so the human page
 * and the API can never disagree.
 *
 * The single filled primary CTA ("Verify ledger") lives in the header and is active here; the
 * mode selector is tinted/bordered (never a second filled primary — §A.4).
 */
export function VerifyView({
  outcome,
  dict,
  locale,
  mode,
}: {
  outcome: VerifyOutcome;
  dict: Dictionary;
  locale: Locale;
  mode: VerifyMode;
}) {
  const basePath = mode === "chain" ? "/verify?mode=chain" : "/verify";
  return (
    <>
      <AppHeader
        locale={locale}
        dict={dict}
        active="verify"
        basePath={basePath}
      />
      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
        <div>
          <h1 className="text-xl font-semibold text-text">
            {dict.verify.title}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {dict.verify.subtitle}
          </p>
        </div>

        <ModeToggle mode={mode} locale={locale} dict={dict} />
        <VerifyResult outcome={outcome} dict={dict} />
      </main>
    </>
  );
}
