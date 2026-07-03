import type { ReactNode } from "react";
import type { Dictionary, Locale } from "@/app/_i18n";
import { withLang } from "@/app/_i18n/href";
import type {
  EventDto,
  ProtocolDetailDto,
  SourceDto,
} from "@/app/_data/queries";
import type { EventType } from "@/lib/db";
import { formatUtc, relativeAge } from "@/app/_data/format";
import { AppHeader } from "./AppHeader";
import { Callout } from "./Callout";
import { EmptyState } from "./EmptyState";
import { HashDisplay } from "./HashDisplay";
import { Pill, type PillTone } from "./Pill";
import {
  FreshnessBadge,
  SourceFreshnessBadge,
  StatusBadge,
} from "./badges";
import {
  IconBack,
  IconEmpty,
  IconFresh,
  IconShieldOk,
  IconSpec,
  IconVanished,
  IconVersion,
  IconWarn,
} from "./icons";

const EVENT_ICON = "h-3.5 w-3.5";

/** Map an event type to a toned pill (SVG icon + localised label) for the timeline. */
function EventTypeBadge({
  type,
  dict,
}: {
  type: EventType;
  dict: Dictionary;
}) {
  const map: Record<EventType, { tone: PillTone; icon: ReactNode }> = {
    appeared: { tone: "ok", icon: <IconFresh className={EVENT_ICON} /> },
    version_bump: { tone: "info", icon: <IconVersion className={EVENT_ICON} /> },
    spec_change: { tone: "info", icon: <IconSpec className={EVENT_ICON} /> },
    vanished: { tone: "danger", icon: <IconVanished className={EVENT_ICON} /> },
  };
  const cfg = map[type];
  return (
    <Pill tone={cfg.tone} icon={cfg.icon}>
      {dict.eventType[type]}
    </Pill>
  );
}

/** One monitored source row: uniform-bordered card with a freshness badge (F-033). */
function SourceRow({
  source,
  dict,
}: {
  source: SourceDto;
  dict: Dictionary;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm text-text">
          {source.label ?? source.url}
        </p>
        <p className="truncate font-mono text-xs text-text-muted">
          {source.url}
        </p>
        {source.last_polled_at ? (
          <p className="mt-1 text-xs text-text-muted">
            {formatUtc(source.last_polled_at)}
          </p>
        ) : null}
      </div>
      <SourceFreshnessBadge freshness={source.freshness} dict={dict} />
    </li>
  );
}

/** One timeline event: uniform-bordered card (never a single-edge accent — §A.1). */
function EventCard({
  event,
  dict,
}: {
  event: EventDto;
  dict: Dictionary;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <EventTypeBadge type={event.type} dict={dict} />
        <span className="font-mono text-xs text-text-muted">
          seq {event.seq}
        </span>
        <span className="text-xs text-text-muted">
          {formatUtc(event.created_at)}
        </span>
      </div>

      {event.summary ? (
        <p className="text-sm text-text">{event.summary}</p>
      ) : null}

      {event.diffs.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {event.diffs.map((d, i) => (
            <li key={i} className="text-xs text-text-muted">
              {d.detail ?? d.kind}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="flex flex-col gap-1 border-t border-border pt-2">
        <div className="flex items-center gap-2">
          <dt className="w-16 shrink-0 text-xs text-text-muted">
            {dict.detail.hash}
          </dt>
          <dd className="min-w-0">
            <HashDisplay value={event.hash} dict={dict} />
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-16 shrink-0 text-xs text-text-muted">
            {dict.detail.prevHash}
          </dt>
          <dd className="min-w-0">
            <HashDisplay value={event.prev_hash} dict={dict} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * F-031 protocol detail view (+ F-033 decay surfacing). Renders the protocol header, a stale
 * warning Callout when decayed, its monitored sources, the full event timeline (newest first
 * with diffs and ledger hashes), and a link to the ledger verify page. `detail === null`
 * renders a not-found empty state (unknown key) — the page never 404s the whole app.
 *
 * No filled primary CTA lives here: the single primary ("Verify ledger") is in the header,
 * so the in-body verify link is a tinted/bordered secondary action (§A.4).
 */
export function ProtocolDetailView({
  detail,
  dict,
  locale,
  now,
  protocolKey,
}: {
  detail: ProtocolDetailDto | null;
  dict: Dictionary;
  locale: Locale;
  now: number;
  protocolKey: string;
}) {
  const dashHref = withLang("/", locale);
  const verifyHref = withLang("/verify", locale);

  const backLink = (
    <a
      href={dashHref}
      className="inline-flex h-control-h items-center gap-1 rounded-sm border border-border bg-surface px-3 text-sm font-medium text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <IconBack className="h-4 w-4" aria-hidden="true" />
      {dict.detail.backToDashboard}
    </a>
  );

  if (detail === null) {
    return (
      <>
        <AppHeader
          locale={locale}
          dict={dict}
          active="detail"
          basePath={`/protocols/${protocolKey}`}
        />
        <main className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
          {backLink}
          <EmptyState
            icon={<IconEmpty className="h-8 w-8" />}
            message={dict.detail.notFound}
          />
        </main>
      </>
    );
  }

  const { protocol, events } = detail;

  return (
    <>
      <AppHeader
        locale={locale}
        dict={dict}
        active="detail"
        basePath={`/protocols/${protocol.key}`}
      />
      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
        {backLink}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-text">
                {protocol.name}
              </h1>
              <p className="font-mono text-sm text-text-muted">
                {protocol.key}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={protocol.status} dict={dict} />
              <FreshnessBadge freshness={protocol.freshness} dict={dict} />
            </div>
          </div>

          {protocol.last_event ? (
            <p className="text-sm text-text-muted">
              {dict.dashboard.lastChange}:{" "}
              <span className="text-text">
                {dict.eventType[protocol.last_event.type]}
              </span>{" "}
              ({relativeAge(protocol.last_event.created_at, now)})
            </p>
          ) : null}
        </div>

        {protocol.stale_warning ? (
          <Callout
            tone="warn"
            icon={<IconWarn className="h-5 w-5" />}
            title={dict.freshness.stale}
          >
            <span>{dict.dashboard.subtitle}</span>
          </Callout>
        ) : null}

        {/* F-031: explicit link to the ledger verify page (secondary/tinted, not primary). */}
        <div>
          <a
            href={verifyHref}
            className="inline-flex h-control-h items-center gap-1 rounded-sm border border-primary bg-info-tint px-3 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <IconShieldOk className="h-4 w-4" aria-hidden="true" />
            {dict.detail.verifyLink}
          </a>
        </div>

        {protocol.sources.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-md font-semibold text-text">
              {dict.detail.sources}
            </h2>
            <ul className="flex flex-col gap-2">
              {protocol.sources.map((s) => (
                <SourceRow key={s.id} source={s} dict={dict} />
              ))}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-md font-semibold text-text">
            {dict.detail.timeline}
          </h2>
          {events.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {events.map((e) => (
                <EventCard key={e.seq} event={e} dict={dict} />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<IconEmpty className="h-8 w-8" />}
              message={dict.detail.noEvents}
            />
          )}
        </section>
      </main>
    </>
  );
}
