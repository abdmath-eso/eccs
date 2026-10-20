"use client";

import {
  closedWords,
  indiaTimeWords,
  TODAY_RULES,
  type CloseLineDto,
  type TodayCloseDto,
  type TodayDto,
  type TodayItemDto,
  type TodayNoteDto,
  type TodayTarget,
  type TodayVisitDto,
} from "@eccs/shared";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, LoadError, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";
import { NOTIFICATION_ARRIVED } from "@/lib/live-notifications";

import { DaySheets, SheetsAction } from "./day-sheet";
import { slotStart, STATUS, timeOfDay } from "./visits/visit-parts";

// Pattern followed: the field-service "home" of Jobber (today's appointments in start-time order
// beside an admin to-do list, urgent items first, each opening where the work is done) and
// Housecall Pro (open items at the top as shortcuts), ServiceTitan's dispatch alerts (an alert
// clears when its cause is resolved, not when it is dismissed) and Linear's priority inbox (what
// needs you apart from what is only worth knowing). A done queue shows a quiet "all caught up"
// line, as ServiceTitan's and Intuit's design systems advise for a cleared list, with no call to
// action. The founder's design (20 Oct 2026, page 1) is the layout; docs/CONSOLE_PLAN.md 4.1.

/** Where each button and link leads: the page where that work is done. */
function hrefFor(target: TodayTarget): string {
  switch (target.kind) {
    case "WAITING":
      return "/visits?view=waiting";
    case "VISIT":
      return `/visits?visit=${encodeURIComponent(target.visitId)}`;
    case "VISITS":
      return "/visits";
    case "WEEK":
      return "/visits?view=week";
    case "INVOICE":
      return `/invoices?invoice=${encodeURIComponent(target.invoiceId)}`;
    case "INVOICES":
      return "/invoices";
    case "ISSUE":
      return `/issues?issue=${encodeURIComponent(target.issueId)}`;
    case "INSPECTION":
      return `/inspections?inspection=${encodeURIComponent(target.inspectionId)}`;
    case "INSPECTIONS":
      return "/inspections";
    case "NEW_OUTLETS":
      return "/clients?tab=new";
    case "LEAD":
      return `/sales/leads/${encodeURIComponent(target.leadId)}`;
    case "SALES":
      return "/sales";
    case "TEAM_PERSON":
      return `/team/${encodeURIComponent(target.userId)}`;
    case "TEAM":
      return "/team";
    // Quality's three (console plan step 3): a follow-up opens beside its tab's list, an incident on its own page.
    case "FOLLOW_UP":
      return `/quality?tab=follow-ups&followUp=${encodeURIComponent(target.followUpId)}`;
    case "QUALITY_PHOTOS":
      return "/quality?tab=photos";
    case "INCIDENT":
      return `/quality/incidents/${encodeURIComponent(target.incidentId)}`;
  }
}

/** A link that looks like a lesser button, for an item's one action. */
const ACTION_LINK =
  "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-background";

/** "Tuesday 20 October". */
const dayName = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`));

/** Coming back to the tab within this long of the last load does not load again. */
const RELOAD_AFTER_MS = 5_000;

/**
 * Today, the console's home: what needs the office today, in one glance. The headline, the
 * day's visits and free checks, each Supervisor's day's sheet (day-sheet.tsx, with Send beside the
 * headline), Needs you (one button each; an item goes once its work is done), Also today, and the
 * Evening close (in full from 4 pm). A Supervisor sees their own day and their own sheet.
 * Everything is worked out by the server (GET /today) from the other pages' records.
 */
export default function TodayScreen() {
  const [page, setPage] = useState<TodayDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadedAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api.today
      .get()
      .then((next) => {
        if (cancelled) return;
        loadedAt.current = Date.now();
        setPage(next);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // The page keeps itself current: a notification arriving, or coming back to the tab, loads it again.
  useEffect(() => {
    const again = () => setAttempt((value) => value + 1);
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > RELOAD_AFTER_MS) again();
    };
    window.addEventListener(NOTIFICATION_ARRIVED, again);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener(NOTIFICATION_ARRIVED, again);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  if (!page) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Today" />
        {error ? <LoadError message={error} onRetry={reload} /> : <Loading />}
      </div>
    );
  }

  const own = page.scope === "own";
  // An API from before the day's sheet (console plan step 3) sends none: the page works without them.
  const sheets = page.sheets ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <>
            <span className="sr-only">Today: </span>
            {page.headline}
          </>
        }
        description={`${dayName(page.date)} · ${indiaTimeWords(page.at)}`}
        // "Send the day's sheet" beside the headline (docs/CONSOLE_PLAN.md 4.1, part 4): the office only.
        action={!own && <SheetsAction sheets={sheets} onSent={reload} />}
        how={
          <>
            <p>
              Today is put together from Visits, Sales, Invoices, Issues, Clients and Team; nothing is typed here. An item in Needs you goes by itself
              once its work is done, and the page loads again when a notification arrives or you come back to it.
            </p>
            {own ? (
              <p>
                You see your own visits, and what needs you on them: a finished visit not signed off after {TODAY_RULES.signOffWaitDays} days
                (Remind tells the restaurant again), and an issue at your outlets nobody has picked up. The Evening close shows in full from 4 pm.
              </p>
            ) : (
              <p>
                Needs you brings in: a booking not placed after {TODAY_RULES.bookingWaitHours} hours; today&apos;s and tomorrow&apos;s visits with no
                Supervisor; a sign-off, a report or an issue waiting {TODAY_RULES.signOffWaitDays} days; an overdue invoice where the crew is today; a new
                outlet not live after 24 hours; and from Quality, a follow-up with nothing booked, the photos waiting to be judged, and each open
                incident. The Evening close shows in full from 4 pm.
              </p>
            )}
            {own ? (
              <p>Your day&apos;s sheet is under your visits: the visits in time order with their addresses and notes, and what to carry.</p>
            ) : (
              <p>
                Under the visits is each Supervisor&apos;s day&apos;s sheet: their visits in time order with the address, a map link and the note from
                the last visit, and what to carry, from each service&apos;s list in Catalogue. Send the day&apos;s sheet puts it on their phone; once
                sent, it says when, and offers Send again only if their visits have changed since. Print gives that sheet alone on paper.
              </p>
            )}
          </>
        }
      />
      {error && <LoadError message={error} onRetry={reload} />}

      {/*
        The page reads visits, Needs you, Also today, then the Evening close, on a phone and for the
        keyboard alike. On a wide screen the visits are on the left and Needs you on the right; from
        4 pm, when the close is the main thing, it sits under the visits instead of below the fold.
      */}
      <div className="grid items-start gap-6 lg:grid-cols-5 lg:grid-rows-[auto_1fr]">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-3 lg:row-start-1">
          <VisitsCard page={page} />
          {/* The day's sheet for each Supervisor with visits today (a Supervisor's own): the visits, the notes and what to carry. */}
          {sheets.length > 0 && <DaySheets sheets={sheets} canOpenCatalogue={!own} onSent={reload} />}
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2 lg:col-start-4 lg:row-span-2 lg:row-start-1">
          <NeedsYou items={page.needsYou} onChanged={reload} />
          {page.alsoToday.length > 0 && <AlsoToday notes={page.alsoToday} />}
          {!page.close.shownFully && <EveningClose date={page.date} close={page.close} onChanged={reload} />}
        </div>
        {page.close.shownFully && (
          <div className="min-w-0 lg:col-span-3 lg:col-start-1 lg:row-start-2">
            <EveningClose date={page.date} close={page.close} onChanged={reload} />
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Today's visits and free checks ─────────────────────────

function VisitsCard({ page }: { page: TodayDto }) {
  const headingId = useId();
  const own = page.scope === "own";
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-4">
        <h2 id={headingId} className="text-lg font-bold">
          {own ? "Your visits today" : "Today's visits and free checks"}
        </h2>
        {page.capacity && (
          <Link href="/visits?view=week" className={`text-sm hover:underline ${page.capacity.over ? "font-bold text-amber-900" : "text-muted"}`}>
            {page.capacity.booked} of {page.capacity.capacity} slots booked{page.capacity.over ? ", over" : ""}
            <span className="sr-only">: see the week</span>
          </Link>
        )}
      </div>
      {page.visits.length === 0 ? (
        <p className="px-5 py-6 text-muted">{own ? "You have no visits today." : "No visits or free checks today."}</p>
      ) : (
        <ul className="divide-y divide-border">
          {page.visits.map((row) => (
            <VisitRow key={`${row.kind}:${row.id}`} row={row} own={own} />
          ))}
        </ul>
      )}
    </section>
  );
}

function VisitRow({ row, own }: { row: TodayVisitDto; own: boolean }) {
  const href = row.kind === "FREE_CHECK" ? hrefFor({ kind: "LEAD", leadId: row.id }) : hrefFor({ kind: "VISIT", visitId: row.id });
  const time = row.kind === "FREE_CHECK" ? (row.time ? timeOfDay(row.time) : "") : slotStart(row.slot);
  // Only a visit that has moved on from "to do" says where it stands: under way, finished, signed off.
  const stage = row.status && row.status !== "SCHEDULED" && row.status !== "ASSIGNED" ? STATUS[row.status].label : null;
  return (
    <li>
      <Link href={href} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-5 py-3 hover:bg-background sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
        <span className="text-sm font-semibold tabular-nums">{time}</span>
        <span className="min-w-0">
          <span className="font-semibold">{row.outletName}</span>
          {/* Most outlet names already end with their area ("Spice Route, Jubilee Hills"). */}
          {row.area && !row.outletName.includes(row.area) && <span className="text-muted">, {row.area}</span>}
          <span className="block text-sm text-muted">
            {row.serviceName}
            {row.partnerName && ` with ${row.partnerName}`}
            {/* A visit with nobody to do it says so in words as well as red; a free check names who goes, when known. */}
            {!own && row.kind === "VISIT" && (
              <>
                {" · "}
                {row.supervisorName ?? <span className="font-semibold text-danger">No Supervisor</span>}
              </>
            )}
            {row.kind === "FREE_CHECK" && row.supervisorName && ` · ${row.supervisorName}`}
            {stage && ` · ${stage}`}
          </span>
          {row.lastNote && <span className="mt-0.5 block text-sm text-muted">Last visit: {row.lastNote}</span>}
        </span>
        {row.badge && (
          <span className="col-start-2 sm:col-start-auto">
            <Badge badge={row.badge} />
          </span>
        )}
      </Link>
    </li>
  );
}

function Badge({ badge }: { badge: NonNullable<TodayVisitDto["badge"]> }) {
  const look = {
    FREE_CHECK: "border-border-strong text-muted",
    PARTNER: "border-primary text-primary",
    WARNING: "border-amber-500 bg-amber-50 text-amber-900",
  }[badge.kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${look}`}>
      {badge.kind === "WARNING" && <span aria-hidden="true">!</span>}
      {badge.label}
    </span>
  );
}

// ───────────────────────── Needs you ─────────────────────────

function NeedsYou({ items, onChanged }: { items: TodayItemDto[]; onChanged: () => void }) {
  const headingId = useId();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, TODAY_RULES.itemsShown);
  const more = items.length - shown.length;
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id={headingId} className="text-lg font-bold">
          Needs you
        </h2>
        {items.length > 0 && <span className="text-sm text-muted">{items.length === 1 ? "1 thing" : `${items.length} things`}</span>}
      </div>
      {items.length === 0 ? (
        // A cleared queue: a light acknowledgement, nothing to press.
        <div className="flex items-start gap-3 px-5 py-6">
          <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            ✓
          </span>
          <div>
            <p className="font-semibold">Nothing needs you</p>
            <p className="text-sm text-muted">You are all caught up. New things appear here as they happen.</p>
          </div>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {shown.map((item) => (
              <NeedsYouItem key={item.key} item={item} onChanged={onChanged} />
            ))}
          </ul>
          {(more > 0 || all) && items.length > TODAY_RULES.itemsShown && (
            <div className="border-t border-border px-5 py-3">
              <Button variant="link" className="-mx-2 text-sm" aria-expanded={all} onClick={() => setAll((value) => !value)}>
                {all ? "Show fewer" : `Show ${more} more`}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NeedsYouItem({ item, onChanged }: { item: TodayItemDto; onChanged: () => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown at once after pressing Remind, before the page has loaded again.
  const [remindedAt, setRemindedAt] = useState<string | null>(null);

  async function remind(visitId: string) {
    setBusy(true);
    setError(null);
    try {
      const done = await api.visits.remindSignOff(visitId);
      setRemindedAt(done.remindedAt);
      notify(done.told === 1 ? "Reminded the restaurant" : `Reminded ${done.told} people at the restaurant`);
      onChanged();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  const reminds = item.kind === "SIGN_OFF_WAITING" && item.target.kind === "VISIT";
  const shownRemindedAt = remindedAt ?? item.remindedAt;
  let action: ReactNode;
  if (reminds && shownRemindedAt) {
    action = <span className="text-sm whitespace-nowrap text-muted">Reminded at {indiaTimeWords(shownRemindedAt)}</span>;
  } else if (reminds && item.target.kind === "VISIT") {
    const visitId = item.target.visitId;
    action = (
      <Button variant="secondary" size="sm" loading={busy} onClick={() => void remind(visitId)}>
        {item.button}
      </Button>
    );
  } else {
    action = (
      <Link href={hrefFor(item.target)} className={ACTION_LINK}>
        {item.button}
      </Link>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="font-semibold">
          {/* A sign-off's title opens the visit; its button reminds. */}
          {reminds ? (
            <Link href={hrefFor(item.target)} className="hover:underline">
              {item.title}
            </Link>
          ) : (
            item.title
          )}
        </p>
        <p className="text-sm text-muted">{item.detail}</p>
        {error && (
          <p role="alert" className="mt-1 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}

// ───────────────────────── Also today ─────────────────────────

function AlsoToday({ notes }: { notes: TodayNoteDto[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-surface">
      <h2 id={headingId} className="border-b border-border px-5 py-4 text-lg font-bold">
        Also today
      </h2>
      <ul className="divide-y divide-border">
        {notes.map((note) => (
          <li key={note.key} className="px-5 py-3">
            <Link href={hrefFor(note.target)} className="font-semibold hover:underline">
              {note.title}
            </Link>
            <p className="text-sm text-muted">{note.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────────────────── Evening close ─────────────────────────

/**
 * The day's checklist, filled in by itself as the day goes. From 4 pm it shows in full; before,
 * it is one line that opens (the founder's "main part first"). Close the day records who closed
 * it, and warns about what is still open without refusing (decision 5).
 */
function EveningClose({ date, close, onChanged }: { date: string; close: TodayCloseDto; onChanged: () => void }) {
  const notify = useToast();
  const confirm = useConfirm();
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = close.lines.filter((line) => line.state === "OPEN");
  const progress = close.closed ? closedWords(close.closed) : `${close.done} of ${close.total} done`;

  async function closeDay() {
    if (open.length > 0) {
      const go = await confirm({
        title: open.length === 1 ? "Close the day with 1 line open?" : `Close the day with ${open.length} lines open?`,
        // The lines themselves are on the page behind; the warning names them only.
        body: `Still open: ${open.map((line) => line.label.charAt(0).toLowerCase() + line.label.slice(1)).join("; ")}. Closing records who closed the day and what was still open; it changes nothing else.`,
        confirmLabel: "Close the day",
        cancelLabel: "Not yet",
        // Closing only records; nothing is lost, so the button is not red.
        tone: "primary",
      });
      if (!go) return;
    }
    setBusy(true);
    setError(null);
    try {
      const closed = await api.today.close(date);
      notify(closedWords(closed));
      onChanged();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      <ul className="divide-y divide-border">
        {close.lines.map((line) => (
          <CloseLine key={line.key} line={line} />
        ))}
      </ul>
      {(close.canClose || close.closed) && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-4">
          {error && (
            <p role="alert" className="mr-auto text-sm font-semibold text-danger">
              {error}
            </p>
          )}
          {close.closed ? (
            <p className="text-sm font-semibold">{closedWords(close.closed)}</p>
          ) : (
            <Button variant="secondary" loading={busy} onClick={() => void closeDay()}>
              Close the day
            </Button>
          )}
        </div>
      )}
    </>
  );

  if (!close.shownFully) {
    return (
      <details className="rounded-xl border border-border bg-surface">
        <summary className="cursor-pointer rounded-xl px-5 py-4 font-semibold">
          Evening close: <span className="font-normal text-muted">{progress}</span>
        </summary>
        <div className="border-t border-border">{body}</div>
      </details>
    );
  }
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-4">
        <h2 id={headingId} className="text-lg font-bold">
          Evening close
        </h2>
        <span className="text-sm text-muted">{close.closed ? "Closed" : progress}</span>
      </div>
      {body}
    </section>
  );
}

const LINE_LOOK: Record<CloseLineDto["state"], { mark: string; words: string; style: string }> = {
  DONE: { mark: "✓", words: "Done", style: "text-primary" },
  OPEN: { mark: "!", words: "Still open", style: "font-semibold text-amber-900" },
  // What cannot be known is said plainly and never shown as a problem.
  KNOWN: { mark: "i", words: "So far", style: "text-muted" },
};

function CloseLine({ line }: { line: CloseLineDto }) {
  const look = LINE_LOOK[line.state];
  const words = (
    <>
      <span className="sr-only">{look.words}: </span>
      {line.words}
    </>
  );
  return (
    <li className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="font-medium">{line.label}</span>
      <span className={`flex items-start gap-1.5 text-sm sm:max-w-[60%] sm:text-right ${look.style}`}>
        <span aria-hidden="true" className="w-3 shrink-0 text-center font-bold sm:order-2">
          {look.mark}
        </span>
        {line.state !== "DONE" && line.target ? (
          <Link href={hrefFor(line.target)} className="underline-offset-2 hover:underline">
            {words}
          </Link>
        ) : (
          <span>{words}</span>
        )}
      </span>
    </li>
  );
}
