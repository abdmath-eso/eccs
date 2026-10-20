import { z } from "zod";
import type { Action, Resource } from "./permissions.js";
import { daysFrom } from "./finance.js";
import { indiaDay } from "./food-labels.js";
import { clockWords, indiaClock, recentDay, salesRupees, shortDate } from "./sales.js";
import type { DaySheetDto } from "./day-sheet.js";
import { visitSlotWindow, type VisitSlot, type VisitStatus } from "./services.js";

// Today, the console's home (20 Oct 2026; docs/CONSOLE_PLAN.md section 4.1, the founder's
// design page 1). One page that answers "what needs me today": a one-line headline, today's
// visits and free checks in time order, "Needs you" (at most about six things, each with one
// button, gone once the work is done), "Also today" (worth knowing, no button) and, from
// 4 pm, the Evening close. Every line comes from records the apps already write; nothing is
// typed here. The rules, the thresholds and the words are in this file; the API gathers the
// facts (apps/api/src/today/) and the console draws them.
//
// Patterns: Jobber's Home (today's appointments in start-time order, and an admin to-do list
// with the urgent items first, each opening where the work is done), ServiceTitan's dispatch
// alerts (an alert clears when its cause is resolved, not when it is dismissed) and Linear's
// priority inbox (what needs you apart from what is only worth knowing).

/** Every number Today uses. Change one here and the server and the console follow. */
export const TODAY_RULES = {
  /** An app booking not placed after this many hours needs you. */
  bookingWaitHours: 4,
  /** A finished visit the restaurant has not signed off for this many whole days (India) or more. */
  signOffWaitDays: 2,
  /** A signed-off report ECCS has not approved for this many days or more. */
  reportWaitDays: 2,
  /** An issue nobody at ECCS has picked up for this many days or more. */
  issueWaitDays: 2,
  /** Visits with no Supervisor count from today to this many days ahead: today's and tomorrow's. */
  unassignedDaysAhead: 1,
  /** How many Needs you items show before "Show N more". */
  itemsShown: 6,
  /** From this time of day in India the Evening close shows in full; before it, it is one folded line. */
  closeOpensAt: "16:00",
  /** How many names a line lists before "and N more". */
  namesShown: 3,
} as const;

// ───────────────────────── Needs you ─────────────────────────

/**
 * The kinds of Needs you item, in one list (the plan's table in section 4.1), in the order they
 * rank: each with its entry in TODAY_ITEMS, its facts below and its gatherer in the API. Step 3 of
 * the console plan (20 Oct 2026) added FOLLOW_UP_DUE, PHOTO_FLAGGED and INCIDENT_OPEN (Quality).
 */
export const TODAY_ITEM_KINDS = [
  "VISIT_NO_SUPERVISOR",
  "INVOICE_OVERDUE_VISIT_TODAY",
  "BOOKING_WAITING",
  "ISSUE_NOT_PICKED_UP",
  "FOLLOW_UP_DUE",
  "REPORT_TO_APPROVE",
  "PHOTO_FLAGGED",
  "OUTLET_STUCK",
  "INCIDENT_OPEN",
  "SIGN_OFF_WAITING",
] as const;
export type TodayItemKind = (typeof TODAY_ITEM_KINDS)[number];

/**
 * Each kind's one button, and the grant the person needs to be shown it (the same check the
 * page the button opens makes). `mine`: a Supervisor sees it for their own visits and outlets;
 * otherwise it is for the office (the Super Admin and the Ops Manager) only.
 */
export const TODAY_ITEMS: Record<TodayItemKind, { button: string; needs: { resource: Resource; action: Action }; mine: boolean }> = {
  VISIT_NO_SUPERVISOR: { button: "Assign", needs: { resource: "jobs", action: "create" }, mine: false },
  INVOICE_OVERDUE_VISIT_TODAY: { button: "Open invoice", needs: { resource: "invoices", action: "update" }, mine: false },
  BOOKING_WAITING: { button: "Place", needs: { resource: "bookings", action: "update" }, mine: false },
  ISSUE_NOT_PICKED_UP: { button: "Open", needs: { resource: "issues", action: "update" }, mine: true },
  REPORT_TO_APPROVE: { button: "Approve", needs: { resource: "jobs", action: "create" }, mine: false },
  OUTLET_STUCK: { button: "Act", needs: { resource: "clients", action: "create" }, mine: false },
  SIGN_OFF_WAITING: { button: "Remind", needs: { resource: "jobs", action: "update" }, mine: true },
  // Quality's three (step 3): each opens Quality, which only the Super Admin and the Ops Manager have.
  FOLLOW_UP_DUE: { button: "Open", needs: { resource: "quality", action: "create" }, mine: false },
  PHOTO_FLAGGED: { button: "Review", needs: { resource: "quality", action: "update" }, mine: false },
  INCIDENT_OPEN: { button: "Open", needs: { resource: "quality", action: "update" }, mine: false },
};

/** Where an item's button (or a line's link) leads. The console turns it into an address. */
export type TodayTarget =
  | { kind: "WAITING" }
  | { kind: "VISIT"; visitId: string }
  | { kind: "VISITS" }
  | { kind: "WEEK" }
  | { kind: "INVOICE"; invoiceId: string }
  | { kind: "INVOICES" }
  | { kind: "ISSUE"; issueId: string }
  | { kind: "INSPECTION"; inspectionId: string }
  | { kind: "INSPECTIONS" }
  | { kind: "NEW_OUTLETS" }
  | { kind: "LEAD"; leadId: string }
  | { kind: "SALES" }
  | { kind: "TEAM_PERSON"; userId: string }
  | { kind: "TEAM" }
  | { kind: "FOLLOW_UP"; followUpId: string }
  | { kind: "QUALITY_PHOTOS" }
  | { kind: "INCIDENT"; incidentId: string };

/** The facts one item is made from, as the API reads them. Dates are India dates; moments are ISO. */
export type TodayItemFacts =
  | { kind: "BOOKING_WAITING"; bookingId: string; outletName: string; serviceName: string; preferredDate: string; preferredSlot: VisitSlot | null; requestedAt: string }
  | { kind: "VISIT_NO_SUPERVISOR"; visitId: string; outletName: string; serviceName: string; date: string; slot: VisitSlot | null }
  | { kind: "SIGN_OFF_WAITING"; visitId: string; outletName: string; serviceName: string; finishedOn: string; remindedAt: string | null }
  | { kind: "REPORT_TO_APPROVE"; visitId: string; outletName: string; serviceName: string; signedOffOn: string }
  | { kind: "INVOICE_OVERDUE_VISIT_TODAY"; invoiceId: string; outletName: string; duePaise: number; overdueDays: number; invoices: number; visitSlot: VisitSlot | null }
  | { kind: "ISSUE_NOT_PICKED_UP"; issueId: string; reference: string; outletName: string; category: string; raisedAt: string }
  | { kind: "OUTLET_STUCK"; outletId: string; outletName: string; hoursSinceAdded: number }
  /** An open follow-up with nothing booked: `reason` is its words in Quality ("... rated 2 stars"). */
  | { kind: "FOLLOW_UP_DUE"; followUpId: string; outletName: string; reason: string; causedAt: string }
  /** Every doubtful-photo item waiting in Quality > Photos, as one line. */
  | { kind: "PHOTO_FLAGGED"; items: number; outletNames: string[]; firstReason: string; firstWhat: string; oldestAt: string }
  | { kind: "INCIDENT_OPEN"; incidentId: string; reference: string; outletName: string; whatHappened: string; happenedOn: string };

export interface TodayItemDto {
  /** The kind and the record ("SIGN_OFF_WAITING:<visit id>"): the same item keeps its key from one load to the next. */
  key: string;
  kind: TodayItemKind;
  /** "Spice Route, Gachibowli: Tuesday's visit not signed off". */
  title: string;
  /** "Kitchen deep clean. Waiting 2 days." */
  detail: string;
  /** It has to be dealt with today (a visit today with no Supervisor, an overdue invoice to raise on today's visit). */
  dueToday: boolean;
  /** How long it has waited, in hours, for the order. */
  waitedHours: number;
  button: string;
  target: TodayTarget;
  /** A sign-off: when the restaurant was reminded today, if it was (ISO). The button is then replaced by "Reminded at 9:10 am". */
  remindedAt: string | null;
}

const HOUR_MS = 3_600_000;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const hoursBetween = (from: string, to: Date) => Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / HOUR_MS));

/** "9:10 am": a moment's time of day in India. */
export const indiaTimeWords = (at: Date | string) => clockWords(indiaClock(at));

/** "at 10 am", "after closing", or "" when the time is not set. */
function atSlot(slot: VisitSlot | null): string {
  if (!slot) return "";
  const window = visitSlotWindow(slot);
  return window ? `at ${clockWords(window.start)}` : "after closing";
}

/** "Tuesday's visit", "yesterday's visit", "the 12 Oct visit". */
function visitOf(day: string, today: string): string {
  const words = recentDay(day, today);
  if (words === "today" || words === "yesterday") return `${words}'s visit`;
  return /^\d/.test(words) ? `the ${words} visit` : `${words}'s visit`;
}

/** "5 hours", or "2 days" from two days on. */
const waitWords = (hours: number) => (hours < 48 ? plural(hours, "hour") : plural(Math.floor(hours / 24), "day"));

/** "Waiting 2 days." */
const waitingDays = (days: number) => `Waiting ${plural(days, "day")}.`;

/**
 * One Needs you item from its facts at `now`, or null while it has not waited long enough to
 * need anyone (the thresholds in TODAY_RULES). The words are the console's, in English.
 */
export function todayItem(facts: TodayItemFacts, now: Date): TodayItemDto | null {
  const today = indiaDay(now);
  const base = { kind: facts.kind, button: TODAY_ITEMS[facts.kind].button, dueToday: false, remindedAt: null };
  switch (facts.kind) {
    case "BOOKING_WAITING": {
      const hours = hoursBetween(facts.requestedAt, now);
      if (hours < TODAY_RULES.bookingWaitHours) return null;
      const asked = [shortDate(facts.preferredDate), atSlot(facts.preferredSlot)].filter(Boolean).join(" ");
      return {
        ...base,
        key: `${facts.kind}:${facts.bookingId}`,
        title: `${facts.outletName}: a booking waiting for a slot`,
        detail: `${facts.serviceName}, asked for ${asked}. Waiting ${waitWords(hours)}.`,
        waitedHours: hours,
        target: { kind: "WAITING" },
      };
    }
    case "VISIT_NO_SUPERVISOR": {
      const ahead = daysFrom(today, facts.date);
      if (ahead < 0 || ahead > TODAY_RULES.unassignedDaysAhead) return null;
      const when = ahead === 0 ? "today's" : "tomorrow's";
      return {
        ...base,
        key: `${facts.kind}:${facts.visitId}`,
        title: `${facts.outletName}: ${when} visit has no Supervisor`,
        detail: [facts.serviceName, atSlot(facts.slot)].filter(Boolean).join(" ") + ".",
        dueToday: ahead === 0,
        waitedHours: 0,
        target: { kind: "VISIT", visitId: facts.visitId },
      };
    }
    case "SIGN_OFF_WAITING": {
      const days = daysFrom(facts.finishedOn, today);
      if (days < TODAY_RULES.signOffWaitDays) return null;
      // Reminded today: the button gives way to the time it was done. A reminder on another day does not count.
      const remindedToday = facts.remindedAt && indiaDay(facts.remindedAt) === today ? facts.remindedAt : null;
      return {
        ...base,
        key: `${facts.kind}:${facts.visitId}`,
        title: `${facts.outletName}: ${visitOf(facts.finishedOn, today)} not signed off`,
        detail: `${facts.serviceName}. ${waitingDays(days)}`,
        waitedHours: days * 24,
        target: { kind: "VISIT", visitId: facts.visitId },
        remindedAt: remindedToday,
      };
    }
    case "REPORT_TO_APPROVE": {
      const days = daysFrom(facts.signedOffOn, today);
      if (days < TODAY_RULES.reportWaitDays) return null;
      return {
        ...base,
        key: `${facts.kind}:${facts.visitId}`,
        title: `${facts.outletName}: report to approve`,
        detail: `${facts.serviceName}, signed off ${recentDay(facts.signedOffOn, today)}. ${waitingDays(days)}`,
        waitedHours: days * 24,
        target: { kind: "VISIT", visitId: facts.visitId },
      };
    }
    case "INVOICE_OVERDUE_VISIT_TODAY": {
      if (facts.overdueDays <= 0 || facts.duePaise <= 0) return null;
      const when = atSlot(facts.visitSlot);
      const owed = facts.invoices > 1 ? `${salesRupees(facts.duePaise)} due on ${facts.invoices} invoices.` : `${salesRupees(facts.duePaise)} due.`;
      return {
        ...base,
        key: `${facts.kind}:${facts.invoiceId}`,
        title: `${facts.outletName}: invoice overdue, ${plural(facts.overdueDays, "day")}`,
        detail: `${owed} The crew is there today${when ? ` ${when}` : ""}; ask the manager.`,
        dueToday: true,
        waitedHours: facts.overdueDays * 24,
        target: { kind: "INVOICE", invoiceId: facts.invoiceId },
      };
    }
    case "ISSUE_NOT_PICKED_UP": {
      const days = daysFrom(indiaDay(facts.raisedAt), today);
      if (days < TODAY_RULES.issueWaitDays) return null;
      return {
        ...base,
        key: `${facts.kind}:${facts.issueId}`,
        title: `${facts.outletName}: issue ${facts.reference} not picked up`,
        detail: `${facts.category}. Open ${plural(days, "day")}.`,
        waitedHours: hoursBetween(facts.raisedAt, now),
        target: { kind: "ISSUE", issueId: facts.issueId },
      };
    }
    case "OUTLET_STUCK":
      return {
        ...base,
        key: `${facts.kind}:${facts.outletId}`,
        title: `${facts.outletName}: not live yet`,
        detail: `Added ${waitWords(facts.hoursSinceAdded)} ago and not using the app yet.`,
        waitedHours: facts.hoursSinceAdded,
        target: { kind: "NEW_OUTLETS" },
      };
    case "FOLLOW_UP_DUE":
      return {
        ...base,
        key: `${facts.kind}:${facts.followUpId}`,
        title: `${facts.outletName}: follow-up due`,
        detail: `${facts.reason}. Nothing booked yet.`,
        waitedHours: hoursBetween(facts.causedAt, now),
        target: { kind: "FOLLOW_UP", followUpId: facts.followUpId },
      };
    case "PHOTO_FLAGGED": {
      if (facts.items <= 0) return null;
      const where = namesWords(facts.outletNames);
      return {
        ...base,
        // One line for the whole queue: the same key while photos wait, whichever they are.
        key: facts.kind,
        title: `${plural(facts.items, "photo")} flagged for review`,
        detail: facts.items === 1 ? `${where}, ${facts.firstWhat}: ${facts.firstReason}.` : `${where}. The oldest: ${facts.firstWhat}, ${facts.firstReason}.`,
        waitedHours: hoursBetween(facts.oldestAt, now),
        target: { kind: "QUALITY_PHOTOS" },
      };
    }
    case "INCIDENT_OPEN": {
      const days = Math.max(0, daysFrom(facts.happenedOn, today));
      const happened = facts.whatHappened.length > 90 ? `${facts.whatHappened.slice(0, 89).trimEnd()}…` : facts.whatHappened;
      return {
        ...base,
        key: `${facts.kind}:${facts.incidentId}`,
        title: `${facts.outletName}: incident ${facts.reference} open`,
        detail: `${happened.replace(/[.s]+$/, "")}. ${days === 0 ? "Happened today." : `Open ${plural(days, "day")}.`}`,
        waitedHours: days * 24,
        target: { kind: "INCIDENT", incidentId: facts.incidentId },
      };
    }
  }
}

/**
 * Most urgent first: what has to be dealt with today (a visit today with no Supervisor, an
 * overdue invoice to raise on today's visit); then what waits on ECCS, in the order of
 * TODAY_ITEM_KINDS (tomorrow's visits with no Supervisor, bookings, issues, reports, new
 * outlets); then what waits on the restaurant (sign-offs). Within a kind, the longest waiting first.
 */
export function sortTodayItems<T extends Pick<TodayItemDto, "kind" | "dueToday" | "waitedHours" | "title">>(items: readonly T[]): T[] {
  const rank = (kind: TodayItemKind) => TODAY_ITEM_KINDS.indexOf(kind);
  return [...items].sort(
    (a, b) => Number(b.dueToday) - Number(a.dueToday) || rank(a.kind) - rank(b.kind) || b.waitedHours - a.waitedHours || a.title.localeCompare(b.title),
  );
}

/**
 * The page's one line: "5 visits, 2 free checks. 4 things need you." `checks` is null for
 * someone who does not see Sales' free checks (a Supervisor).
 */
export function todayHeadline(counts: { visits: number; checks: number | null; needsYou: number }): string {
  const checks = counts.checks ?? 0;
  const visits = counts.visits === 0 ? (checks > 0 ? "No visits" : "No visits today") : plural(counts.visits, "visit");
  const first = checks > 0 ? `${visits}, ${plural(checks, "free check")}` : visits;
  const needs = counts.needsYou === 0 ? "Nothing needs you." : `${counts.needsYou} ${counts.needsYou === 1 ? "thing needs" : "things need"} you.`;
  return `${first}. ${needs}`;
}

/**
 * "Spice Route, Gachibowli; Biryani House (2) and 2 more". Outlet names have commas in them,
 * so names are kept apart with semicolons; a name that comes twice is listed once, with its count.
 */
export function namesWords(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const all = [...counts].map(([name, count]) => (count > 1 ? `${name} (${count})` : name));
  const shown = all.slice(0, TODAY_RULES.namesShown);
  const more = all.length - shown.length;
  if (more > 0) return `${shown.join("; ")} and ${more} more`;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join("; ")} and ${shown[shown.length - 1]}`;
}

// ───────────────────────── Today's visits ─────────────────────────

/** The one badge a row may carry. WARNING is something to pass on at the visit ("Invoice overdue 9 days"). */
export type TodayBadge = { kind: "FREE_CHECK" | "PARTNER" | "WARNING"; label: string };

export interface TodayVisitDto {
  kind: "VISIT" | "FREE_CHECK";
  /** The visit's id, or the lead's for a free check. */
  id: string;
  /** "HH:mm" it starts, for the order and the left column; null after closing or with no time set. */
  time: string | null;
  /** A visit's arrival window; null for a free check. */
  slot: VisitSlot | null;
  /** The outlet, or the business for a free check. */
  outletName: string;
  area: string | null;
  /** The service, or "Free check". */
  serviceName: string;
  /** The visit's Supervisor, or who from ECCS goes to the free check; null when nobody is set. */
  supervisorName: string | null;
  /** Where the visit stands (as the Visits page says it); null for a free check. */
  status: VisitStatus | null;
  /** The outside firm that does its share of the work, when there is one. */
  partnerName: string | null;
  /** What the Supervisor wrote at the outlet's last visit, if anything. */
  lastNote: string | null;
  badge: TodayBadge | null;
}

/** One badge at most. A free check is a lead, so it has only its own; a visit shows a warning (something to act on) before a partner. */
export function visitBadge(facts: { freeCheck: boolean; partner: boolean; overdueDays: number | null }): TodayBadge | null {
  if (facts.freeCheck) return { kind: "FREE_CHECK", label: "Free check" };
  if (facts.overdueDays && facts.overdueDays > 0) return { kind: "WARNING", label: `Invoice overdue ${plural(facts.overdueDays, "day")}` };
  if (facts.partner) return { kind: "PARTNER", label: "Partner" };
  return null;
}

/** The "HH:mm" an arrival window starts at; null after closing. */
export const slotTime = (slot: VisitSlot | null) => (slot ? (visitSlotWindow(slot)?.start ?? null) : null);

/** Time order, with visits after closing (or with no time) last. */
export function sortTodayVisits<T extends Pick<TodayVisitDto, "time" | "outletName">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.outletName.localeCompare(b.outletName));
}

// ───────────────────────── Also today ─────────────────────────

/** A short line worth knowing, with a link and no button. */
export interface TodayNoteDto {
  key: string;
  /** "Invoices due today: 2". */
  title: string;
  /** "Biryani House ₹17,700 · Green Leaf Tiffins ₹7,080". */
  detail: string;
  target: TodayTarget;
}

// ───────────────────────── Evening close ─────────────────────────

/** The checklist at the end of the day (the plan's section 4.1, part 5), in its order. */
export const CLOSE_LINE_KEYS = ["VISITS_FINISHED", "REPORTS_IN", "SIGN_OFFS", "PAYMENTS", "TOMORROW_SUPERVISORS"] as const;
export type CloseLineKey = (typeof CLOSE_LINE_KEYS)[number];

export const CLOSE_LINE_LABELS: Record<CloseLineKey, string> = {
  VISITS_FINISHED: "Every visit finished, with before and after photos",
  REPORTS_IN: "Every report handed in",
  SIGN_OFFS: "Sign-offs still waiting",
  PAYMENTS: "Payments entered today",
  TOMORROW_SUPERVISORS: "Tomorrow's visits all have a Supervisor",
};

/**
 * DONE: ticked. OPEN: something is left, named, with a link. KNOWN: a line that cannot be
 * ticked, because the app cannot know it (whether all the money collected was entered); it
 * says what is known and is never shown as a problem.
 */
export type CloseLineState = "DONE" | "OPEN" | "KNOWN";

export interface CloseLineDto {
  key: CloseLineKey;
  label: string;
  state: CloseLineState;
  /** "3 of 5 finished · to finish: Spice Route and Hotel Blue Fox". */
  words: string;
  /** Where to see what is left (or what is known); null when there is nothing to see. */
  target: TodayTarget | null;
}

/** One visit of the day, for the close. */
export interface CloseVisitFacts {
  visitId: string;
  outletName: string;
  /** The Supervisor has finished it (a report sent back for correction still counts as finished work). */
  finished: boolean;
  hasBefore: boolean;
  hasAfter: boolean;
  /** Finished and waiting for the restaurant to sign it off. */
  awaitingSignOff: boolean;
}

export interface CloseFacts {
  /** Today's visits, not counting cancelled ones. */
  visits: readonly CloseVisitFacts[];
  /** Reports not handed in: today's inspections still being filled in, and visit reports sent back and not yet corrected. */
  reportsOut: readonly { outletName: string; what: "INSPECTION" | "RETURNED"; target: TodayTarget }[];
  /** Payments entered today; null when the person does not see invoices (a Supervisor). */
  payments: { count: number; totalPaise: number } | null;
  /** Tomorrow's visits still to do; null for a Supervisor (the office gives visits their Supervisor). */
  tomorrow: { total: number; withoutSupervisor: readonly { visitId: string; outletName: string }[] } | null;
}

const one = (rows: readonly { visitId: string }[], fallback: TodayTarget): TodayTarget =>
  rows.length === 1 ? { kind: "VISIT", visitId: rows[0]!.visitId } : fallback;

/** The Evening close's lines from the day's facts. A Supervisor's has only the lines about their own visits. */
export function eveningClose(facts: CloseFacts): CloseLineDto[] {
  const line = (key: CloseLineKey, state: CloseLineState, words: string, target: TodayTarget | null): CloseLineDto => ({
    key,
    label: CLOSE_LINE_LABELS[key],
    state,
    words,
    target,
  });
  const lines: CloseLineDto[] = [];

  // 1. Every visit finished, with before and after photos.
  const total = facts.visits.length;
  const toFinish = facts.visits.filter((visit) => !visit.finished);
  const noPhotos = facts.visits.filter((visit) => visit.finished && (!visit.hasBefore || !visit.hasAfter));
  if (total === 0) lines.push(line("VISITS_FINISHED", "DONE", "No visits today", null));
  else if (toFinish.length === 0 && noPhotos.length === 0) lines.push(line("VISITS_FINISHED", "DONE", `All ${total} finished, with photos`, null));
  else {
    const parts = [`${total - toFinish.length} of ${total} finished`];
    if (toFinish.length > 0) parts.push(`to finish: ${namesWords(toFinish.map((visit) => visit.outletName))}`);
    if (noPhotos.length > 0) parts.push(`photos missing: ${namesWords(noPhotos.map((visit) => visit.outletName))}`);
    lines.push(line("VISITS_FINISHED", "OPEN", parts.join(" · "), one([...toFinish, ...noPhotos], { kind: "VISITS" })));
  }

  // 2. Every report handed in.
  if (facts.reportsOut.length === 0) lines.push(line("REPORTS_IN", "DONE", "All handed in", null));
  else {
    const names = facts.reportsOut.map((report) => `${report.outletName} (${report.what === "INSPECTION" ? "inspection" : "sent back"})`);
    const allInspections = facts.reportsOut.every((report) => report.what === "INSPECTION");
    const target: TodayTarget = facts.reportsOut.length === 1 ? facts.reportsOut[0]!.target : { kind: allInspections ? "INSPECTIONS" : "VISITS" };
    lines.push(line("REPORTS_IN", "OPEN", `Not handed in: ${namesWords(names)}`, target));
  }

  // 3. Sign-offs still waiting, named: today's finished visits the restaurant has not signed off.
  const finished = facts.visits.filter((visit) => visit.finished);
  const waiting = facts.visits.filter((visit) => visit.awaitingSignOff);
  if (finished.length === 0) lines.push(line("SIGN_OFFS", "DONE", "None waiting", null));
  else if (waiting.length === 0) lines.push(line("SIGN_OFFS", "DONE", `All ${finished.length} signed off`, null));
  else {
    const words = `${finished.length - waiting.length} of ${finished.length} signed off · waiting: ${namesWords(waiting.map((visit) => visit.outletName))}`;
    lines.push(line("SIGN_OFFS", "OPEN", words, one(waiting, { kind: "VISITS" })));
  }

  // 4. Payments entered today: the app cannot know what was collected and not entered, so it says what it knows.
  if (facts.payments) {
    const words =
      facts.payments.count === 0
        ? "No payments entered today"
        : `${plural(facts.payments.count, "payment")} entered today, ${salesRupees(facts.payments.totalPaise)}`;
    lines.push(line("PAYMENTS", "KNOWN", words, { kind: "INVOICES" }));
  }

  // 5. Tomorrow's visits all have a Supervisor.
  if (facts.tomorrow) {
    const { total: planned, withoutSupervisor } = facts.tomorrow;
    if (planned === 0) lines.push(line("TOMORROW_SUPERVISORS", "DONE", "No visits tomorrow", null));
    else if (withoutSupervisor.length === 0) lines.push(line("TOMORROW_SUPERVISORS", "DONE", `All ${planned} have one`, null));
    else {
      const words = `${withoutSupervisor.length} of ${planned} without one: ${namesWords(withoutSupervisor.map((visit) => visit.outletName))}`;
      lines.push(line("TOMORROW_SUPERVISORS", "OPEN", words, one(withoutSupervisor, { kind: "WEEK" })));
    }
  }
  return lines;
}

/** "3 of 5 done": a line that says what is known counts as done, since there is nothing in it to chase. */
export function closeProgress(lines: readonly Pick<CloseLineDto, "state">[]): { done: number; total: number; open: number } {
  const open = lines.filter((entry) => entry.state === "OPEN").length;
  return { done: lines.length - open, total: lines.length, open };
}

/** The Evening close shows in full from 4 pm in India; before that it is one folded line. */
export const closeShownFully = (now: Date) => indiaClock(now) >= TODAY_RULES.closeOpensAt;

/** Close the day: the day being closed, so a page left open past midnight cannot close the next one. */
export const closeDaySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the day as YYYY-MM-DD") });
export type CloseDayInput = z.input<typeof closeDaySchema>;

/** What Close the day recorded. */
export interface DayClosedDto {
  date: string;
  closedAt: string;
  closedByName: string;
  /** The lines still open when it was closed, as they read then. */
  openLines: { key: CloseLineKey; label: string; words: string }[];
}

export interface TodayCloseDto {
  /** From 4 pm in India; before, the console folds the close under one line. */
  shownFully: boolean;
  lines: CloseLineDto[];
  done: number;
  total: number;
  /** Set once the day is closed. */
  closed: DayClosedDto | null;
  /** The Super Admin and the Ops Manager close the day; a Supervisor sees their own lines only. */
  canClose: boolean;
}

/** "Closed at 6:42 pm by Abdul". */
export const closedWords = (closed: Pick<DayClosedDto, "closedAt" | "closedByName">) => `Closed at ${indiaTimeWords(closed.closedAt)} by ${closed.closedByName}`;

// ───────────────────────── What GET /today returns ─────────────────────────

export interface TodayDto {
  /** Today in India, YYYY-MM-DD, and the moment the page was worked out (ISO). */
  date: string;
  at: string;
  /** "office": the Super Admin and the Ops Manager, everything; "own": a Supervisor, their own visits and items. */
  scope: "office" | "own";
  headline: string;
  /** Today's visits and free checks, in time order. */
  visits: TodayVisitDto[];
  /** Today's booked visits against what the crew can take (the Visits week board's count); null for a Supervisor. */
  capacity: { booked: number; capacity: number; over: boolean } | null;
  /** Every item that needs the person, most urgent first; the console shows the first few. */
  needsYou: TodayItemDto[];
  alsoToday: TodayNoteDto[];
  close: TodayCloseDto;
  /**
   * The day's sheet for each Supervisor with visits today (console plan step 3), in the order of
   * their first visit: the office sees every Supervisor's, a Supervisor their own.
   */
  sheets: DaySheetDto[];
}

/** What Remind answers. */
export interface SignOffRemindedDto {
  visitId: string;
  remindedAt: string;
  /** How many people at the outlet were told. */
  told: number;
}
