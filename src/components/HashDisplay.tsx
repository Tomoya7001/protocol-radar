"use client";

import { useState } from "react";
import type { Dictionary } from "@/app/_i18n";
import { truncateMiddle } from "@/app/_data/format";
import { IconCopy, IconCopied } from "./icons";

/**
 * Hash/version display (02_DESIGN.md): mono token, truncate-middle, with an SVG copy button.
 * Interactive, so it defines a :focus-visible ring (§A.3). Copies the FULL value, not the
 * truncated one. The full value is also exposed via `title` for hover/inspection.
 */
export function HashDisplay({
  value,
  dict,
  head = 8,
  tail = 8,
}: {
  value: string;
  dict: Dictionary;
  head?: number;
  tail?: number;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context): fail silently, value stays visible.
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <code className="font-mono text-xs text-text-muted" title={value}>
        {truncateMiddle(value, head, tail)}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? dict.common.copied : dict.common.copy}
        className="inline-flex h-hit-min w-hit-min items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {copied ? (
          <IconCopied className="h-4 w-4 text-ok" aria-hidden="true" />
        ) : (
          <IconCopy className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
