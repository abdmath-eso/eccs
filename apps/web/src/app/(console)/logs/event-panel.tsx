"use client";

import { ACTIVITY_CATEGORIES, ROLE_LABELS, type ActivityLogEntryDto, type ActivityLogEventDto, type Role } from "@eccs/shared";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { CloseIcon } from "@/components/icons";
import { Button, LoadError, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";

import { AiMark, CopyButton, ResultBadge, SourceBadge, Time } from "./log-parts";
import {
  AI_FEATURE_LABEL,
  AI_OUTCOME_LABEL,
  AI_STATUS_LABEL,
  aiModelLabel,
  CLIENT_LABEL,
  detailLines,
  entityLabel,
  fullTime,
  RESULT_MEANING,
  recordLink,
  recordName,
  SOURCE_SHORT,
  usd,
} from "./log-view";

/** What a link in the panel filters the page by. `alone` clears the other filters first ("This person's activity"). */
export type PanelFilter =
  | { kind: "source"; value: string }
  | { kind: "person"; value: string; name: string | null; alone?: boolean }
  | { kind: "role"; value: string }
  | { kind: "restaurant"; value: string; name: string | null; alone?: boolean }
  | { kind: "outlet"; value: string; name: string | null }
  | { kind: "area"; value: string }
  | { kind: "action"; value: string }
  | { kind: "record"; type: string; id: string; name: string }
  | { kind: "ip"; value: string }
  | { kind: "device"; value: string }
  | { kind: "request"; value: string };

/**
 * One event in full, in a panel that opens from the right edge over the list (the
 * detail panel of Stripe's logs and of most audit-log pages). Main facts first: what,
 * who, where, the record and its details; then the technical side; ids to copy; and
 * the other events written for the same request. People, places and the record are
 * links that filter the page by them.
 *
 * It is a modal dialog: the keyboard stays inside, Escape closes it, and the Back
 * button closes it too (the open event is in the web address as `event=`).
 */
export function EventPanel({
  eventId,
  base,
  newer,
  older,
  onClose,
  onOpen,
  onFilter,
}: {
  eventId: string | null;
  /** The row as already loaded in the list, shown at once while the full event loads. */
  base: ActivityLogEntryDto | null;
  /** The events above and below it in the list, for the arrows. */
  newer: string | null;
  older: string | null;
  onClose: () => void;
  /** Shows another event in the panel. */
  onOpen: (id: string) => void;
  onFilter: (filter: PanelFilter) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [loaded, setLoaded] = useState<{ id: string; event: ActivityLogEventDto | null; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The address decides whether the panel is open, so Back and a copied link both work.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (eventId && !dialog.open) {
      dialog.showModal();
      // The keyboard starts on the event's name, so a screen reader reads it first and no button looks pressed.
      titleRef.current?.focus();
    }
    if (!eventId && dialog.open) dialog.close();
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    api.activityLog
      .get(eventId)
      .then((event) => !cancelled && setLoaded({ id: eventId, event, error: null }))
      .catch((e) => !cancelled && setLoaded({ id: eventId, event: null, error: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  const full = loaded && loaded.id === eventId ? loaded : null;
  const entry: ActivityLogEntryDto | null = full?.event ?? (base && base.id === eventId ? base : null);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Escape, or the dialog closed any other way: the address is brought into line.
      onClose={onClose}
      // A click on the dimmed page beside the panel lands on the dialog itself.
      onClick={(event) => event.target === event.currentTarget && dialogRef.current?.close()}
      className="side-sheet my-0 mr-0 ml-auto h-dvh max-h-none w-[34rem] max-w-full border-l border-border bg-surface p-0 text-foreground shadow-xl"
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            {/* No focus ring on the name: it is focused only so the panel starts there, and is not something to press. */}
            <h2 ref={titleRef} id={titleId} tabIndex={-1} style={{ outline: "none" }} className="text-lg leading-snug font-bold">
              {entry ? entry.actionLabel : "Event"}
              {entry?.category === "ai" && <AiMark />}
            </h2>
            {entry && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <ResultBadge result={entry.result} />
                <span>{fullTime(entry.at)}</span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <PanelIconButton label="Newer event" disabled={!newer} onClick={() => newer && onOpen(newer)}>
              ↑
            </PanelIconButton>
            <PanelIconButton label="Older event" disabled={!older} onClick={() => older && onOpen(older)}>
              ↓
            </PanelIconButton>
            <PanelIconButton label="Close" onClick={() => dialogRef.current?.close()}>
              <CloseIcon />
            </PanelIconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!entry && !full?.error && <Loading />}
          {!entry && full?.error && <LoadError message={full.error} onRetry={() => setAttempt((n) => n + 1)} />}
          {entry && <EventBody entry={entry} related={full?.event?.related ?? null} onOpen={onOpen} onFilter={onFilter} />}
        </div>

        {entry && <PanelFooter entry={entry} onFilter={onFilter} />}
      </div>
    </dialog>
  );
}

function PanelIconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-lg font-bold hover:bg-background disabled:cursor-default disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** A value that filters the page when pressed. */
function FilterLink({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="cursor-pointer rounded text-left font-semibold text-primary hover:underline">
      {children}
    </button>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-3">
      <h3 className="mb-2 text-sm font-bold">{title}</h3>
      <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

function EventBody({
  entry,
  related,
  onOpen,
  onFilter,
}: {
  entry: ActivityLogEntryDto;
  related: ActivityLogEntryDto[] | null;
  onOpen: (id: string) => void;
  onFilter: (filter: PanelFilter) => void;
}) {
  const link = recordLink(entry);
  const details = detailLines(entry.details);
  const name = recordName(entry.entityType, entry.entityLabel);
  const noPerson = entry.source === "SYSTEM" ? "System (the server's own work)" : entry.source === "PUBLIC" ? "No login (a public page)" : "Not logged in";

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <Fact term="Who">
          {entry.actorUserId ? (
            <FilterLink title="Show only this person's events" onClick={() => onFilter({ kind: "person", value: entry.actorUserId!, name: entry.actorName })}>
              {entry.actorName ?? "Unknown person"}
            </FilterLink>
          ) : (
            <span>{entry.actorName ?? noPerson}</span>
          )}
          {entry.actorRole && (
            <>
              {" · "}
              <FilterLink title="Show only events by this role" onClick={() => onFilter({ kind: "role", value: entry.actorRole! })}>
                {ROLE_LABELS[entry.actorRole as Role] ?? entry.actorRoleLabel}
              </FilterLink>
            </>
          )}
        </Fact>
        <Fact term="Restaurant">
          {entry.organizationId ? (
            <FilterLink title="Show only this restaurant's events" onClick={() => onFilter({ kind: "restaurant", value: entry.organizationId!, name: entry.organizationName })}>
              {entry.organizationName ?? "Unknown restaurant"}
            </FilterLink>
          ) : (
            <span className="text-muted">None</span>
          )}
        </Fact>
        <Fact term="Outlet">
          {entry.outletId ? (
            <FilterLink title="Show only this outlet's events" onClick={() => onFilter({ kind: "outlet", value: entry.outletId!, name: entry.outletName })}>
              {entry.outletName ?? "Unknown outlet"}
            </FilterLink>
          ) : (
            <span className="text-muted">None</span>
          )}
        </Fact>
        <Fact term="Source">
          <button type="button" title="Show only events from here" onClick={() => onFilter({ kind: "source", value: entry.source })} className="cursor-pointer">
            <SourceBadge source={entry.source} />
          </button>
        </Fact>
        <Fact term="When">
          <Time at={entry.at} /> <span className="text-muted">(India time)</span>
          {entry.phoneAt && (
            <span className="block">
              Phone&apos;s time: {fullTime(entry.phoneAt)}
              {entry.offline && <span className="ml-1 font-semibold">· done offline, sent later</span>}
            </span>
          )}
        </Fact>
      </dl>

      <Section title="What">
        <Fact term="Action">
          <FilterLink title="Show only this action" onClick={() => onFilter({ kind: "action", value: entry.action })}>
            {entry.actionLabel}
          </FilterLink>
          <span className="block font-mono text-xs text-muted">{entry.action}</span>
        </Fact>
        <Fact term="Area">
          <FilterLink title="Show only this area" onClick={() => onFilter({ kind: "area", value: entry.category })}>
            {ACTIVITY_CATEGORIES[entry.category as keyof typeof ACTIVITY_CATEGORIES] ?? entry.categoryLabel}
          </FilterLink>
        </Fact>
        {entry.entityType && (
          <Fact term="Record">
            <span className="font-semibold">{entityLabel(entry.entityType)}</span>
            {name && ` · ${name}`}
            {entry.reference && ` · ${entry.reference}`}
            {link && (
              <Link href={link.href} className="block font-semibold text-primary hover:underline">
                {link.label} →
              </Link>
            )}
          </Fact>
        )}
        {!entry.entityType && entry.category === "staff" && (
          <Fact term="Record">
            <span className="text-muted">Staff records are the restaurant&apos;s own: only the action, the place and who did it are kept.</span>
          </Fact>
        )}
      </Section>

      {details.length > 0 && (
        <Section title="Details">
          {details.map((line) => (
            <Fact key={line.label} term={line.label}>
              {line.value}
            </Fact>
          ))}
        </Section>
      )}

      {entry.ai && (
        <Section title="AI">
          <Fact term="Feature">{AI_FEATURE_LABEL[entry.ai.feature] ?? entry.ai.feature}</Fact>
          {entry.ai.model && <Fact term="Model">{aiModelLabel(entry.ai.model)}</Fact>}
          {entry.ai.status && <Fact term="AI result">{AI_STATUS_LABEL[entry.ai.status] ?? entry.ai.status}</Fact>}
          <Fact term="What they did">{entry.ai.outcome ? (AI_OUTCOME_LABEL[entry.ai.outcome] ?? entry.ai.outcome) : <span className="text-muted">Not said</span>}</Fact>
          <Fact term="Cost">{usd(entry.ai.costUsd)}</Fact>
        </Section>
      )}

      <Section title="Result">
        <Fact term="Result">
          <ResultBadge result={entry.result} /> <span className="text-muted">{RESULT_MEANING[entry.result]}</span>
        </Fact>
        {entry.statusCode !== null && <Fact term="Status code">{entry.statusCode}</Fact>}
        {entry.durationMs !== null && <Fact term="Time taken">{entry.durationMs.toLocaleString("en-IN")} ms</Fact>}
        {entry.route && (
          <Fact term="Route">
            <span className="font-mono text-xs">
              {entry.method} {entry.route}
            </span>
          </Fact>
        )}
      </Section>

      <Section title="Device">
        <Fact term="IP address">
          {entry.ip ? (
            <FilterLink title="Show only events from this IP address" onClick={() => onFilter({ kind: "ip", value: entry.ip! })}>
              {entry.ip}
            </FilterLink>
          ) : (
            <span className="text-muted">Not known</span>
          )}
        </Fact>
        <Fact term="Linked phone">
          {entry.deviceId ? (
            <span className="flex flex-wrap items-center gap-2">
              <FilterLink title="Show only events from this phone" onClick={() => onFilter({ kind: "device", value: entry.deviceId! })}>
                <span className="font-mono text-xs break-all">{entry.deviceId}</span>
              </FilterLink>
              <CopyButton value={entry.deviceId} />
            </span>
          ) : (
            <span className="text-muted">None</span>
          )}
        </Fact>
        <Fact term="App">
          {entry.client ? (CLIENT_LABEL[entry.client] ?? entry.client) : <span className="text-muted">Not known</span>}
          {entry.appVersion && <span className="text-muted"> · version {entry.appVersion}</span>}
        </Fact>
      </Section>

      <Section title="Ids">
        <IdFact term="Event" value={entry.id} />
        {entry.entityId && <IdFact term="Record" value={entry.entityId} />}
        {entry.requestId && <IdFact term="Request" value={entry.requestId} />}
        {entry.actorUserId && <IdFact term="Person" value={entry.actorUserId} />}
      </Section>

      {entry.details && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-md py-1 font-semibold text-primary">The details as stored (JSON)</summary>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-background p-3 font-mono text-xs">{JSON.stringify(entry.details, null, 2)}</pre>
        </details>
      )}

      {related && related.length > 0 && (
        <section className="border-t border-border pt-3">
          <h3 className="mb-2 text-sm font-bold">Written for the same request</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {related.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border px-3 py-2 text-left hover:border-primary"
                >
                  <span className="font-semibold">{row.actionLabel}</span>
                  <ResultBadge result={row.result} />
                  <span className="text-xs text-muted">
                    {SOURCE_SHORT[row.source] ?? row.source}
                    {row.ai && ` · ${usd(row.ai.costUsd)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function IdFact({ term, value }: { term: string; value: string }) {
  return (
    <Fact term={term}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs break-all">{value}</span>
        <CopyButton value={value} />
      </span>
    </Fact>
  );
}

/** The ways out of one event into the activity around it, always in view at the bottom of the panel. */
function PanelFooter({ entry, onFilter }: { entry: ActivityLogEntryDto; onFilter: (filter: PanelFilter) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const name = recordName(entry.entityType, entry.entityLabel);
  return (
    <div className="flex shrink-0 flex-wrap gap-2 border-t border-border bg-surface px-4 py-3">
      {entry.entityType && entry.entityId && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onFilter({
              kind: "record",
              type: entry.entityType!,
              id: entry.entityId!,
              name: [entityLabel(entry.entityType), name || entry.reference].filter(Boolean).join(" · "),
            })
          }
        >
          Everything on this record
        </Button>
      )}
      {entry.actorUserId && (
        <Button size="sm" variant="secondary" onClick={() => onFilter({ kind: "person", value: entry.actorUserId!, name: entry.actorName, alone: true })}>
          This person&apos;s activity
        </Button>
      )}
      {entry.organizationId && (
        <Button size="sm" variant="secondary" onClick={() => onFilter({ kind: "restaurant", value: entry.organizationId!, name: entry.organizationName, alone: true })}>
          This restaurant&apos;s activity
        </Button>
      )}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          navigator.clipboard
            ?.writeText(`${window.location.origin}/logs?event=${encodeURIComponent(entry.id)}`)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        <span aria-live="polite">{copied ? "Link copied" : "Copy link to this event"}</span>
      </Button>
    </div>
  );
}
