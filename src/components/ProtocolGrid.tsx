import type { Dictionary, Locale } from "@/app/_i18n";
import { withLang } from "@/app/_i18n/href";
import type { ProtocolSummaryDto } from "@/app/_data/queries";
import { ProtocolCard } from "./ProtocolCard";
import { EmptyState } from "./EmptyState";
import { IconEmpty } from "./icons";

/**
 * F-030 protocol grid. Renders one card per protocol, or an empty state (SVG icon + one line)
 * when there are no protocols.
 *
 * Layout: responsive 1 / sm:2 / lg:3 columns. `items-stretch` makes every cell take the full
 * row height and each card fills it (`h-full`), so cards in a row are equal-height and their
 * "N events / N sources" footers align regardless of how much last-change text each carries.
 * `min-w-0` lets long names truncate instead of forcing horizontal scroll in narrow panels.
 */
export function ProtocolGrid({
  protocols,
  dict,
  locale,
  now,
}: {
  protocols: ProtocolSummaryDto[];
  dict: Dictionary;
  locale: Locale;
  now: number;
}) {
  if (protocols.length === 0) {
    return (
      <EmptyState
        icon={<IconEmpty className="h-8 w-8" />}
        message={dict.dashboard.empty}
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {protocols.map((p) => (
        <li key={p.key} className="flex min-w-0">
          <ProtocolCard
            summary={p}
            dict={dict}
            now={now}
            href={withLang(`/protocols/${p.key}`, locale)}
          />
        </li>
      ))}
    </ul>
  );
}
