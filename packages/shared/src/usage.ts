import { z } from "zod";
import { ROLE_LABELS } from "./activity-log.js";
import { addDays, daysFrom } from "./finance.js";
import { ECCS_ROLES, RESTAURANT_ROLES, type Role } from "./roles.js";

// Usage (23 Oct 2026, the founder: "add the usage analytics"): who uses the restaurant app,
// the Supervisor's app and the console, how often, and which parts, for the console's Usage
// page. The Super Admin only.
//
// How it is counted. Each app notes the screen a logged-in person opens and sends the notes
// every half minute. The server keeps one row per person, day, app and screen with how many
// times it was opened, and nothing else: no ids of the records looked at, no search words,
// no times beyond the first and last of the day. Nobody is counted while nobody is logged in
// (the PIN pad, the clock-in screen), so restaurant staff without a login never are. Rows go
// after USAGE_RULES.keepDays. The Logs page still records what people change; this page says
// how much the apps are used.
//
// PATTERN FOLLOWED: the usage pages of established products. Pendo's account overview
// (accounts active today, in 7 days and in 30 days; feature use by account), Mixpanel's
// company profile (daily, weekly and monthly active users; activity per user), Google
// Workspace's apps usage report (active users, and each user's last activity), the stickiness
// ratio (daily active ÷ monthly active: Pendo, Gainsight), Metabase's feature-adoption guide
// (daily rollups per feature and account; accounts using it less, 28 days against the 28
// before), and Plausible's one-page dashboard of top pages counted without cookies or trackers.
// For a business tool used weekly, weekly active users is the main figure (Gainsight).

export const USAGE_RULES = {
  /** Rows are kept this many days, then deleted by a daily job (as the activity log). */
  keepDays: 365,
  /** At most this many screen opens in one call. */
  maxBatch: 50,
  maxScreenLength: 120,
  /** How often the apps send what they have noted. */
  sendEveryMs: 30_000,
  /** The most notes an app keeps while it cannot send them (no signal). */
  maxWaiting: 200,
  /** An open noted more than this long ago is counted on the day it arrives. */
  lateHours: 48,
  /** "Used less": the last 28 days against the 28 before. */
  compareDays: 28,
  /** A fall of this much or more in days used is "used less". */
  dropPercent: 30,
  /** Not used for this many days or more: "no use for N days". */
  quietDays: 7,
  /** The top screens listed. */
  topScreens: 25,
} as const;

export const USAGE_APPS = ["APP", "CONSOLE"] as const;
export type UsageApp = (typeof USAGE_APPS)[number];
export const USAGE_APP_LABELS: Record<UsageApp, string> = { APP: "Phone app", CONSOLE: "Console" };

export const USAGE_PERIODS = [7, 30, 90] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export const USAGE_SEGMENTS = ["restaurants", "team"] as const;
export type UsageSegment = (typeof USAGE_SEGMENTS)[number];

/** Who each segment counts: restaurants' logins, or ECCS's own team. */
export const USAGE_SEGMENT_ROLES: Record<UsageSegment, readonly Role[]> = { restaurants: RESTAURANT_ROLES, team: ECCS_ROLES };

// ───────────────────────── Screens ─────────────────────────

/** A screen's name as kept: the route's pattern ("/team/[staffId]"), with at most a console tab ("?tab=health"). */
const SCREEN = /^\/[A-Za-z0-9_\-[\]/.]*(\?tab=[a-z0-9-]{1,30})?$/;

/** A segment that looks like a record's id (a uuid, or a long run with digits), never kept as it is. */
const LOOKS_LIKE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-|^(?=.*\d)[A-Za-z0-9_-]{16,}$|^\d+$/i;

/** The phone app's screen from expo-router's segments: the groups ("(app)") and "index" left out. */
export function usageScreenFromSegments(segments: readonly string[]): string {
  const parts = segments.filter((segment) => !/^\(.*\)$/.test(segment) && segment !== "index").map((segment) => (LOOKS_LIKE_ID.test(segment) ? "[id]" : segment));
  return `/${parts.join("/")}`;
}

/**
 * A console page's screen from its address: each part filled in by a route parameter is put
 * back as its name ("/team/3f2…" becomes "/team/[id]"), and a page's tab is kept.
 */
export function usageScreenFromPath(pathname: string, params: Readonly<Record<string, string | string[] | undefined>>, tab?: string | null): string {
  const named = new Map<string, string>();
  for (const [name, value] of Object.entries(params)) for (const one of Array.isArray(value) ? value : value ? [value] : []) named.set(one, name);
  const parts = pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      const decoded = safeDecode(part);
      const name = named.get(decoded);
      return name ? `[${name}]` : LOOKS_LIKE_ID.test(decoded) ? "[id]" : decoded;
    });
  const base = `/${parts.join("/")}`;
  return tab && /^[a-z0-9-]{1,30}$/.test(tab) ? `${base}?tab=${tab}` : base;
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export const isUsageScreen = (screen: string) => screen.length <= USAGE_RULES.maxScreenLength && SCREEN.test(screen);

/** The parts of the apps, for "which parts are used". */
export const USAGE_AREAS = {
  // The phone app
  home: "Home",
  checklists: "Daily checklists",
  services: "Services and visits",
  inspections: "Inspections",
  certificates: "Certificates",
  documents: "Licences and documents",
  billing: "Invoices and plan",
  sops: "SOPs",
  labels: "Food labels",
  staff: "Team and attendance",
  buddy: "ECCS Buddy",
  score: "Score and calendar",
  customerPage: "Customer page",
  vendors: "Vendors",
  support: "Issues and support",
  notifications: "Notifications",
  profile: "Profile and legal",
  sales: "Sales",
  // The console's own sections (its menu's names), and the rest of it
  today: "Today",
  visits: "Visits",
  issues: "Issues",
  quality: "Quality",
  clients: "Clients",
  invoices: "Invoices",
  finance: "Finance",
  team: "ECCS team",
  joining: "Joining ECCS",
  aiUsage: "AI usage",
  usage: "Usage",
  catalogue: "Catalogue",
  plans: "Plans",
  logs: "Logs",
  other: "Other",
} as const;
export type UsageArea = keyof typeof USAGE_AREAS;

/** The phone app's part by a screen's first segment. */
const APP_AREA: Record<string, UsageArea> = {
  "": "home",
  checklists: "checklists",
  services: "services",
  inspections: "inspections",
  certificates: "certificates",
  documents: "documents",
  invoices: "billing",
  plan: "billing",
  sops: "sops",
  labels: "labels",
  team: "staff",
  staff: "staff",
  clock: "staff",
  buddy: "buddy",
  score: "score",
  history: "score",
  "customer-page": "customerPage",
  vendors: "vendors",
  support: "support",
  notifications: "notifications",
  profile: "profile",
  legal: "profile",
  accept: "profile",
  sales: "sales",
};

/** The console's part by a page's first segment. */
const CONSOLE_AREA: Record<string, UsageArea> = {
  "": "today",
  visits: "visits",
  inspections: "inspections",
  issues: "issues",
  quality: "quality",
  "customer-pages": "quality",
  clients: "clients",
  monitoring: "clients",
  invoices: "invoices",
  certificates: "certificates",
  sales: "sales",
  finance: "finance",
  team: "team",
  joining: "joining",
  "ai-usage": "aiUsage",
  usage: "usage",
  catalogue: "catalogue",
  plans: "plans",
  sops: "sops",
  logs: "logs",
  notifications: "notifications",
};

/** Names for the screens, in words. A screen not listed is shown by its address. */
const APP_SCREENS: Record<string, string> = {
  "/": "Home",
  "/accept": "Agreeing to the terms",
  "/legal/[key]": "A legal document",
  "/buddy": "ECCS Buddy",
  "/buddy/chats": "Buddy's past chats",
  "/certificates": "Certificates",
  "/checklists": "Daily checklists",
  "/checklists/[runId]": "A checklist",
  "/checklists/setup": "Edit checklists",
  "/clock": "Clock in or out",
  "/customer-page": "Customer page",
  "/customer-page/from-checks": "Customer page photos from daily checks",
  "/customer-page/propose": "Propose customer page photos",
  "/documents": "Licences and documents",
  "/history": "Calendar",
  "/inspections": "Inspections",
  "/inspections/[inspectionId]": "An inspection",
  "/inspections/start": "Start an inspection",
  "/invoices": "Invoices",
  "/invoices/[invoiceId]": "An invoice",
  "/invoices/pay": "Paying an invoice",
  "/invoices/receipt": "A receipt",
  "/labels": "Food labels",
  "/labels/item": "Printing a label",
  "/labels/items": "Saved labels",
  "/labels/new": "A new label",
  "/labels/starter": "Starter labels",
  "/notifications": "Notifications",
  "/plan": "Plan",
  "/profile": "Profile",
  "/sales": "Leads",
  "/sales/[leadId]": "A lead",
  "/sales/check": "Free hygiene check",
  "/sales/edit": "Editing a lead",
  "/sales/new": "Logging a lead",
  "/sales/quote": "A quote",
  "/score": "Hygiene score",
  "/services": "Services",
  "/services/[visitId]": "A visit",
  "/services/book": "Booking a service",
  "/sops": "SOPs",
  "/sops/[sopId]": "An SOP",
  "/sops/edit": "Editing an SOP",
  "/sops/library": "SOP library",
  "/sops/library/[itemId]": "A library SOP",
  "/staff": "App logins",
  "/support": "Issues and support",
  "/support/[issueId]": "An issue",
  "/team": "Team",
  "/team/[staffId]": "A team member",
  "/team/attendance": "Attendance",
  "/team/day": "Attendance, one day",
  "/team/face": "Setting up a face",
  "/team/month": "Attendance, the month",
  "/team/pay": "Staff pay",
  "/team/person": "Adding or editing a person",
  "/team/review": "Attendance to review",
  "/team/salary": "Salary",
  "/team/settings": "Attendance settings",
  "/vendors": "Vendors",
  "/vendors/[vendorId]": "A vendor",
};

const CONSOLE_SCREENS: Record<string, string> = {
  "/": "Today",
  "/visits": "Visits",
  "/inspections": "Inspections",
  "/issues": "Issues",
  "/quality": "Quality",
  "/quality/incidents/[id]": "An incident",
  "/customer-pages": "Customer pages",
  "/clients": "Clients",
  "/monitoring": "Monitoring",
  "/invoices": "Invoices",
  "/certificates": "Certificates",
  "/sales": "Sales",
  "/sales/leads": "Leads",
  "/sales/leads/[id]": "A lead",
  "/sales/quotes": "Quotes",
  "/finance": "Finance",
  "/finance/expenses": "Expenses",
  "/team": "Team",
  "/team/[id]": "A team member",
  "/team/onboarding": "Onboarding checklists",
  "/team/onboarding/handbook": "Staff handbook",
  "/joining": "Joining ECCS",
  "/joining/details": "Joining: details",
  "/joining/handbook": "Joining: handbook",
  "/joining/letter": "Joining: appointment letter",
  "/ai-usage": "AI usage",
  "/usage": "Usage",
  "/catalogue": "Catalogue",
  "/plans": "Plans",
  "/sops": "SOPs",
  "/logs": "Logs",
  "/notifications": "Notifications",
};

/** A screen's part of the app and its name in words. */
export function usageScreenInfo(app: UsageApp, screen: string): { area: UsageArea; label: string } {
  const [path = "/", tab] = screen.split("?tab=");
  const first = path.split("/")[1] ?? "";
  const area = (app === "APP" ? APP_AREA : CONSOLE_AREA)[first] ?? "other";
  const named = (app === "APP" ? APP_SCREENS : CONSOLE_SCREENS)[path];
  const base = named ?? path;
  return { area, label: tab ? `${base}: ${tab.replace(/-/g, " ")}` : base };
}

// ───────────────────────── What the apps send ─────────────────────────

export const usageViewsSchema = z.object({
  app: z.enum(USAGE_APPS),
  views: z
    .array(
      z.object({
        screen: z.string().max(USAGE_RULES.maxScreenLength).refine(isUsageScreen, "Not a screen's name"),
        /** When it was opened, by the phone's clock. */
        at: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(USAGE_RULES.maxBatch),
});
export type UsageViewsInput = z.input<typeof usageViewsSchema>;

/** The day an open is counted on: the day it happened, unless the phone's clock is ahead or the note came too late. */
export function usageDayOf(at: string, receivedAt: Date): Date {
  const when = new Date(at);
  const late = receivedAt.getTime() - when.getTime() > USAGE_RULES.lateHours * 3_600_000;
  const ahead = when.getTime() > receivedAt.getTime() + 5 * 60_000;
  return late || ahead || Number.isNaN(when.getTime()) ? receivedAt : when;
}

// ───────────────────────── The page's question ─────────────────────────

export const usageQuerySchema = z.object({
  days: z
    .enum(["7", "30", "90"])
    .default("30")
    .transform((value) => Number(value) as UsagePeriod),
  segment: z.enum(USAGE_SEGMENTS).default("restaurants"),
  /** One restaurant only. */
  restaurant: z.uuid().optional(),
});
export type UsageQuery = z.output<typeof usageQuerySchema>;

// ───────────────────────── Working it out ─────────────────────────

/** One kept row, as the overview reads it. */
export interface UsageRowFacts {
  /** The day in India, "YYYY-MM-DD". */
  day: string;
  userId: string;
  role: Role;
  organizationId: string | null;
  app: UsageApp;
  screen: string;
  views: number;
}

/** A login the segment counts, whether or not it was used. */
export interface UsagePersonFacts {
  id: string;
  name: string;
  role: Role;
  organizationId: string | null;
  /** Their last day of use in everything kept; null when never. */
  lastActiveOn: string | null;
}

export interface UsageRestaurantFacts {
  id: string;
  name: string;
  lastActiveOn: string | null;
}

export interface UsageTilesDto {
  activeToday: number;
  active7: number;
  active30: number;
  /** Logins the segment counts (restaurant logins, or ECCS team members). */
  logins: number;
  /** Average daily active people over the last 30 days ÷ people active in those 30 days, as a percent; null when nobody was. */
  stickiness: number | null;
  /** Restaurants only. */
  restaurantsActive7: number | null;
  restaurantsTotal: number | null;
}

export interface UsageDayDto {
  date: string;
  people: number;
  views: number;
}

export type UsageRestaurantState = "QUIET" | "DOWN" | "NEVER" | "NEW" | "OK";

export interface UsageRestaurantDto {
  id: string;
  name: string;
  logins: number;
  active7: number;
  /** Days on which anyone used it, of the last 30. */
  daysActive30: number;
  lastActiveOn: string | null;
  /** Days used in the last 28 against the 28 before, in percent; null with nothing before. */
  change: number | null;
  state: UsageRestaurantState;
  /** "No use for 9 days", "Used less: 45% fewer days", "Not used yet", "New", null when fine. */
  stateWords: string | null;
  views: number;
  topArea: string | null;
}

export interface UsageAreaDto {
  area: UsageArea;
  label: string;
  people: number;
  restaurants: number;
  views: number;
}

export interface UsageScreenDto {
  app: UsageApp;
  screen: string;
  label: string;
  areaLabel: string;
  views: number;
  people: number;
}

export interface UsagePersonDto {
  id: string;
  name: string;
  role: Role;
  roleLabel: string;
  organizationId: string | null;
  organizationName: string | null;
  daysActive: number;
  views: number;
  lastActiveOn: string | null;
  apps: UsageApp[];
}

export interface UsageOverviewDto {
  today: string;
  range: { from: string; to: string; days: UsagePeriod };
  segment: UsageSegment;
  restaurant: { id: string; name: string } | null;
  tiles: UsageTilesDto;
  daily: UsageDayDto[];
  /** Restaurants only; empty for the team. Those needing a look come first. */
  restaurants: UsageRestaurantDto[];
  /** Restaurants that used anything in the period: the whole for each part's share. */
  restaurantsActive: number;
  areas: UsageAreaDto[];
  screens: UsageScreenDto[];
  people: UsagePersonDto[];
  /** The restaurants to choose one from (every one, by name). */
  restaurantChoices: { id: string; name: string }[];
  keepDays: number;
}

export interface UsageOverviewInput {
  rows: readonly UsageRowFacts[];
  people: readonly UsagePersonFacts[];
  restaurants: readonly UsageRestaurantFacts[];
  today: string;
  days: UsagePeriod;
  segment: UsageSegment;
  restaurantId: string | null;
}

const within = (day: string, from: string, to: string) => day >= from && day <= to;
const distinct = <T>(values: Iterable<T>) => new Set(values).size;

/** The longer of the period and the comparison: how far back the overview must be given rows. */
export const usageRowsFrom = (today: string, days: UsagePeriod) => addDays(today, -(Math.max(days, USAGE_RULES.compareDays * 2) - 1));

/** "Used less" and the rest, from the days a restaurant was used. */
export function restaurantState(input: { lastActiveOn: string | null; recentDays: number; priorDays: number; today: string }): { state: UsageRestaurantState; words: string | null; change: number | null } {
  const change = input.priorDays === 0 ? null : Math.round(((input.recentDays - input.priorDays) / input.priorDays) * 100);
  if (input.lastActiveOn === null) return { state: "NEVER", words: "Not used yet", change };
  const quiet = daysFrom(input.lastActiveOn, input.today);
  if (quiet >= USAGE_RULES.quietDays) return { state: "QUIET", words: `No use for ${quiet} days`, change };
  if (change !== null && change <= -USAGE_RULES.dropPercent) return { state: "DOWN", words: `Used less: ${-change}% fewer days`, change };
  if (input.priorDays === 0 && input.recentDays > 0) return { state: "NEW", words: "New this month", change };
  return { state: "OK", words: null, change };
}

const STATE_ORDER: Record<UsageRestaurantState, number> = { QUIET: 0, DOWN: 1, NEVER: 2, NEW: 3, OK: 3 };

/** Everything on the Usage page from the kept rows. Pure, so the server and the tests agree. */
export function usageOverview(input: UsageOverviewInput): Omit<UsageOverviewDto, "restaurant" | "restaurantChoices" | "keepDays" | "segment"> {
  const { today, days } = input;
  const roles = USAGE_SEGMENT_ROLES[input.segment];
  const inOrg = (organizationId: string | null) => input.restaurantId === null || organizationId === input.restaurantId;
  const rows = input.rows.filter((row) => roles.includes(row.role) && inOrg(row.organizationId));
  const people = input.people.filter((person) => roles.includes(person.role) && inOrg(person.organizationId));
  const restaurants = input.segment === "restaurants" ? input.restaurants.filter((restaurant) => inOrg(restaurant.id)) : [];

  const from = addDays(today, -(days - 1));
  const last7 = addDays(today, -6);
  const last30 = addDays(today, -29);
  const recentFrom = addDays(today, -(USAGE_RULES.compareDays - 1));
  const priorFrom = addDays(today, -(USAGE_RULES.compareDays * 2 - 1));
  const priorTo = addDays(today, -USAGE_RULES.compareDays);
  const period = rows.filter((row) => within(row.day, from, today));
  const usersOn = (list: readonly UsageRowFacts[]) => distinct(list.map((row) => row.userId));

  // ── The tiles ──
  const month = rows.filter((row) => within(row.day, last30, today));
  const active30 = usersOn(month);
  let dailyTotal = 0;
  for (let offset = 0; offset < 30; offset++) {
    const day = addDays(today, -offset);
    dailyTotal += usersOn(month.filter((row) => row.day === day));
  }
  const week = rows.filter((row) => within(row.day, last7, today));
  const tiles: UsageTilesDto = {
    activeToday: usersOn(rows.filter((row) => row.day === today)),
    active7: usersOn(week),
    active30,
    logins: people.length,
    stickiness: active30 === 0 ? null : Math.round((dailyTotal / 30 / active30) * 100),
    restaurantsActive7: input.segment === "restaurants" ? distinct(week.map((row) => row.organizationId).filter(Boolean)) : null,
    restaurantsTotal: input.segment === "restaurants" ? restaurants.length : null,
  };

  // ── Day by day ──
  const daily: UsageDayDto[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = addDays(today, -offset);
    const on = period.filter((row) => row.day === day);
    daily.push({ date: day, people: usersOn(on), views: on.reduce((sum, row) => sum + row.views, 0) });
  }

  const areaOf = (row: UsageRowFacts) => usageScreenInfo(row.app, row.screen).area;

  // ── Restaurants ──
  const restaurantRows: UsageRestaurantDto[] = restaurants.map((restaurant) => {
    const own = rows.filter((row) => row.organizationId === restaurant.id);
    const ownPeriod = own.filter((row) => within(row.day, from, today));
    const daysIn = (start: string, end: string) => distinct(own.filter((row) => within(row.day, start, end)).map((row) => row.day));
    const recentDays = daysIn(recentFrom, today);
    const priorDays = daysIn(priorFrom, priorTo);
    const { state, words, change } = restaurantState({ lastActiveOn: restaurant.lastActiveOn, recentDays, priorDays, today });
    const byArea = new Map<UsageArea, number>();
    for (const row of ownPeriod) byArea.set(areaOf(row), (byArea.get(areaOf(row)) ?? 0) + row.views);
    const top = [...byArea.entries()].filter(([area]) => area !== "home").sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      id: restaurant.id,
      name: restaurant.name,
      logins: input.people.filter((person) => person.organizationId === restaurant.id && roles.includes(person.role)).length,
      active7: usersOn(own.filter((row) => within(row.day, last7, today))),
      daysActive30: daysIn(last30, today),
      lastActiveOn: restaurant.lastActiveOn,
      change,
      state,
      stateWords: words,
      views: ownPeriod.reduce((sum, row) => sum + row.views, 0),
      topArea: top ? USAGE_AREAS[top] : null,
    };
  });
  restaurantRows.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.daysActive30 - a.daysActive30 || a.name.localeCompare(b.name));

  // ── Parts of the apps ──
  const areas = new Map<UsageArea, { users: Set<string>; orgs: Set<string>; views: number }>();
  for (const row of period) {
    const area = areaOf(row);
    const entry = areas.get(area) ?? { users: new Set<string>(), orgs: new Set<string>(), views: 0 };
    entry.users.add(row.userId);
    if (row.organizationId) entry.orgs.add(row.organizationId);
    entry.views += row.views;
    areas.set(area, entry);
  }
  const areaRows: UsageAreaDto[] = [...areas.entries()]
    .map(([area, entry]) => ({ area, label: USAGE_AREAS[area], people: entry.users.size, restaurants: entry.orgs.size, views: entry.views }))
    .sort((a, b) => b.restaurants - a.restaurants || b.people - a.people || b.views - a.views);

  // ── Screens ──
  const screens = new Map<string, { app: UsageApp; screen: string; users: Set<string>; views: number }>();
  for (const row of period) {
    const key = `${row.app} ${row.screen}`;
    const entry = screens.get(key) ?? { app: row.app, screen: row.screen, users: new Set<string>(), views: 0 };
    entry.users.add(row.userId);
    entry.views += row.views;
    screens.set(key, entry);
  }
  const screenRows: UsageScreenDto[] = [...screens.values()]
    .map((entry) => {
      const info = usageScreenInfo(entry.app, entry.screen);
      return { app: entry.app, screen: entry.screen, label: info.label, areaLabel: USAGE_AREAS[info.area], views: entry.views, people: entry.users.size };
    })
    .sort((a, b) => b.views - a.views || b.people - a.people || a.label.localeCompare(b.label))
    .slice(0, USAGE_RULES.topScreens);

  // ── People ──
  const names = new Map(input.restaurants.map((restaurant) => [restaurant.id, restaurant.name]));
  const known = new Map(people.map((person) => [person.id, person]));
  // Someone counted whose login has since gone still shows, as a removed login.
  for (const row of period) {
    if (!known.has(row.userId)) known.set(row.userId, { id: row.userId, name: "A removed login", role: row.role, organizationId: row.organizationId, lastActiveOn: null });
  }
  const personRows: UsagePersonDto[] = [...known.values()].map((person) => {
    const own = period.filter((row) => row.userId === person.id);
    const last = person.lastActiveOn ?? own.reduce<string | null>((latest, row) => (latest === null || row.day > latest ? row.day : latest), null);
    return {
      id: person.id,
      name: person.name,
      role: person.role,
      roleLabel: ROLE_LABELS[person.role],
      organizationId: person.organizationId,
      organizationName: person.organizationId ? (names.get(person.organizationId) ?? null) : null,
      daysActive: distinct(own.map((row) => row.day)),
      views: own.reduce((sum, row) => sum + row.views, 0),
      lastActiveOn: last,
      apps: USAGE_APPS.filter((app) => own.some((row) => row.app === app)),
    };
  });
  personRows.sort((a, b) => (b.lastActiveOn ?? "").localeCompare(a.lastActiveOn ?? "") || b.views - a.views || a.name.localeCompare(b.name));

  return {
    today,
    range: { from, to: today, days },
    tiles,
    daily,
    restaurants: restaurantRows,
    restaurantsActive: distinct(period.map((row) => row.organizationId).filter(Boolean)),
    areas: areaRows,
    screens: screenRows,
    people: personRows,
  };
}

/** "today", "yesterday", "3 days ago", "12 Oct", for a last day of use. */
export function lastActiveWords(day: string | null, today: string): string {
  if (day === null) return "Never";
  const ago = daysFrom(day, today);
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago < 7) return `${ago} days ago`;
  const [, month, date] = day.split("-");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
}
