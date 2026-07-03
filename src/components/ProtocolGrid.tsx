import type { Dictionary, Locale } from "@/app/_i18n";
import { withLang } from "@/app/_i18n/href";
import type { ProtocolSummaryDto } from "@/app/_data/queries";
import { ProtocolCard } from "./ProtocolCard";
import { EmptyState } from "./EmptyState";
import { IconEmpty } from "./icons";

/**
 * F-030 protocol grid. Renders one card per protocol, or an empty state (SVG icon + one line)
 * when there are no protocols.
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
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {protocols.map((p) => (
        <li key={p.key} className="flex">
          <div className="flex w-full">
            <ProtocolCard
              summary={p}
              dict={dict}
              now={now}
              href={withLang(`/protocols/${p.key}`, locale)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
