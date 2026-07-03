import type { ReactNode } from "react";

/**
 * Callout (02_DESIGN.md): FULL background tint + FULL uniform border + leading SVG icon.
 * NEVER a single-edge stripe (§A.1). Tokens-only. Used for the verify OK/tampered/stale
 * notices.
 */
export type CalloutTone = "ok" | "warn" | "danger" | "info";

const TONE_CLASSES: Record<CalloutTone, string> = {
  ok: "border-ok bg-surface-2",
  warn: "border-warn bg-surface-2",
  danger: "border-danger bg-surface-2",
  info: "border-primary bg-info-tint",
};

const ICON_TONE: Record<CalloutTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-primary",
};

export function Callout({
  tone,
  icon,
  title,
  children,
}: {
  tone: CalloutTone;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-md border p-4 ${TONE_CLASSES[tone]}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex ${ICON_TONE[tone]}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-md font-semibold text-text">{title}</p>
        {children ? (
          <div className="mt-1 text-sm text-text-muted">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
