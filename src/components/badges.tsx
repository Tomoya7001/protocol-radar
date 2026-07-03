import type { Dictionary } from "@/app/_i18n";
import type { ProtocolStatus } from "@/lib/db";
import type { ProtocolFreshness, SourceFreshness } from "@/app/_data/freshness";
import { Pill, type PillTone } from "./Pill";
import {
  IconActive,
  IconFresh,
  IconInactive,
  IconPending,
  IconUnknown,
  IconVanished,
  IconWarn,
} from "./icons";

const ICON_CLASS = "h-3.5 w-3.5";

/**
 * F-033 freshness badge. Maps a protocol's aggregated freshness to a toned pill with an SVG
 * icon and a localised label. Stale renders in the warn tone (the decay warning).
 */
export function FreshnessBadge({
  freshness,
  dict,
}: {
  freshness: ProtocolFreshness;
  dict: Dictionary;
}) {
  const map: Record<
    ProtocolFreshness,
    { tone: PillTone; icon: React.ReactNode; label: string }
  > = {
    fresh: {
      tone: "ok",
      icon: <IconFresh className={ICON_CLASS} />,
      label: dict.freshness.fresh,
    },
    stale: {
      tone: "warn",
      icon: <IconWarn className={ICON_CLASS} />,
      label: dict.freshness.stale,
    },
    pending: {
      tone: "neutral",
      icon: <IconPending className={ICON_CLASS} />,
      label: dict.freshness.pending,
    },
    vanished: {
      tone: "danger",
      icon: <IconVanished className={ICON_CLASS} />,
      label: dict.freshness.vanished,
    },
    unknown: {
      tone: "neutral",
      icon: <IconUnknown className={ICON_CLASS} />,
      label: dict.freshness.unknown,
    },
  };
  const cfg = map[freshness];
  return (
    <Pill tone={cfg.tone} icon={cfg.icon}>
      {cfg.label}
    </Pill>
  );
}

/** Protocol lifecycle status badge (active / inactive / vanished). */
export function StatusBadge({
  status,
  dict,
}: {
  status: ProtocolStatus;
  dict: Dictionary;
}) {
  const map: Record<
    ProtocolStatus,
    { tone: PillTone; icon: React.ReactNode; label: string }
  > = {
    active: {
      tone: "ok",
      icon: <IconActive className={ICON_CLASS} />,
      label: dict.status.active,
    },
    inactive: {
      tone: "neutral",
      icon: <IconInactive className={ICON_CLASS} />,
      label: dict.status.inactive,
    },
    vanished: {
      tone: "danger",
      icon: <IconVanished className={ICON_CLASS} />,
      label: dict.status.vanished,
    },
  };
  const cfg = map[status];
  return (
    <Pill tone={cfg.tone} icon={cfg.icon}>
      {cfg.label}
    </Pill>
  );
}

/** Per-source freshness badge (fresh / stale / pending / inactive). */
export function SourceFreshnessBadge({
  freshness,
  dict,
}: {
  freshness: SourceFreshness;
  dict: Dictionary;
}) {
  const map: Record<
    SourceFreshness,
    { tone: PillTone; icon: React.ReactNode; label: string }
  > = {
    fresh: {
      tone: "ok",
      icon: <IconFresh className={ICON_CLASS} />,
      label: dict.freshness.fresh,
    },
    stale: {
      tone: "warn",
      icon: <IconWarn className={ICON_CLASS} />,
      label: dict.freshness.stale,
    },
    pending: {
      tone: "neutral",
      icon: <IconPending className={ICON_CLASS} />,
      label: dict.freshness.pending,
    },
    inactive: {
      tone: "neutral",
      icon: <IconInactive className={ICON_CLASS} />,
      label: dict.detail.sourceInactive,
    },
  };
  const cfg = map[freshness];
  return (
    <Pill tone={cfg.tone} icon={cfg.icon}>
      {cfg.label}
    </Pill>
  );
}
