// Sales and the CRM (the console's Sales page, 15 Oct 2026): ECCS's leads, the steps the
// BDEs log on them, quotes, and the figures the founders read every morning.
//
// A lead moves right through its stages on its own when a step is logged ("contacted"
// after a first call or visit, "quoted" when a quote is sent), and First job and On a
// plan come from the app itself once the lead is linked to the client it became. Do
// today, Stale and Likely to close are worked out from each lead's stage and what the
// owner did, never planned by hand.
//
// Everything in this file is plain rules and wording with no database in it, so the
// server and the console work a figure out the same way and every rule is tested on
// its own (sales.test.ts). Money is whole paise; dates are India dates (YYYY-MM-DD);
// moments are ISO strings; a week runs Monday to Sunday and a BDE works Monday to
// Saturday.
//
// PATTERN FOLLOWED (the founder's own design, docs/design/2026-10-15 Sales dashboard and
// Team member page): Pipedrive's pipeline, where a deal sits in one stage, every deal
// has a next activity, and a deal idle past a set number of days "rots" (turns red)
// until the next step is logged (support.pipedrive.com/article/the-rotting-feature);
// Zoho Books' quote "viewed" history (the date and time the customer opened it) and
// Pipedrive Smart Docs' open count on the deal; HubSpot-style lead scoring kept simple
// and explained (a few fit and behaviour signals with points, minus points for going
// quiet); a rep's day as a prioritised list, overdue first (Odoo, Teamgate); and quota
// pacing, where progress is read against how much of the week has gone.

import { z } from "zod";
import { calculateGst, ECCS_STATE_CODE } from "./billing.js";
import { addDays, daysFrom, whatsappReminderUrl } from "./finance.js";
import { normalizePhone } from "./auth.js";
import { indiaDay } from "./food-labels.js";
import type { Role, MembershipScope } from "./roles.js";
import { roleCan } from "./permissions.js";
import { BILLING_CYCLES, CYCLE_MONTHS, type BillingCycle } from "./subscriptions.js";
import { freeCheckSchema, freeCheckServices, type FreeCheckAnswer, type FreeCheckDto, type FreeCheckPoint } from "./free-check.js";

// ───────────────────────── Stages, sources, kinds of step ─────────────────────────

/**
 * Where a lead is, left to right. Keys are stored in the database: add new ones, never
 * rename (labels can change). A lead never moves left by itself.
 */
export const LEAD_STAGES = ["NEW", "CONTACTED", "CHECK_BOOKED", "CHECK_DONE", "QUOTED", "FIRST_JOB", "ON_PLAN"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  CHECK_BOOKED: "Check booked",
  CHECK_DONE: "Check done",
  QUOTED: "Quoted",
  FIRST_JOB: "First job",
  ON_PLAN: "On a plan",
};

/** The stages of a lead that has become a paying customer. */
export const WON_STAGES = ["FIRST_JOB", "ON_PLAN"] as const satisfies readonly LeadStage[];
export const isWonStage = (stage: LeadStage) => (WON_STAGES as readonly LeadStage[]).includes(stage);

export const stageRank = (stage: LeadStage) => LEAD_STAGES.indexOf(stage);

/** The later of two stages: a step can move a lead right, never left. */
export const moveForward = (current: LeadStage, target: LeadStage | null | undefined): LeadStage =>
  target && stageRank(target) > stageRank(current) ? target : current;

/**
 * OPEN: in the pipeline. PARKED: waiting until a date ("after Diwali"). LOST: it went
 * nowhere, with the reason. A parked or lost lead keeps its stage, so it comes back to
 * where it was.
 */
export const LEAD_STATUSES = ["OPEN", "PARKED", "LOST"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Where a lead came from (the design's "where this month's first jobs came from"). Stored keys. */
export const LEAD_SOURCES = ["FIELD_VISIT", "CHEF_REFERRAL", "PARTNER_REFERRAL", "DRIVE", "WHATSAPP_GROUP", "AGGREGATOR_HUB", "OTHER"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  FIELD_VISIT: "Field visit",
  CHEF_REFERRAL: "Chef referral",
  PARTNER_REFERRAL: "Partner referral",
  DRIVE: "Drive",
  WHATSAPP_GROUP: "WhatsApp group",
  AGGREGATOR_HUB: "Aggregator hub",
  OTHER: "Other",
};

/** How a count of each source reads: "11 field visits", "4 chef referrals". */
export const LEAD_SOURCE_COUNTED: Record<LeadSource, [one: string, many: string]> = {
  FIELD_VISIT: ["field visit", "field visits"],
  CHEF_REFERRAL: ["chef referral", "chef referrals"],
  PARTNER_REFERRAL: ["partner referral", "partner referrals"],
  DRIVE: ["drive", "drives"],
  WHATSAPP_GROUP: ["WhatsApp group", "WhatsApp group"],
  AGGREGATOR_HUB: ["aggregator hub", "aggregator hub"],
  OTHER: ["other", "other"],
};

/** The sources that come with a referrer's name. */
export const REFERRAL_SOURCES = ["CHEF_REFERRAL", "PARTNER_REFERRAL"] as const satisfies readonly LeadSource[];
export const isReferral = (source: LeadSource) => (REFERRAL_SOURCES as readonly LeadSource[]).includes(source);

/**
 * What can happen on a lead, as its timeline shows it. Stored keys: add, never rename.
 * WON and QUOTE_OPENED are the app's own (a client's first job or plan; the owner
 * opening the quote); the others are logged by a person.
 */
export const LEAD_ACTIVITY_KINDS = [
  "CREATED",
  "CALL",
  "VISIT",
  "NOTE",
  "CHECK_BOOKED",
  "CHECK_DONE",
  "ASKED",
  "QUOTE_SENT",
  "QUOTE_OPENED",
  "PARKED",
  "LOST",
  "REOPENED",
  "LINKED",
  "WON",
] as const;
export type LeadActivityKind = (typeof LEAD_ACTIVITY_KINDS)[number];

/** The steps a person logs on a lead (the "Log a step" choices). */
export const STEP_KINDS = ["CALL", "VISIT", "NOTE", "CHECK_BOOKED", "CHECK_DONE", "ASKED"] as const satisfies readonly LeadActivityKind[];
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_LABELS: Record<StepKind, string> = {
  CALL: "Call",
  VISIT: "Visit",
  NOTE: "Note",
  CHECK_BOOKED: "Free check booked",
  CHECK_DONE: "Free check done",
  ASKED: "Owner asked about price",
};

/** What the owner asked, which counts as a sign they mean to buy (Likely to close). Stored keys. */
export const ASK_SIGNALS = ["QUOTE", "MONTHLY_PRICE"] as const;
export type AskSignal = (typeof ASK_SIGNALS)[number];
export const ASK_SIGNAL_LABELS: Record<AskSignal, string> = {
  QUOTE: "Asked for a quote",
  MONTHLY_PRICE: "Asked about the monthly price",
};

/**
 * Which stage each step moves a lead to ("A lead moves right on its own when the BDE
 * logs the step"). A note moves nothing. Asking about the price means they talked, so
 * it counts as contact. First job and On a plan are never logged by hand: they come
 * from the app once the lead is linked to its client.
 */
export const STEP_STAGE: Record<StepKind | "QUOTE_SENT", LeadStage | null> = {
  CALL: "CONTACTED",
  VISIT: "CONTACTED",
  ASKED: "CONTACTED",
  NOTE: null,
  CHECK_BOOKED: "CHECK_BOOKED",
  CHECK_DONE: "CHECK_DONE",
  QUOTE_SENT: "QUOTED",
};

/** The kinds that count as someone working the lead, for "last activity" and staleness. The app's own events do not. */
export const PERSON_ACTIVITY_KINDS = [
  "CREATED",
  "CALL",
  "VISIT",
  "NOTE",
  "CHECK_BOOKED",
  "CHECK_DONE",
  "ASKED",
  "QUOTE_SENT",
  "PARKED",
  "LOST",
  "REOPENED",
  "LINKED",
] as const satisfies readonly LeadActivityKind[];
export const isPersonActivity = (kind: LeadActivityKind) => (PERSON_ACTIVITY_KINDS as readonly LeadActivityKind[]).includes(kind);

/** The roles that may own a lead: the BDEs, and the founders and Ops Manager when they sell themselves. */
export const SALES_OWNER_ROLES = ["BDE", "SUPER_ADMIN", "OPS_MANAGER"] as const satisfies readonly Role[];

export const SALES_RULES = {
  /** "Stale" (Pipedrive's "rotting"): no step logged for this many days. The founder's design says 5. */
  staleDays: 5,
  /** A quote the owner opened and nobody followed up for this many days is overdue. */
  quoteNoReplyDays: 2,
  /**
   * A quote sent this many days ago with nothing logged on the lead since, opened or not, is
   * overdue too (the console plan, 20 Oct 2026: "No reply, 5 days" prompts a follow-up).
   */
  quoteFollowUpDays: 5,
  /** The call after a client's first job: "how is the app going, ask for a rating". */
  day10CallDays: 10,
  /** A client on a plan with more kitchens is pitched again once nothing has been logged for this long. */
  pitchEveryDays: 7,
  /** What a to-do with no time of its own says: done by the end of the working day. */
  dayEndLabel: "By 6 pm",
  /** Days of the last seven an owner used the app to count as "on the app daily". */
  dailyUseDays: 5,
  /** A BDE works Monday to Saturday; a week's target is read against how much of it has gone. */
  workingDaysPerWeek: 6,
  /**
   * How much of today's pipeline (open quotes and checks done, each at its win rate) is
   * expected to close within the next week. Claude's assumption for the forecast, to be
   * replaced by the real figure once there are a few months of history.
   */
  pipelineShareNextWeek: 0.5,
  /** Forecasts are rounded to ₹500. */
  forecastRoundPaise: 50_000,
  /** The lowest weekly targets until the Super Admin sets others. */
  defaultFloors: { leads: 10, checks: 3, firstJobs: 1, plans: 0 },
  /** Likely to close shows this many leads. */
  likelyShown: 3,
  /** The growth charts show at most this many weeks. */
  growthWeeksShown: 12,
  /** The most leads one list returns. */
  maxListed: 1000,
  /** A quote is valid for this many days after it is sent. */
  quoteValidDays: 15,
  maxQuoteLines: 12,
  /** One "quote opened" is recorded per quote in this many minutes at most. */
  openEveryMinutes: 30,
  /** The longest a lead can be parked. */
  parkMaxDays: 366,
} as const;

/** The points each "likely to close" signal adds (or takes away). Simple on purpose, and every one is shown in words. */
export const CLOSE_SIGNAL_POINTS = {
  alreadyPays: 20,
  askedQuote: 20,
  ownerDaily: 15,
  ownerThisWeek: 8,
  quoteOpenedOnce: 15,
  quoteOpenedAgain: 25,
  checkFindingsBase: 5,
  checkFindingsEach: 2,
  checkFindingsCountedUpTo: 5,
  nearPlanCustomer: 10,
  ratedFive: 15,
  ratedFour: 8,
  ratedLow: -15,
  sameDay: 5,
  askedMonthly: 20,
  severalKitchens: 10,
  quiet: -10,
} as const;

// ───────────────────────── Who reaches which leads ─────────────────────────

/**
 * Which leads a person reaches: every lead (the Super Admin and the Ops Manager), only
 * their own (a BDE), or none. The API checks it on every sales request.
 */
export function salesScope(memberships: readonly MembershipScope[]): { kind: "all" } | { kind: "own" } | null {
  const readers = memberships.filter((m) => roleCan(m.role, "sales", "read"));
  if (readers.some((m) => m.role === "SUPER_ADMIN" || m.role === "OPS_MANAGER")) return { kind: "all" };
  if (readers.some((m) => m.role === "BDE")) return { kind: "own" };
  return null;
}

// ───────────────────────── India time ─────────────────────────

const IST_OFFSET_MS = 330 * 60_000;
const shifted = (at: Date | string) => new Date(new Date(at).getTime() + IST_OFFSET_MS).toISOString();

// The India date of a moment ("2026-10-15") is `indiaDay` from food-labels.ts.
/** The India time of day of a moment: "16:00". */
export const indiaClock = (at: Date | string) => shifted(at).slice(11, 16);
/** The moment an India date and time of day stand for. */
export const indiaMoment = (date: string, time = "00:00") => new Date(`${date}T${time}:00.000+05:30`);

/** The Monday of the week a date is in. */
export function weekStartOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // Sunday is 0
  return addDays(date, -((weekday + 6) % 7));
}

/** Which week this is, counting the week of `start` as week 1. */
export const weekNumber = (start: string, date: string) => Math.floor(daysFrom(weekStartOf(start), weekStartOf(date)) / 7) + 1;

/** Working days (Monday to Saturday) of the week gone by the end of `date`: 1 on a Monday, 6 on Saturday and Sunday. */
export function workingDaysGone(date: string): number {
  return Math.min(SALES_RULES.workingDaysPerWeek, daysFrom(weekStartOf(date), date) + 1);
}

/** The day the growth forecast lands on: 31 December, or next year's once this year has under a week left. */
export function forecastEnd(today: string): string {
  const year = Number(today.slice(0, 4));
  const end = `${year}-12-31`;
  return daysFrom(today, end) < 7 ? `${year + 1}-12-31` : end;
}

// ───────────────────────── Words ─────────────────────────

const rupeesFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
/** "₹8,500". */
export const salesRupees = (paise: number) => rupeesFormat.format(paise / 100);

const dateWords = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));

/** "22 Nov". */
export const shortDate = (date: string) => dateWords(date, { day: "numeric", month: "short" });

/** "Tuesday" for a day in the last six, else "22 Nov". */
export const recentDay = (date: string, today: string) => {
  const ago = daysFrom(date, today);
  if (ago === 0) return "today";
  if (ago === 1) return "yesterday";
  return ago > 0 && ago < 7 ? dateWords(date, { weekday: "long" }) : shortDate(date);
};

/** "once", "twice", "3 times". */
export const timesWord = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "16:00" as "4 pm", "10:30" as "10:30 am". */
export function clockWords(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "pm" : "am";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0 ? `${hour} ${suffix}` : `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

// ───────────────────────── What the rules read about a lead ─────────────────────────

/** Everything the rules below read about one lead, gathered by the server. */
export interface LeadFacts {
  id: string;
  name: string;
  ownerId: string;
  stage: LeadStage;
  status: LeadStatus;
  kitchens: number;
  area: string | null;
  hasPhone: boolean;
  createdAt: string;
  /** The last step a person logged (the app's own events do not count). */
  lastActivityAt: string;
  nextAction: string | null;
  nextActionAt: string | null;
  parkedAt: string | null;
  /** The India date it is parked until. */
  parkedUntil: string | null;
  parkedReason: string | null;
  /** A free check booked and not yet done. */
  checkAt: string | null;
  checkWith: string | null;
  checkDoneAt: string | null;
  checkFindings: number | null;
  /** When it became a paying customer (its first job, or a plan straight away). */
  wonAt: string | null;
  planAt: string | null;
  /** The last call or visit logged. */
  lastContactAt: string | null;
  /** The latest quote sent. `outcome` is what came of it, once won or declined (20 Oct 2026). */
  quote: { totalPaise: number; sentAt: string; openCount: number; firstOpenedAt: string | null; lastOpenedAt: string | null; hasPlan: boolean; outcome?: QuoteOutcome | null } | null;
  askedQuote: boolean;
  askedMonthlyPrice: boolean;
  /** The first job, once there is one: how the restaurant rated it and whether they signed off the day it was done. */
  firstJob: { rating: number | null; sameDay: boolean } | null;
  /** On a plan: how many kitchens and the plan's name. */
  onPlan: { kitchens: number; planName: string | null } | null;
  /** For a lead linked to a client already on the app: kitchens it pays for, and the days of the last seven its people used the app. */
  client: { alreadyPaysKitchens: number; ownerActiveDays: number } | null;
  /** The area of a plan customer in the same locality, when there is one. */
  nearPlanCustomer: string | null;
  /** The plan to offer after a first job. */
  suggestedPlan: string | null;
}

// ───────────────────────── Stale ("rotting") ─────────────────────────

export const STALE_REASONS = ["NURTURE_DATE_PASSED", "NEXT_ACTION_PASSED", "QUOTE_NO_CONTACT", "CHECK_NO_QUOTE", "NO_NEXT_STEP", "NO_ACTIVITY"] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

export interface StaleDto {
  reason: StaleReason;
  days: number;
  /** What last happened: "quote ₹8,500 sent 22 Nov", "said "after Diwali" on 28 Oct". */
  context: string;
  /** Why it is on the list: "no contact for 5 days". */
  words: string;
}

/**
 * A lead "goes stale" (the Team design's "What the app found") when it has had no step
 * logged for five days or its next-action date has passed; a parked lead when the date
 * it was parked until has passed. Lost leads and paying customers never do (Do today
 * looks after customers). It leaves the list on its own when the next step is logged.
 */
export function staleness(lead: LeadFacts, now: Date): StaleDto | null {
  const today = indiaDay(now);
  if (lead.status === "LOST") return null;
  if (lead.status === "PARKED") {
    if (!lead.parkedUntil || lead.parkedUntil >= today) return null;
    const days = daysFrom(lead.parkedUntil, today);
    const said = lead.parkedReason ? `said "${lead.parkedReason}"` : `parked until ${shortDate(lead.parkedUntil)}`;
    return {
      reason: "NURTURE_DATE_PASSED",
      days,
      context: `${said} on ${shortDate(indiaDay(lead.parkedAt ?? lead.lastActivityAt))}`,
      words: `nurture date passed ${plural(days, "day")} ago`,
    };
  }
  if (isWonStage(lead.stage)) return null;

  const idle = daysFrom(indiaDay(lead.lastActivityAt), today);
  const context = staleContext(lead);
  if (lead.nextActionAt && indiaDay(lead.nextActionAt) < today) {
    const days = daysFrom(indiaDay(lead.nextActionAt), today);
    return { reason: "NEXT_ACTION_PASSED", days, context, words: `next step was due ${plural(days, "day")} ago` };
  }
  if (idle < SALES_RULES.staleDays) return null;
  if (lead.stage === "QUOTED") return { reason: "QUOTE_NO_CONTACT", days: idle, context, words: `no contact for ${plural(idle, "day")}` };
  if (lead.stage === "CHECK_DONE") {
    const days = lead.checkDoneAt ? daysFrom(indiaDay(lead.checkDoneAt), today) : idle;
    return { reason: "CHECK_NO_QUOTE", days, context, words: `no quote sent, ${plural(days, "day")}` };
  }
  if (!lead.nextAction && !lead.nextActionAt && (lead.stage === "NEW" || lead.stage === "CONTACTED")) {
    return { reason: "NO_NEXT_STEP", days: idle, context, words: `no next step set, ${plural(idle, "day")}` };
  }
  return { reason: "NO_ACTIVITY", days: idle, context, words: `no activity for ${plural(idle, "day")}` };
}

/** What last happened on a lead, in a few words, for the stale list. */
function staleContext(lead: LeadFacts): string {
  const last = shortDate(indiaDay(lead.lastActivityAt));
  switch (lead.stage) {
    case "QUOTED":
      return lead.quote ? `quote ${salesRupees(lead.quote.totalPaise)} sent ${shortDate(indiaDay(lead.quote.sentAt))}` : `quoted ${last}`;
    case "CHECK_DONE":
      return `free check done ${shortDate(indiaDay(lead.checkDoneAt ?? lead.lastActivityAt))}`;
    case "CHECK_BOOKED":
      return lead.checkAt ? `free check booked for ${shortDate(indiaDay(lead.checkAt))}` : `free check booked ${last}`;
    case "CONTACTED":
      return `contacted ${last}`;
    default:
      return `logged ${shortDate(indiaDay(lead.createdAt))}`;
  }
}

// ───────────────────────── Do today ─────────────────────────

export const DO_TODAY_KINDS = [
  "PARKED_DUE",
  "NEXT_ACTION_OVERDUE",
  "QUOTE_NO_REPLY",
  // A quote sent five days ago that the owner has not opened, with nothing logged since (20 Oct 2026).
  "QUOTE_NOT_OPENED",
  "CHECK_TODAY",
  "QUOTE_NOT_SENT",
  "OFFER_PLAN",
  "DAY10_CALL",
  "PITCH_MORE",
  "NEXT_ACTION_TODAY",
] as const;
export type DoTodayKind = (typeof DO_TODAY_KINDS)[number];

/** The one button beside each to-do. "Call" opens the phone and logs the call. */
export const DO_TODAY_ACTIONS = ["CALL", "PARK_AGAIN", "SEND_QUOTE", "OPEN", "SEND_PLAN"] as const;
export type DoTodayAction = (typeof DO_TODAY_ACTIONS)[number];

export const DO_TODAY_ACTION_LABELS: Record<DoTodayAction, string> = {
  CALL: "Call",
  PARK_AGAIN: "Park again",
  SEND_QUOTE: "Send quote",
  OPEN: "Open",
  SEND_PLAN: "Send plan",
};

/**
 * The facts a to-do's line is made from (16 Oct 2026), so the BDE's phone can say it in
 * the BDE's own language; `line` is the console's English. Dates are India dates.
 */
export interface DoTodayParams {
  parkedOn?: string;
  until?: string;
  reason?: string | null;
  nextAction?: string | null;
  dueOn?: string;
  totalPaise?: number;
  sentOn?: string;
  opens?: number;
  checkWith?: string | null;
  doneOn?: string;
  plan?: string | null;
  more?: number;
  onPlan?: number;
  planName?: string | null;
}

export interface DoTodayItem {
  leadId: string;
  businessName: string;
  ownerId: string;
  /** OVERDUE: something should already have happened. TODAY: due today. */
  bucket: "OVERDUE" | "TODAY";
  kind: DoTodayKind;
  /** How many days overdue or waiting (OVERDUE only). */
  days: number | null;
  /** "16:00" for a to-do with its own time; null for "By 6 pm". */
  time: string | null;
  line: string;
  /** What the line says, as facts, for the phone to word in the BDE's language. */
  params: DoTodayParams;
  action: DoTodayAction;
  /** A second, lesser button (Park again beside Call). */
  secondAction: DoTodayAction | null;
}

/**
 * The day's to-dos, "set by the app from each lead's stage", at most one per lead (the
 * most pressing), overdue first (longest waiting first), then today's in time order
 * with those that have no time last.
 */
export function doToday(leads: readonly LeadFacts[], now: Date): DoTodayItem[] {
  const items = leads.map((lead) => doTodayFor(lead, now)).filter((item): item is DoTodayItem => item !== null);
  return items.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket === "OVERDUE" ? -1 : 1;
    if (a.bucket === "OVERDUE") return (b.days ?? 0) - (a.days ?? 0) || a.businessName.localeCompare(b.businessName);
    if (a.time !== b.time) return a.time === null ? 1 : b.time === null ? -1 : a.time.localeCompare(b.time);
    return a.businessName.localeCompare(b.businessName);
  });
}

/** The most pressing to-do for one lead, or none. The order of the checks below is the priority. */
export function doTodayFor(lead: LeadFacts, now: Date): DoTodayItem | null {
  const today = indiaDay(now);
  const base = { leadId: lead.id, businessName: lead.name, ownerId: lead.ownerId, secondAction: null };
  const call: DoTodayAction = lead.hasPhone ? "CALL" : "OPEN";
  if (lead.status === "LOST") return null;

  // A parked lead only comes back when its date has passed.
  if (lead.status === "PARKED") {
    if (!lead.parkedUntil || lead.parkedUntil >= today) return null;
    const parkedDay = indiaDay(lead.parkedAt ?? lead.lastActivityAt);
    const parkedOn = shortDate(parkedDay);
    return {
      ...base,
      bucket: "OVERDUE",
      kind: "PARKED_DUE",
      days: daysFrom(lead.parkedUntil, today),
      time: null,
      line: lead.parkedReason ? `Parked on ${parkedOn}, "${lead.parkedReason}". Date passed.` : `Parked on ${parkedOn} until ${shortDate(lead.parkedUntil)}. Date passed.`,
      params: { parkedOn: parkedDay, until: lead.parkedUntil, reason: lead.parkedReason },
      action: call,
      secondAction: "PARK_AGAIN",
    };
  }

  const nextDay = lead.nextActionAt ? indiaDay(lead.nextActionAt) : null;
  const nextToday = nextDay === today;
  const ownTime = nextToday && lead.nextActionAt ? indiaClock(lead.nextActionAt) : null;

  if (nextDay && nextDay < today) {
    const days = daysFrom(nextDay, today);
    return {
      ...base,
      bucket: "OVERDUE",
      kind: "NEXT_ACTION_OVERDUE",
      days,
      time: null,
      line: `${lead.nextAction ? `${lead.nextAction}. ` : ""}Was due ${recentDay(nextDay, today)}.`,
      params: { nextAction: lead.nextAction, dueOn: nextDay },
      action: call,
    };
  }

  // The owner opened the quote and nobody has been in touch since; or it went five days ago,
  // opened or not, with nothing logged since (quoteFollowUp).
  const followUp = lead.stage === "QUOTED" && lead.quote ? quoteFollowUp(lead.quote, lead.lastActivityAt, today) : null;
  if (followUp && lead.quote) {
    const sent = `Quote ${salesRupees(lead.quote.totalPaise)} sent ${shortDate(indiaDay(lead.quote.sentAt))}.`;
    return {
      ...base,
      bucket: "OVERDUE",
      kind: followUp.opened ? "QUOTE_NO_REPLY" : "QUOTE_NOT_OPENED",
      days: followUp.days,
      time: null,
      line: followUp.opened ? `${sent} Owner opened it ${timesWord(lead.quote.openCount)}, no reply.` : `${sent} Not opened yet, no reply.`,
      params: { totalPaise: lead.quote.totalPaise, sentOn: indiaDay(lead.quote.sentAt), opens: lead.quote.openCount },
      action: call,
    };
  }

  if (lead.checkAt && indiaDay(lead.checkAt) === today) {
    return {
      ...base,
      bucket: "TODAY",
      kind: "CHECK_TODAY",
      days: null,
      time: indiaClock(lead.checkAt),
      line: `Free check${lead.checkWith ? ` with ${lead.checkWith}` : ""}. Scorecard on the phone.`,
      params: { checkWith: lead.checkWith },
      action: "OPEN",
    };
  }

  if (lead.stage === "CHECK_DONE" && !lead.quote) {
    return {
      ...base,
      bucket: "TODAY",
      kind: "QUOTE_NOT_SENT",
      days: null,
      time: ownTime,
      line: `Free check done ${shortDate(indiaDay(lead.checkDoneAt ?? lead.lastActivityAt))}; quote not sent yet. Send it.`,
      params: { doneOn: indiaDay(lead.checkDoneAt ?? lead.lastActivityAt) },
      action: "SEND_QUOTE",
    };
  }

  if (lead.stage === "FIRST_JOB" && lead.wonAt && lead.firstJob) {
    const planOffered = lead.quote?.hasPlan === true && lead.quote.sentAt >= lead.wonAt;
    if (!planOffered) {
      const plan = lead.suggestedPlan ? `the ${lead.suggestedPlan} plan` : "a plan";
      return {
        ...base,
        bucket: "TODAY",
        kind: "OFFER_PLAN",
        days: null,
        time: ownTime,
        line: `First job done ${recentDay(indiaDay(lead.wonAt), today)}, signed off. Offer ${plan}.`,
        params: { doneOn: indiaDay(lead.wonAt), plan: lead.suggestedPlan },
        action: "SEND_PLAN",
      };
    }
  }

  if (isWonStage(lead.stage) && lead.wonAt) {
    const callDay = addDays(indiaDay(lead.wonAt), SALES_RULES.day10CallDays);
    const called = lead.lastContactAt !== null && indiaDay(lead.lastContactAt) >= callDay;
    if (callDay <= today && !called) {
      return { ...base, bucket: "TODAY", kind: "DAY10_CALL", days: null, time: ownTime, line: "Day-10 call: how is the app going, ask for a rating.", params: {}, action: call };
    }
  }

  if (lead.stage === "ON_PLAN" && lead.onPlan && lead.kitchens > lead.onPlan.kitchens) {
    const quiet = daysFrom(indiaDay(lead.lastActivityAt), today) >= SALES_RULES.pitchEveryDays;
    if (quiet || nextToday) {
      const more = lead.kitchens - lead.onPlan.kitchens;
      const plan = lead.onPlan.planName ? ` on ${lead.onPlan.planName}` : " on a plan";
      return {
        ...base,
        bucket: "TODAY",
        kind: "PITCH_MORE",
        days: null,
        time: ownTime,
        line: `Pitch ${more === 1 ? "one more kitchen" : `${numberWord(more)} more kitchens`}; they have ${lead.onPlan.kitchens}${plan} already.`,
        params: { more, onPlan: lead.onPlan.kitchens, planName: lead.onPlan.planName },
        action: "OPEN",
      };
    }
  }

  if (nextToday) {
    return { ...base, bucket: "TODAY", kind: "NEXT_ACTION_TODAY", days: null, time: ownTime, line: lead.nextAction ?? "Next step due today.", params: { nextAction: lead.nextAction }, action: call };
  }
  return null;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (count: number) => NUMBER_WORDS[count] ?? String(count);

// ───────────────────────── Likely to close ─────────────────────────

export interface CloseSignal {
  key: keyof typeof CLOSE_SIGNAL_POINTS | "quoteOpened" | "checkFindings" | "rated" | "ownerOnApp";
  points: number;
  words: string;
}

/** What closing would mean: the first job, a plan after the first job, or more kitchens for a client on a plan. */
export type CloseKind = "FIRST_JOB" | "PLAN" | "MORE_KITCHENS";

export interface CloseScore {
  kind: CloseKind;
  score: number;
  /** Every signal, the strongest first; the page shows the positive ones in words. */
  signals: CloseSignal[];
}

/**
 * "Likely to close, from signals, not opinions": a simple score from what the owner did
 * and who they are (the owner opened the quote, used the app, rated a job, asked about
 * price; the free check found things to fix; they run several kitchens or sit near a
 * plan customer), less points for going quiet. Null for a lead with nothing left to
 * close (lost, parked, or on a plan for every kitchen).
 */
export function closeScore(lead: LeadFacts, now: Date): CloseScore | null {
  if (lead.status !== "OPEN") return null;
  let kind: CloseKind = "FIRST_JOB";
  if (lead.stage === "FIRST_JOB") kind = "PLAN";
  if (lead.stage === "ON_PLAN") {
    if (!lead.onPlan || lead.kitchens <= lead.onPlan.kitchens) return null;
    kind = "MORE_KITCHENS";
  }
  const p = CLOSE_SIGNAL_POINTS;
  const signals: CloseSignal[] = [];
  const add = (key: CloseSignal["key"], points: number, words: string) => signals.push({ key, points, words });

  const pays = lead.client?.alreadyPaysKitchens ?? 0;
  if (pays > 0) add("alreadyPays", p.alreadyPays, `already pays for ${pays}`);
  if (lead.askedQuote) add("askedQuote", p.askedQuote, "asked for the quote");
  const activeDays = lead.client?.ownerActiveDays ?? 0;
  if (activeDays >= SALES_RULES.dailyUseDays) add("ownerOnApp", p.ownerDaily, "owner on the app daily");
  else if (activeDays > 0) add("ownerOnApp", p.ownerThisWeek, "owner on the app this week");
  if (lead.quote && lead.quote.openCount > 0) {
    add("quoteOpened", lead.quote.openCount > 1 ? p.quoteOpenedAgain : p.quoteOpenedOnce, lead.quote.openCount > 1 ? `quote opened ${timesWord(lead.quote.openCount)}` : "quote opened");
  }
  if (lead.checkFindings && lead.checkFindings > 0) {
    const counted = Math.min(lead.checkFindings, p.checkFindingsCountedUpTo);
    add("checkFindings", p.checkFindingsBase + p.checkFindingsEach * counted, `check found ${plural(lead.checkFindings, "thing")} to fix`);
  }
  if (lead.nearPlanCustomer) add("nearPlanCustomer", p.nearPlanCustomer, `near a plan customer in ${lead.nearPlanCustomer}`);
  if (lead.firstJob?.rating) {
    const rating = lead.firstJob.rating;
    if (rating >= 5) add("rated", p.ratedFive, "first job rated 5");
    else if (rating === 4) add("rated", p.ratedFour, "first job rated 4");
    else if (rating <= 2) add("rated", p.ratedLow, `first job rated ${rating}`);
  }
  if (lead.firstJob?.sameDay) add("sameDay", p.sameDay, "signed off same day");
  if (lead.askedMonthlyPrice) add("askedMonthly", p.askedMonthly, "asked about monthly price");
  if (lead.kitchens > 1 && pays === 0) add("severalKitchens", p.severalKitchens, `runs ${lead.kitchens} kitchens`);
  const idle = daysFrom(indiaDay(lead.lastActivityAt), indiaDay(now));
  if (idle >= SALES_RULES.staleDays) add("quiet", p.quiet, `no contact for ${plural(idle, "day")}`);

  // Strongest first; equal ones keep the order above.
  const ordered = signals.map((signal, index) => ({ signal, index })).sort((a, b) => b.signal.points - a.signal.points || a.index - b.index);
  return { kind, score: signals.reduce((total, signal) => total + signal.points, 0), signals: ordered.map((entry) => entry.signal) };
}

/** The title a likely lead is shown under: "Green Leaf Tiffins, plan", "Hyderabad Kitchen Co, 2 more kitchens". */
export function closeTitle(lead: Pick<LeadFacts, "name" | "kitchens" | "onPlan">, kind: CloseKind): string {
  if (kind === "PLAN") return `${lead.name}, plan`;
  if (kind === "MORE_KITCHENS") return `${lead.name}, ${Math.max(1, lead.kitchens - (lead.onPlan?.kitchens ?? 0))} more kitchens`;
  return lead.name;
}

/** The positive signals in words, the first with a capital: "Quote opened twice · check found 4 things to fix". */
export function closeWords(score: CloseScore, most = 3): string[] {
  const words = score.signals.filter((signal) => signal.points > 0).slice(0, most).map((signal) => signal.words);
  return words.map((text, index) => (index === 0 ? text[0]!.toUpperCase() + text.slice(1) : text));
}

/** The leads most likely to close, best first (ties: the most recently worked). Only leads with a positive score. */
export function likelyToClose(leads: readonly LeadFacts[], now: Date, most: number = SALES_RULES.likelyShown) {
  return leads
    .map((lead) => ({ lead, score: closeScore(lead, now) }))
    .filter((entry): entry is { lead: LeadFacts; score: CloseScore } => entry.score !== null && entry.score.score > 0)
    .sort((a, b) => b.score.score - a.score.score || b.lead.lastActivityAt.localeCompare(a.lead.lastActivityAt))
    .slice(0, most);
}

// ───────────────────────── Weekly targets ─────────────────────────

export const TARGET_FIGURES = ["leads", "checks", "firstJobs", "plans"] as const;
export type TargetFigure = (typeof TARGET_FIGURES)[number];
export type TargetFigures = Record<TargetFigure, number>;

export const TARGET_LABELS: Record<TargetFigure, [one: string, many: string]> = {
  leads: ["lead", "leads"],
  checks: ["check", "checks"],
  firstJobs: ["job", "jobs"],
  plans: ["plan", "plans"],
};

export const emptyFigures = (): TargetFigures => ({ leads: 0, checks: 0, firstJobs: 0, plans: 0 });

/**
 * A week's target for one figure, set every Monday from the last two weeks: their
 * average, rounded up, never below the floor (Claude's suggestion for the design's
 * "targets reset every Monday from the last two weeks").
 */
export const suggestedTarget = (lastWeek: number, weekBefore: number, floor: number) => Math.max(floor, Math.ceil((lastWeek + weekBefore) / 2));

/** All four targets, with any the Super Admin set by hand for the week taking the place of the suggestion. */
export function weeklyTargets(
  lastWeek: TargetFigures,
  weekBefore: TargetFigures,
  floors: TargetFigures,
  overrides: Partial<Record<TargetFigure, number | null>> = {},
): TargetFigures {
  const targets = emptyFigures();
  for (const figure of TARGET_FIGURES) {
    const set = overrides[figure];
    targets[figure] = typeof set === "number" ? set : suggestedTarget(lastWeek[figure], weekBefore[figure], floors[figure]);
  }
  return targets;
}

/** How much of a weekly target should be done by the end of `date`: the target spread over the six working days, rounded up. */
export const expectedSoFar = (target: number, date: string) => Math.ceil((target * workingDaysGone(date)) / SALES_RULES.workingDaysPerWeek);

export type TargetStatus = "GREEN" | "AMBER" | "RED";

/**
 * Green when every target is on pace for the week so far; amber when one is behind; red
 * when two or more are (the design: "green means every target met; amber, one missed").
 */
export function targetStatus(actual: TargetFigures, targets: TargetFigures, date: string): { status: TargetStatus; missed: TargetFigure[] } {
  const missed = TARGET_FIGURES.filter((figure) => actual[figure] < expectedSoFar(targets[figure], date));
  return { status: missed.length === 0 ? "GREEN" : missed.length === 1 ? "AMBER" : "RED", missed };
}

// ───────────────────────── Conversion and forecasts ─────────────────────────

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * The three rates on the page, over every lead so far: free check to paid job (of the
 * leads whose check was done, the share that became paying customers), lead to
 * customer, and quote to win (of the leads sent a quote). Null with nothing to count.
 */
export function conversionRates(leads: readonly { won: boolean; checked: boolean; quoted: boolean }[]) {
  const checked = leads.filter((lead) => lead.checked);
  const quoted = leads.filter((lead) => lead.quoted);
  return {
    checkToPaid: percent(checked.filter((lead) => lead.won).length, checked.length),
    leadToCustomer: percent(leads.filter((lead) => lead.won).length, leads.length),
    quoteToWin: percent(quoted.filter((lead) => lead.won).length, quoted.length),
  };
}

/**
 * Where a running count lands on a later day at the last two weeks' pace: today's value
 * plus half of what it grew in the last two weeks, for every week ahead. Never below
 * today's value (a count of customers does not shrink by forecast).
 */
export function paceForecast(now: number, twoWeeksAgo: number, weeksAhead: number): number {
  const perWeek = (now - twoWeeksAgo) / 2;
  return Math.max(now, Math.round(now + perWeek * Math.max(0, weeksAhead)));
}

/**
 * Next week's sales before GST: half from the last two weeks' pace, half from today's
 * pipeline (open quotes at the quote-to-win rate, checks done at the check-to-paid rate
 * and the average sale), of which SALES_RULES.pipelineShareNextWeek is expected to
 * close in a week. Rounded to ₹500.
 */
export function nextWeekForecast(input: {
  lastWeekPaise: number;
  weekBeforePaise: number;
  openQuotesPaise: number;
  quoteToWinPercent: number | null;
  checksDone: number;
  checkToPaidPercent: number | null;
  averageSalePaise: number;
}): number {
  const pace = (input.lastWeekPaise + input.weekBeforePaise) / 2;
  const pipeline =
    input.openQuotesPaise * ((input.quoteToWinPercent ?? 0) / 100) + input.checksDone * ((input.checkToPaidPercent ?? 0) / 100) * input.averageSalePaise;
  const expected = (pace + pipeline * SALES_RULES.pipelineShareNextWeek) / 2;
  return Math.round(expected / SALES_RULES.forecastRoundPaise) * SALES_RULES.forecastRoundPaise;
}

/** A plan's price as a monthly amount. */
export const monthlyPaise = (pricePaise: number, cycle: BillingCycle) => Math.round(pricePaise / CYCLE_MONTHS[cycle]);

// ───────────────────────── Quotes ─────────────────────────

export const QUOTE_LINE_KINDS = ["SERVICE", "PLAN"] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

/** One line of a quote as it is kept: what it was, at the price it was quoted at. */
export interface QuoteLine {
  kind: QuoteLineKind;
  /** The catalogue item's or the plan's id. */
  refId: string;
  name: string;
  quantity: number;
  /** Before GST; for a plan, per billing cycle. */
  unitPaise: number;
  gstRatePercent: number;
  /** For a plan: how often it is billed. */
  cycle: BillingCycle | null;
  /** quantity × unit price, before GST. */
  amountPaise: number;
}

export const CYCLE_WORDS: Record<BillingCycle, string> = { MONTHLY: "a month", QUARTERLY: "a quarter", ANNUAL: "a year" };

/** A quote's subtotal, its GST (CGST and SGST within Telangana) and its total. */
export function quoteTotals(lines: readonly Pick<QuoteLine, "amountPaise" | "gstRatePercent">[]) {
  const gst = calculateGst(
    lines.map((line) => ({ taxablePaise: line.amountPaise, gstRatePercent: line.gstRatePercent })),
    ECCS_STATE_CODE,
  );
  return { subtotalPaise: gst.subtotalPaise, cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, gstPaise: gst.taxPaise, totalPaise: gst.totalPaise };
}

/** The message a quote goes with on WhatsApp, sent from the BDE's own phone. */
export function quoteMessage(input: { contactName: string | null; businessName: string; senderName: string; totalPaise: number; link: string; validUntil: string | null }): string {
  return [
    `Hello ${input.contactName ?? input.businessName}, this is ${input.senderName} from ECCS.`,
    `Here is our quote for ${input.businessName}: ${salesRupees(input.totalPaise)} with GST.`,
    input.link,
    input.validUntil ? `It is valid until ${shortDate(input.validUntil)}. Reply here with any question.` : "Reply here with any question.",
  ].join("\n");
}

/** The WhatsApp link with the quote's message typed in (the console opens it; the server sends nothing). */
export const quoteWhatsappUrl = (phone: string | null, text: string) => whatsappReminderUrl(phone, text);

/**
 * Link-preview robots (WhatsApp's own, Facebook's, Slack's and others) fetch a link the
 * moment it is pasted. Their visits are not the owner opening the quote, so they are not
 * counted: forwarded links and security scanners otherwise distort open counts.
 */
export const isLinkPreviewAgent = (userAgent: string | null | undefined) =>
  /whatsapp|facebookexternalhit|facebot|slackbot|twitterbot|telegrambot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|embedly|preview|crawler|spider|bot\b/i.test(userAgent ?? "");

// ───────────────────────── What came of a quote (20 Oct 2026) ─────────────────────────
//
// The console plan's Quotes tab (docs/CONSOLE_PLAN.md 4.9): every quote in one list with
// where it stands. A quote is a draft until sent; a sent one is won (the lead became a
// client with it, or someone marked it), declined (marked, with a reason) or, once the day
// it was valid until has gone, expired. Expired is worked out, never stored, so changing
// the validity never leaves a quote marked wrongly.

export const QUOTE_STATES = ["DRAFT", "SENT", "WON", "DECLINED", "EXPIRED"] as const;
export type QuoteState = (typeof QUOTE_STATES)[number];

export const QUOTE_STATE_LABELS: Record<QuoteState, string> = { DRAFT: "Draft", SENT: "Sent", WON: "Won", DECLINED: "Declined", EXPIRED: "Expired" };

/** What came of a sent quote, as stored (Quote.outcome). */
export const QUOTE_OUTCOMES = ["WON", "DECLINED"] as const;
export type QuoteOutcome = (typeof QUOTE_OUTCOMES)[number];
export const toQuoteOutcome = (value: string | null | undefined): QuoteOutcome | null => ((QUOTE_OUTCOMES as readonly string[]).includes(value ?? "") ? (value as QuoteOutcome) : null);

/**
 * Where a quote stands on an India date. Won stands even after the validity has gone (the
 * plan: expired is "validUntil passed and not won"); declined is a person's word, so it
 * stands too.
 */
export function quoteState(quote: { status: string; outcome: string | null; validUntil: string | null }, today: string): QuoteState {
  const outcome = toQuoteOutcome(quote.outcome);
  if (outcome === "WON") return "WON";
  if (quote.status !== "SENT") return "DRAFT";
  if (outcome === "DECLINED") return "DECLINED";
  if (quote.validUntil && quote.validUntil < today) return "EXPIRED";
  return "SENT";
}

/** Only a sent quote can be marked won or declined; a draft has not been offered yet. */
export const mayMarkQuote = (state: QuoteState) => state === "SENT" || state === "EXPIRED";

/**
 * Whether a sent quote waits for a follow-up, and for how many days: the owner opened it
 * and nobody has been in touch for two days since the first open (Do today's QUOTE_NO_REPLY,
 * 15 Oct 2026); or it went five days ago, opened or not, with no step logged on the lead
 * since (the console plan's "No reply, 5 days", 20 Oct 2026). A quote won or declined needs
 * none. Moments are ISO strings, which compare in time order.
 */
export function quoteFollowUp(
  quote: { sentAt: string; openCount: number; firstOpenedAt: string | null; outcome?: QuoteOutcome | null },
  lastActivityAt: string,
  today: string,
): { days: number; opened: boolean } | null {
  if (quote.outcome) return null;
  const opened = quote.firstOpenedAt !== null;
  if (quote.firstOpenedAt) {
    const sinceOpen = daysFrom(indiaDay(quote.firstOpenedAt), today);
    if (sinceOpen >= SALES_RULES.quoteNoReplyDays && lastActivityAt < quote.firstOpenedAt) return { days: sinceOpen, opened };
  }
  const sinceSent = daysFrom(indiaDay(quote.sentAt), today);
  if (sinceSent >= SALES_RULES.quoteFollowUpDays && lastActivityAt <= quote.sentAt) return { days: sinceSent, opened };
  return null;
}

/** The one button a row of the Quotes list has. */
export const QUOTE_ROW_ACTIONS = ["SEND", "REVISE", "OPEN"] as const;
export type QuoteRowAction = (typeof QUOTE_ROW_ACTIONS)[number];

/**
 * A draft is sent; the lead's latest quote is revised once it has expired or waits for a
 * reply; anything else is opened (the founder's design, p. 7: "No reply · 5 days → Revise",
 * "Sent today → Open", "Won → Open").
 */
export function quoteRowAction(state: QuoteState, facts: { latest: boolean; waiting: boolean }): QuoteRowAction {
  if (state === "DRAFT") return "SEND";
  if (facts.latest && (state === "EXPIRED" || (state === "SENT" && facts.waiting))) return "REVISE";
  return "OPEN";
}

/**
 * The services a quote starts with after a free check, as the phone's quote screen does:
 * for each kind of service the check found a need for (FREE_CHECK_FIXES), the first of
 * that kind among the options (quote-options lists them cheapest first), one of each.
 * Prices stay the catalogue's: only which lines are ticked comes from the check.
 */
export function freeCheckPicks(
  options: readonly Pick<QuoteOptionDto, "kind" | "refId" | "serviceCode">[],
  answers: readonly { point: FreeCheckPoint; answer: FreeCheckAnswer }[],
): { refId: string; quantity: number }[] {
  const picks: { refId: string; quantity: number }[] = [];
  for (const code of freeCheckServices(answers)) {
    const option = options.find((entry) => entry.kind === "SERVICE" && entry.serviceCode === code);
    if (option && !picks.some((pick) => pick.refId === option.refId)) picks.push({ refId: option.refId, quantity: 1 });
  }
  return picks;
}

// ───────────────────────── What the API accepts ─────────────────────────

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

const momentSchema = z.iso.datetime({ offset: true, message: "Enter the date and time" });
const dateSchema = z
  .string("Enter the date")
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist");

const optionalPhone = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value, context) => {
    if (!value) return null;
    const phone = normalizePhone(value);
    if (!phone) {
      context.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" });
      return z.NEVER;
    }
    return phone;
  });

const leadFields = {
  businessName: z.string("Enter the business name").trim().min(1, "Enter the business name").max(100, "Keep the name under 100 characters"),
  area: optionalText(60, "Keep the area under 60 characters"),
  address: optionalText(200, "Keep the address under 200 characters"),
  contactName: optionalText(80, "Keep the name under 80 characters"),
  contactPhone: optionalPhone,
  kitchens: z.number("Enter how many kitchens").int("Enter a whole number").min(1, "At least one kitchen").max(200, "Enter 200 or fewer"),
  source: z.enum(LEAD_SOURCES, "Choose where the lead came from"),
  referrerName: optionalText(80, "Keep the name under 80 characters"),
  /** The person who owns it. A BDE adding a lead always owns it, whatever is sent. */
  ownerId: z.uuid().optional().nullable(),
  nextAction: optionalText(80, "Keep the next step under 80 characters"),
  nextActionAt: momentSchema.optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  /** The photo of the shop board (B2): uploaded first through POST /sales/photos, kept with the lead. */
  photoId: z.uuid().optional().nullable(),
};

/**
 * A new lead. `id` is chosen by the app when the form opens, so sending it twice adds one
 * lead. `at` (B2) is when it was logged on the phone, so a lead logged without signal
 * counts on the day and in the week it was really logged.
 */
export const leadSchema = z
  .object({ id: z.uuid().optional(), at: momentSchema.optional(), ...leadFields, kitchens: leadFields.kitchens.default(1) })
  .superRefine((value, context) => {
    if (value.referrerName && !isReferral(value.source)) context.addIssue({ code: "custom", path: ["referrerName"], message: "Only a referral has a referrer" });
  });
export type LeadInput = z.input<typeof leadSchema>;
export type LeadValues = z.output<typeof leadSchema>;

/** A change to a lead's details or its next step. Only what is sent changes. */
export const leadUpdateSchema = z.object(leadFields).partial();
export type LeadUpdateInput = z.input<typeof leadUpdateSchema>;
export type LeadUpdateValues = z.output<typeof leadUpdateSchema>;

/**
 * A step logged on a lead. `at` is when it happened (now unless said; never in the
 * future), so a step logged later from the phone keeps its real time. A next step may
 * be set with it; one that was already due is cleared, since this step was it.
 */
export const stepSchema = z
  .object({
    id: z.uuid().optional(),
    kind: z.enum(STEP_KINDS, "Choose what happened"),
    at: momentSchema.optional(),
    note: optionalText(200, "Keep the note under 200 characters"),
    /** A free check booked: when, and who from ECCS goes. */
    checkAt: momentSchema.optional().nullable(),
    checkWith: optionalText(40, "Keep the name under 40 characters"),
    /** A free check done: how many things it found to fix. */
    findings: z.number().int("Enter a whole number").min(0, "Enter zero or more").max(99).optional().nullable(),
    signal: z.enum(ASK_SIGNALS).optional().nullable(),
    nextAction: optionalText(80, "Keep the next step under 80 characters"),
    nextActionAt: momentSchema.optional().nullable(),
    /**
     * A free check done with the scorecard on the phone (B2): every point's answer. The
     * number of things to fix is then counted from it, whatever `findings` says.
     */
    scorecard: freeCheckSchema.optional().nullable(),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
    if (value.kind === "NOTE" && !value.note) issue("note", "Write the note");
    if (value.kind === "CHECK_BOOKED" && !value.checkAt) issue("checkAt", "Enter when the free check is");
    if (value.kind === "CHECK_DONE" && (value.findings === null || value.findings === undefined) && !value.scorecard) issue("findings", "Enter how many things it found to fix");
    if (value.kind === "ASKED" && !value.signal) issue("signal", "Choose what the owner asked");
    if (value.scorecard && value.kind !== "CHECK_DONE") issue("scorecard", "A scorecard goes only with a free check done");
  });
export type StepInput = z.input<typeof stepSchema>;
export type StepValues = z.output<typeof stepSchema>;

/**
 * Park and Lost, like a step, may carry an `id` chosen on the phone and `at`, when it was
 * done (B2): a park or a loss sent again from the phone's outbox is then recorded once,
 * at the time it really happened.
 */
const replay = { id: z.uuid().optional(), at: momentSchema.optional() };

export const parkSchema = z.object({
  ...replay,
  until: dateSchema,
  reason: z.string("Say why in a few words").trim().min(1, "Say why in a few words").max(60, "Keep it under 60 characters"),
});
export type ParkInput = z.input<typeof parkSchema>;
export type ParkValues = z.output<typeof parkSchema>;

export const loseSchema = z.object({
  ...replay,
  reason: z.string("Say why").trim().min(1, "Say why").max(100, "Keep it under 100 characters"),
});
export type LoseInput = z.input<typeof loseSchema>;
export type LoseValues = z.output<typeof loseSchema>;

/** "Became a client": the client it became, or null to undo a wrong link. */
export const linkClientSchema = z.object({ organizationId: z.uuid().nullable() });
export type LinkClientInput = z.input<typeof linkClientSchema>;

export const quoteSchema = z.object({
  lines: z
    .array(
      z.object({
        kind: z.enum(QUOTE_LINE_KINDS),
        refId: z.uuid(),
        quantity: z.number().int("Enter a whole number").min(1, "At least one").max(200, "Enter 200 or fewer"),
      }),
    )
    .min(1, "Add at least one service or plan")
    .max(SALES_RULES.maxQuoteLines, `At most ${SALES_RULES.maxQuoteLines} lines`)
    .refine((lines) => new Set(lines.map((line) => `${line.kind}:${line.refId}`)).size === lines.length, "Each service or plan once"),
});
export type QuoteInput = z.input<typeof quoteSchema>;

/** "Declined": the owner said no, with why in a few words (20 Oct 2026). Marking it won needs nothing more. */
export const quoteDeclinedSchema = z.object({
  reason: z.string("Say why").trim().min(1, "Say why in a few words").max(100, "Keep it under 100 characters"),
});
export type QuoteDeclinedInput = z.input<typeof quoteDeclinedSchema>;

/** The Quotes list's filters: a state, or BUILD for the free checks done with no quote yet ("Build now"). */
export const QUOTE_LIST_FILTERS = [...QUOTE_STATES, "BUILD"] as const;
export type QuoteListFilter = (typeof QUOTE_LIST_FILTERS)[number];
export const quoteListQuerySchema = z.object({
  state: z.enum(QUOTE_LIST_FILTERS).optional(),
  owner: z.uuid().optional(),
});
export type QuoteListQuery = z.output<typeof quoteListQuerySchema>;

const figure =z.number().int("Enter a whole number").min(0, "Enter zero or more").max(500, "Enter 500 or fewer");

/** The Super Admin's own target for one BDE's week; null puts that figure back to the suggestion. */
export const targetSchema = z.object({
  weekStart: dateSchema.refine((value) => weekStartOf(value) === value, "A week starts on a Monday"),
  leads: figure.nullable().optional(),
  checks: figure.nullable().optional(),
  firstJobs: figure.nullable().optional(),
  plans: figure.nullable().optional(),
});
export type TargetInput = z.input<typeof targetSchema>;

/** The lowest each weekly target can go. */
export const targetFloorsSchema = z.object({ leads: figure, checks: figure, firstJobs: figure, plans: figure });
export type TargetFloorsInput = z.input<typeof targetFloorsSchema>;

/** The Leads list's filters. */
export const LEAD_LIST_STATES = ["open", "stale", "parked", "lost", "won", "all"] as const;
export type LeadListState = (typeof LEAD_LIST_STATES)[number];
export const leadListQuerySchema = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  owner: z.uuid().optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  state: z.enum(LEAD_LIST_STATES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type LeadListQuery = z.output<typeof leadListQuerySchema>;

export const salesOverviewQuerySchema = z.object({ owner: z.uuid().optional() });

// ───────────────────────── What the API sends ─────────────────────────

export interface SalesPersonDto {
  id: string;
  name: string;
  role: Role;
  isBde: boolean;
}

export interface LeadRowDto {
  id: string;
  businessName: string;
  area: string | null;
  stage: LeadStage;
  status: LeadStatus;
  source: LeadSource;
  kitchens: number;
  ownerId: string;
  ownerName: string;
  contactName: string | null;
  contactPhone: string | null;
  createdAt: string;
  lastActivityAt: string;
  nextAction: string | null;
  nextActionAt: string | null;
  parkedUntil: string | null;
  /** The latest quote sent: its total with GST and how often the owner opened it. */
  quote: { totalPaise: number; openCount: number } | null;
  stale: StaleDto | null;
  organization: { id: string; name: string } | null;
  isSample: boolean;
}

export interface LeadListDto {
  leads: LeadRowDto[];
  /** Every lead the filters match, when more than the list shows. */
  total: number;
  owners: SalesPersonDto[];
}

export interface LeadActivityDto {
  id: string;
  kind: LeadActivityKind;
  at: string;
  /** Who logged it; null for the app's own events. */
  byName: string | null;
  note: string | null;
  fromStage: LeadStage | null;
  toStage: LeadStage | null;
  checkAt: string | null;
  checkWith: string | null;
  findings: number | null;
  amountPaise: number | null;
  signal: AskSignal | null;
  rating: number | null;
  quoteNumber: string | null;
  /** A free check done with the phone's scorecard: every point's answer, with its photo. */
  scorecard: FreeCheckDto | null;
}

export interface QuoteDto {
  id: string;
  number: string;
  lines: QuoteLine[];
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
  status: "DRAFT" | "SENT";
  sentAt: string | null;
  validUntil: string | null;
  openCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  /** The public page's address. */
  link: string;
  isSample: boolean;
  /** Where it stands today (20 Oct 2026): draft, sent, won, declined or expired. */
  state: QuoteState;
  /** What came of it, when and why (a decline's reason); `outcomeBy` is who marked it, null when the app did (the lead became a client). */
  outcome: QuoteOutcome | null;
  outcomeAt: string | null;
  outcomeReason: string | null;
  outcomeBy: string | null;
  createdAt: string;
}

/** One row of the Quotes list (20 Oct 2026). */
export interface QuoteRowDto extends QuoteDto {
  leadId: string;
  businessName: string;
  area: string | null;
  kitchens: number;
  ownerId: string;
  ownerName: string;
  /** Every line is a plan billed this often: the total is "a month" (the design's "₹7,080 a month"). */
  perCycle: BillingCycle | null;
  /** The newest quote on its lead: only that one is revised. */
  latest: boolean;
  /** Days it has waited for a reply, when a follow-up is due ("No reply · 5 days"); null otherwise. */
  waitingDays: number | null;
  action: QuoteRowAction;
}

/** A free check done with no quote yet: "Build now". */
export interface QuoteBuildRowDto {
  leadId: string;
  businessName: string;
  area: string | null;
  ownerId: string;
  ownerName: string;
  checkDoneAt: string | null;
  checkFindings: number | null;
  isSample: boolean;
}

export interface QuoteListDto {
  today: string;
  /** Newest first: drafts and quotes sent, as the filters choose. */
  quotes: QuoteRowDto[];
  /** Free checks done with no quote yet, oldest check first. Empty unless the filter is BUILD or none. */
  buildNow: QuoteBuildRowDto[];
  /** How many of each there are for this person (and owner), whatever the state filter. */
  counts: Record<QuoteListFilter, number>;
  owners: SalesPersonDto[];
}

export interface LeadDetailDto extends LeadRowDto {
  /** The photo of the shop board taken when the lead was logged, with a link that lasts an hour. */
  photo: { id: string; path: string } | null;
  address: string | null;
  referrerName: string | null;
  latitude: number | null;
  longitude: number | null;
  checkAt: string | null;
  checkWith: string | null;
  checkDoneAt: string | null;
  checkFindings: number | null;
  parkedAt: string | null;
  parkedReason: string | null;
  lostAt: string | null;
  lostReason: string | null;
  wonAt: string | null;
  planAt: string | null;
  activities: LeadActivityDto[];
  quotes: QuoteDto[];
  /** Its "likely to close" score and the signals behind it; null when there is nothing to close. */
  close: { kind: CloseKind; score: number; signals: CloseSignal[] } | null;
  /** What Do today says about it, if anything. */
  toDo: DoTodayItemDto | null;
  /** Who may own it (for "Hand to"); empty for a BDE, who cannot hand a lead over. */
  owners: SalesPersonDto[];
}

export interface QuoteOptionDto {
  kind: QuoteLineKind;
  refId: string;
  name: string;
  unitPaise: number;
  gstRatePercent: number;
  cycle: BillingCycle | null;
  /** A service's kind (its catalogue code, e.g. "CHIMNEY"), so a free check's findings can be offered first; null for a plan. */
  serviceCode: string | null;
}

/** A photo filed for a lead (the shop board, or a free check's "Needs fixing"). */
export interface SalesPhotoDto {
  id: string;
  path: string;
}

/** A BDE's day on the phone (B2): their own Do today and this week against their targets. */
export interface BdeDayDto {
  today: string;
  items: DoTodayItemDto[];
  /** Null for someone who is not a BDE (a founder selling for themselves has no weekly targets). */
  week: BdeWeekDto | null;
}

export const shopBoardReadSchema = z.object({ photoId: z.uuid() });
export type ShopBoardReadInput = z.input<typeof shopBoardReadSchema>;

export interface QuoteSentDto {
  quote: QuoteDto;
  /** WhatsApp with the message and the link typed in. */
  whatsappUrl: string;
  hasPhone: boolean;
}

export interface DoTodayItemDto extends DoTodayItem {
  ownerName: string;
  /** For Call: the number dialled. */
  contactPhone: string | null;
  /** A sample lead: its number is made up and never dialled. */
  isSample: boolean;
}

export interface LikelyDto {
  leadId: string;
  title: string;
  kind: CloseKind;
  score: number;
  /** The signals in words, strongest first. */
  signals: string[];
  ownerName: string;
}

export interface BdeWeekDto {
  userId: string;
  name: string;
  actual: TargetFigures;
  targets: TargetFigures;
  /** The figures the Super Admin set by hand this week. */
  overridden: TargetFigure[];
  status: TargetStatus;
  missed: TargetFigure[];
  /** Last week's figures, for the Team page. */
  lastWeek: TargetFigures;
}

export interface GrowthWeekDto {
  label: string;
  start: string;
  end: string;
  payingKitchens: number;
  people: number;
  /** Sales won that week, before GST. */
  wonPaise: number;
  /** The week still running. */
  current: boolean;
}

export interface SalesOverviewDto {
  today: string;
  weekStart: string;
  weekNumber: number;
  /** True while any sample lead is in the books. */
  sample: boolean;
  /** The person the page is narrowed to; null for everyone. */
  owner: string | null;
  owners: SalesPersonDto[];
  headline: { firstJobs: number; plans: number; toDo: number };
  cards: {
    leads: { week: number; month: number; referrals: number; spark: number[] };
    won: { weekPaise: number; firstJobs: number; plans: number; monthPaise: number; spark: number[] };
    customers: { week: number; payingKitchens: number; people: number; spark: number[] };
    conversion: { checkToPaid: number | null; leadToCustomer: number | null; quoteToWin: number | null; spark: (number | null)[] };
  };
  stages: { counts: Record<LeadStage, number>; quotedPaise: number; open: number; parked: number; lostThisMonth: number };
  doToday: DoTodayItemDto[];
  likely: LikelyDto[];
  byBde: BdeWeekDto[];
  floors: TargetFigures;
  growth: {
    weeks: GrowthWeekDto[];
    forecastDate: string;
    forecast: { payingKitchens: number; people: number };
    nextWeekPaise: number;
    monthWonPaise: number;
    pipeline: { openQuotes: number; openQuotesPaise: number; checksDone: number };
    plans: { count: number; monthlyPaise: number; prices: number[] };
  };
  /** This month's first jobs by where the lead came from, most first. */
  sources: { source: LeadSource; count: number }[];
  firstJobsThisMonth: number;
}

/** The public quote page's content. */
export interface PublicQuoteDto {
  number: string;
  businessName: string;
  contactName: string | null;
  area: string | null;
  sentOn: string | null;
  validUntil: string | null;
  lines: { name: string; quantity: number; unitPaise: number; amountPaise: number; cycle: BillingCycle | null; gstRatePercent: number }[];
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
  preparedBy: string;
  supplier: { name: string; legalName: string; address: string; gstin: string; phone: string; isSample: boolean };
}

export const isBillingCycle = (value: unknown): value is BillingCycle => typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value);
