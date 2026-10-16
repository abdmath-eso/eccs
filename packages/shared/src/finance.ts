// ECCS's own books (the console's Finance page, 15 Oct 2026): money in, money out and
// the budget, for the founders.
//
// What the app already knows is never entered twice: invoices, payments, plans and the
// AI's cost come from billing, subscriptions and the AI's own records. What is new is
// kept here: expenses (and wage advances), budgets, the founders' money, and the
// opening cash balance the daily balance is counted from.
//
// Everything in this file is plain arithmetic and wording with no database in it, so
// the server and the console work a figure out the same way and the rules can be
// tested on their own (finance.test.ts). Money is whole paise (₹1 = 100 paise); dates
// are India dates written YYYY-MM-DD; a month is written YYYY-MM.
//
// PATTERN FOLLOWED (the founder's own design, docs/design/2026-10-15 Finance dashboard):
// Zoho Books' dashboard and expense form (an expense has a date, an account, an amount
// with its tax, what it was paid through, a vendor, a receipt photo or PDF, and can be
// tied to a customer's job); the common receivables ageing report (not yet due, then
// buckets of days past due, with the overdue invoices listed under it); and founder
// finance dashboards (burn against the budget, cash day by day, runway = cash left ÷
// monthly net burn, figures shown beside their target rather than alone).

import { z } from "zod";
import { financialYear } from "./billing.js";
import { daysInMonth } from "./calendar.js";
import { CYCLE_MONTHS, type BillingCycle } from "./subscriptions.js";

// ───────────────────────── Budget lines and kinds of spend ─────────────────────────

/**
 * The budget lines, in the order the page lists them (the founder's design). Keys are
 * stored in the database: add new ones, never rename (labels can change).
 */
export const FINANCE_LINES = [
  "SALARIES",
  "SUBCONTRACTOR",
  "CHEMICALS",
  "INSURANCE",
  "VEHICLE",
  "MARKETING",
  "SOFTWARE",
  "EQUIPMENT",
] as const;
export type FinanceLine = (typeof FINANCE_LINES)[number];

export const FINANCE_LINE_LABELS: Record<FinanceLine, string> = {
  SALARIES: "Salaries",
  SUBCONTRACTOR: "Subcontractor (pest, grease trap)",
  CHEMICALS: "Chemicals and consumables",
  INSURANCE: "Insurance and professional",
  VEHICLE: "Vehicle and fuel",
  MARKETING: "Marketing and print",
  SOFTWARE: "Software and AI",
  EQUIPMENT: "Equipment and other",
};

/** The short names used in the expense book's narrow Category column. */
export const FINANCE_LINE_SHORT: Record<FinanceLine, string> = {
  SALARIES: "Salaries",
  SUBCONTRACTOR: "Subcontractor",
  CHEMICALS: "Chemicals",
  INSURANCE: "Insurance",
  VEHICLE: "Vehicle",
  MARKETING: "Marketing",
  SOFTWARE: "Software and AI",
  EQUIPMENT: "Equipment",
};

/**
 * The finer kinds of day-to-day spend (the design's "Daily operating expenses by type").
 * A monthly bill (salaries, insurance, software) has no type. Stored keys: add, never rename.
 */
export const EXPENSE_TYPES = ["CHEMICALS", "EQUIPMENT", "SUBCONTRACTOR", "FUEL", "PRINTING", "OFFICE"] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  CHEMICALS: "Chemicals and consumables",
  EQUIPMENT: "Equipment and spares",
  SUBCONTRACTOR: "Subcontractor payouts",
  FUEL: "Fuel and vehicle",
  PRINTING: "Printing and marketing",
  OFFICE: "Office, tea, parking, misc",
};

/** The budget line each kind of daily spend is counted under. */
export const EXPENSE_TYPE_LINE: Record<ExpenseType, FinanceLine> = {
  CHEMICALS: "CHEMICALS",
  EQUIPMENT: "EQUIPMENT",
  SUBCONTRACTOR: "SUBCONTRACTOR",
  FUEL: "VEHICLE",
  PRINTING: "MARKETING",
  OFFICE: "EQUIPMENT",
};

/** The kinds of daily spend that belong to a budget line (none for salaries, insurance, software). */
export const typesForLine = (line: FinanceLine): ExpenseType[] => EXPENSE_TYPES.filter((type) => EXPENSE_TYPE_LINE[type] === line);

/**
 * EXPENSE: money spent. WAGE_ADVANCE: cash given to an ECCS staff member ahead of pay
 * and recovered from their pay. An advance is cash out on the day it is given, but it
 * is not an expense, so it never counts against the budget.
 */
export const EXPENSE_KINDS = ["EXPENSE", "WAGE_ADVANCE"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

/** How a bill was paid. */
export const PAID_VIA = ["cash", "upi", "bank-transfer", "card"] as const;
export type PaidVia = (typeof PAID_VIA)[number];
export const PAID_VIA_LABELS: Record<PaidVia, string> = {
  cash: "Cash",
  upi: "UPI",
  "bank-transfer": "Bank transfer",
  card: "Card",
};

/** Money a founder put into ECCS, or took out of it. */
export const FOUNDER_MONEY_DIRECTIONS = ["IN", "OUT"] as const;
export type FounderMoneyDirection = (typeof FOUNDER_MONEY_DIRECTIONS)[number];

export const FINANCE_RULES = {
  /** "Collected" is shown against this share of what was invoiced (a setting; the founder's design says 60%). */
  collectedTargetPercent: 60,
  /** The AI's cost is kept in US dollars and shown in rupees at this rate (a setting; a sample value). In paise per dollar. */
  usdToInrPaise: 8800,
  /** The daily cash flow and daily spend charts look back this many days, today included. */
  recentDays: 14,
  /** The expense book on the main page shows this many of the latest entries. */
  latestEntries: 6,
  /** Up to this many days, "collected against expenses" is drawn by week; a longer period is drawn by month. */
  weeklyUpToDays: 42,
  /** The largest amount one entry can hold: ₹1 crore. */
  maxAmountPaise: 1_000_000_000,
  /** The most entries one "All entries" list returns. */
  maxListed: 1000,
  /** A receipt photo or PDF. */
  maxReceiptBytes: 10 * 1024 * 1024,
} as const;

// ───────────────────────── Dates ─────────────────────────

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

/** The day `days` after (or before, when negative) a date. */
export const addDays = (date: string, days: number) => new Date(toTime(date) + days * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `from` to `to`: 0 on the same day, negative when `to` comes first. */
export const daysFrom = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY_MS);

/** "2026-10" for any day in October 2026. */
export const monthOf = (date: string) => date.slice(0, 7);
export const monthStart = (month: string) => `${month.slice(0, 7)}-01`;

export const monthEnd = (month: string) => `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, "0")}`;

/** The month before (or `count` months after) a month. */
export function addMonths(month: string, count: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + count;
  const date = new Date(Date.UTC(year, index, 1));
  return date.toISOString().slice(0, 7);
}

/** Every month from the month of `from` to the month of `to`, both included. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = monthOf(from); month <= monthOf(to); month = addMonths(month, 1)) months.push(month);
  return months;
}

/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** "October 2026". */
export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${monthStart(month)}T00:00:00Z`));

/** "October" (the year left off). */
export const monthName = (month: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long" }).format(new Date(`${monthStart(month)}T00:00:00Z`));

/** The first day of the financial year a date is in: 1 April. */
export const financialYearStart = (date: string) => `${financialYear(date).startYear}-04-01`;

// ───────────────────────── The period shown ─────────────────────────

/** This month so far, the financial year so far (from 1 April), or dates chosen. */
export const FINANCE_PERIODS = ["month", "fy", "custom"] as const;
export type FinancePeriodChoice = (typeof FINANCE_PERIODS)[number];

/** The dates a choice of period stands for, on `today`. A custom period given back to front is turned round. */
export function financePeriod(choice: FinancePeriodChoice, today: string, custom?: { from?: string; to?: string }): { from: string; to: string } {
  if (choice === "fy") return { from: financialYearStart(today), to: today };
  if (choice === "custom" && custom?.from && custom.to) {
    return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
  }
  return { from: monthStart(monthOf(today)), to: today };
}

/**
 * The months a period is held against the budget for: every calendar month it touches,
 * leaving out months before the books started (nothing was spent then). A month is
 * counted whole, as the founder's design does ("88% of lean budget, 88% of month gone").
 */
export function budgetMonths(from: string, to: string, booksStart: string | null): string[] {
  const first = booksStart && monthOf(booksStart) > monthOf(from) ? monthOf(booksStart) : monthOf(from);
  return first > monthOf(to) ? [] : monthsBetween(first, to);
}

/** How much of those months has gone by on `today`, as a whole percent (100 once they are over). */
export function periodGonePercent(months: readonly string[], today: string): number {
  if (months.length === 0) return 0;
  const start = monthStart(months[0]!);
  const end = monthEnd(months[months.length - 1]!);
  const total = daysFrom(start, end) + 1;
  if (today < start) return 0;
  const gone = Math.min(total, daysFrom(start, today) + 1);
  return Math.round((gone / total) * 100);
}

// ───────────────────────── Plans and the budget ─────────────────────────

/** A plan's price as a monthly amount: a quarterly price ÷ 3, an annual one ÷ 12. */
export const monthlyPlanPaise = (pricePaise: number, cycle: BillingCycle) => Math.round(pricePaise / CYCLE_MONTHS[cycle]);

export type BudgetLines = Record<FinanceLine, number>;

/** Every line at nothing, for a new budget. */
export const emptyBudgetLines = (): BudgetLines => Object.fromEntries(FINANCE_LINES.map((line) => [line, 0])) as BudgetLines;

/** A budget's lines as stored, with any missing line read as nothing. */
export function readBudgetLines(stored: unknown): BudgetLines {
  const lines = emptyBudgetLines();
  if (stored && typeof stored === "object") {
    for (const line of FINANCE_LINES) {
      const value = (stored as Record<string, unknown>)[line];
      if (typeof value === "number" && Number.isFinite(value)) lines[line] = Math.round(value);
    }
  }
  return lines;
}

export const budgetTotal = (lines: BudgetLines) => FINANCE_LINES.reduce((total, line) => total + lines[line], 0);

/** How much of a budget is used: a whole percent (null with no budget) and by how much it is over. */
export function budgetUse(actualPaise: number, budgetPaise: number | null): { percent: number | null; overByPaise: number } {
  if (budgetPaise === null || budgetPaise <= 0) return { percent: null, overByPaise: budgetPaise === 0 ? Math.max(0, actualPaise) : 0 };
  return { percent: Math.round((actualPaise / budgetPaise) * 100), overByPaise: Math.max(0, actualPaise - budgetPaise) };
}

// ───────────────────────── Collections ageing ─────────────────────────

/** Not yet due, then days past the due date (the common ageing report, in the founder's buckets). */
export const AGEING_BUCKETS = ["NOT_DUE", "DAYS_1_7", "DAYS_8_30", "OVER_30"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export const AGEING_LABELS: Record<AgeingBucket, string> = {
  NOT_DUE: "Not yet due",
  DAYS_1_7: "1 to 7 days",
  DAYS_8_30: "8 to 30 days",
  OVER_30: "Over 30 days",
};

/** Which bucket an unpaid invoice is in on `today`. It is not overdue on its due date itself. */
export function ageingBucket(dueDate: string, today: string): AgeingBucket {
  const late = daysFrom(dueDate, today);
  if (late <= 0) return "NOT_DUE";
  if (late <= 7) return "DAYS_1_7";
  if (late <= 30) return "DAYS_8_30";
  return "OVER_30";
}

/** What is owed on unpaid invoices, in total and by bucket. Invoices with nothing owed are left out. */
export function ageCollections(invoices: readonly { dueDate: string; duePaise: number }[], today: string) {
  const buckets = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, { paise: 0, count: 0 }])) as Record<AgeingBucket, { paise: number; count: number }>;
  let totalPaise = 0;
  let count = 0;
  for (const invoice of invoices) {
    if (invoice.duePaise <= 0) continue;
    const bucket = buckets[ageingBucket(invoice.dueDate, today)];
    bucket.paise += invoice.duePaise;
    bucket.count += 1;
    totalPaise += invoice.duePaise;
    count += 1;
  }
  return { totalPaise, count, buckets };
}

// ───────────────────────── Cash, day by day ─────────────────────────

/** Money into (positive) or out of (negative) the bank and cash box on a day. */
export interface CashMovement {
  date: string;
  paise: number;
}

/** The bank plus cash box at the start of a day, from which every later day is counted. */
export interface OpeningCash {
  date: string;
  paise: number;
}

/**
 * The bank plus cash box at the close of each day from `from` to `to`: the opening
 * balance, plus everything that came in, less everything that went out, from the
 * opening day on. A day before the opening day has no balance (null). Without an
 * opening balance, it is counted from nothing, from the first movement on record.
 */
export function cashBalanceByDay(opening: OpeningCash | null, movements: readonly CashMovement[], from: string, to: string): { date: string; paise: number | null }[] {
  const start = opening?.date ?? "0000-01-01";
  const counted = movements.filter((movement) => movement.date >= start).sort((a, b) => a.date.localeCompare(b.date));
  let balance = opening?.paise ?? 0;
  let next = 0;
  // Everything before the first day shown.
  while (next < counted.length && counted[next]!.date < from) balance += counted[next++]!.paise;
  return daysBetween(from, to).map((date) => {
    while (next < counted.length && counted[next]!.date <= date) balance += counted[next++]!.paise;
    return { date, paise: date < start ? null : balance };
  });
}

/** The balance at the close of one day (null before the opening day). */
export const cashBalanceOn = (opening: OpeningCash | null, movements: readonly CashMovement[], date: string) =>
  cashBalanceByDay(opening, movements, date, date)[0]!.paise;

// ───────────────────────── Collected against expenses, by week ─────────────────────────

export interface ChartBucket {
  from: string;
  to: string;
  label: string;
}

/**
 * The bars of "collected against expenses": 7-day weeks from the first day of the
 * period ("Week 1" is days 1 to 7) up to today, or calendar months when the period is
 * longer than six weeks.
 */
export function chartBuckets(from: string, to: string, today: string): { kind: "week" | "month"; buckets: ChartBucket[] } {
  const end = to < today ? to : today;
  if (end < from) return { kind: "week", buckets: [] };
  if (daysFrom(from, end) + 1 <= FINANCE_RULES.weeklyUpToDays) {
    const buckets: ChartBucket[] = [];
    for (let start = from, week = 1; start <= end; start = addDays(start, 7), week += 1) {
      const last = addDays(start, 6);
      buckets.push({ from: start, to: last < end ? last : end, label: `Week ${week}` });
    }
    return { kind: "week", buckets };
  }
  return {
    kind: "month",
    buckets: monthsBetween(from, end).map((month) => {
      const first = monthStart(month) > from ? monthStart(month) : from;
      const last = monthEnd(month) < end ? monthEnd(month) : end;
      return { from: first, to: last, label: monthName(month).slice(0, 3) };
    }),
  };
}

/**
 * A month's salaries spread evenly over the days of that month from `from` to `end`
 * ("expenses include salaries accrued"), so the weekly bars carry the salary bill week
 * by week rather than all on pay day. The shares always add up to the whole amount;
 * any odd paise go on the last day. Empty when no day of the month is in the range.
 */
export function spreadOverMonth(amountPaise: number, date: string, from: string, end: string): CashMovement[] {
  const month = monthOf(date);
  const first = monthStart(month) > from ? monthStart(month) : from;
  const last = monthEnd(month) < end ? monthEnd(month) : end;
  if (last < first) return [];
  const days = daysBetween(first, last);
  const share = Math.floor(amountPaise / days.length);
  return days.map((day, index) => ({ date: day, paise: index === days.length - 1 ? amountPaise - share * (days.length - 1) : share }));
}

/** Adds dated amounts into the buckets they fall in. Amounts outside every bucket are left out. */
export function sumIntoBuckets(buckets: readonly ChartBucket[], items: readonly CashMovement[]): number[] {
  return buckets.map((bucket) => items.reduce((total, item) => (item.date >= bucket.from && item.date <= bucket.to ? total + item.paise : total), 0));
}

// ───────────────────────── Founders' money and runway ─────────────────────────

export interface FounderMoneyEntry {
  founder: string;
  date: string;
  amountPaise: number;
  direction: FounderMoneyDirection;
}

export interface FounderShare {
  founder: string;
  /** The day they first put money in (or took it out, if they never put any in). */
  firstDate: string;
  putInPaise: number;
  takenOutPaise: number;
  /** Their part of everything the founders put in, as a whole percent; the shares add up to 100. */
  sharePercent: number;
}

/**
 * Each founder's money, earliest first, with their share worked out from what each
 * put in. Rounded so the shares always add up to 100 (the largest remainders round up).
 */
export function founderShares(entries: readonly FounderMoneyEntry[]): FounderShare[] {
  const people = new Map<string, FounderShare>();
  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = entry.founder.trim();
    const person = people.get(key) ?? { founder: key, firstDate: entry.date, putInPaise: 0, takenOutPaise: 0, sharePercent: 0 };
    if (entry.direction === "IN") person.putInPaise += entry.amountPaise;
    else person.takenOutPaise += entry.amountPaise;
    people.set(key, person);
  }
  const rows = [...people.values()];
  const total = rows.reduce((sum, row) => sum + row.putInPaise, 0);
  if (total > 0) {
    const exact = rows.map((row) => (row.putInPaise / total) * 100);
    rows.forEach((row, index) => (row.sharePercent = Math.floor(exact[index]!)));
    let left = 100 - rows.reduce((sum, row) => sum + row.sharePercent, 0);
    const order = rows.map((_, index) => index).sort((a, b) => exact[b]! - Math.floor(exact[b]!) - (exact[a]! - Math.floor(exact[a]!)));
    for (const index of order) {
      if (left <= 0) break;
      if (rows[index]!.putInPaise === 0) continue;
      rows[index]!.sharePercent += 1;
      left -= 1;
    }
  }
  return rows;
}

/**
 * The last full calendar month before `today`, when the books cover all of it (they
 * started on or before its first day). Null when there is no such month yet.
 */
export function lastFullMonth(today: string, booksStart: string | null): string | null {
  if (!booksStart) return null;
  const month = addMonths(monthOf(today), -1);
  return booksStart <= monthStart(month) ? month : null;
}

export type RunwayKind = "NO_HISTORY" | "NOTHING_LEFT" | "NOT_BURNING" | "MONTHS";

export interface RunwayDto {
  kind: RunwayKind;
  /** How many months what is left lasts at that pace (one decimal), for MONTHS only. */
  months: number | null;
  /** "about 2 months", "less than a month". Empty unless kind is MONTHS. */
  words: string;
}

/**
 * Runway: how long what is left lasts at the last full month's net outflow (what was
 * spent that month less what was collected). Says plainly when there is not a full
 * month to go by, when nothing is left, and when collections already cover spending.
 */
export function runway(leftPaise: number, netOutflowPaise: number | null): RunwayDto {
  if (netOutflowPaise === null) return { kind: "NO_HISTORY", months: null, words: "" };
  if (leftPaise <= 0) return { kind: "NOTHING_LEFT", months: 0, words: "" };
  if (netOutflowPaise <= 0) return { kind: "NOT_BURNING", months: null, words: "" };
  const months = leftPaise / netOutflowPaise;
  const rounded = Math.round(months);
  const words = months < 0.75 ? "less than a month" : `about ${rounded} ${rounded === 1 ? "month" : "months"}`;
  return { kind: "MONTHS", months: Math.round(months * 10) / 10, words };
}

// ───────────────────────── The AI's cost ─────────────────────────

/** The AI's cost (kept in millionths of a US dollar) in paise at the rate set. */
export const aiCostPaise = (costMicroUsd: number, usdToInrPaise: number) => Math.round((costMicroUsd * usdToInrPaise) / 1_000_000);

// ───────────────────────── A payment reminder on WhatsApp ─────────────────────────

const reminderRupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

const reminderDay = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));

/** A short, polite reminder about an overdue invoice, for ECCS to send from its own WhatsApp. */
export function invoiceReminderText(input: { clientName: string; invoiceNumber: string; duePaise: number; dueDate: string }): string {
  return [
    `Hello ${input.clientName}, this is ECCS.`,
    `A gentle reminder that invoice ${input.invoiceNumber} for ${reminderRupees(input.duePaise)} was due on ${reminderDay(input.dueDate)}.`,
    "You can pay it in the ECCS app under Invoices. If it is already paid, or anything needs checking, please reply here.",
    "Thank you.",
  ].join(" ");
}

/**
 * The WhatsApp link that opens a chat with the message typed in, ready to send (WhatsApp's
 * own "click to chat"). A ten-digit Indian number gets 91 in front. With no number,
 * WhatsApp asks whom to send it to.
 */
export function whatsappReminderUrl(phone: string | null | undefined, text: string): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  return `https://wa.me/${digits.length >= 11 ? digits : ""}?text=${encodeURIComponent(text)}`;
}

// ───────────────────────── What the API accepts ─────────────────────────

const dateSchema = z
  .string("Enter the date")
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist");

const monthSchema = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Enter the month as YYYY-MM");

const amountSchema = z
  .number("Enter the amount")
  .int("Enter the amount in rupees and paise")
  .positive("Enter an amount above zero")
  .max(FINANCE_RULES.maxAmountPaise, "That is more than one entry can hold");

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

/**
 * One expense or wage advance, as the form sends it (the same shape to add and to change).
 * A bill is either paid (how and when) or not yet paid (and then due on a date): an
 * unpaid bill is a payout due, such as a subcontractor's bill or a referral payout.
 */
export const expenseSchema = z
  .object({
    /** Chosen by the console when the form opens, so pressing Save twice adds one entry. */
    id: z.uuid().optional(),
    kind: z.enum(EXPENSE_KINDS).default("EXPENSE"),
    date: dateSchema,
    category: z.enum(FINANCE_LINES, "Choose the budget line").nullable().optional(),
    type: z.enum(EXPENSE_TYPES).nullable().optional(),
    vendor: z.string("Say who was paid").trim().min(1, "Say who was paid").max(80, "Keep the name under 80 characters"),
    description: optionalText(200, "Keep what it was for under 200 characters"),
    amountPaise: amountSchema,
    gstPaise: z.number().int("Enter the GST in rupees and paise").min(0, "The GST cannot be below zero").default(0),
    paidVia: z.enum(PAID_VIA).nullable().optional(),
    paidOn: dateSchema.nullable().optional(),
    dueDate: dateSchema.nullable().optional(),
    recoveredOn: dateSchema.nullable().optional(),
    receiptId: z.uuid().nullable().optional(),
    visitId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
    if (value.gstPaise > value.amountPaise) issue("gstPaise", "The GST is part of the amount, so it cannot be more than it");
    const paid = Boolean(value.paidVia) || Boolean(value.paidOn);
    if (paid && !value.paidVia) issue("paidVia", "Choose how it was paid");
    if (paid && !value.paidOn) issue("paidOn", "Enter the day it was paid");
    if (value.kind === "WAGE_ADVANCE") {
      if (value.category || value.type) issue("category", "A wage advance has no budget line: it is recovered from pay");
      if (!paid) issue("paidVia", "Say how the advance was given");
      if (value.gstPaise > 0) issue("gstPaise", "A wage advance has no GST");
      if (value.visitId) issue("visitId", "A wage advance is not linked to a visit");
      if (value.recoveredOn && value.paidOn && value.recoveredOn < value.paidOn) issue("recoveredOn", "It cannot be recovered before it was given");
    } else {
      if (!value.category) issue("category", "Choose the budget line");
      if (value.type && value.category && EXPENSE_TYPE_LINE[value.type] !== value.category) issue("type", "That kind of spend belongs to another budget line");
      if (!paid && !value.dueDate) issue("dueDate", "Enter when it is due, or say how it was paid");
      if (value.recoveredOn) issue("recoveredOn", "Only a wage advance is recovered from pay");
    }
  });
export type ExpenseInput = z.input<typeof expenseSchema>;
export type ExpenseValues = z.output<typeof expenseSchema>;

/** Unpaid bills paid together (the "Mark paid" of a payout). */
export const markPaidSchema = z.object({
  ids: z.array(z.uuid()).min(1, "Choose at least one bill").max(100),
  paidVia: z.enum(PAID_VIA, "Choose how it was paid"),
  paidOn: dateSchema,
});
export type MarkPaidInput = z.input<typeof markPaidSchema>;

export const budgetSchema = z.object({
  name: z.string("Name the budget").trim().min(1, "Name the budget").max(40, "Keep the name under 40 characters"),
  /** A monthly amount for every budget line, in paise. */
  lines: z.object(
    Object.fromEntries(FINANCE_LINES.map((line) => [line, z.number().int().min(0, "An amount cannot be below zero").max(FINANCE_RULES.maxAmountPaise)])) as Record<
      FinanceLine,
      z.ZodNumber
    >,
  ),
  /** The net cash the plan expects month by month (negative while spending more than collected). */
  plannedNet: z
    .array(z.object({ month: monthSchema, paise: z.number().int().min(-FINANCE_RULES.maxAmountPaise).max(FINANCE_RULES.maxAmountPaise) }))
    .max(36)
    .default([])
    .refine((months) => new Set(months.map((entry) => entry.month)).size === months.length, "Each month once"),
  /** The budget the page compares with until another is chosen. */
  isDefault: z.boolean().default(false),
});
export type BudgetInput = z.input<typeof budgetSchema>;
export type BudgetValues = z.output<typeof budgetSchema>;

export const founderMoneySchema = z.object({
  id: z.uuid().optional(),
  founder: z.string("Say which founder").trim().min(1, "Say which founder").max(60, "Keep the name under 60 characters"),
  date: dateSchema,
  amountPaise: amountSchema,
  direction: z.enum(FOUNDER_MONEY_DIRECTIONS, "Say whether the money went in or came out"),
  label: optionalText(80, "Keep the note under 80 characters"),
});
export type FounderMoneyInput = z.input<typeof founderMoneySchema>;
export type FounderMoneyValues = z.output<typeof founderMoneySchema>;

export const openingBalanceSchema = z.object({
  asOf: dateSchema,
  bankPaise: z.number("Enter the bank balance").int().min(0, "Enter zero or more").max(FINANCE_RULES.maxAmountPaise),
  cashPaise: z.number("Enter the cash box").int().min(0, "Enter zero or more").max(FINANCE_RULES.maxAmountPaise),
});
export type OpeningBalanceInput = z.input<typeof openingBalanceSchema>;

export const financeSettingsSchema = z.object({
  collectedTargetPercent: z.number("Enter the target").int("Enter a whole percent").min(1, "Enter 1 to 100").max(100, "Enter 1 to 100"),
  usdToInrPaise: z.number("Enter the dollar rate").int().min(1_000, "Enter the rate in rupees, for example 88").max(100_000, "Enter the rate in rupees, for example 88"),
});
export type FinanceSettingsInput = z.input<typeof financeSettingsSchema>;

/** The page's period and the budget to compare with. */
export const financeQuerySchema = z
  .object({ from: dateSchema, to: dateSchema, budgetId: z.string().trim().max(64).optional() })
  .refine((value) => value.from <= value.to, { path: ["to"], message: "The end comes before the start" })
  .refine((value) => daysFrom(value.from, value.to) <= 366 * 3, { path: ["to"], message: "Choose at most three years" });
export type FinanceQuery = z.output<typeof financeQuerySchema>;

/** The filters of "All entries". */
export const expenseListQuerySchema = z.object({
  month: monthSchema.optional(),
  /** A budget line, or WAGE_ADVANCE for the advances. */
  category: z.enum([...FINANCE_LINES, "WAGE_ADVANCE"]).optional(),
  paid: z.enum(["yes", "no"]).optional(),
  visit: z.enum(["yes", "no"]).optional(),
});
export type ExpenseListQuery = z.output<typeof expenseListQuerySchema>;

export const EXPORT_REGISTERS = ["expenses", "sales", "receipts"] as const;
export type ExportRegister = (typeof EXPORT_REGISTERS)[number];
export const EXPORT_REGISTER_LABELS: Record<ExportRegister, string> = {
  expenses: "Expense register",
  sales: "Sales register (invoices)",
  receipts: "Receipts (payments received)",
};

// ───────────────────────── What the API sends ─────────────────────────

export interface ExpenseDto {
  id: string;
  kind: ExpenseKind;
  date: string;
  category: FinanceLine | null;
  type: ExpenseType | null;
  /** Who was paid; for a wage advance, the staff member. */
  vendor: string;
  description: string | null;
  /** What was paid, GST included. */
  amountPaise: number;
  /** The GST inside the amount, for the CA's input credit. */
  gstPaise: number;
  paidVia: PaidVia | null;
  paidOn: string | null;
  /** For a bill not yet paid: when it is due. */
  dueDate: string | null;
  /** For a wage advance: the day it was taken back out of pay. */
  recoveredOn: string | null;
  receipt: { id: string; path: string; pdf: boolean } | null;
  /** The visit (job) this cost belongs to, so it counts against that job's margin. */
  visit: { id: string; date: string; outletName: string; reference: string | null } | null;
  isSample: boolean;
  /** True for a line the server works out itself (the month's AI cost). It cannot be changed or removed. */
  automatic: boolean;
  /**
   * A month's salary made from the Team page (16 Oct 2026): whose (their login, for the link
   * to their page) and which month. It cannot be changed or removed here, only paid.
   */
  team: { userId: string; month: string } | null;
  enteredByName: string | null;
}

export interface ExpenseListDto {
  entries: ExpenseDto[];
  /** Every month that has an entry, newest first, for the month filter. */
  months: string[];
}

export interface BudgetDto {
  id: string;
  name: string;
  lines: BudgetLines;
  totalPaise: number;
  plannedNet: { month: string; paise: number }[];
  isDefault: boolean;
  isSample: boolean;
}

export interface CashOpeningDto {
  id: string;
  asOf: string;
  bankPaise: number;
  cashPaise: number;
  isSample: boolean;
}

export interface FinanceSettingsDto {
  collectedTargetPercent: number;
  usdToInrPaise: number;
}

export interface FinanceCardsDto {
  /** Invoices issued in the period (not void): their total with GST, and how many were for plans and for one-off jobs. */
  invoiced: { totalPaise: number; count: number; plans: number; oneOff: number };
  /** Payments received in the period, and that as a share of what was invoiced in it. */
  collected: { paise: number; percentOfInvoiced: number | null; targetPercent: number };
  /** What is owed today on unpaid invoices, whenever they were issued. */
  outstanding: { paise: number; count: number; overduePaise: number; overdueCount: number };
  /** Expenses in the period (wage advances are not expenses), against the budget for its months. */
  expenses: { paise: number; budgetPaise: number | null; percentOfBudget: number | null; percentOfPeriodGone: number };
  /** Collected less expenses, against what the budget planned for the same months. */
  netCash: { paise: number; plannedPaise: number | null; plannedMonths: string[] };
  /** Active plans' prices as a monthly amount, before GST; and how many were cancelled in the period. */
  planRevenue: { monthlyPaise: number; active: number; cancelled: number };
}

export interface FinanceBucketDto extends ChartBucket {
  collectedPaise: number;
  expensesPaise: number;
}

export interface FinanceLineDto {
  line: FinanceLine;
  label: string;
  actualPaise: number;
  budgetPaise: number | null;
  percent: number | null;
  overByPaise: number;
}

export interface FounderMoneyDto {
  id: string;
  founder: string;
  date: string;
  amountPaise: number;
  direction: FounderMoneyDirection;
  label: string | null;
  isSample: boolean;
}

export interface FoundersDto {
  openingPaise: number;
  putInPaise: number;
  takenOutPaise: number;
  /** Everything collected from customers since the books started. */
  collectedPaise: number;
  /** Everything spent before this month, and this month so far (unpaid bills included). */
  spentBeforePaise: number;
  spentThisMonthPaise: number;
  thisMonth: string;
  /** Opening balance + put in − taken out + collected − everything spent (paid or still owed). */
  leftPaise: number;
  /** Bills entered but not yet paid, which "left" already allows for. */
  unpaidPaise: number;
  people: FounderShare[];
  entries: FounderMoneyDto[];
  /** The last full month and its net outflow (spent less collected), which runway is worked out from. */
  lastFullMonth: { month: string; netOutflowPaise: number } | null;
  runway: RunwayDto;
}

export interface CashDayDto {
  date: string;
  /** Collections received that day. */
  inPaise: number;
  /** Paid out that day, salaries left out (they go once a month and would dwarf the rest). */
  outPaise: number;
  /** The bank plus cash box at close of day; null before the opening balance's day. */
  balancePaise: number | null;
}

export interface CashFlowDto {
  days: CashDayDto[];
  inPaise: number;
  outPaise: number;
  /** Bills still to pay: salaries, and everything else, and the first day one is due. */
  dueOut: { salariesPaise: number; payoutsPaise: number; firstDueDate: string | null };
}

export interface DailySpendDto {
  /** Day-to-day spend paid in the last days, by kind, largest first; wage advances and other bills included, salaries not. */
  types: { key: string; label: string; paise: number }[];
  totalPaise: number;
  perDayPaise: number;
  highest: { date: string; paise: number } | null;
  lowest: { date: string; paise: number } | null;
  /** Wage advances given and not yet recovered from pay. */
  advancesToRecoverPaise: number;
  days: number;
}

export interface OverdueInvoiceDto {
  id: string;
  number: string;
  organizationName: string;
  outletName: string | null;
  duePaise: number;
  dueDate: string;
  overdueDays: number;
}

export interface AgeingDto {
  totalPaise: number;
  count: number;
  buckets: { bucket: AgeingBucket; label: string; paise: number; count: number }[];
  /** Overdue invoices, longest overdue first. */
  overdue: OverdueInvoiceDto[];
}

/**
 * Unpaid bills from one payee under one budget line, paid together with "Mark paid". A
 * month's salaries from Team are one group, the whole team's for that month.
 */
export interface PayoutGroupDto {
  key: string;
  vendor: string;
  category: FinanceLine;
  count: number;
  /** How many of the bills are linked to a visit. */
  visitCount: number;
  totalPaise: number;
  /** The soonest due date among them. */
  dueDate: string | null;
  ids: string[];
}

export interface FinanceOverviewDto {
  today: string;
  from: string;
  to: string;
  /** True while any sample row is in the books (the "Sample data" badge). */
  sample: boolean;
  settings: FinanceSettingsDto;
  opening: CashOpeningDto | null;
  /** The day the books start: the opening balance's day, else the first entry. Null when there is nothing yet. */
  booksStart: string | null;
  budgets: BudgetDto[];
  /** The budget compared with (the one asked for, else the default), null when there is none. */
  budgetId: string | null;
  /** The months the period is held against the budget for. */
  budgetMonths: string[];
  cards: FinanceCardsDto;
  bucketKind: "week" | "month";
  buckets: FinanceBucketDto[];
  lines: FinanceLineDto[];
  founders: FoundersDto;
  cashFlow: CashFlowDto;
  dailySpend: DailySpendDto;
  /** The latest entries of the expense book, the month's AI cost among them. */
  latest: ExpenseDto[];
  /** How many entries the expense book holds (the AI lines not counted). */
  entryCount: number;
  ageing: AgeingDto;
  payouts: PayoutGroupDto[];
}

/** One day's cash, as the office closes it: opening, what came in and went out, closing. */
export interface CashDayDetailDto {
  date: string;
  openingPaise: number | null;
  in: { label: string; paise: number }[];
  out: { label: string; paise: number }[];
  inPaise: number;
  outPaise: number;
  closingPaise: number | null;
}

/** A visit an expense can be linked to. */
export interface FinanceVisitOptionDto {
  id: string;
  date: string;
  outletName: string;
  serviceName: string;
  reference: string | null;
}
