import type { ReactNode } from "react";

/**
 * Status pill (02_DESIGN.md): area tint + leading SVG icon + text. Color is NEVER the only
 * signal — an icon and a text label are always present. Tokens-only; the border is UNIFORM
 * on all sides (§A.1). Not interactive, so no focus ring needed.
 */
export type PillTone = "ok" | "warn" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<PillTone, string> = {
  ok: "border-ok text-ok bg-surface-2",
  warn: "border-warn text-warn bg-surface-2",
  danger: "border-danger text-danger bg-surface-2",
  info: "border-primary text-primary bg-info-tint",
  neutral: "border-border text-text-muted bg-surface-2",
};

export function Pill({
  tone,
  icon,
  children,
}: {
  tone: PillTone;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}
