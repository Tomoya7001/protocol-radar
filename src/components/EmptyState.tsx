import type { ReactNode } from "react";

/**
 * Empty state (02_DESIGN.md): SVG icon + one line + optional action. Tokens-only, uniform
 * border.
 */
export function EmptyState({
  icon,
  message,
  action,
}: {
  icon: ReactNode;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface p-7 text-center">
      <span aria-hidden="true" className="inline-flex text-text-muted">
        {icon}
      </span>
      <p className="text-sm text-text-muted">{message}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
