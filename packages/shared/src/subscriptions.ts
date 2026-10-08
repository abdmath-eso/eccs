// Plans and subscriptions: what ECCS sells on a cycle, and an outlet's subscription to one.
//
// A plan is a bundle of services, each repeated every so many days, for a price
// per billing cycle. An outlet subscribes to one plan at a time. The price and
// the cycle are copied onto the subscription when it starts and again each time
// it renews, so editing a plan never changes what a subscriber pays or gets in
// the middle of a cycle they have already been invoiced for.

import { z } from "zod";
import type { LocalizedText } from "./checklists.js";
import { gstOn } from "./billing.js";
import type { PlanServiceDto } from "./services.js";

// ───────────────────────── Cycles and their dates ─────────────────────────

export const BILLING_CYCLES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** How many months one cycle lasts. */
export const CYCLE_MONTHS: Record<BillingCycle, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

/**
 * A restaurant that subscribes by itself gets its first visits this many days
 * after subscribing, so ECCS has time to give them to a Supervisor.
 */
export const SUBSCRIPTION_FIRST_VISIT_LEAD_DAYS = 3;

/** GST on a plan's price. Every kind of service ECCS sells carries this rate (sample). */
export const SUBSCRIPTION_GST_RATE_PERCENT = 18;

export const PLAN_MAX_PRICE_RUPEES = 10_000_000;
export const PLAN_MAX_LINES = 12;
export const PLAN_MAX_INTERVAL_DAYS = 365;

const parts = (date: string) => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
};
const write = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** How many days a month has; `month` is 1 to 12. Knows leap years. */
export function daysInCycleMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A YYYY-MM-DD date moved by a number of days (negative goes back). */
export function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The same day of the month, a number of months later. When that month is too
 * short for the day (the 31st in a 30-day month, the 29th to 31st in
 * February), the month's last day is used instead.
 *
 * `anchorDay` is the day of the month the cycle is tied to. It matters after a
 * short month: a subscription that began on 31 January renews on 28 February
 * and then on 31 March again, not on the 28th for ever. Left out, the day of
 * `date` itself is used.
 */
export function addMonthsToDate(date: string, months: number, anchorDay?: number): string {
  const from = parts(date);
  const index = from.year * 12 + (from.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return write(year, month, Math.min(anchorDay ?? from.day, daysInCycleMonth(year, month)));
}

/**
 * The day of the month a subscription's cycles are tied to: the day it
 * started on, as long as the cycle now running still follows from it.
 * (A subscription that was paused past the end of a cycle starts a fresh cycle
 * on the day it is resumed; from then on that day is what counts.)
 */
export function cycleAnchorDay(startDate: string, periodStart: string): number {
  const anchor = parts(startDate).day;
  const now = parts(periodStart);
  return now.day === Math.min(anchor, daysInCycleMonth(now.year, now.month)) ? anchor : now.day;
}

export interface CyclePeriod {
  /** First day of the cycle. */
  start: string;
  /** Last day of the cycle: the day before the next one starts. */
  end: string;
  /** First day of the cycle after this one. This is also the day the next invoice is raised. */
  nextStart: string;
}

/**
 * One billing cycle beginning on `start`: it runs to the day before the same
 * day of the month one, three or twelve months later.
 */
export function cyclePeriod(start: string, cycle: BillingCycle, anchorDay?: number): CyclePeriod {
  const nextStart = addMonthsToDate(start, CYCLE_MONTHS[cycle], anchorDay);
  return { start, end: addDaysToDate(nextStart, -1), nextStart };
}

/**
 * The cycle that `asOf` falls in, for a subscription that began on
 * `startDate` and has renewed without a break since. Before the start date it
 * is the first cycle.
 */
export function cyclePeriodContaining(startDate: string, cycle: BillingCycle, asOf: string): CyclePeriod {
  const months = CYCLE_MONTHS[cycle];
  // Each cycle is counted from the start date itself, so a short month never shifts the later ones.
  let count = 0;
  while (addMonthsToDate(startDate, (count + 1) * months) <= asOf) count += 1;
  const start = addMonthsToDate(startDate, count * months);
  const nextStart = addMonthsToDate(startDate, (count + 1) * months);
  return { start, end: addDaysToDate(nextStart, -1), nextStart };
}

/** A price before GST with its GST and the total a restaurant pays, all in whole paise. */
export function subscriptionPrice(pricePaise: number, gstRatePercent: number = SUBSCRIPTION_GST_RATE_PERCENT) {
  const gstPaise = gstOn(pricePaise, gstRatePercent);
  return { pricePaise, gstPaise, totalPaise: pricePaise + gstPaise, gstRatePercent };
}

// ───────────────────────── What the console sends to manage plans ─────────────────────────

/** A number typed into a form box (which arrives as text) or sent as a number. An empty box is "nothing typed". */
const typedNumber = (rules: z.ZodNumber) =>
  z.preprocess((value) => (typeof value === "string" ? (value.trim() === "" ? undefined : Number(value)) : value), rules);

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist");

const planName = z.string().trim().min(2, "Enter the name of the plan").max(80);
const planDescription = z.string().trim().max(500);
const planPriceRupees = typedNumber(
  z
    .number({ error: "Enter the price in rupees, in figures" })
    .min(0, "The price cannot be less than zero")
    .max(PLAN_MAX_PRICE_RUPEES, `The price cannot be more than ₹${PLAN_MAX_PRICE_RUPEES.toLocaleString("en-IN")}`),
);

/** One service of a plan: which kind, and every how many days. */
export const planLineSchema = z.object({
  /** The kind of service, e.g. "PEST". */
  serviceCode: z.string().min(1, "Choose the kind of service"),
  intervalDays: typedNumber(
    z
      .number({ error: "Enter every how many days, in figures" })
      .int("Enter whole days")
      .min(1, "Enter at least 1 day")
      .max(PLAN_MAX_INTERVAL_DAYS, `Enter no more than ${PLAN_MAX_INTERVAL_DAYS} days`),
  ),
});

const planLines = z
  .array(planLineSchema)
  .min(1, "A plan needs at least one service")
  .max(PLAN_MAX_LINES, `A plan can have at most ${PLAN_MAX_LINES} services`)
  .refine(
    (lines) => new Set(lines.map((line) => line.serviceCode)).size === lines.length,
    "Each kind of service can be in a plan only once",
  );

/** A new plan. Written in English; it shows in English to everyone until translated. */
export const createPlanSchema = z.object({
  name: planName,
  description: planDescription.optional(),
  /** Per billing cycle, before GST. */
  priceRupees: planPriceRupees,
  billingCycle: z.enum(BILLING_CYCLES, "Choose how often it is billed"),
  lines: planLines,
});
export type CreatePlanInput = z.input<typeof createPlanSchema>;

/**
 * Changes a plan; only what is sent changes. Outlets already on the plan keep
 * the price and services of the cycle they are in; the change reaches each of
 * them when its next cycle starts.
 */
export const updatePlanSchema = z.object({
  name: planName.optional(),
  description: planDescription.optional(),
  priceRupees: planPriceRupees.optional(),
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  /** The whole list: a kind left out is removed from the plan. */
  lines: planLines.optional(),
  /** False stops offering it to new subscribers; true offers it again. */
  isActive: z.boolean().optional(),
});
export type UpdatePlanInput = z.input<typeof updatePlanSchema>;

// ───────────────────────── What is sent to manage a subscription ─────────────────────────

/**
 * Starts an outlet's subscription. A restaurant sends only the plan: it starts
 * today, and its first visits are a few days later. ECCS may choose both dates.
 */
export const startSubscriptionSchema = z.object({
  /** The plan's code, e.g. "ESSENTIAL". */
  planCode: z.string().min(1, "Choose a plan"),
  /** ECCS only. The first day of the first cycle. */
  startDate: dateSchema.optional(),
  /** ECCS only. The day every service of the plan is first due. */
  firstVisitDate: dateSchema.optional(),
});
export type StartSubscriptionInput = z.input<typeof startSubscriptionSchema>;

/** Asks for a different plan from the next cycle. */
export const changeSubscriptionPlanSchema = z.object({ planCode: z.string().min(1, "Choose a plan") });
export type ChangeSubscriptionPlanInput = z.input<typeof changeSubscriptionPlanSchema>;

/** PERIOD_END: stays as it is until the cycle ends, then is not renewed. NOW: ends today (ECCS only). */
export const cancelSubscriptionSchema = z.object({ when: z.enum(["PERIOD_END", "NOW"]) });
export type CancelSubscriptionInput = z.input<typeof cancelSubscriptionSchema>;

// ───────────────────────── What the server sends back ─────────────────────────

/** A price per cycle, as it is shown: before GST, the GST, and what is paid. */
export interface PlanPriceDto {
  /** Per billing cycle, before GST, in paise. */
  pricePaise: number;
  gstPaise: number;
  /** What the restaurant pays per cycle, GST included, in paise. */
  totalPaise: number;
  gstRatePercent: number;
  billingCycle: BillingCycle;
}

/** A plan as a restaurant sees it when choosing. */
export interface PlanOfferDto extends PlanPriceDto {
  code: string;
  name: LocalizedText;
  description: LocalizedText | null;
  services: PlanServiceDto[];
}

/** A plan as the office sees it, offered or not. */
export interface PlanAdminDto extends PlanOfferDto {
  id: string;
  /** Whether new subscribers can choose it. */
  isActive: boolean;
  /** Outlets on this plan now (active or paused). An edit reaches them at their next cycle. */
  subscriberCount: number;
  /** Outlets that have asked to move to this plan at their next cycle. */
  incomingCount: number;
  createdAt: string;
}

/** Everything on the console's Plans page. */
export interface PlansAdminDto {
  plans: PlanAdminDto[];
  /** The kinds of service a plan line can be for. */
  kinds: { code: string; name: LocalizedText; isActive: boolean }[];
}

export const SUBSCRIPTION_STATES = ["ACTIVE", "PAUSED"] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** An outlet's subscription that has not ended. */
export interface SubscriptionDto extends PlanPriceDto {
  id: string;
  /** PAUSED: ECCS has paused it; no new visits are added and it does not renew. */
  status: SubscriptionState;
  plan: { code: string; name: LocalizedText; description: LocalizedText | null };
  /**
   * What the outlet gets in this cycle, with the date of each service's next
   * visit (null when none is coming: paused, or after the plan ends).
   */
  services: (PlanServiceDto & { nextDate: string | null })[];
  /** YYYY-MM-DD the subscription first started. */
  startDate: string;
  /** The cycle now running (or, before the start date, the first one). */
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /**
   * What happens when this cycle ends, if it renews: the date of the next
   * invoice, the plan and the price from then on. Null when it will not renew
   * (it is ending, or it is paused).
   */
  renewal: (PlanPriceDto & {
    date: string;
    plan: { code: string; name: LocalizedText };
    /** True when the price, the cycle or the services will differ from this cycle's. */
    changes: boolean;
  }) | null;
  /** Set when a different plan has been asked for from the next cycle. */
  pendingPlan: { code: string; name: LocalizedText } | null;
  /** Set when it has been asked to end: the last day, after which it is not renewed. */
  endsOn: string | null;
  /** YYYY-MM-DD it was paused, when it is. */
  pausedOn: string | null;
}

/** What an outlet's Plan screen starts from. */
export interface OutletSubscriptionDto {
  outletId: string;
  /** Null when the outlet has no subscription (never had one, or the last one has ended). */
  subscription: SubscriptionDto | null;
  /** The plan that ended most recently, when there is no subscription now. */
  lastEnded: { plan: { code: string; name: LocalizedText }; endedOn: string } | null;
}
