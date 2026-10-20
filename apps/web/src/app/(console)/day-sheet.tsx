"use client";

import { firstName, indiaTimeWords, sentWords, type DaySheetDto, type DaySheetVisitDto } from "@eccs/shared";
import Link from "next/link";
import { useId, useRef, useState } from "react";

import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, english } from "@/lib/format";

import { slotStart, STATUS, timeOfDay } from "./visits/visit-parts";

// Pattern followed: the technician's day in Jobber's and ServiceTitan's field apps (today's jobs in
// time order with the arrival time, the address and a directions link, and the job's notes) and a
// job-materials pick list (each item once, with the job it is for, ticked by hand as the van is
// loaded). The founder's design (20 Oct 2026, page 1, "Dispatch sheet": its Load and Route columns)
// is the layout, without the quantities and the route, which come later (docs/CONSOLE_PLAN.md 4.1
// part 4). "Send the day's sheet" follows the dispatch board's "send the schedule to the crew":
// it says when it was sent and by whom, and offers Send again only once the visits have changed.

/** The anchor the headline's "Day's sheets: 1 of 2 sent" link goes to. */
export const SHEETS_ANCHOR = "day-sheets";

/** "Sent at 6:10 am by Abdul", or "Sent at 6:10 am; changed since" when the visits moved after sending. */
const sentLine = (sent: NonNullable<DaySheetDto["sent"]>) => {
  const words = sentWords({ changedSince: sent.changedSince, time: indiaTimeWords(sent.at) });
  return sent.changedSince ? words : `${words} by ${firstName(sent.byName)}`;
};

/** Sent, and nothing has changed since: no need to send again. */
const isSentNow = (sheet: DaySheetDto) => sheet.sent !== null && !sheet.sent.changedSince;

/**
 * Sends one Supervisor their sheet (a notification that opens it in their app), and says where it
 * stands: the button before it is sent, "Sent at 6:10 am by Abdul" after, and "changed since" with
 * Send again once the visits have moved. Only the office has it (`canSend`).
 */
function SendSheet({ sheet, main = false, onSent }: { sheet: DaySheetDto; main?: boolean; onSent: () => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!sheet.canSend) return null;
  const name = firstName(sheet.supervisorName);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const done = await api.today.sendSheet(sheet.supervisorId, sheet.date);
      notify(done.told === 1 ? `Day's sheet sent to ${name}` : `Recorded as sent, but ${name} could not be told`, {
        detail: sheet.visits.length === 1 ? "1 visit on it" : `${sheet.visits.length} visits on it`,
      });
      onSent();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  const state = sheet.sent && (
    <span className={`text-sm ${sheet.sent.changedSince ? "font-semibold text-amber-900" : "text-muted"}`}>
      <span aria-hidden="true">{sheet.sent.changedSince ? "! " : "✓ "}</span>
      {/* Beside the headline, the line needs to say what was sent. */}
      {main && <>Day&apos;s sheet: </>}
      {sentLine(sheet.sent)}
    </span>
  );

  return (
    <div className={`flex flex-col gap-1 print:hidden ${main ? "items-start sm:items-end" : "items-start"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {state}
        {!isSentNow(sheet) && (
          <Button variant={main ? "primary" : "secondary"} size={main ? "md" : "sm"} loading={busy} onClick={() => void send()}>
            {sheet.sent ? "Send again" : main ? `Send the day's sheet to ${name}` : "Send the day's sheet"}
            {sheet.sent && <span className="sr-only"> to {name}</span>}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Beside Today's headline, for the office: with one sheet, the design's main button ("Send the
 * day's sheet to Naveen", or where it stands once sent); with several, a short line saying how
 * many are sent, which goes to the sheets.
 */
export function SheetsAction({ sheets, onSent }: { sheets: readonly DaySheetDto[]; onSent: () => void }) {
  const sendable = sheets.filter((sheet) => sheet.canSend);
  if (sendable.length === 0) return null;
  if (sendable.length === 1) return <SendSheet sheet={sendable[0]!} main onSent={onSent} />;
  const sent = sendable.filter(isSentNow).length;
  const changed = sendable.filter((sheet) => sheet.sent?.changedSince).length;
  return (
    <a href={`#${SHEETS_ANCHOR}`} className="rounded-md py-1 font-semibold text-primary hover:underline print:hidden">
      Day&apos;s sheets: {sent} of {sendable.length} sent{changed > 0 ? ` · ${changed} changed since` : ""}
    </a>
  );
}

/** One card per Supervisor with visits today, under the day's visits. A Supervisor sees their own. */
export function DaySheets({ sheets, canOpenCatalogue, onSent }: { sheets: readonly DaySheetDto[]; canOpenCatalogue: boolean; onSent: () => void }) {
  return (
    <div id={SHEETS_ANCHOR} className="flex scroll-mt-[calc(var(--topbar)+1rem)] flex-col gap-6">
      {sheets.map((sheet) => (
        <DaySheet key={sheet.supervisorId} sheet={sheet} canOpenCatalogue={canOpenCatalogue} onSent={onSent} />
      ))}
    </div>
  );
}

/** "Tuesday 20 October". */
const dayName = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`));

function DaySheet({ sheet, canOpenCatalogue, onSent }: { sheet: DaySheetDto; canOpenCatalogue: boolean; onSent: () => void }) {
  const headingId = useId();
  const carryId = useId();
  const routeId = useId();
  const ref = useRef<HTMLElement>(null);

  /**
   * Prints this sheet alone: the page marks it while the print dialog is open, and the print
   * stylesheet (globals.css) leaves out everything else, black on white.
   */
  function print() {
    const root = document.documentElement;
    const card = ref.current;
    if (!card) return;
    const done = () => {
      card.removeAttribute("data-printing");
      root.removeAttribute("data-printing-sheet");
      window.removeEventListener("afterprint", done);
    };
    card.setAttribute("data-printing", "");
    root.setAttribute("data-printing-sheet", "");
    window.addEventListener("afterprint", done);
    window.print();
  }

  /**
   * "every visit", or "3:30 pm, 5:30 pm": the visits a thing is for, by their times (the route beside
   * it names them), as the design's "(15:30 job)". A visit with no time is named instead.
   */
  const forWhich = (visits: DaySheetDto["carry"][number]["visits"]) => {
    if (visits.length === sheet.visits.length && sheet.visits.length > 1) return "every visit";
    return visits.map((visit) => (visit.time ? timeOfDay(visit.time) : visit.outletName)).join(", ");
  };
  /** The same, in full, for screen readers and on hover. */
  const forWhichInFull = (visits: DaySheetDto["carry"][number]["visits"]) =>
    visits.map((visit) => (visit.time ? `${timeOfDay(visit.time)} ${visit.outletName}` : visit.outletName)).join(", ");

  return (
    <section ref={ref} aria-labelledby={headingId} className="day-sheet rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-bold">
            Day&apos;s sheet: {sheet.supervisorName}
          </h2>
          <p className="text-sm text-muted">
            {dayName(sheet.date)} · {sheet.visits.length === 1 ? "1 visit" : `${sheet.visits.length} visits`}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2 print:hidden">
          <SendSheet sheet={sheet} onSent={onSent} />
          <Button variant="secondary" size="sm" onClick={print}>
            Print<span className="sr-only"> {sheet.supervisorName}&apos;s sheet</span>
          </Button>
        </div>
      </div>

      {/* The design's two columns: what to load, and the route in time order. One under the other on a phone. */}
      <div className="grid gap-x-8 gap-y-5 px-5 py-4 md:grid-cols-2 print:grid-cols-2">
      <div className="min-w-0 md:order-2 print:order-2">
        <h3 id={routeId} className="font-bold">
          Route
        </h3>
        <ol aria-labelledby={routeId} className="mt-2 flex flex-col gap-2.5">
          {sheet.visits.map((visit, index) => (
            <SheetVisit key={visit.visitId} visit={visit} number={index + 1} />
          ))}
        </ol>
      </div>

      <div className="min-w-0 md:order-1 print:order-1">
        <h3 id={carryId} className="font-bold">
          What to carry
        </h3>
        {sheet.carry.length === 0 ? (
          <p className="mt-1 text-sm text-muted">
            Nothing to carry is listed for these services.{" "}
            {canOpenCatalogue && (
              <Link href="/catalogue" className="font-semibold text-primary hover:underline print:hidden">
                Set it in Catalogue
              </Link>
            )}
          </p>
        ) : (
          <ul aria-labelledby={carryId} className="mt-2 flex flex-col gap-1 text-sm">
            {sheet.carry.map((entry) => (
              <li key={entry.item} className="flex items-start gap-2">
                {/* On paper, an empty box to tick by hand as the van is loaded. */}
                <span aria-hidden="true" className="mt-0.5 hidden h-4 w-4 shrink-0 rounded-sm border border-black print:inline-block" />
                <span aria-hidden="true" className="text-muted print:hidden">
                  •
                </span>
                <span className="min-w-0" title={forWhichInFull(entry.visits)}>
                  <span className="font-semibold">{entry.item}</span>
                  <span className="text-muted" aria-hidden="true">
                    {" "}
                    ({forWhich(entry.visits)})
                  </span>
                  <span className="sr-only">: for {entry.visits.length === sheet.visits.length && sheet.visits.length > 1 ? "every visit" : forWhichInFull(entry.visits)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </section>
  );
}

function SheetVisit({ visit, number }: { visit: DaySheetVisitDto; number: number }) {
  // As on Today's visit list: only a visit that has moved on from "to do" says where it stands.
  const stage = visit.status !== "SCHEDULED" && visit.status !== "ASSIGNED" ? STATUS[visit.status].label : null;
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1 text-sm">
      <span className="font-semibold tabular-nums text-muted">{number}.</span>
      <div className="min-w-0">
        <p>
          <span className="font-semibold tabular-nums">{visit.time ? timeOfDay(visit.time) : slotStart(visit.slot)}</span>{" "}
          <Link href={`/visits?visit=${encodeURIComponent(visit.visitId)}`} className="font-semibold hover:underline">
            {visit.outletName}
          </Link>
          {visit.free && <span className="ml-2 rounded-full border border-border-strong px-2 py-0.5 text-xs font-semibold whitespace-nowrap">Free</span>}
        </p>
        {visit.address && (
          <p className="text-muted">
            {visit.address}
            {visit.mapUrl && (
              // Not on paper, where a link cannot be followed.
              <span className="print:hidden">
                {" · "}
                <a href={visit.mapUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                  Map<span className="sr-only"> of {visit.outletName}, opens in a new tab</span>
                </a>
              </span>
            )}
          </p>
        )}
        <p className="text-muted">
          {english(visit.serviceName)}
          {visit.partnerName && <span className="text-muted"> · with {visit.partnerName}</span>}
          {stage && <span className="text-muted"> · {stage}</span>}
        </p>
        {visit.lastNote && <p className="text-muted">Last visit: {visit.lastNote}</p>}
      </div>
    </li>
  );
}
