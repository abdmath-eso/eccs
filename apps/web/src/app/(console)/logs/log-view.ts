import {
  ACTIVITY_CATEGORY_KEYS,
  ACTIVITY_ENTITY_LABELS,
  ACTIVITY_RESULTS,
  AI_FEATURES,
  AI_OUTCOMES,
  AI_STATUSES,
  ROLES,
  type ActivitySource,
} from "@eccs/shared";
import type { ActivityLogFilters } from "@eccs/api-client";

import { addDays, rupees, today } from "@/lib/format";

// What the Logs page is showing, kept in the web address so a filtered view can be
// bookmarked, shared, refreshed and brought back with the Back button. This file
// reads the address into a typed "view", turns the view into the API's filters,
// and holds the page's English words for the codes the API sends.

// ───────────────────────── The period ─────────────────────────

export const PERIODS = [
  { value: "1h", label: "Last hour" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom dates" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];
export const DEFAULT_PERIOD: Period = "7d";

// ───────────────────────── The quick tabs ─────────────────────────

/**
 * Where it happened. Every tab but AI is a source; AI is the AI area, whichever app
 * asked for it. System also holds the public pages (a customer page or a document
 * link opened without a login), which are not any of the apps.
 */
export const TABS = [
  { value: "all", label: "All" },
  { value: "restaurant", label: "Restaurant app" },
  { value: "supervisor", label: "Supervisor app" },
  { value: "console", label: "Console" },
  { value: "ai", label: "AI" },
  { value: "system", label: "System" },
] as const;
export type Tab = (typeof TABS)[number]["value"];

const TAB_SOURCES: Record<Exclude<Tab, "all" | "ai">, ActivitySource[]> = {
  restaurant: ["RESTAURANT_APP"],
  supervisor: ["SUPERVISOR_APP"],
  console: ["CONSOLE"],
  system: ["SYSTEM", "PUBLIC"],
};

// ───────────────────────── The address ─────────────────────────

/** The names used in the web address, kept short and readable (`?restaurant=…&result=REFUSED`). */
export const KEY = {
  period: "period",
  from: "from",
  to: "to",
  q: "q",
  tab: "tab",
  failures: "failures",
  organization: "restaurant",
  outlet: "outlet",
  person: "person",
  role: "role",
  area: "area",
  action: "action",
  result: "result",
  record: "record",
  recordId: "recordId",
  reference: "ref",
  ip: "ip",
  device: "device",
  request: "request",
  offline: "offline",
  aiFeature: "feature",
  aiModel: "model",
  aiStatus: "aiResult",
  aiOutcome: "outcome",
  /** The event open in the side panel. Not a filter. */
  event: "event",
} as const;

/** Every address key that filters the list (all but the open event). */
export const FILTER_KEYS = Object.values(KEY).filter((key) => key !== KEY.event);

/** The filters that only mean something under the AI tab, dropped when leaving it. */
export const AI_KEYS = [KEY.aiFeature, KEY.aiModel, KEY.aiStatus, KEY.aiOutcome] as const;

/** The list filters, by their address key. */
export type ListKey =
  | typeof KEY.organization
  | typeof KEY.outlet
  | typeof KEY.person
  | typeof KEY.role
  | typeof KEY.area
  | typeof KEY.action
  | typeof KEY.result
  | typeof KEY.aiFeature
  | typeof KEY.aiModel
  | typeof KEY.aiStatus
  | typeof KEY.aiOutcome;

export interface LogView {
  period: Period;
  /** Custom dates, YYYY-MM-DD, India time. */
  from: string;
  to: string;
  q: string;
  tab: Tab;
  failuresOnly: boolean;
  lists: Record<ListKey, string[]>;
  record: string;
  recordId: string;
  reference: string;
  ip: string;
  device: string;
  request: string;
  offline: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Values a hand-edited address might carry that the API would refuse are dropped here, not sent. */
const ALLOWED: Partial<Record<ListKey, readonly string[]>> = {
  [KEY.role]: ROLES,
  [KEY.area]: ACTIVITY_CATEGORY_KEYS,
  [KEY.result]: ACTIVITY_RESULTS,
  [KEY.aiFeature]: AI_FEATURES,
  [KEY.aiStatus]: AI_STATUSES,
  [KEY.aiOutcome]: AI_OUTCOMES,
};

const LIST_KEYS: ListKey[] = [
  KEY.organization,
  KEY.outlet,
  KEY.person,
  KEY.role,
  KEY.area,
  KEY.action,
  KEY.result,
  KEY.aiFeature,
  KEY.aiModel,
  KEY.aiStatus,
  KEY.aiOutcome,
];

/** "a,b" in the address → ["a", "b"]. */
export const splitList = (text: string | null) =>
  (text ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item.length <= 80);

const short = (text: string | null, max = 64) => (text ?? "").trim().slice(0, max);

/** Reads the page's view from the web address. */
export function readView(params: URLSearchParams): LogView {
  const period = (PERIODS.find((p) => p.value === params.get(KEY.period))?.value ?? DEFAULT_PERIOD) as Period;
  const tab = (TABS.find((t) => t.value === params.get(KEY.tab))?.value ?? "all") as Tab;
  const lists = {} as Record<ListKey, string[]>;
  for (const key of LIST_KEYS) {
    const allowed = ALLOWED[key];
    lists[key] = splitList(params.get(key)).filter((value) => !allowed || allowed.includes(value));
  }
  const from = params.get(KEY.from) ?? "";
  const to = params.get(KEY.to) ?? "";
  return {
    period,
    from: DAY.test(from) ? from : "",
    to: DAY.test(to) ? to : "",
    q: short(params.get(KEY.q), 100),
    tab,
    failuresOnly: params.get(KEY.failures) === "1",
    lists,
    record: short(params.get(KEY.record), 40),
    recordId: short(params.get(KEY.recordId)),
    reference: short(params.get(KEY.reference), 60),
    ip: short(params.get(KEY.ip)),
    device: short(params.get(KEY.device)),
    request: short(params.get(KEY.request)),
    offline: params.get(KEY.offline) === "1",
  };
}

/**
 * The filters of the address alone, as address text: it changes whenever a filter
 * changes (and not when an event is opened), to know when to load again, and reads
 * back into the same view with `readView(new URLSearchParams(key))`.
 */
export function filterKey(params: URLSearchParams) {
  const kept = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  return kept.toString();
}

/** True when anything but the period and the tab narrows the list. */
export function hasFilters(view: LogView) {
  return (
    view.q !== "" ||
    view.failuresOnly ||
    view.offline ||
    Object.values(view.lists).some((list) => list.length > 0) ||
    [view.record, view.recordId, view.reference, view.ip, view.device, view.request].some(Boolean)
  );
}

/** The period's start and end for the API. Worked out when loading, as "the last hour" moves on. */
export function periodRange(view: LogView, now: number): { from?: string; to?: string } {
  const day = today();
  switch (view.period) {
    case "1h":
      return { from: new Date(now - 3_600_000).toISOString() };
    case "today":
      return { from: day, to: day };
    case "yesterday":
      return { from: addDays(day, -1), to: addDays(day, -1) };
    case "30d":
      return { from: addDays(day, -29) };
    case "custom": {
      // Dates typed the wrong way round are read the right way round.
      const [from, to] = view.from && view.to && view.from > view.to ? [view.to, view.from] : [view.from, view.to];
      return { from: from || undefined, to: to || undefined };
    }
    default:
      return { from: addDays(day, -6) };
  }
}

/** The time now, for working out "the last hour" when the page loads or exports. */
export const now = () => Date.now();

/** True when the period reaches today, so Live can bring in new events. */
export function periodIsCurrent(view: LogView) {
  if (view.period === "yesterday") return false;
  if (view.period !== "custom") return true;
  const range = periodRange(view, 0);
  return !range.to || range.to >= today();
}

/** The view as the API's filters. */
export function apiFilters(view: LogView, now: number): ActivityLogFilters {
  const ai = view.tab === "ai";
  const { lists } = view;
  return {
    ...periodRange(view, now),
    source: view.tab === "all" || view.tab === "ai" ? undefined : TAB_SOURCES[view.tab],
    category: ai ? ["ai"] : lists[KEY.area],
    action: ai ? undefined : lists[KEY.action],
    organizationId: lists[KEY.organization],
    outletId: lists[KEY.outlet],
    actorUserId: lists[KEY.person],
    role: lists[KEY.role] as ActivityLogFilters["role"],
    result: lists[KEY.result] as ActivityLogFilters["result"],
    failuresOnly: view.failuresOnly ? "1" : undefined,
    entityType: view.record || undefined,
    entityId: view.recordId || undefined,
    reference: view.reference || undefined,
    ip: view.ip || undefined,
    deviceId: view.device || undefined,
    requestId: view.request || undefined,
    offline: view.offline ? "1" : undefined,
    aiFeature: ai ? (lists[KEY.aiFeature] as ActivityLogFilters["aiFeature"]) : undefined,
    aiModel: ai ? lists[KEY.aiModel] : undefined,
    aiStatus: ai ? (lists[KEY.aiStatus] as ActivityLogFilters["aiStatus"]) : undefined,
    aiOutcome: ai ? (lists[KEY.aiOutcome] as ActivityLogFilters["aiOutcome"]) : undefined,
    q: view.q || undefined,
  };
}

/** An address change that clears every filter, keeping the period. */
export function clearedFilters(): Record<string, null> {
  return Object.fromEntries(FILTER_KEYS.filter((key) => key !== KEY.period && key !== KEY.from && key !== KEY.to).map((key) => [key, null]));
}

/** "Device or IP" is one box: something shaped like an IP address is looked up as one, anything else as a linked phone. */
export const looksLikeIp = (text: string) => /^[0-9.]+$/.test(text) || (/^[0-9a-f:]+$/i.test(text) && text.includes(":"));

/** Where a record is looked after in the console, when it has a page there. */
export function recordLink(entry: {
  entityType: string | null;
  entityId: string | null;
  reference: string | null;
  organizationId: string | null;
  outletId: string | null;
  details: Record<string, unknown> | null;
}): { href: string; label: string } | null {
  const { entityType: type, entityId: id, reference, organizationId, outletId } = entry;
  const q = (text: string) => encodeURIComponent(text);
  switch (type) {
    case "visit":
      return id ? { href: `/visits?visit=${q(id)}`, label: "Open the visit" } : null;
    case "booking":
      return { href: "/visits", label: "Open Visits" };
    case "inspection":
      return id ? { href: `/inspections?inspection=${q(id)}`, label: "Open the inspection" } : null;
    case "invoice":
      return id ? { href: `/invoices?invoice=${q(id)}`, label: "Open the invoice" } : null;
    case "payment":
      return reference ? { href: `/invoices?q=${q(reference)}`, label: "Open the invoice" } : null;
    case "issue":
      return id ? { href: `/issues?show=all&issue=${q(id)}`, label: "Open the issue" } : null;
    case "licence":
    case "document":
    case "attachment":
      return outletId ? { href: `/licences?outlet=${q(outletId)}`, label: "Open the outlet's licences" } : null;
    case "certificate":
      return reference ? { href: `/certificates?q=${q(reference)}`, label: "Open the certificate" } : null;
    case "organization":
      return id ? { href: `/?client=${q(id)}`, label: "Open the client" } : null;
    case "outlet":
    case "user":
    case "linkedDevice":
      return organizationId ? { href: `/?client=${q(organizationId)}`, label: "Open the client" } : null;
    case "plan":
      return { href: "/plans", label: "Open Plans" };
    case "publicPhoto":
      return { href: "/customer-pages", label: "Open Customer pages" };
    case "catalogItem":
    case "serviceKind":
    case "serviceTask":
      return { href: "/catalogue", label: "Open the catalogue" };
    case "sop":
      // A restaurant's own SOP has no page in the console; ECCS's standard SOPs do.
      return entry.details?.ownSop === false ? { href: "/sops", label: "Open SOPs" } : null;
    case "expense":
      return { href: "/finance/expenses", label: "Open the expense book" };
    case "budget":
    case "founderMoney":
    case "cashOpening":
      return { href: "/finance", label: "Open Finance" };
    case "lead":
      return entry.entityId ? { href: `/sales/leads/${encodeURIComponent(entry.entityId)}`, label: "Open the lead" } : null;
    case "quote":
      return { href: "/sales/leads", label: "Open the leads" };
    default:
      return null;
  }
}

// ───────────────────────── Words ─────────────────────────

/** Where each event came from, in the words of the tabs. */
export const SOURCE_SHORT: Record<string, string> = {
  RESTAURANT_APP: "Restaurant app",
  SUPERVISOR_APP: "Supervisor app",
  CONSOLE: "Console",
  SYSTEM: "System",
  PUBLIC: "Public page",
};

/** The same, shorter, for the badge in each row of the table (the column is headed "Source"). */
export const SOURCE_BADGE: Record<string, string> = {
  RESTAURANT_APP: "Restaurant",
  SUPERVISOR_APP: "Supervisor",
  CONSOLE: "Console",
  SYSTEM: "System",
  PUBLIC: "Public",
};

export const RESULT_LABEL: Record<string, string> = {
  SUCCESS: "Succeeded",
  REFUSED: "Refused",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

/** What each result means, for the side panel and the menu. */
export const RESULT_MEANING: Record<string, string> = {
  SUCCESS: "It worked.",
  REFUSED: "Not allowed: not logged in, not their role, or too many tries.",
  REJECTED: "Something was wrong with what was sent, or it clashed with the record as it stood.",
  FAILED: "A server error.",
};

export const AI_FEATURE_LABEL: Record<string, string> = {
  "licence-reader": "Licence reader",
  "translate-support": "Support translation",
  "translate-content": "Content translation",
  "explain-score": "“Why this score?”",
  "monitoring-digest": "Monitoring digest",
  "inspection-summary": "Inspection summary draft",
  "photo-check": "Photo check",
  "photo-standard": "Photo standard of a checklist item",
  "shop-board": "Shop board reader (a BDE's new lead)",
};

export const AI_STATUS_LABEL: Record<string, string> = {
  OK: "Answered",
  ERROR: "Error",
  OFF: "AI switched off",
  LIMIT: "Daily limit reached",
  INVALID: "Answer failed the checks",
};

export const AI_OUTCOME_LABEL: Record<string, string> = {
  ACCEPTED: "Accepted",
  EDITED: "Edited",
  DISCARDED: "Discarded",
  HELPFUL: "Helpful",
  NOT_HELPFUL: "Not helpful",
};

/** "claude-haiku-5-5" → "Haiku 5.5"; anything else as it is. */
export function aiModelLabel(model: string | null) {
  if (!model) return "";
  const match = model.match(/^claude-([a-z]+)-(\d+)-(\d+)/);
  return match ? `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)} ${match[2]}.${match[3]}` : model;
}

export const CLIENT_LABEL: Record<string, string> = {
  mobile: "Phone app",
  console: "Console (browser)",
  other: "Other program",
};

export const entityLabel = (type: string | null) => (type ? (ACTIVITY_ENTITY_LABELS[type] ?? humanize(type)) : "");

const LICENCE_TYPE: Record<string, string> = {
  FSSAI: "FSSAI licence",
  FIRE_NOC: "Fire NOC",
  TRADE_LICENCE: "Trade licence",
  PEST_CONTROL: "Pest control contract",
};

/** "PEST_SIGHTING" → "Pest sighting", "photoCheck" → "Photo check". */
export function humanize(code: string) {
  const words = code
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : code;
}

/**
 * A record's name as stored, made readable: some kinds keep a code rather than a
 * name (an issue's category, a licence's type, an AI request's feature).
 */
export function recordName(type: string | null, label: string | null) {
  if (!label) return "";
  if (type === "licence") return LICENCE_TYPE[label] ?? humanize(label);
  if (type === "aiRequest") return AI_FEATURE_LABEL[label] ?? label;
  if (/^[A-Z][A-Z0-9_]+$/.test(label) && type !== "invoice") return humanize(label);
  return label;
}

/** US dollars with enough places for an AI call that cost a fraction of a cent. */
export function usd(amount: number) {
  if (amount === 0) return "US$0";
  if (amount < 0.01) return `US$${amount.toFixed(4)}`;
  return `US$${amount.toFixed(2)}`;
}

// ───────────────────────── Details ─────────────────────────

const DETAIL_LABEL: Record<string, string> = {
  status: "Status",
  answered: "Items answered",
  problems: "Items reported as problems",
  category: "Category",
  severity: "Severity",
  totalPaise: "Total",
  paidPaise: "Paid",
  amountPaise: "Amount",
  pricePaise: "Price",
  planCode: "Plan code",
  planName: "Plan",
  offered: "Offered",
  serviceCode: "Kind of service",
  kind: "Kind",
  pdf: "A PDF",
  score: "Score",
  grade: "Grade",
  copies: "Copies",
  inUse: "In use",
  ownSop: "The restaurant's own SOP",
  caption: "Caption",
  origin: "Taken from",
  active: "Switched on",
  role: "Role",
  changed: "Fields changed",
  rows: "Rows exported",
  truncated: "Cut short at 10,000 rows",
  filters: "Filters used",
  type: "Type",
  phoneLast4: "Phone",
  feature: "AI feature",
  model: "AI model",
  costUsd: "AI cost",
  wrongInARow: "Wrong PINs in a row",
  lockedMinutes: "Locked for (minutes)",
  deviceLinked: "Phone linked",
  setUpAgain: "PIN set up again",
  keepDays: "Days kept",
  stage: "Stage",
  checked: "Checked",
  sent: "Sent",
  notDelivered: "Not delivered",
  errors: "Errors",
  devicesRemoved: "Phones removed",
  documents: "Documents",
  aiDrafted: "Drafted with AI",
  answer: "Answer",
  billingCycle: "Billing cycle",
  issuesCertificate: "Issues a certificate",
  isActive: "Switched on",
  enabled: "Switched on",
  photoRequired: "Photo needed",
  priceRupees: "Price",
  shelfLifeHours: "Shelf life (hours)",
  devices: "Phones",
  accepted: "Accepted",
  raised: "Raised",
  created: "Created",
};

/** The details of an event as labelled lines a person can read: amounts in rupees, yes and no in words, codes as words. */
export function detailLines(details: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!details) return [];
  return Object.entries(details).map(([key, value]) => ({ label: DETAIL_LABEL[key] ?? humanize(key), value: detailValue(key, value) }));
}

function detailValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (/Paise$/.test(key)) return rupees(value);
    if (/Rupees$/.test(key)) return rupees(value * 100);
    if (key === "costUsd") return usd(value);
    return new Intl.NumberFormat("en-IN").format(value);
  }
  if (Array.isArray(value)) {
    const words = key === "changed" || key === "filters" ? value.map((item) => humanize(String(item))) : value.map(String);
    return words.join(", ") || "None";
  }
  const text = String(value);
  if (key === "feature") return AI_FEATURE_LABEL[text] ?? text;
  if (key === "model") return aiModelLabel(text);
  return /^[A-Z][A-Z0-9_]+$/.test(text) && !/^[A-Z]{2,5}$/.test(text) ? humanize(text) : text;
}

// ───────────────────────── Time ─────────────────────────

/** "15 Oct, 5:42 pm", India time. */
export const shortTime = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/\b(am|pm)\b/i, (part) => part.toLowerCase());

/** "15 Oct 2026, 5:42:07 pm", India time. */
export const fullTime = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(/\b(am|pm)\b/i, (part) => part.toLowerCase());
