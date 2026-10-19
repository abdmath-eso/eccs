import { z } from "zod";
import { AI_FEATURES, AI_STATUSES, type AiFeature, type AiStatus } from "./ai.js";
import { AI_HELPERS } from "./ai-settings.js";
import { daysInMonth } from "./calendar.js";
import { addDays } from "./finance.js";

// The AI usage page (Stage F, 19 Oct 2026, Console > Business > AI usage): its filters, what
// the server sends it, and the small calculations behind its cards and findings. Every
// number comes from the AiRequest table, the request log the server writes for each AI
// call; nothing is typed in or sampled. Money is sent in US dollars and shown in rupees at
// the rate set under "About the key". Days and hours are India time.

// ───────────────────────── Filters ─────────────────────────

/** The period chips: this month, last month, the last 7 days, today, or dates chosen. */
export const AI_USAGE_PERIODS = ["month", "lastMonth", "7d", "today", "custom"] as const;
export type AiUsagePeriod = (typeof AI_USAGE_PERIODS)[number];

/** Where a request came from (the activity log's sources, without the public pages). */
export const AI_SOURCES = ["RESTAURANT_APP", "SUPERVISOR_APP", "CONSOLE", "SYSTEM"] as const;
export type AiSource = (typeof AI_SOURCES)[number];

export const AI_SOURCE_LABELS: Record<AiSource, string> = {
  RESTAURANT_APP: "Restaurant app",
  SUPERVISOR_APP: "Supervisor's app",
  CONSOLE: "Console",
  SYSTEM: "Background",
};

/** How a request ended, in the page's words. */
export const AI_RESULTS = ["answered", "limit", "off", "failed", "invalid"] as const;
export type AiResult = (typeof AI_RESULTS)[number];

export const AI_RESULT_STATUS: Record<AiResult, AiStatus> = { answered: "OK", limit: "LIMIT", off: "OFF", failed: "ERROR", invalid: "INVALID" };

export const AI_RESULT_LABELS: Record<AiResult, string> = {
  answered: "Answered",
  limit: "Refused by a limit",
  off: "Switched off",
  failed: "Failed",
  invalid: "Thrown away by a check",
};

/**
 * Error codes that are not failures: ABORTED is ECCS Buddy's first step stopped on purpose
 * because its scope check refused the message. They count neither as tries nor as failures.
 */
export const AI_STOPPED_ON_PURPOSE: readonly string[] = ["ABORTED"];

export const aiResultOf = (status: string): AiResult => (Object.entries(AI_RESULT_STATUS).find(([, value]) => value === status)?.[0] as AiResult | undefined) ?? "failed";

/** What a person did with an answer, in the page's words. */
export const AI_OUTCOME_LABELS: Record<string, string> = {
  ACCEPTED: "Accepted",
  EDITED: "Edited",
  DISCARDED: "Discarded",
  HELPFUL: "Helpful",
  NOT_HELPFUL: "Not helpful",
};

/** Why a request was refused by a limit (AiRequest.errorCode). */
export const AI_LIMIT_LABELS: Record<string, string> = {
  DAILY_LIMIT: "Daily limit, everything",
  MONTH_LIMIT: "Monthly limit",
  OUTLET_LIMIT: "Outlet's daily limit",
};

export const AI_USAGE_RULES = {
  /** Rows in one page of the log. */
  pageSize: 50,
  maxPageSize: 200,
  /** The most rows one CSV export holds. */
  exportMax: 10_000,
  /** The spend chart shows at least this many days, ending on the period's last day. */
  chartDays: 14,
  /** And at most this many (a long custom period). */
  chartMaxDays: 62,
  /** A custom period may be at most a year. */
  maxDays: 366,
  /** A helper failing more than this share of today's tries is a warning... */
  failingPercent: 10,
  /** ...once it has been tried at least this many times today. */
  failingMinTries: 3,
  /** At most this many plain findings. */
  findingsMax: 3,
  /** The outlet table shows this many before "All N outlets". */
  outletsShown: 8,
  /** A helper with at least this share of the spend is flagged for a look. */
  bigSharePercent: 40,
  /** An outlet is "near its cap" today at this share of it. */
  nearCapPercent: 80,
} as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD");

/** "a,b" or ["a","b"] → ["a","b"]; nothing → []. */
const list = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) =>
      value === undefined
        ? []
        : (Array.isArray(value) ? value : [value])
            .flatMap((entry) => entry.split(","))
            .map((entry) => entry.trim())
            .filter(Boolean),
    )
    .pipe(z.array(item).max(100));

const id = z.string().min(1).max(64);

/** The page's filters, as the address and the API take them. */
export const aiUsageQuerySchema = z.object({
  period: z.enum(AI_USAGE_PERIODS).optional().default("month"),
  from: date.optional(),
  to: date.optional(),
  org: list(id),
  outlet: list(id),
  feature: list(z.enum(AI_FEATURES)),
  model: list(z.string().min(1).max(40)),
  source: list(z.enum(AI_SOURCES)),
  result: list(z.enum(AI_RESULTS)),
  /** The log only: where the next page starts, and how many rows. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(AI_USAGE_RULES.maxPageSize).optional(),
});
export type AiUsageQuery = z.output<typeof aiUsageQuerySchema>;
export type AiUsageQueryInput = z.input<typeof aiUsageQuerySchema>;

// ───────────────────────── Dates ─────────────────────────

/** How many days from `from` to `to`, both counted. */
export const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * The India dates a period covers, both counted. "month" runs from the 1st to today;
 * "lastMonth" is the whole of the month before; "custom" is the dates given, in order,
 * at most a year, never past today (this month when they are missing).
 */
export function aiUsageRange(query: Pick<AiUsageQuery, "period" | "from" | "to">, today: string): { from: string; to: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (query.period) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "lastMonth": {
      const lastDay = addDays(monthStart, -1);
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
    case "custom": {
      if (!query.from || !query.to) return { from: monthStart, to: today };
      let [from, to] = query.from <= query.to ? [query.from, query.to] : [query.to, query.from];
      if (to > today) to = today;
      if (from > to) from = to;
      if (dayCount(from, to) > AI_USAGE_RULES.maxDays) from = addDays(to, -(AI_USAGE_RULES.maxDays - 1));
      return { from, to };
    }
    default:
      return { from: monthStart, to: today };
  }
}

/** Midnight in India at the start of an India date, as a moment. */
export const indiaMidnightOf = (isoDate: string) => new Date(`${isoDate}T00:00:00.000+05:30`);

/** "7 to 8 am", "11 am to 12 pm", "11 pm to 12 am": an hour of the day in India time. */
export function hourRange(hour: number): string {
  const name = (h: number) => {
    const twelve = h % 12 === 0 ? 12 : h % 12;
    return { n: twelve, half: h % 24 < 12 ? "am" : "pm" };
  };
  const start = name(hour);
  const end = name(hour + 1);
  return start.half === end.half ? `${start.n} to ${end.n} ${end.half}` : `${start.n} ${start.half} to ${end.n} ${end.half}`;
}

// ───────────────────────── Small calculations ─────────────────────────

/** US dollars as rupees at the rate set, unrounded. */
export const usdToInr = (usd: number, rate: number) => usd * rate;

/**
 * The month's spend at this month's pace by its last day: what has been spent so far,
 * per day gone (today counted), times the days in the month.
 */
export function monthForecast(spentUsd: number, today: string): { forecastUsd: number; daysGone: number; daysInMonth: number } {
  const daysGone = Number(today.slice(8, 10));
  const days = daysInMonth(today);
  return { forecastUsd: daysGone > 0 ? (spentUsd / daysGone) * days : 0, daysGone, daysInMonth: days };
}

/** "Of what they pay": the AI's cost as a share of what the outlet was invoiced (before GST), or null when it was invoiced nothing. */
export function shareOfPay(aiUsd: number, rate: number, invoicedPaise: number): number | null {
  if (invoicedPaise <= 0) return null;
  return Math.round(((aiUsd * rate * 100) / invoicedPaise) * 1000) / 10;
}

/** What is left of the credit loaded, and how many days it lasts at a day's spend; null days when nothing is being spent. */
export function creditLeft(creditUsd: number, spentSinceUsd: number, perDayUsd: number): { leftUsd: number; fraction: number; lastsDays: number | null } {
  const leftUsd = Math.max(0, creditUsd - spentSinceUsd);
  return { leftUsd, fraction: creditUsd > 0 ? leftUsd / creditUsd : 0, lastsDays: perDayUsd > 0 ? leftUsd / perDayUsd : null };
}

/** "about 9 more days", "about 3 more weeks", "about 2 more months", "over a year", for how long the credit lasts. */
export function lastsWords(days: number | null): string {
  if (days === null) return "nothing is being spent";
  if (days < 1) return "less than a day";
  if (days < 14) return `about ${Math.round(days)} more day${Math.round(days) === 1 ? "" : "s"}`;
  if (days < 60) return `about ${Math.round(days / 7)} more weeks`;
  if (days < 365) return `about ${Math.round(days / 30)} more months`;
  return "over a year";
}

/** The weekday whose days cost least, when they cost under a third of an average day: "Sundays are quiet". Needs two weeks. */
export function quietWeekday(days: readonly { date: string; usd: number }[]): { weekday: string; usd: number } | null {
  if (days.length < 14) return null;
  const total = days.reduce((sum, day) => sum + day.usd, 0);
  if (total <= 0) return null;
  const average = total / days.length;
  const byWeekday = new Map<number, number[]>();
  for (const day of days) {
    const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
    byWeekday.set(weekday, [...(byWeekday.get(weekday) ?? []), day.usd]);
  }
  const [weekday, values] = [...byWeekday.entries()].map(([key, list]) => [key, list.reduce((a, b) => a + b, 0) / list.length] as const).sort((a, b) => a[1] - b[1])[0]!;
  if (values >= average / 3) return null;
  const name = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday]!;
  return { weekday: name, usd: values };
}

/** The middle value of a list (the median time taken); null for an empty one. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// ───────────────────────── Plain findings ─────────────────────────

/** The facts the findings are worked out from (all for the period and filters on screen). */
export interface AiFindingFacts {
  rate: number;
  helpers: readonly { feature: AiFeature; costUsd: number; share: number }[];
  /** India dates a limit for everything refused requests. */
  limitDays: readonly string[];
  busiestHour: { hour: number; requests: number } | null;
  /** Outlets at or past `nearCapPercent` of their daily cap today. */
  nearCap: readonly { name: string; percent: number }[];
  /** This month at its pace, against the monthly limit (null: none set). */
  forecast: { forecastUsd: number; monthlyLimitUsd: number | null } | null;
}

const rupeesText = (usd: number, rate: number) => `₹${Math.round(usd * rate).toLocaleString("en-IN")}`;
const dayText = (isoDate: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${isoDate}T00:00:00Z`));

/**
 * At most three short findings, worked out by rules from the numbers, most pressing first:
 * a month heading past its limit, days a limit refused requests, an outlet near its cap,
 * the helper that is most of the bill and why, the busiest hour. Plain words, no advice
 * the numbers do not support.
 */
export function aiFindings(facts: AiFindingFacts): string[] {
  const found: string[] = [];
  const { forecast, rate } = facts;
  if (forecast?.monthlyLimitUsd && forecast.forecastUsd > forecast.monthlyLimitUsd) {
    found.push(
      `At this pace the month ends near ${rupeesText(forecast.forecastUsd, rate)} (US$${forecast.forecastUsd.toFixed(2)}), over the US$${forecast.monthlyLimitUsd.toFixed(2)} monthly limit: requests will be refused before the month is out.`,
    );
  }
  if (facts.limitDays.length > 0) {
    const days = facts.limitDays.slice(0, 4).map(dayText).join(", ");
    found.push(
      `The limit for everything was reached on ${facts.limitDays.length === 1 ? days : `${facts.limitDays.length} days (${days}${facts.limitDays.length > 4 ? "…" : ""})`}: some requests were refused until the next day.`,
    );
  }
  const near = facts.nearCap[0];
  if (near) found.push(`${near.name} has used ${near.percent}% of its daily cap today${facts.nearCap.length > 1 ? `, and ${facts.nearCap.length - 1} more outlet${facts.nearCap.length > 2 ? "s are" : " is"} near theirs` : ""}.`);
  const biggest = [...facts.helpers].sort((a, b) => b.costUsd - a.costUsd)[0];
  if (biggest && biggest.costUsd > 0 && biggest.share >= 25) {
    const info = AI_HELPERS[biggest.feature];
    found.push(`${info.name} is ${biggest.share}% of the spend (${rupeesText(biggest.costUsd, rate)}) because ${info.why}.`);
  }
  if (facts.busiestHour && facts.busiestHour.requests > 0) {
    found.push(`Busiest hour: ${hourRange(facts.busiestHour.hour)}, with ${facts.busiestHour.requests.toLocaleString("en-IN")} requests.`);
  }
  return found.slice(0, AI_USAGE_RULES.findingsMax);
}

// ───────────────────────── Warnings ─────────────────────────

export type AiWarningKind = "SERVER_OFF" | "NO_KEY" | "CONSOLE_OFF" | "DAY" | "MONTH" | "CREDIT" | "FAILING";

/** A warning shown at the top of the page while it is true (nothing is refused by a warning). */
export interface AiWarningDto {
  kind: AiWarningKind;
  /** One short sentence. */
  text: string;
  /** "danger" when AI is not answering at all; "warning" otherwise. */
  level: "danger" | "warning";
}

export interface AiWarningFacts {
  rate: number;
  serverOn: boolean;
  keySet: boolean;
  consoleOn: boolean;
  todayUsd: number;
  dailyLimitUsd: number;
  dayPercent: number;
  monthUsd: number;
  monthlyLimitUsd: number | null;
  monthPercent: number;
  creditLeftUsd: number;
  creditUnderUsd: number;
  /** Today's tries that reached the model, and how many of them failed, by helper. */
  today: readonly { feature: AiFeature; tries: number; failed: number }[];
}

const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** The warnings that are true now: AI off, a limit's warning share passed, the credit low, a helper failing today. */
export function aiWarnings(facts: AiWarningFacts): AiWarningDto[] {
  const warnings: AiWarningDto[] = [];
  if (!facts.serverOn) warnings.push({ kind: "SERVER_OFF", level: "danger", text: "AI is switched off on the server (AI_FEATURES=off). It cannot be switched on from the console." });
  else if (!facts.keySet) warnings.push({ kind: "NO_KEY", level: "danger", text: "The server has no Anthropic API key, so every AI helper is off." });
  if (!facts.consoleOn) warnings.push({ kind: "CONSOLE_OFF", level: "danger", text: "All AI helpers are switched off in Settings." });
  const day = percentOf(facts.todayUsd, facts.dailyLimitUsd);
  if (facts.dailyLimitUsd > 0 && day >= facts.dayPercent) {
    warnings.push({
      kind: "DAY",
      level: "warning",
      text: `Today has used ${day}% of the US$${facts.dailyLimitUsd.toFixed(2)} daily limit (${rupeesText(facts.todayUsd, facts.rate)}).${day >= 100 ? " Requests are refused until midnight." : ""}`,
    });
  }
  if (facts.monthlyLimitUsd) {
    const month = percentOf(facts.monthUsd, facts.monthlyLimitUsd);
    if (month >= facts.monthPercent) {
      warnings.push({
        kind: "MONTH",
        level: "warning",
        text: `This month has used ${month}% of the US$${facts.monthlyLimitUsd.toFixed(2)} monthly limit.${month >= 100 ? " Requests are refused until the 1st." : ""}`,
      });
    }
  }
  if (facts.creditLeftUsd < facts.creditUnderUsd) {
    warnings.push({ kind: "CREDIT", level: "warning", text: `About US$${facts.creditLeftUsd.toFixed(2)} of credit is left on the key, under the US$${facts.creditUnderUsd.toFixed(2)} you set. Load more in Anthropic's console.` });
  }
  for (const helper of facts.today) {
    if (helper.tries >= AI_USAGE_RULES.failingMinTries && (helper.failed / helper.tries) * 100 > AI_USAGE_RULES.failingPercent) {
      warnings.push({
        kind: "FAILING",
        level: "warning",
        text: `${AI_HELPERS[helper.feature].name} has failed ${helper.failed} of ${helper.tries} tries today (${percentOf(helper.failed, helper.tries)}%).`,
      });
    }
  }
  return warnings;
}

// ───────────────────────── What the page is sent ─────────────────────────

export interface AiFacetOptionDto {
  value: string;
  label: string;
  count: number;
  /** An outlet's restaurant. */
  detail?: string | null;
}

/** One day of the spend chart. */
export interface AiDayDto {
  date: string;
  usd: number;
  requests: number;
  /** A limit refused requests that day: everyone's (daily or monthly), or the outlet's when one outlet is in view. */
  limitHit: boolean;
}

/** One helper's row, with its quality and speed. */
export interface AiHelperRowDto {
  feature: AiFeature;
  requests: number;
  costUsd: number;
  /** Its part of the period's spend, in whole percent. */
  share: number;
  /** Tries that reached the model (answered, failed, or thrown away by a check), and those that failed or were thrown away. */
  tries: number;
  failed: number;
  /** Refused by a limit or switched off. */
  refused: number;
  /** Middle time taken of the answered ones, in milliseconds. */
  medianMs: number | null;
  /** What people did with the answers, where the helper records it. */
  outcomes: { accepted: number; edited: number; discarded: number; helpful: number; notHelpful: number };
}

/** One outlet's row of "By restaurant". */
export interface AiOutletRowDto {
  /** "removed" for the one row that gathers outlets deleted since (test outlets): it opens nothing. */
  outletId: string;
  /** On the "removed" row: how many outlets it gathers. */
  removed?: number;
  outletName: string;
  organizationId: string | null;
  organizationName: string | null;
  /** Its active plan, or null (no plan). */
  plan: { name: string; pricePaise: number; cycle: string } | null;
  requests: number;
  costUsd: number;
  /** Invoiced in the period, before GST (void and draft invoices left out). */
  invoicedPaise: number;
  /** AI cost as a share of what it was invoiced, or null when it was invoiced nothing. */
  ofPayPercent: number | null;
  /** Its top helpers by cost. */
  top: AiFeature[];
  /** India dates its own daily cap refused requests. */
  capDays: string[];
}

export interface AiModelRowDto {
  model: string;
  requests: number;
  /** Every input token, the cached ones included. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/** Everything on the overview, for the period and filters asked for. */
export interface AiOverviewDto {
  today: string;
  range: { from: string; to: string; days: number };
  /** ₹ to one US$, as set. */
  rate: number;
  cards: {
    spent: { usd: number; requests: number };
    /** The key's credit: not narrowed by the filters (it is one key for everything). */
    credit: { creditUsd: number; loadedOn: string; spentSinceUsd: number; leftUsd: number; fraction: number; lastsDays: number | null };
    /** Today, with the filters; against the outlet's cap when one outlet is in view. */
    today: { usd: number; limitUsd: number; percent: number; against: "everything" | "outlet" };
    /** Restaurant AI cost per paying kitchen, at this period's pace for a month. */
    perKitchen: { usdMonth: number | null; payingKitchens: number; cheapestPlan: { name: string; monthlyPaise: number } | null };
    refused: { requests: number; outletsCapped: number };
  };
  /** The spend chart: at least two weeks, ending on the period's last day. */
  daily: {
    days: AiDayDto[];
    limitUsd: number;
    against: "everything" | "outlet";
    busiestHour: { hour: number; requests: number } | null;
    quiet: { weekday: string; usd: number } | null;
  };
  /** This month (whatever the period) at its pace, with the filters. */
  forecast: { monthUsd: number; forecastUsd: number; daysGone: number; daysInMonth: number; monthlyLimitUsd: number | null };
  helpers: AiHelperRowDto[];
  /** Spend by where it ran: the apps, the console, the server's own work. */
  bySource: { source: AiSource | null; usd: number }[];
  outlets: AiOutletRowDto[];
  /** ECCS's own use: requests with no outlet, and ECCS's own helpers (the digest, the write-up, the shop board). */
  eccsOwn: { requests: number; costUsd: number; top: AiFeature[] };
  /** Invoiced across the outlets in the table, before GST. */
  invoicedPaise: number;
  models: AiModelRowDto[];
  findings: string[];
  facets: {
    organizations: AiFacetOptionDto[];
    outlets: AiFacetOptionDto[];
    features: AiFacetOptionDto[];
    models: AiFacetOptionDto[];
    sources: AiFacetOptionDto[];
    results: AiFacetOptionDto[];
  };
}

/** One row of the request log. Never any words of a prompt or an answer: the log never holds them. */
export interface AiRequestEntryDto {
  id: string;
  at: string;
  feature: string;
  model: string;
  source: AiSource | null;
  organizationId: string | null;
  organizationName: string | null;
  outletId: string | null;
  outletName: string | null;
  person: { name: string; role: string | null } | null;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  status: AiStatus;
  /** Why it failed or was refused (TIMEOUT, OUTLET_LIMIT...). */
  errorCode: string | null;
  outcome: string | null;
  /** The kind of answer only (the camera nudge's verdict, Buddy's tools). */
  resultCode: string | null;
}

export interface AiRequestPageDto {
  entries: AiRequestEntryDto[];
  nextCursor: string | null;
  /** Rows under the filters, all pages. */
  total: number;
}

export interface AiAlertsDto {
  warnings: AiWarningDto[];
}

/** The statuses a result filter stands for. */
export const statusesOf = (results: readonly AiResult[]): AiStatus[] => results.map((result) => AI_RESULT_STATUS[result]);

/** Every status, for checks. */
export const AI_ALL_STATUSES: readonly AiStatus[] = AI_STATUSES;
