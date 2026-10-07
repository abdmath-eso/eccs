import type { ChecklistRunSummaryDto, LocalizedText } from "./checklists.js";
import type { LicenceType } from "./licences.js";

// The restaurant's history calendar: one month at a time, with what
// happened on past days (checklists, ECCS services) and what is coming
// (services booked, licences falling due, holidays).

/** How far the calendar goes back and ahead from the current month. */
export const CALENDAR_MONTHS_BACK = 12;
export const CALENDAR_MONTHS_AHEAD = 12;

/**
 * Where an ECCS service visit stands, as the restaurant sees it:
 * UPCOMING = booked for today or later; IN_PROGRESS = the team is on site;
 * DONE = completed; NOT_DONE = its date passed without it being completed.
 */
export type CalendarVisitState = "UPCOMING" | "IN_PROGRESS" | "DONE" | "NOT_DONE";

export interface CalendarVisitDto {
  id: string;
  service: LocalizedText;
  /** When in the day, as arranged: one of VISIT_SLOTS, e.g. "AFTER_CLOSING". */
  slot: string | null;
  state: CalendarVisitState;
}

/** A licence that expires on the day it is listed under. */
export interface CalendarLicenceDto {
  id: string;
  type: LicenceType;
  name: string | null;
}

/** One day that has something on it. */
export interface CalendarDayDto {
  /** YYYY-MM-DD */
  date: string;
  /** The day's checklists. Empty for days after today. */
  checklists: ChecklistRunSummaryDto[];
  visits: CalendarVisitDto[];
  /** Licences expiring on this day. */
  licences: CalendarLicenceDto[];
  holidays: LocalizedText[];
}

/** Something coming up, whichever month is being looked at. */
export type CalendarUpcomingDto =
  | { date: string; kind: "visit"; visit: CalendarVisitDto }
  | { date: string; kind: "licence"; licence: CalendarLicenceDto };

export interface CalendarMonthDto {
  outletId: string;
  /** YYYY-MM */
  month: string;
  /** Today's calendar date in India, YYYY-MM-DD. */
  today: string;
  /** Only the days that have something on them, in date order. */
  days: CalendarDayDto[];
  /** The next services and licence due dates from today, soonest first. */
  upcoming: CalendarUpcomingDto[];
}

/** "2026-10" moved by a number of months, e.g. -1 gives "2026-09". */
export function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (monthNumber - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** How many days a month ("2026-02") has. */
export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}
