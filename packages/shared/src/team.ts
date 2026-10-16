// ECCS's own team (the console's Team page, 16 Oct 2026): the founders' staff (the Ops
// Manager, the Supervisors and the BDEs), not a restaurant's cooks, whose attendance and
// pay are the restaurant's own (staff.ts).
//
// Presence is never marked by anyone: it is read from what the person did that day (a
// BDE's first lead step, a Supervisor's first visit arrival or inspection, the Ops
// Manager's first change in the console), by the time it was done, which for work done on
// the phone without signal is the phone's own time. Leave is recorded by the Super Admin or
// the Ops Manager, and a day of leave is never a day missed. Salaries are monthly, counted
// from the joining day to the last day, and each month's becomes a row of the Finance
// page's expense book.
//
// Everything in this file is plain rules and wording with no database in it, so the server
// and the console work a figure out the same way and every rule is tested on its own
// (team.test.ts). Money is whole paise; dates are India dates (YYYY-MM-DD); moments are ISO
// strings; India time throughout.
//
// PATTERN FOLLOWED (the founder's own design, docs/design/2026-10-15 Team member page):
// LeadSquared's "My Teams" (one row per person with today's check-in status and time and a
// WhatsApp button; a person's page with their leads and activities), Pipedrive Insights'
// activity performance and HubSpot's rep productivity reports (a handful of figures per
// rep, each against its goal and the last period; HubSpot's community advice is to keep to
// five or six), Pipedrive's "rotting" deals for the leads going stale, GitHub's
// contribution graph for one square a day (each square titled, a sequential colour, empty
// is not zero), attendance calendars (greytHR's "weekly off, but present"; ByteHR's grey
// day off and blue leave) and small-team leave trackers (Timetastic, Leave Dates: a day or
// a few days off, a short reason, no medical details).

import { z } from "zod";
import { normalizePhone } from "./auth.js";
import { daysInMonth } from "./calendar.js";
import { addDays, daysBetween, daysFrom, monthEnd, monthLabel, monthOf, monthStart, monthsBetween, whatsappReminderUrl } from "./finance.js";
import { indiaDay } from "./food-labels.js";
import { clockWords, indiaClock, type StaleDto, type StaleReason } from "./sales.js";
import { visitSlotWindow, type VisitSlot } from "./services.js";
import { weekdayOf } from "./staff.js";
import type { Role } from "./roles.js";

// ───────────────────────── Roles on the team ─────────────────────────

/** The roles a person is given on the Team page. */
export const TEAM_ROLES = ["OPS_MANAGER", "SUPERVISOR", "BDE"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** The roles a team member can hold: a founder (the Super Admin) is on the team only when given a place on it. */
export const TEAM_MEMBER_ROLES = ["SUPER_ADMIN", ...TEAM_ROLES] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

export const TEAM_ROLE_LABELS: Record<TeamMemberRole, string> = {
  SUPER_ADMIN: "Super Admin",
  OPS_MANAGER: "Ops Manager",
  SUPERVISOR: "Supervisor",
  BDE: "BDE",
};

/** The role a login holds on the team: the team role it has, else the Super Admin's. Null for anyone else. */
export function teamRoleOf(roles: readonly Role[]): TeamMemberRole | null {
  return TEAM_ROLES.find((role) => roles.includes(role)) ?? (roles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : null);
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const TEAM_RULES = {
  /** The squares on a person's page: the last 14 days, today included. */
  windowDays: 14,
  /** The share of follow-ups and arrivals on time aimed for, until the Super Admin sets another (a setting). */
  defaultOnTimeTargetPercent: 90,
  /** Working days not in (with no leave recorded) in the last 14 days, before today, that make "keep an eye on". */
  missedDaysFlag: 2,
  /** Stale leads that make "keep an eye on" (one or two is ordinary). */
  staleLeadsFlag: 3,
  /** At least this many follow-ups or arrivals in the week before their share on time is judged. */
  onTimeJudgedFrom: 3,
  /** "What the app found" lists this many; the rest are a link away. */
  foundShown: 8,
  /** An after-closing visit counts as on time when arrived by this hour of the next morning. */
  afterClosingByHour: 4,
  /** The highest monthly salary the form takes: ₹10 lakh. */
  maxMonthlyPaise: 100_000_000,
  /** The longest one record of leave can be. */
  maxLeaveDays: 60,
} as const;

// ───────────────────────── Names ─────────────────────────

/** "IM" for Imran, "SS" for Sample Supervisor: the first two letters of a single name, else the first letter of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * "Imran" from "Imran Khan", as the design says "Message Imran". The seed's own logins are
 * called "Sample Ops Manager" and "Sample Supervisor", which keep their whole name.
 */
export const firstName = (name: string) => {
  const trimmed = name.trim();
  if (/^sample\s/i.test(trimmed)) return trimmed;
  return trimmed.split(/\s+/)[0] ?? trimmed;
};

/**
 * "Message Imran": WhatsApp opened on a chat with them (WhatsApp's own "click to chat"),
 * nothing typed in. The server sends nothing. A sample member's number is made up, so it is
 * left out and WhatsApp asks whom to write to.
 */
export function teamWhatsappUrl(phone: string | null, sample: boolean): string {
  return whatsappReminderUrl(sample ? null : phone, "").replace(/\?text=$/, "");
}

// ───────────────────────── Days ─────────────────────────

const dayWords = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`)).replace(",", "");

/** "Friday 9". */
export const weekdayAndDay = (date: string) => `${WEEKDAY_NAMES[weekdayOf(date)]} ${Number(date.slice(8, 10))}`;
/** "Fri 9". */
const shortWeekdayAndDay = (date: string) => `${WEEKDAY_NAMES[weekdayOf(date)]!.slice(0, 3)} ${Number(date.slice(8, 10))}`;
/** "23 September". */
export const dayAndMonth = (date: string) => dayWords(date, { day: "numeric", month: "long" });
/** "9 Oct". */
const dayShort = (date: string) => dayWords(date, { day: "numeric", month: "short" });

/** "Friday 9", "Friday 9 and Monday 12", "Fri 9, Mon 12 and Wed 14", or "5 days" when there are more than four. */
export function dayList(dates: readonly string[]): string {
  if (dates.length === 0) return "";
  if (dates.length > 4) return `${dates.length} days`;
  if (dates.length === 1) return weekdayAndDay(dates[0]!);
  const words = dates.map(dates.length === 2 ? weekdayAndDay : shortWeekdayAndDay);
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (count: number) => NUMBER_WORDS[count] ?? String(count);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// ───────────────────────── Leave ─────────────────────────

export interface LeaveSpan {
  from: string;
  to: string;
  reason?: string | null;
}

/** The leave covering a day, if any. */
export const leaveOn = (leave: readonly LeaveSpan[], date: string) => leave.find((span) => span.from <= date && span.to >= date) ?? null;

/** "Fri 9 Oct", or "Tue 20 to Wed 21 Oct" for a few days. */
export function leaveWords(span: Pick<LeaveSpan, "from" | "to">): string {
  const one = (date: string) => `${WEEKDAY_NAMES[weekdayOf(date)]!.slice(0, 3)} ${dayShort(date)}`;
  return span.from === span.to ? one(span.from) : `${shortWeekdayAndDay(span.from)} to ${one(span.to)}`;
}

// ───────────────────────── Presence, read from what was done ─────────────────────────

/**
 * Where a person's presence is read from: a BDE's lead steps; a Supervisor's visit arrivals
 * and inspections; for the Ops Manager (and a founder on the team), the changes they make in
 * the console or the app (the activity log).
 */
export type PresenceSource = "LEAD_STEPS" | "FIELD_WORK" | "ACTIVITY_LOG";
export const presenceSourceFor = (role: TeamMemberRole): PresenceSource => (role === "BDE" ? "LEAD_STEPS" : role === "SUPERVISOR" ? "FIELD_WORK" : "ACTIVITY_LOG");

/** One thing a person did, as presence reads it: when (the phone's own time for work done offline) and what, in a few words. */
export interface PresenceEvent {
  at: string;
  /** "first lead logged from the field", "arrived at Spice Route, Jubilee Hills". */
  what: string;
}

/**
 * IN: something was done that day (a day off or a day of leave included).
 * LEAVE: on leave. OFF: their weekly day off. TODAY: today, nothing yet (not missed).
 * NOT_IN: a working day with nothing done and no leave. NO_RECORD: before the records it
 * is read from began. NOT_ON_TEAM: before they joined or after they left.
 */
export const DAY_STATES = ["IN", "LEAVE", "OFF", "TODAY", "NOT_IN", "NO_RECORD", "NOT_ON_TEAM"] as const;
export type DayState = (typeof DAY_STATES)[number];

export interface PresenceDayDto {
  date: string;
  state: DayState;
  /** The first thing done that day: its India time ("09:40") and what it was. */
  firstAt: string | null;
  what: string | null;
  dayOff: boolean;
  onLeave: boolean;
  leaveReason: string | null;
}

export interface PresenceInput {
  today: string;
  events: readonly PresenceEvent[];
  weeklyOff: number;
  leave: readonly LeaveSpan[];
  joinedOn: string | null;
  leftOn: string | null;
  /** The first day the records presence is read from exist; days before it have nothing to read. */
  recordsFrom?: string | null;
  days?: number;
}

/** One square a day for the last 14 days (oldest first), today last. */
export function presenceDays(input: PresenceInput): PresenceDayDto[] {
  const count = input.days ?? TEAM_RULES.windowDays;
  const first = new Map<string, PresenceEvent>();
  for (const event of [...input.events].sort((a, b) => a.at.localeCompare(b.at))) {
    const day = indiaDay(event.at);
    if (!first.has(day)) first.set(day, event);
  }
  return daysBetween(addDays(input.today, -(count - 1)), input.today).map((date) => {
    const event = first.get(date) ?? null;
    const leave = leaveOn(input.leave, date);
    const dayOff = weekdayOf(date) === input.weeklyOff;
    const base = { date, firstAt: event ? indiaClock(event.at) : null, what: event?.what ?? null, dayOff, onLeave: leave !== null, leaveReason: leave?.reason ?? null };
    let state: DayState;
    if ((input.joinedOn && date < input.joinedOn) || (input.leftOn && date > input.leftOn)) state = "NOT_ON_TEAM";
    else if (event) state = "IN";
    else if (dayOff) state = "OFF";
    else if (leave) state = "LEAVE";
    else if (input.recordsFrom && date < input.recordsFrom) state = "NO_RECORD";
    else if (date === input.today) state = "TODAY";
    else state = "NOT_IN";
    return { ...base, state };
  });
}

export interface PresenceSummary {
  /** Working days so far: not a day off, on the team, with records; today only once they are in. Leave days count as working days. */
  working: number;
  /** Working days they were in. */
  in: number;
  /** Working days with nothing done and no leave, before today. */
  missed: string[];
  leave: string[];
  /** Days off they worked anyway. */
  offWorked: string[];
  /** Days off with nothing done (the grey squares). */
  off: string[];
  /** Days before the records began. */
  noRecord: string[];
  today: PresenceDayDto;
}

export function summarisePresence(days: readonly PresenceDayDto[]): PresenceSummary {
  const pick = (test: (day: PresenceDayDto) => boolean) => days.filter(test).map((day) => day.date);
  const inDays = pick((day) => day.state === "IN" && !day.dayOff);
  const leave = pick((day) => day.state === "LEAVE");
  const missed = pick((day) => day.state === "NOT_IN");
  return {
    working: inDays.length + leave.length + missed.length,
    in: inDays.length,
    missed,
    leave,
    offWorked: pick((day) => day.state === "IN" && day.dayOff),
    off: pick((day) => day.state === "OFF"),
    noRecord: pick((day) => day.state === "NO_RECORD"),
    today: days[days.length - 1]!,
  };
}

/** What a person's presence is read from, in words, for the line under the squares. */
export function presenceSourceWords(source: PresenceSource, name: string): string {
  const who = firstName(name);
  if (source === "LEAD_STEPS") return `Read from the first lead step ${who} logs each day.`;
  if (source === "FIELD_WORK") return `Read from ${who}'s first visit arrival or inspection each day.`;
  return `Read from the first change ${who} makes in the console or the app each day.`;
}

/**
 * The line under the squares, as the design words it: "11 of 12 working days in · on leave
 * Tuesday 24 · the two grey squares are Sundays. Read from the first lead step Imran logs
 * each day."
 */
export function presenceLine(summary: PresenceSummary, input: { name: string; weeklyOff: number; source: PresenceSource }): string {
  const parts = [summary.working > 0 ? `${summary.in} of ${plural(summary.working, "working day")} in` : "No working days to read yet"];
  if (summary.leave.length > 0) parts.push(`on leave ${dayList(summary.leave)}`);
  if (summary.missed.length > 0) parts.push(`not in ${dayList(summary.missed)}`);
  if (summary.offWorked.length > 0) parts.push(`also worked on ${dayList(summary.offWorked)}, ${summary.offWorked.length === 1 ? "a day off" : "days off"}`);
  if (summary.off.length > 0) {
    const day = WEEKDAY_NAMES[input.weeklyOff] ?? "day off";
    parts.push(summary.off.length === 1 ? `the grey square is a ${day}` : `the ${numberWord(summary.off.length)} grey squares are ${day}s`);
  }
  const before = summary.noRecord.length > 0 ? ` Nothing to read before ${dayShort(addDays(summary.noRecord[summary.noRecord.length - 1]!, 1))}.` : "";
  return `${parts.join(" · ")}. ${presenceSourceWords(input.source, input.name)}${before}`;
}

/** Today in one sentence: "In since 9:40 am today, first lead logged from the field." */
export function todaySentence(today: PresenceDayDto, input: { name: string; lastIn?: PresenceDayDto | null; leftOn?: string | null }): string {
  switch (today.state) {
    case "IN":
      return `In since ${clockWords(today.firstAt!)} today, ${today.what}.`;
    case "LEAVE":
      return `On leave today${today.leaveReason ? ` (${today.leaveReason})` : ""}.`;
    case "OFF":
      return `${WEEKDAY_NAMES[weekdayOf(today.date)]} is ${firstName(input.name)}'s day off.`;
    case "NOT_ON_TEAM":
      return input.leftOn ? `Left on ${dayAndMonth(input.leftOn)}.` : "Not on the team yet.";
    case "NO_RECORD":
      return "Nothing to read today yet.";
    default: {
      const last = input.lastIn;
      return `Not in yet today${last && last.firstAt ? `; last in on ${weekdayAndDay(last.date)}, from ${clockWords(last.firstAt)}` : ""}.`;
    }
  }
}

/** The list's "today" column: "In since 9:40 am", "Not in yet", "On leave", "Day off", "Left". */
export function todayWords(today: PresenceDayDto): string {
  switch (today.state) {
    case "IN":
      return `In since ${clockWords(today.firstAt!)}`;
    case "LEAVE":
      return "On leave";
    case "OFF":
      return "Day off";
    case "NOT_ON_TEAM":
      return "Not on the team";
    case "NO_RECORD":
      return "No record yet";
    default:
      return "Not in yet";
  }
}

// ───────────────────────── Follow-ups and arrivals on time ─────────────────────────

/** A share on time: how many fell due (or arrived), how many were on time, and the whole percent (null with none). */
export interface OnTimeDto {
  due: number;
  onTime: number;
  percent: number | null;
}

const share = (onTime: number, due: number): OnTimeDto => ({ due, onTime, percent: due > 0 ? Math.round((onTime / due) * 100) : null });

/** A next step as kept from the moment it was set (LeadFollowUp). */
export interface FollowUpRecord {
  leadId: string;
  setAt: string;
  dueAt: string;
  /** When it stopped being the lead's next step; null while it still is. */
  endedAt: string | null;
}

/**
 * "Follow-ups on time": of the next steps that fell due between two India dates (and by
 * `now`), the share that had a step logged on the lead after they were set and by their due
 * time. One moved to a new date before it fell due, with nothing logged, is not counted: it
 * never fell due. One that fell due and was moved afterwards counts as late.
 */
export function followUpsOnTime(followUps: readonly FollowUpRecord[], steps: readonly { leadId: string; at: string }[], from: string, to: string, now: Date): OnTimeDto {
  const byLead = new Map<string, number[]>();
  for (const step of steps) byLead.set(step.leadId, [...(byLead.get(step.leadId) ?? []), Date.parse(step.at)]);
  let due = 0;
  let onTime = 0;
  for (const followUp of followUps) {
    const dueAt = Date.parse(followUp.dueAt);
    const day = indiaDay(followUp.dueAt);
    if (day < from || day > to || dueAt > now.getTime()) continue;
    const setAt = Date.parse(followUp.setAt);
    const endedAt = followUp.endedAt ? Date.parse(followUp.endedAt) : null;
    // A step after a later next step was set belongs to that one.
    const until = endedAt !== null && endedAt < dueAt ? endedAt : dueAt;
    const met = (byLead.get(followUp.leadId) ?? []).some((at) => at > setAt && at <= until);
    if (!met && endedAt !== null && endedAt < dueAt) continue;
    due += 1;
    if (met) onTime += 1;
  }
  return share(onTime, due);
}

/** A visit as "arrivals on time" reads it. */
export interface ArrivalFacts {
  /** The India date it was booked for. */
  scheduledDate: string;
  slot: VisitSlot | null;
  checkInAt: string;
}

/**
 * On time when the Supervisor arrived by the end of the visit's two-hour window on its day
 * (early is on time); an after-closing visit by 4 am the next morning; a visit with no window
 * by the end of its day.
 */
export function arrivedOnTime(visit: ArrivalFacts): boolean {
  const window = visit.slot ? visitSlotWindow(visit.slot) : null;
  const deadline = window
    ? new Date(`${visit.scheduledDate}T${window.end}:00.000+05:30`)
    : visit.slot === "AFTER_CLOSING"
      ? new Date(`${addDays(visit.scheduledDate, 1)}T${String(TEAM_RULES.afterClosingByHour).padStart(2, "0")}:00:00.000+05:30`)
      : new Date(`${addDays(visit.scheduledDate, 1)}T00:00:00.000+05:30`);
  return Date.parse(visit.checkInAt) <= deadline.getTime();
}

/** "Arrivals on time": of the arrivals between two India dates, the share on time. */
export function arrivalsOnTime(visits: readonly ArrivalFacts[], from: string, to: string): OnTimeDto {
  const counted = visits.filter((visit) => {
    const day = indiaDay(visit.checkInAt);
    return day >= from && day <= to;
  });
  return share(counted.filter(arrivedOnTime).length, counted.length);
}

// ───────────────────────── Keep an eye on ─────────────────────────

/** The things worth the founder's attention, in the order the page picks them: absence first, then work going stale, then the week's figures. */
export const CONCERN_KINDS = ["MISSED_DAYS", "STALE_LEADS", "VISITS_OVERDUE", "TARGETS_BEHIND", "FOLLOW_UPS_LATE", "ARRIVALS_LATE"] as const;
export type ConcernKind = (typeof CONCERN_KINDS)[number];

export interface ConcernDto {
  kind: ConcernKind;
  /** The banner's sentence: "6 leads waiting for a follow-up, the longest for 12 days." */
  words: string;
  /** A few words for the list and for "Also": "6 leads waiting". */
  short: string;
}

export interface ConcernInput {
  /** Working days not in, with no leave, before today. */
  missedDays: readonly string[];
  /** A BDE's stale leads: how many, and the longest wait in days. */
  staleLeads?: { count: number; longestDays: number } | null;
  /** A Supervisor's visits past their day and not done. */
  visitsOverdue?: number | null;
  /** The week's figures behind pace, with how many are done and the week's target. */
  behind?: readonly { label: string; done: number; target: number }[] | null;
  followUps?: OnTimeDto | null;
  arrivals?: OnTimeDto | null;
  onTimeTargetPercent: number;
}

/** Everything worth attention, most first. Empty when all is well. */
export function concerns(input: ConcernInput): ConcernDto[] {
  const found: ConcernDto[] = [];
  const missed = input.missedDays.length;
  if (missed >= TEAM_RULES.missedDaysFlag) {
    // The days are named when there are a few; more than that, the count says it.
    const which = missed <= 4 ? `: ${dayList(input.missedDays)}` : "";
    found.push({ kind: "MISSED_DAYS", words: `Not in on ${plural(missed, "working day")} of the last two weeks${which}.`, short: `not in on ${plural(missed, "day")}` });
  }
  const stale = input.staleLeads;
  if (stale && stale.count >= TEAM_RULES.staleLeadsFlag) {
    found.push({ kind: "STALE_LEADS", words: `${stale.count} leads waiting for a follow-up, the longest for ${plural(stale.longestDays, "day")}.`, short: `${stale.count} leads waiting` });
  }
  const overdue = input.visitsOverdue ?? 0;
  if (overdue > 0) {
    found.push({
      kind: "VISITS_OVERDUE",
      words: overdue === 1 ? "1 visit past its day and not done." : `${overdue} visits past their day and not done.`,
      short: `${plural(overdue, "visit")} overdue`,
    });
  }
  const behind = input.behind ?? [];
  if (behind.length > 0) {
    const figures = behind.map((entry) => `${entry.done} of ${entry.target}`);
    const names = behind.map((entry) => entry.label);
    const joined = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    found.push({
      kind: "TARGETS_BEHIND",
      words: behind.length === 1 ? `Behind on ${joined}: ${figures[0]} this week.` : `Behind on ${joined} this week: ${figures.join(" and ")}.`,
      short: behind.map((entry, index) => `${entry.label} ${figures[index]}`).join(", "),
    });
  }
  const late = (value: OnTimeDto | null | undefined) =>
    value && value.percent !== null && value.due >= TEAM_RULES.onTimeJudgedFrom && value.percent < input.onTimeTargetPercent ? value.percent : null;
  const followUps = late(input.followUps);
  if (followUps !== null) {
    found.push({ kind: "FOLLOW_UPS_LATE", words: `Follow-ups on time ${followUps}% this week, target ${input.onTimeTargetPercent}%.`, short: `follow-ups on time ${followUps}%` });
  }
  const arrivals = late(input.arrivals);
  if (arrivals !== null) {
    found.push({ kind: "ARRIVALS_LATE", words: `Arrived on time at ${arrivals}% of visits this week, target ${input.onTimeTargetPercent}%.`, short: `arrivals on time ${arrivals}%` });
  }
  return found;
}

/**
 * "Keep an eye on": the one thing most worth the founder's attention, and the day's note
 * under it (today's presence, then "Everything else is on target." or what else is behind).
 */
export function keepAnEyeOn(found: readonly ConcernDto[], today: string): { pick: ConcernDto | null; note: string } {
  const [pick = null, ...others] = found;
  const rest = others.length > 0 ? `Also: ${others.map((entry) => entry.short).join(", ")}.` : pick ? "Everything else is on target." : "Everything is on target.";
  return { pick, note: `${today} ${rest}` };
}

// ───────────────────────── What the app found (a BDE's stale leads) ─────────────────────────

/** Worst first, as the design lists them: money waiting on a quote, a nurture date passed, a check with no quote, then the rest. */
export const STALE_ORDER: readonly StaleReason[] = ["QUOTE_NO_CONTACT", "NURTURE_DATE_PASSED", "CHECK_NO_QUOTE", "NEXT_ACTION_PASSED", "NO_NEXT_STEP", "NO_ACTIVITY"];

/** Stale leads worst first: by reason, then the longest waiting. */
export function worstFirst<T extends { stale: StaleDto }>(leads: readonly T[]): T[] {
  return [...leads].sort((a, b) => STALE_ORDER.indexOf(a.stale.reason) - STALE_ORDER.indexOf(b.stale.reason) || b.stale.days - a.stale.days);
}

// ───────────────────────── Salaries ─────────────────────────

/** A monthly salary from a day on. */
export interface SalaryStep {
  from: string;
  monthlyPaise: number;
}

/** The salary in effect on a day: the latest that has started, else the first (pay counts from the joining day). */
export function salaryOn(steps: readonly SalaryStep[], date: string): number | null {
  const sorted = [...steps].sort((a, b) => a.from.localeCompare(b.from));
  if (sorted.length === 0) return null;
  return [...sorted].reverse().find((step) => step.from <= date)?.monthlyPaise ?? sorted[0]!.monthlyPaise;
}

export interface SalaryMonth {
  month: string;
  paise: number;
  /** The days it is for: the joining day or the 1st, to the last day or the month's end. */
  firstDay: string;
  lastDay: string;
  /** When it is paid: the month's last day, or their last day when they leave. */
  dueDate: string;
}

/**
 * One month's salary: each day on the team paid at the salary of that day, a month's salary
 * divided by the days in the month (a salary change from the 15th pays the old rate to the
 * 14th and the new from the 15th), rounded to the rupee. A whole month at one salary is that
 * salary exactly. Leave days are paid. Null when they were not on the team that month or
 * have no salary.
 */
export function salaryForMonth(input: { month: string; joinedOn: string; leftOn: string | null; steps: readonly SalaryStep[] }): SalaryMonth | null {
  const firstDay = input.joinedOn > monthStart(input.month) ? input.joinedOn : monthStart(input.month);
  const end = monthEnd(input.month);
  const lastDay = input.leftOn && input.leftOn < end ? input.leftOn : end;
  if (lastDay < firstDay || input.steps.length === 0) return null;
  // Whole paise times days, divided once, so a whole month is exact.
  let numerator = 0;
  for (const day of daysBetween(firstDay, lastDay)) numerator += salaryOn(input.steps, day) ?? 0;
  const paise = Math.round(numerator / daysInMonth(input.month) / 100) * 100;
  if (paise <= 0) return null;
  return { month: input.month, paise, firstDay, lastDay, dueDate: lastDay };
}

/** Every month's salary from the joining month to this month (or the month they left). */
export function salaryMonths(input: { joinedOn: string; leftOn: string | null; steps: readonly SalaryStep[]; today: string }): SalaryMonth[] {
  const last = input.leftOn && input.leftOn < input.today ? input.leftOn : input.today;
  if (last < input.joinedOn) return [];
  return monthsBetween(input.joinedOn, last)
    .map((month) => salaryForMonth({ month, joinedOn: input.joinedOn, leftOn: input.leftOn, steps: input.steps }))
    .filter((entry): entry is SalaryMonth => entry !== null);
}

/** The expense book's words for a month's salary: "Salary, October 2026", "Salary, September 2026 (23 to 30 Sep)". */
export function salaryDescription(entry: Pick<SalaryMonth, "month" | "firstDay" | "lastDay">): string {
  const whole = entry.firstDay === monthStart(entry.month) && entry.lastDay === monthEnd(entry.month);
  return `Salary, ${monthLabel(entry.month)}${whole ? "" : ` (${Number(entry.firstDay.slice(8))} to ${dayShort(entry.lastDay)})`}`;
}

/** How many days a month's salary covers, for the tests and the page. */
export const salaryDays = (entry: Pick<SalaryMonth, "firstDay" | "lastDay">) => daysFrom(entry.firstDay, entry.lastDay) + 1;

/** The month a date is in, for a salary row. */
export const salaryMonthOf = monthOf;

// ───────────────────────── What the API accepts ─────────────────────────

const dateSchema = z
  .string("Enter the date")
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist");

const phoneField = z.string("Enter their mobile number").transform((value, context) => {
  const phone = normalizePhone(value);
  if (!phone) {
    context.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" });
    return z.NEVER;
  }
  return phone;
});

const salaryField = z
  .number("Enter the monthly salary")
  .int("Enter the salary in rupees")
  .min(0, "The salary cannot be below zero")
  .max(TEAM_RULES.maxMonthlyPaise, "That is more than a monthly salary can be here");

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

const memberFields = {
  name: z.string("Enter their name").trim().min(1, "Enter their name").max(80, "Keep the name under 80 characters"),
  /** Their login: they log in as ECCS staff with this number and a one-time code. */
  phone: phoneField,
  role: z.enum(TEAM_ROLES, "Choose their role"),
  area: optionalText(60, "Keep the area under 60 characters"),
  joinedOn: dateSchema,
  weeklyOff: z.number().int().min(0).max(6).default(0),
};

/** Add a team member (the Super Admin). The salary is optional; it counts from the joining day. */
export const teamMemberSchema = z.object({ ...memberFields, monthlySalaryPaise: salaryField.nullable().optional() });
export type TeamMemberInput = z.input<typeof teamMemberSchema>;
export type TeamMemberValues = z.output<typeof teamMemberSchema>;

/**
 * Change a team member's details (the Super Admin); only what is sent changes. A new salary
 * takes effect from its day (`from`); a salary set again on the same day replaces it.
 */
export const teamChangeSchema = z.object({
  name: memberFields.name.optional(),
  phone: phoneField.optional(),
  role: memberFields.role.optional(),
  /** Sent empty to clear it; left out to keep it. */
  area: z.string().trim().max(60, "Keep the area under 60 characters").nullable().optional(),
  joinedOn: dateSchema.optional(),
  weeklyOff: z.number().int().min(0).max(6).optional(),
  salary: z.object({ monthlyPaise: salaryField, from: dateSchema }).optional(),
});
export type TeamChangeInput = z.input<typeof teamChangeSchema>;
export type TeamChangeValues = z.output<typeof teamChangeSchema>;

/** Mark as left: their last day, and who takes over their open leads (needed when they have any). */
export const markLeftSchema = z.object({ leftOn: dateSchema, handTo: z.uuid().nullable().optional() });
export type MarkLeftInput = z.input<typeof markLeftSchema>;

/** A day or a few days off, with an optional short reason. */
export const leaveSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    reason: optionalText(60, "Keep the reason under 60 characters"),
  })
  .refine((value) => value.from <= value.to, { path: ["to"], message: "The last day comes before the first" })
  .refine((value) => daysFrom(value.from, value.to) < TEAM_RULES.maxLeaveDays, { path: ["to"], message: `Record at most ${TEAM_RULES.maxLeaveDays} days at a time` });
export type LeaveInput = z.input<typeof leaveSchema>;
export type LeaveValues = z.output<typeof leaveSchema>;

export const teamSettingsSchema = z.object({
  onTimeTargetPercent: z.number("Enter the target").int("Enter a whole percent").min(1, "Enter 1 to 100").max(100, "Enter 1 to 100"),
});
export type TeamSettingsInput = z.input<typeof teamSettingsSchema>;

// ───────────────────────── What the API sends ─────────────────────────

export interface TeamLeaveDto {
  id: string;
  from: string;
  to: string;
  reason: string | null;
  isSample: boolean;
}

/** One of the three cards on a person's page. */
export interface TeamCardDto {
  key: string;
  label: string;
  /** "14", "71%", "—". */
  value: string;
  /** "target 15", "8 planned". */
  target: string | null;
  /** "last week 13". */
  lastWeek: string | null;
  /** Behind its pace for the week so far. */
  behind: boolean;
}

export interface TeamRowDto {
  userId: string;
  /** Empty for a login whose team details have not been added yet. */
  memberId: string | null;
  name: string;
  initials: string;
  role: TeamMemberRole;
  area: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  weeklyOff: number;
  isSample: boolean;
  today: { state: DayState; words: string; firstAt: string | null };
  /** This week's main figure against its target: "9 of 15 leads". Null for the Ops Manager. */
  week: { label: string; done: number; target: number } | null;
  /** The one thing to keep an eye on, if any. */
  flag: ConcernDto | null;
  /** The salary paid now; only the Super Admin is sent it. */
  monthlyPaise: number | null;
}

export interface TeamListDto {
  today: string;
  members: TeamRowDto[];
  /** People still on the team with something to keep an eye on (the menu's number). */
  flagged: number;
  onTimeTargetPercent: number;
  /** True while any sample team member is on the list. */
  sample: boolean;
}

/** A lead on "What the app found". */
export interface FoundLeadDto {
  leadId: string;
  businessName: string;
  stale: StaleDto;
}

/** A visit on a Supervisor's "What the app found": past its day and not done. */
export interface FoundVisitDto {
  visitId: string;
  outletName: string;
  serviceName: string;
  scheduledDate: string;
  daysLate: number;
}

export interface TeamMemberDto extends TeamRowDto {
  phone: string | null;
  presenceSource: PresenceSource;
  keep: { pick: ConcernDto | null; note: string };
  cards: TeamCardDto[];
  days: PresenceDayDto[];
  presenceLine: string;
  /** Leave from 30 days ago on, earliest first. */
  leave: TeamLeaveDto[];
  /** A BDE's stale leads worst first (the first few), and how many in all. */
  foundLeads: { items: FoundLeadDto[]; total: number } | null;
  /** A Supervisor's visits past their day and not done. */
  foundVisits: { items: FoundVisitDto[]; total: number } | null;
  /** "Message Imran": WhatsApp opened on a chat with them. A sample member's number is left out. */
  whatsappUrl: string;
  /** Leads they own that are not lost: these must be handed over before they leave or stop selling. */
  openLeads: number;
  /** Visits given to them from today on (a Supervisor), to give to someone else when they leave. */
  upcomingVisits: number;
  /** Who can take over their leads (the BDEs first). Only for the Super Admin. */
  handTo: { id: string; name: string; isBde: boolean }[];
  /** The salary and its history; only for the Super Admin. */
  salary: { monthlyPaise: number | null; history: SalaryStep[] } | null;
  /** Whether the person looking may record leave, and change details or mark as left. */
  canRecordLeave: boolean;
  canManage: boolean;
}
