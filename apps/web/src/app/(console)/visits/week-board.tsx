"use client";

// Visits → Week (20 Oct 2026; the founder's Dispatch design, the console plan section 4.2):
// the same visits as the diary, Monday to Saturday, each day's "booked of capacity", Sales'
// free checks dashed (they use no slot), and the capacity box with the weeks-in-a-row rule
// and one suggestion when a day is over.
// Pattern followed: Jobber's week view (one schedule; drag a visit to another day; an
// "unscheduled" list kept apart, here the Waiting tab) and ServiceTitan's capacity planning
// (booked against what the crew can take, per day, with the over-full day flagged). Every
// drag has a "Move" button beside it for the keyboard and touch (WCAG 2.2, 2.5.7 Dragging
// Movements), and the area colour on each card's edge is named in the legend, in the card's
// hover text and for screen readers, so colour is never the only sign.

import {
  areaColours,
  BOARD_WEEKDAYS,
  BOARD_WEEKDAY_NAMES,
  boardMonday,
  normaliseArea,
  type BoardWeekday,
  type VisitCapacity,
  type VisitSlot,
  type WeekBoardCheckDto,
  type WeekBoardDayDto,
  type WeekBoardDto,
  type WeekBoardVisitDto,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";

import { Button, Card, ErrorMessage, Field, HowItWorks, LoadError, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { addDays, describe, english, shortDay, today } from "@/lib/format";
import { useQuery } from "@/lib/query";

import { checkDate, SlotField, slotStart, timeOfDay } from "./visit-parts";

/**
 * The edge colours, chosen for each area on the board by `areaColours` (from its name, and the
 * next free one if two areas on the same board would share a colour), so an area keeps its
 * colour from week to week. Amber is left out: it marks a day over capacity.
 */
const AREA_STYLES = [
  { edge: "border-l-blue-600", swatch: "bg-blue-600" },
  { edge: "border-l-slate-800", swatch: "bg-slate-800" },
  { edge: "border-l-emerald-600", swatch: "bg-emerald-600" },
  { edge: "border-l-fuchsia-600", swatch: "bg-fuchsia-600" },
  { edge: "border-l-sky-400", swatch: "bg-sky-400" },
  { edge: "border-l-rose-600", swatch: "bg-rose-600" },
  { edge: "border-l-lime-600", swatch: "bg-lime-600" },
  { edge: "border-l-violet-700", swatch: "bg-violet-700" },
] as const;
const NO_AREA = { edge: "border-l-border-strong", swatch: "bg-border-strong" };

type AreaStyle = { edge: string; swatch: string };
/** The edge and legend colour of an area on this board. */
type StyleOf = (area: string | null) => AreaStyle;

const stylesFor = (areas: readonly (string | null)[]): StyleOf => {
  const colours = areaColours(areas);
  return (area) => {
    const index = colours.get(normaliseArea(area));
    return index === undefined ? NO_AREA : (AREA_STYLES[index] ?? NO_AREA);
  };
};

/** "Mon 24". */
const dayHeading = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(new Date(`${date}T00:00:00Z`)).replace(",", "");

/** "24 to 29 November", or "29 December to 3 January" across a month or year. */
function weekRange(start: string, end: string) {
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(new Date(`${date}T00:00:00Z`));
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth
    ? `${format(start, { day: "numeric" })} to ${format(end, { day: "numeric", month: "long" })}`
    : `${format(start, { day: "numeric", month: "long" })} to ${format(end, { day: "numeric", month: "long" })}`;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What a card says about its size: its tasks, or the crew once recorded. */
const cardSize = (visit: WeekBoardVisitDto) =>
  visit.crewSize ? `crew of ${visit.crewSize}` : visit.taskCount ? plural(visit.taskCount, "task") : null;

const DONE_WORDS: Partial<Record<WeekBoardVisitDto["status"], string>> = {
  IN_PROGRESS: "In progress",
  COMPLETED: "Finished",
  IN_REVIEW: "Finished",
  APPROVED: "Signed off",
};

export function WeekBoard({ onChanged }: { onChanged: (message: string) => void }) {
  const query = useQuery();
  const asked = query.get("week");
  const todayIso = today();
  const monday = boardMonday(/^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : todayIso);
  const thisMonday = boardMonday(todayIso);

  const [loaded, setLoaded] = useState<{ monday: string; board: WeekBoardDto } | null>(null);
  const [failure, setFailure] = useState<{ monday: string; message: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [moving, setMoving] = useState<WeekBoardVisitDto | null>(null);
  const [dragging, setDragging] = useState<WeekBoardVisitDto | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.visits
      .week(monday)
      .then((board) => {
        if (cancelled) return;
        setLoaded({ monday, board });
        setFailure(null);
      })
      .catch((e) => !cancelled && setFailure({ monday, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [monday, version]);

  const board = loaded?.board ?? null;
  const showing = loaded?.monday === monday;
  const failed = failure?.monday === monday ? failure.message : null;

  /**
   * Moves a visit through the diary's own change, so the restaurant's app and the Supervisor's
   * phone follow. Returns what went wrong, or null: a drag or the suggestion shows it above
   * the board, the Move dialog in itself.
   */
  async function move(visit: WeekBoardVisitDto, date: string, slot?: VisitSlot, showHere = true): Promise<string | null> {
    setBusyId(visit.id);
    setMoveError(null);
    try {
      await api.visits.update(visit.id, { date, ...(slot && { slot }) });
      onChanged(`${visit.outletName} moved to ${shortDay(date)}`);
      setVersion((current) => current + 1);
      return null;
    } catch (e) {
      if (showHere) setMoveError(describe(e));
      return describe(e);
    } finally {
      setBusyId(null);
    }
  }

  const weekLink = (date: string) => query.hrefWith({ week: date === thisMonday ? null : date });

  if (!board) {
    return failed ? <LoadError message={failed} onRetry={() => setVersion((current) => current + 1)} /> : <Loading />;
  }

  const areas = new Map<string, string>();
  let unplaced = false;
  for (const day of [...board.days, board.sunday]) {
    for (const item of [...day.visits, ...day.checks]) {
      if (item.area && normaliseArea(item.area)) areas.set(normaliseArea(item.area), item.area);
      else unplaced = true;
    }
  }
  const legend = [...areas.values()].sort((a, b) => a.localeCompare(b));
  const styleOf = stylesFor(legend);
  const sundayItems = board.sunday.visits.length + board.sunday.checks.length;

  return (
    // Printing the week keeps the board's colours (the area edges and the capacity bars).
    <div className={`flex flex-col gap-4 [print-color-adjust:exact] ${showing ? "" : "opacity-60"}`} aria-busy={!showing}>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">Week of {weekRange(board.start, board.end)}</p>
        <h2 className="text-xl font-bold">{board.headline}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <nav aria-label="Which week" className="flex items-center gap-2">
          <Link href={weekLink(addDays(monday, -7))} aria-label="The week before" className={WEEK_STEP}>
            <span aria-hidden>‹</span>
          </Link>
          <div className="inline-flex overflow-hidden rounded-lg border border-border-strong bg-surface">
            {[
              { label: "Last week", date: addDays(thisMonday, -7) },
              { label: "This week", date: thisMonday },
              { label: "Next week", date: addDays(thisMonday, 7) },
            ].map((option, index) => {
              const on = option.date === monday;
              return (
                <Link
                  key={option.label}
                  href={weekLink(option.date)}
                  aria-current={on ? "true" : undefined}
                  className={`min-h-9 px-3 py-1.5 text-sm font-semibold ${index > 0 ? "border-l border-border-strong" : ""} ${on ? "bg-foreground text-white" : "hover:bg-background"}`}
                >
                  {option.label.replace(" week", "")}
                  <span className="sr-only sm:not-sr-only"> week</span>
                </Link>
              );
            })}
          </div>
          <Link href={weekLink(addDays(monday, 7))} aria-label="The week after" className={WEEK_STEP}>
            <span aria-hidden>›</span>
          </Link>
        </nav>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          Print the week
        </Button>
      </div>

      <ErrorMessage message={moveError} />

      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_17rem] print:block">
        <div className="flex flex-col gap-3">
          {(legend.length > 0 || unplaced) && <AreaLegend areas={legend} unplaced={unplaced} styleOf={styleOf} />}
          <div className="grid gap-3 rounded-xl border border-border bg-surface p-3 md:grid-cols-6 md:gap-2 print:grid-cols-6 print:border-0 print:p-0">
            {board.days.map((day) => {
              const gone = day.date < board.today;
              const accepts = dragging !== null && !gone && dragging.date !== day.date;
              return (
                <DayColumn
                  key={day.date}
                  day={day}
                  todayIso={board.today}
                  gone={gone}
                  dropping={accepts && dropOn === day.date}
                  busyId={busyId}
                  styleOf={styleOf}
                  onDragOver={(event) => {
                    if (!accepts) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (dropOn !== day.date) setDropOn(day.date);
                  }}
                  onDragLeave={() => dropOn === day.date && setDropOn(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDropOn(null);
                    if (dragging && accepts) void move(dragging, day.date);
                    setDragging(null);
                  }}
                  onDragStart={setDragging}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropOn(null);
                  }}
                  onMove={setMoving}
                />
              );
            })}
          </div>

          {sundayItems > 0 && (
            <p className="text-sm">
              <span className="font-semibold">Also on {shortDay(board.sunday.date)}: </span>
              {[
                ...board.sunday.visits.map((visit) => (
                  <Link key={visit.id} href={`/visits?visit=${encodeURIComponent(visit.id)}`} className="text-primary hover:underline">
                    {visit.outletName} · {english(visit.serviceName)}
                  </Link>
                )),
                ...board.sunday.checks.map((check) => (
                  <span key={check.leadId}>Free check, {check.businessName}</span>
                )),
              ].map((item, index) => (
                <span key={index}>
                  {index > 0 && ", "}
                  {item}
                </span>
              ))}
              . The board has no Sunday column, and Sunday is not counted.
            </p>
          )}

          <p className="text-sm text-muted print:hidden">
            A card on this board is the same visit the restaurant sees in its app and the Supervisor sees on their phone. Moving it here moves it there.
          </p>
        </div>

        <aside className="order-last flex flex-col gap-4 md:order-first 2xl:order-none print:mb-4" aria-label="Capacity">
          <CapacityBox board={board} busy={busyId !== null} onMove={move} onSaved={(message) => {
            onChanged(message);
            setVersion((current) => current + 1);
          }} />
        </aside>
      </div>

      <div className="print:hidden">
        <HowItWorks>
          <p>
            Each day shows how many visits are booked against what the crew can take that day. A day with more than that is marked over, in amber and in words. Free checks
            booked by Sales are shown dashed and use no slot. Cancelled visits are left off.
          </p>
          <p>
            Drag a card to another day, or use its Move button to choose the day and the arrival time. A visit already started, finished or cancelled stays where it
            is, and a day that has gone cannot be chosen. The restaurant&apos;s Owner and Manager and the visit&apos;s Supervisor are told of the new day.
          </p>
          <p>
            The coloured edge of a card is the outlet&apos;s area, set on the client&apos;s page under the outlet&apos;s details; the legend above the board names each colour, and resting the pointer on a card shows its area.
            &ldquo;Weeks at 80% or more&rdquo; counts back from this week, at most half a year, using today&apos;s capacity for every week.
          </p>
        </HowItWorks>
      </div>

      <MoveDialog visit={moving} todayIso={board.today} onClose={() => setMoving(null)} onMove={move} />
    </div>
  );
}

const WEEK_STEP = "flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-border-strong bg-surface px-2 text-lg font-semibold hover:bg-background";

function AreaLegend({ areas, unplaced, styleOf }: { areas: string[]; unplaced: boolean; styleOf: StyleOf }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="text-muted">Edge colour is the area:</span>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {areas.map((area) => (
          <li key={area} className="flex items-center gap-1.5">
            <span aria-hidden className={`h-3 w-3 rounded-sm ${styleOf(area).swatch}`} />
            {area}
          </li>
        ))}
        {unplaced && (
          <li className="flex items-center gap-1.5 text-muted">
            <span aria-hidden className={`h-3 w-3 rounded-sm ${NO_AREA.swatch}`} />
            No area set
          </li>
        )}
      </ul>
    </div>
  );
}

function DayColumn({
  day,
  todayIso,
  gone,
  dropping,
  busyId,
  styleOf,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  day: WeekBoardDayDto;
  todayIso: string;
  gone: boolean;
  dropping: boolean;
  busyId: string | null;
  styleOf: StyleOf;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
  onDragStart: (visit: WeekBoardVisitDto) => void;
  onDragEnd: () => void;
  onMove: (visit: WeekBoardVisitDto) => void;
}) {
  const open = day.capacity - day.booked;
  const share = day.capacity > 0 ? Math.min(100, Math.round((day.booked / day.capacity) * 100)) : day.booked > 0 ? 100 : 0;
  const headingId = `day-${day.date}`;
  return (
    <section
      aria-labelledby={headingId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex min-w-0 flex-col gap-2 rounded-lg p-1.5 ${day.over ? "bg-amber-50 ring-1 ring-amber-400" : ""} ${dropping ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex flex-col gap-1 px-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id={headingId} className={`text-sm font-bold ${day.over ? "text-amber-900" : ""}`}>
            {dayHeading(day.date)}
            {day.date === todayIso && <span className="ml-1 text-xs font-semibold text-primary">Today</span>}
            {gone && <span className="sr-only"> (gone)</span>}
          </h3>
          <span className={`text-xs whitespace-nowrap ${day.over ? "font-bold text-amber-900" : "text-muted"}`}>
            {day.booked} of {day.capacity}
          </span>
        </div>
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className={`h-full rounded-full ${day.over ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${share}%` }} />
        </div>
        {day.over && (
          <p className="text-xs font-bold text-amber-900">
            <span aria-hidden>! </span>
            {day.booked - day.capacity} over capacity
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-1.5">
        {day.visits.map((visit) => (
          <li key={visit.id}>
            <VisitCard visit={visit} busy={busyId === visit.id} style={styleOf(visit.area)} onDragStart={onDragStart} onDragEnd={onDragEnd} onMove={onMove} />
          </li>
        ))}
        {day.checks.map((check) => (
          <li key={check.leadId}>
            <CheckCard check={check} style={styleOf(check.area)} />
          </li>
        ))}
      </ul>

      {open > 0 && !gone && (
        <p className="rounded-lg border border-dashed border-border-strong px-2 py-1.5 text-center text-xs text-muted">
          {open === 1 ? "1 slot open" : `${open} slots open`}
        </p>
      )}
      {day.visits.length === 0 && day.checks.length === 0 && gone && <p className="px-1 text-xs text-muted">Nothing that day.</p>}
    </section>
  );
}

function VisitCard({
  visit,
  busy,
  style,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  visit: WeekBoardVisitDto;
  busy: boolean;
  style: AreaStyle;
  onDragStart: (visit: WeekBoardVisitDto) => void;
  onDragEnd: () => void;
  onMove: (visit: WeekBoardVisitDto) => void;
}) {
  const size = cardSize(visit);
  const done = DONE_WORDS[visit.status];
  const where = visit.area ?? "No area set";
  return (
    <div
      draggable={visit.canMove && !busy}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", visit.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(visit);
      }}
      onDragEnd={onDragEnd}
      title={`${visit.organizationName} · ${visit.outletName} · ${where}`}
      className={`flex flex-col gap-0.5 rounded-lg border border-l-4 border-border bg-surface p-2 text-xs ${style.edge} ${visit.canMove ? "cursor-grab active:cursor-grabbing" : ""} ${busy ? "opacity-50" : ""}`}
    >
      <Link href={`/visits?visit=${encodeURIComponent(visit.id)}`} className="font-semibold leading-snug hover:underline">
        <span className="block">{slotStart(visit.slot)}</span>
        <span className="block break-words">{visit.outletName}</span>
      </Link>
      <span className="text-muted">
        {english(visit.serviceName)}
        {size ? ` · ${size}` : ""}
      </span>
      {/* The colour of the edge, in words, for a screen reader; on screen the legend names it, and so does the card's hover text. */}
      <span className="sr-only">Area: {where}.</span>
      {visit.supervisorName ? (
        <span className="text-muted">{visit.supervisorName}</span>
      ) : (
        visit.status === "SCHEDULED" && <span className="font-semibold text-danger">No Supervisor</span>
      )}
      {done && <span className="font-semibold text-primary">{done}</span>}
      {visit.canMove && (
        <button
          type="button"
          onClick={() => onMove(visit)}
          disabled={busy}
          className="mt-1 self-start rounded-md border border-border-strong px-2 py-1 font-semibold hover:bg-background disabled:opacity-50 print:hidden"
        >
          Move<span className="sr-only">
            {" "}
            {visit.outletName}, {english(visit.serviceName)}
          </span>
        </button>
      )}
    </div>
  );
}

/** A free check Sales has booked: dashed, because it uses no slot, and read-only here. */
function CheckCard({ check, style }: { check: WeekBoardCheckDto; style: AreaStyle }) {
  return (
    <Link
      href={`/sales/leads/${encodeURIComponent(check.leadId)}`}
      title={`Free check · ${check.businessName} · ${check.area ?? "No area set"}`}
      className={`flex flex-col gap-0.5 rounded-lg border border-l-4 border-dashed border-border-strong bg-background p-2 text-xs hover:border-primary ${style.edge}`}
    >
      <span className="font-semibold leading-snug">
        <span className="block">{timeOfDay(check.time)}</span>
        <span className="block break-words">{check.businessName}</span>
      </span>
      <span className="text-muted">
        Free check{check.checkWith ? ` · ${check.checkWith}` : ""}
      </span>
      <span className="sr-only">
        Area: {check.area ?? "No area set"}. Uses no slot.
      </span>
    </Link>
  );
}

function CapacityBox({
  board,
  busy,
  onMove,
  onSaved,
}: {
  board: WeekBoardDto;
  busy: boolean;
  onMove: (visit: WeekBoardVisitDto, date: string) => Promise<string | null>;
  onSaved: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { week, streak, suggestion } = board;
  const share = week.capacity > 0 ? Math.min(100, Math.round((week.booked / week.capacity) * 100)) : 0;
  const suggested = suggestion ? board.days.flatMap((day) => day.visits).find((visit) => visit.id === suggestion.visitId) : undefined;
  const fromDay = suggestion ? BOARD_WEEKDAY_NAMES[weekdayOf(suggestion.fromDate)] : "";
  const toDay = suggestion ? BOARD_WEEKDAY_NAMES[weekdayOf(suggestion.toDate)] : "";

  return (
    <Card className="grid gap-x-6 gap-y-3 p-4 md:grid-cols-2 2xl:grid-cols-1">
      <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">Capacity</h2>
        <span className="text-sm font-semibold">
          {week.booked} of {week.capacity}
        </span>
      </div>
      <div aria-hidden className="h-2 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${week.booked > week.capacity ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${share}%` }} />
      </div>
      <p className="text-sm">
        {week.percent === null ? "No slots this week." : `${week.percent}% of this week's slots booked.`} Free checks do not use a slot.
      </p>
      <p className="text-sm">
        Weeks at {streak.busyPercent}% or more:{" "}
        <span className="font-bold">{streak.weeks === 0 ? "none just now" : `${streak.weeks} in a row`}</span>
        {streak.weeks > 0 ? ", up to this week." : "."}
      </p>
      </div>

      <div className="flex flex-col gap-3">

      {suggestion && suggested && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
          <p>
            {fromDay} is over. Move {suggested.outletName}&apos;s {english(suggested.serviceName).toLowerCase()} to {toDay}, the lightest day after it?
          </p>
          <Button size="sm" variant="secondary" className="self-start" loading={busy} onClick={() => void onMove(suggested, suggestion.toDate)}>
            Move to {shortDay(suggestion.toDate)}
          </Button>
        </div>
      )}

      {board.canChangeCapacity &&
        (editing ? (
          <CapacityForm
            capacity={board.capacity}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              onSaved("Capacity saved");
            }}
          />
        ) : (
          <Button size="sm" variant="secondary" className="self-start print:hidden" onClick={() => setEditing(true)}>
            Change capacity
          </Button>
        ))}
      </div>
    </Card>
  );
}

const weekdayOf = (date: string): BoardWeekday => {
  const index = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return BOARD_WEEKDAYS[Math.min(index, 5)] ?? "MON";
};

/** The Super Admin sets how many visits a day the crew can take. */
function CapacityForm({ capacity, onCancel, onSaved }: { capacity: VisitCapacity; onCancel: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<BoardWeekday, string>>(
    Object.fromEntries(BOARD_WEEKDAYS.map((day) => [day, String(capacity[day])])) as Record<BoardWeekday, string>,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const numbers = Object.fromEntries(BOARD_WEEKDAYS.map((day) => [day, Number(values[day])])) as VisitCapacity;
    if (BOARD_WEEKDAYS.some((day) => !Number.isInteger(numbers[day]) || numbers[day] < 0 || numbers[day] > 20)) {
      setError("Each day takes a whole number from 0 to 20.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.visits.updateSettings(numbers);
      onSaved();
    } catch (e) {
      setError(describe(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3 border-t border-border pt-3 print:hidden">
      <p className="text-sm text-muted">Visits a day the crew can take. 0 closes the day.</p>
      <div className="grid grid-cols-3 gap-2">
        {BOARD_WEEKDAYS.map((day) => (
          <Field
            key={day}
            label={BOARD_WEEKDAY_NAMES[day].slice(0, 3)}
            name={day}
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            required
            value={values[day]}
            onChange={(e) => setValues((current) => ({ ...current, [day]: e.target.value }))}
            className="w-full"
          />
        ))}
      </div>
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={busy}>
          Save capacity
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Move": the day and arrival time of a visit, for the keyboard and touch (and anyone who would rather not drag). */
function MoveDialog({
  visit,
  todayIso,
  onClose,
  onMove,
}: {
  visit: WeekBoardVisitDto | null;
  todayIso: string;
  onClose: () => void;
  onMove: (visit: WeekBoardVisitDto, date: string, slot: VisitSlot, showHere: boolean) => Promise<string | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState<VisitSlot>("1000");
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (visit && !dialog.open) dialog.showModal();
    if (!visit && dialog.open) dialog.close();
  }, [visit]);

  // A new visit to move starts from where it is now (or today, for one already overdue).
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (visit && shownFor !== visit.id) {
    setShownFor(visit.id);
    setDate(visit.date < todayIso ? todayIso : visit.date);
    setSlot(visit.slot ?? "1000");
    setDateError(undefined);
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!visit) return;
    const problem = checkDate(date, todayIso);
    setDateError(problem);
    if (problem) return;
    setBusy(true);
    const problemMoving = await onMove(visit, date, slot, false);
    setBusy(false);
    setError(problemMoving);
    if (!problemMoving) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="move-title"
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl"
    >
      {visit && (
        <form onSubmit={save} noValidate className="flex flex-col gap-4 p-5">
          <div>
            <h2 id="move-title" className="text-lg font-bold">
              Move this visit
            </h2>
            <p className="text-sm text-muted">
              {english(visit.serviceName)} at {visit.outletName}, now {shortDay(visit.date)}
              {visit.slot ? `, ${slotStart(visit.slot)}` : ""}.
            </p>
          </div>
          <Field label="New date" name="date" type="date" required min={todayIso} value={date} error={dateError} onChange={(e) => setDate(e.target.value)} />
          <SlotField value={slot} onChange={setSlot} />
          <p className="text-sm text-muted">The restaurant&apos;s Owner and Manager and the Supervisor are told of the change.</p>
          <ErrorMessage message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              Move the visit
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
