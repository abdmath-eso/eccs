import { z } from "zod";
import type { LocalizedText } from "./checklists.js";
import { can, type Action, type Resource } from "./permissions.js";
import { isEccsRole, type Language, type MembershipScope } from "./roles.js";
import type { SopCategory } from "./sops.js";
import type { VisitSlot } from "./services.js";
import type { IssueCategory } from "./issues.js";

// ECCS Buddy (Stage E, 16 Oct 2026): the AI helper in the restaurant app, for the Owner and
// the Manager only. It answers questions about the app and about running a kitchen, reads the
// person's day (checklists, visits, the score, licences, invoices and the rest), and prepares
// changes (book a service, add a checklist item, write an SOP...), each of which waits for the
// person's tap on a confirmation card before anything happens. The pattern: Shopify Sidekick
// ("never makes changes without your approval"), agent-UX guidance on intent previews (let
// lookups run, stop every change at a concrete confirmation), NN/g's guidelines for chatbots
// (say what it can do, suggest prompts that fit the screen, short answers).
//
// Everything here is plain data and small rules, unit-tested in buddy.test.ts. The server
// (apps/api/src/buddy) and the app (apps/mobile/src/app/(app)/buddy) both use them.

// ───────────────────────── Rules ─────────────────────────

export const BUDDY_RULES = {
  /** A chat and its messages are removed this many days after its last message. */
  keepDays: 30,
  /** A confirmation card can be used once, within this many minutes of being made. */
  cardMinutes: 30,
  /** How many messages one person may send Buddy in a day (India time), unless the server says otherwise (BUDDY_DAILY_MESSAGES). */
  dailyMessagesPerPerson: 40,
  /** The longest message a person may send (OWASP LLM10: a cap on what goes in). */
  maxMessageChars: 1000,
  /** The longest answer shown; a longer one is replaced (no model should need more for two to five sentences or a short list). */
  maxAnswerChars: 2000,
  /** Messages a person may send in one chat; after that Buddy asks for a New chat. */
  messagesPerChat: 30,
  /** Messages a person may send in one minute. */
  perMinute: 6,
  /** Messages refused as out of scope or abuse in one day before Buddy pauses for that person until tomorrow. */
  blocksBeforePause: 5,
  /** How many times Buddy may use its tools while answering one message. */
  maxToolRounds: 6,
  /** How many earlier messages of the chat are sent with a new one (words only). */
  historyMessages: 16,
  /** Recent chats listed. */
  recentChats: 20,
  /** A chat's title is the start of its first message, cut to this. */
  titleChars: 60,
} as const;

/** The roles that have Buddy: the restaurant's Owner and Manager (founder, 16 Oct 2026). */
export const BUDDY_ROLES = ["OWNER", "MANAGER"] as const;

/**
 * True when this person may use Buddy: they are a restaurant Owner or Manager, and have no ECCS
 * role. Head Chefs, ECCS staff and BDEs never see it, and the server refuses them.
 */
export function mayUseBuddy(memberships: readonly MembershipScope[]): boolean {
  if (memberships.length === 0 || memberships.some((m) => isEccsRole(m.role))) return false;
  return memberships.some((m) => (BUDDY_ROLES as readonly string[]).includes(m.role));
}

/** Messages left today for a person who has sent `sentToday` (never below zero). */
export const buddyMessagesLeft = (sentToday: number, dailyCap: number): number => Math.max(0, dailyCap - sentToday);

// ───────────────────────── Tools ─────────────────────────
//
// Buddy acts only through tools, and each tool calls the same service, permission check and
// rules as the app's own route, as the person asking: it can never do more than they can in
// the app. "read" tools run at once; "change" tools only prepare a confirmation card; "open"
// gives an Open button to one of the app's screens.

export type BuddyToolKind = "read" | "change" | "open";

interface BuddyToolRule {
  kind: BuddyToolKind;
  /** The grant the app's own route asks for (its @RequirePermission), or null for none. */
  needs: readonly [Resource, Action] | null;
}

export const BUDDY_TOOLS = {
  // Reads
  today_checklists: { kind: "read", needs: ["checklists", "read"] },
  checklist_setup: { kind: "read", needs: ["checklists", "update"] },
  visits: { kind: "read", needs: ["jobs", "read"] },
  visit_details: { kind: "read", needs: ["jobs", "read"] },
  bookings: { kind: "read", needs: ["bookings", "read"] },
  certificates: { kind: "read", needs: ["reports", "read"] },
  hygiene_score: { kind: "read", needs: ["scores", "read"] },
  licences: { kind: "read", needs: ["licences", "read"] },
  invoices: { kind: "read", needs: ["invoices", "read"] },
  plan: { kind: "read", needs: ["subscriptions", "read"] },
  issues: { kind: "read", needs: ["issues", "read"] },
  inspections: { kind: "read", needs: ["inspections", "read"] },
  sops: { kind: "read", needs: ["sopTemplates", "read"] },
  food_labels: { kind: "read", needs: ["foodLabels", "read"] },
  vendors: { kind: "read", needs: ["vendors", "read"] },
  service_catalogue: { kind: "read", needs: ["catalog", "read"] },
  // Changes: each makes a confirmation card, and nothing happens until the person taps it.
  propose_booking: { kind: "change", needs: ["bookings", "create"] },
  propose_cancel_booking: { kind: "change", needs: ["bookings", "update"] },
  propose_checklist_item: { kind: "change", needs: ["checklists", "update"] },
  propose_new_checklist: { kind: "change", needs: ["checklists", "update"] },
  propose_checklist_due_time: { kind: "change", needs: ["checklists", "update"] },
  propose_sop: { kind: "change", needs: ["sopTemplates", "create"] },
  propose_food_label: { kind: "change", needs: ["foodLabels", "create"] },
  propose_issue: { kind: "change", needs: ["issues", "create"] },
  propose_eccs_handover: { kind: "change", needs: ["issues", "create"] },
  // Open a screen of the app (paying, plans, uploads, the camera, staff, attendance and pay...).
  open_screen: { kind: "open", needs: null },
} as const satisfies Record<string, BuddyToolRule>;

export type BuddyToolName = keyof typeof BUDDY_TOOLS;
export const BUDDY_TOOL_NAMES = Object.keys(BUDDY_TOOLS) as BuddyToolName[];

/**
 * The tools this person's Buddy gets: none at all unless they may use Buddy, and then only
 * those whose app route their role is granted.
 */
export function buddyToolsFor(memberships: readonly MembershipScope[]): BuddyToolName[] {
  if (!mayUseBuddy(memberships)) return [];
  return BUDDY_TOOL_NAMES.filter((name) => {
    const needs = BUDDY_TOOLS[name].needs as readonly [Resource, Action] | null;
    return needs === null || can(memberships, needs[0], needs[1]);
  });
}

// ───────────────────────── Confirmation cards ─────────────────────────

/** What a card does when the person taps its main button. */
export const BUDDY_ACTIONS = [
  "BOOK",
  "CANCEL_BOOKING",
  "ADD_CHECKLIST_ITEM",
  "ADD_CHECKLIST",
  "CHECKLIST_DUE_TIME",
  "SAVE_SOP",
  "ADD_FOOD_LABEL",
  "REPORT_ISSUE",
  "ASK_ECCS",
] as const;
export type BuddyAction = (typeof BUDDY_ACTIONS)[number];

/**
 * PENDING: waiting for the tap. RUNNING: the tap is being carried out (a second tap meanwhile is
 * refused). DONE: carried out, never again. FAILED: the service refused it; it can be tried again
 * until it runs out. CANCELLED: the person said no, or a newer card of the same kind replaced it.
 */
export const BUDDY_CARD_STATUSES = ["PENDING", "RUNNING", "DONE", "FAILED", "CANCELLED"] as const;
export type BuddyCardStatus = (typeof BUDDY_CARD_STATUSES)[number];

/** Why a tap on a card is refused. A card of someone else's looks the same as no card (NOT_FOUND). */
export type BuddyCardRefusal = "NOT_FOUND" | "USED" | "EXPIRED" | "CANCELLED" | "BUSY";

/** When a card made at `madeAt` runs out. */
export const buddyCardExpiresAt = (madeAt: Date): Date => new Date(madeAt.getTime() + BUDDY_RULES.cardMinutes * 60_000);

/**
 * Whether `userId` may carry out this card now, or why not. A card works once, for the person it
 * was made for, before it runs out; a failed one may be tried again while it lasts.
 */
export function buddyCardRefusal(
  card: { userId: string; status: BuddyCardStatus; expiresAt: Date } | null,
  userId: string,
  now: Date = new Date(),
): BuddyCardRefusal | null {
  if (!card || card.userId !== userId) return "NOT_FOUND";
  if (card.status === "DONE") return "USED";
  if (card.status === "CANCELLED") return "CANCELLED";
  if (card.status === "RUNNING") return "BUSY";
  if (now.getTime() >= card.expiresAt.getTime()) return "EXPIRED";
  return null;
}

/** What a card shows, by kind. The app words it in the person's language from these facts. */
export type BuddyCardDetails =
  | {
      action: "BOOK";
      outletName: string;
      serviceName: LocalizedText;
      date: string;
      slot: VisitSlot;
      pricePaise: number;
      gstPaise: number;
      totalPaise: number;
      /** INCLUDED: the outlet's plan already brings this kind of service, so this is an extra visit, billed on its own. */
      plan: "NO_PLAN" | "NOT_IN_PLAN" | "INCLUDED";
      notes: string | null;
    }
  | { action: "CANCEL_BOOKING"; outletName: string; serviceName: LocalizedText; date: string; slot: VisitSlot | null }
  | { action: "ADD_CHECKLIST_ITEM"; outletName: string; checklistTitle: LocalizedText; label: string; photoRequired: boolean }
  | { action: "ADD_CHECKLIST"; outletName: string; title: string; dueTime: string | null }
  | { action: "CHECKLIST_DUE_TIME"; outletName: string; checklistTitle: LocalizedText; from: string | null; to: string | null }
  | { action: "SAVE_SOP"; outletName: string; title: string; category: SopCategory; steps: string[]; replaces: string | null }
  | { action: "ADD_FOOD_LABEL"; outletName: string; name: string; shelfLifeHours: number }
  | { action: "REPORT_ISSUE"; outletName: string; category: IssueCategory; description: string }
  | { action: "ASK_ECCS"; outletName: string; description: string };

export interface BuddyCardDto {
  id: string;
  action: BuddyAction;
  status: BuddyCardStatus;
  details: BuddyCardDetails;
  /** ISO time it runs out. */
  expiresAt: string;
  /** True once it has run out without being carried out: it can no longer be used. */
  expired: boolean;
  /** Once done: where to see it in the app. */
  result: BuddyOpenDto | null;
  /** What was made, for the "done" line (an issue's ECCS-0042). */
  reference: string | null;
  /** Why the last try failed, in plain words, while it can still be tried again. */
  error: string | null;
}

// ───────────────────────── Opening a screen ─────────────────────────

/**
 * The screens Buddy can open, and the details each may be opened with. Paying, the plan, uploads,
 * the camera, and staff, attendance and pay are only ever opened, never done by Buddy.
 */
export const BUDDY_OPEN_TARGETS = {
  home: [],
  checklists: [],
  checklist_setup: [],
  services: [],
  book_service: ["itemId"],
  visit: ["visitId"],
  calendar: [],
  sops: [],
  sop: ["sopId"],
  sop_library: [],
  labels: [],
  documents: [],
  certificates: [],
  invoices: [],
  invoice: ["invoiceId"],
  plan: [],
  score: [],
  inspections: [],
  inspection: ["inspectionId"],
  support: [],
  issue: ["issueId"],
  staff: [],
  staff_add: ["name"],
  attendance: [],
  salary: [],
  app_logins: [],
  vendors: [],
  vendor: ["vendorId"],
  customer_page: [],
  notifications: [],
  profile: [],
} as const satisfies Record<string, readonly string[]>;
export type BuddyOpenTarget = keyof typeof BUDDY_OPEN_TARGETS;
export const BUDDY_OPEN_TARGET_NAMES = Object.keys(BUDDY_OPEN_TARGETS) as BuddyOpenTarget[];

export interface BuddyOpenDto {
  target: BuddyOpenTarget;
  /** Only the details the screen takes, each a short value. */
  params: Record<string, string>;
}

/** An Open button from what the model asked for: an unknown screen is dropped, and so is any detail the screen does not take. */
export function cleanBuddyOpen(target: string, params: Record<string, unknown> | null | undefined): BuddyOpenDto | null {
  if (!Object.hasOwn(BUDDY_OPEN_TARGETS, target)) return null;
  const allowed = BUDDY_OPEN_TARGETS[target as BuddyOpenTarget] as readonly string[];
  const kept: Record<string, string> = {};
  for (const key of allowed) {
    const value = params?.[key];
    if (typeof value === "string" && value.trim() && value.length <= 100) kept[key] = value.trim();
  }
  return { target: target as BuddyOpenTarget, params: kept };
}

// ───────────────────────── Which screen Buddy was opened from ─────────────────────────

export const BUDDY_SCREENS = [
  "home",
  "checklists",
  "services",
  "calendar",
  "sops",
  "labels",
  "documents",
  "certificates",
  "invoices",
  "plan",
  "score",
  "inspections",
  "support",
  "staff",
  "vendors",
  "customer-page",
  "other",
] as const;
export type BuddyScreen = (typeof BUDDY_SCREENS)[number];

const SCREEN_OF_PATH: [RegExp, BuddyScreen][] = [
  [/^\/?$/, "home"],
  [/^\/checklists/, "checklists"],
  [/^\/services/, "services"],
  [/^\/history/, "calendar"],
  [/^\/sops/, "sops"],
  [/^\/labels/, "labels"],
  [/^\/documents/, "documents"],
  [/^\/certificates/, "certificates"],
  [/^\/invoices/, "invoices"],
  [/^\/plan/, "plan"],
  [/^\/score/, "score"],
  [/^\/inspections/, "inspections"],
  [/^\/support/, "support"],
  [/^\/(team|staff)/, "staff"],
  [/^\/vendors/, "vendors"],
  [/^\/customer-page/, "customer-page"],
];

/** The screen a path in the app belongs to ("/checklists/setup" is "checklists"). */
export function buddyScreenFor(pathname: string): BuddyScreen {
  const path = pathname.split("?")[0] ?? "";
  return SCREEN_OF_PATH.find(([pattern]) => pattern.test(path))?.[1] ?? "other";
}

// ───────────────────────── Suggested prompts ─────────────────────────

/** The facts of the person's day that the suggested prompts are chosen from. */
export interface BuddyStartFacts {
  overdueChecklists: number;
  /** Today's checklists not handed in yet. */
  openChecklists: number;
  nextVisitDate: string | null;
  openIssues: number;
  licencesToRenew: number;
  duePaise: number;
}

/** One suggested prompt: an i18n key under "buddy.starter." with what fills it in. Tapping it sends the words. */
export interface BuddyStarterDto {
  key: string;
  params?: Record<string, string | number>;
}

/** How many suggested prompts are shown. */
export const BUDDY_STARTERS_SHOWN = 4;

/** The prompts that suit each screen, first. */
const SCREEN_STARTERS: Record<BuddyScreen, string[]> = {
  home: ["myDay", "nextVisit"],
  checklists: ["addCheck", "newChecklist"],
  services: ["book", "nextVisit"],
  calendar: ["nextVisit", "book"],
  sops: ["writeSop", "findSop"],
  labels: ["addLabel", "shelfLife"],
  documents: ["licences", "howAddLicence"],
  certificates: ["certificates"],
  invoices: ["whatsDue", "howPay"],
  plan: ["whatPlan", "howPay"],
  score: ["whyScore", "raiseScore"],
  inspections: ["fixFirst"],
  support: ["reportIssue", "talkToEccs"],
  staff: ["howAddStaff", "attendanceWhere"],
  vendors: ["findVendor"],
  "customer-page": ["customerPage"],
  other: ["myDay"],
};
/** Filled in after the screen's own, in this order. */
const GENERAL_STARTERS = ["book", "addCheck", "writeSop", "nextVisit", "howAddStaff", "fridgeTemp"];

/**
 * The suggested prompts for the screen Buddy was opened from and the person's day: what is
 * overdue first, then what suits the screen, then the general ones, without repeats, four in all.
 */
export function buddyStarters(screen: BuddyScreen, facts: BuddyStartFacts): BuddyStarterDto[] {
  const out: BuddyStarterDto[] = [];
  const add = (key: string, params?: Record<string, string | number>) => {
    if (out.length < BUDDY_STARTERS_SHOWN && !out.some((entry) => entry.key === key)) out.push(params ? { key, params } : { key });
  };
  if (facts.overdueChecklists > 0) add("overdue", { count: facts.overdueChecklists });
  if (facts.licencesToRenew > 0 && (screen === "home" || screen === "documents")) add("licences");
  if (facts.duePaise > 0 && (screen === "home" || screen === "invoices")) add("whatsDue");
  for (const key of SCREEN_STARTERS[screen]) add(key);
  for (const key of GENERAL_STARTERS) add(key);
  return out;
}

// ───────────────────────── Speaking (the mic) and reading aloud ─────────────────────────

/** The speech tag of each app language: the language as spoken in India. */
export const SPEECH_TAGS: Record<Language, string> = {
  EN: "en-IN",
  HI: "hi-IN",
  TE: "te-IN",
  TA: "ta-IN",
  KN: "kn-IN",
  ML: "ml-IN",
  MR: "mr-IN",
  BN: "bn-IN",
  GU: "gu-IN",
  PA: "pa-IN",
  OR: "or-IN",
  UR: "ur-IN",
};

export const speechTagFor = (language: Language): string => SPEECH_TAGS[language];

/**
 * The speaking languages offered at the mic: the app's language first, then English and Hindi,
 * which people often mix in (Hinglish, Tenglish).
 */
export function speechChoices(appLanguage: Language): Language[] {
  return [...new Set<Language>([appLanguage, "EN", "HI"])];
}

const tagParts = (tag: string) => tag.replace(/_/g, "-").toLowerCase().split("-");

/**
 * Whether the phone's speech recognition lists the language: true for the tag itself or the
 * same language for another region ("te" or "te-IN" for "te-IN"), false when the list has
 * other languages but not this one, and null when the phone gave no list (older Android, the
 * browser), so nothing can be said in advance.
 */
export function speechLocaleSupported(tag: string, locales: readonly string[]): boolean | null {
  if (locales.length === 0) return null;
  const [language] = tagParts(tag);
  return locales.some((locale) => tagParts(locale)[0] === language);
}

/**
 * The phone's voice for reading a language aloud: one for the exact tag (te-IN) first, then any
 * voice of that language, else null, and Read aloud is then hidden.
 */
export function voiceFor<V extends { language: string }>(tag: string, voices: readonly V[]): V | null {
  const wanted = tag.replace(/_/g, "-").toLowerCase();
  const [language] = tagParts(tag);
  return (
    voices.find((voice) => voice.language.replace(/_/g, "-").toLowerCase() === wanted) ??
    voices.find((voice) => tagParts(voice.language)[0] === language) ??
    null
  );
}

// ───────────────────────── What the model is never given ─────────────────────────

/**
 * Text with anything that looks like a phone number replaced (ten or more digits, with spaces,
 * dashes or a "+" between): Buddy is never given phone numbers, also when people typed one into
 * an issue, a vendor's details or their own message.
 */
export function hidePhoneNumbers(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{8,}\d/g, (match) => (match.replace(/\D/g, "").length >= 10 ? "[number hidden]" : match));
}

// ───────────────────────── Requests and answers ─────────────────────────

export const buddyMessageSchema = z.object({
  /** Left out to start a new chat. */
  chatId: z.string().min(1).optional(),
  text: z.string().trim().min(1, "Write a message").max(BUDDY_RULES.maxMessageChars),
  /** The screen Buddy was opened from, so the first answer fits it. */
  screen: z.enum(BUDDY_SCREENS).optional(),
  /** The outlet in view. A Manager's own outlet, or one of the Owner's. */
  outletId: z.string().min(1).optional(),
});
export type BuddyMessageInput = z.input<typeof buddyMessageSchema>;

export const buddyFeedbackSchema = z.object({ outcome: z.enum(["HELPFUL", "NOT_HELPFUL"]) });
export type BuddyFeedbackInput = z.input<typeof buddyFeedbackSchema>;

/** ON: Buddy can answer. OFF: AI is switched off. LIMIT: today's AI limit for the outlet or for everyone is reached. PERSON_LIMIT: this person's messages for today are used up. */
/**
 * Also: OUT_OF_SCOPE (the message is not about the restaurant or the app: one fixed line and some
 * suggested prompts), TOO_FAST (more than six messages in a minute), CHAT_FULL (start a New chat),
 * PAUSED (too many refused messages today: Buddy is back tomorrow).
 */
export const BUDDY_STATES = ["ON", "OFF", "LIMIT", "PERSON_LIMIT", "OUT_OF_SCOPE", "TOO_FAST", "CHAT_FULL", "PAUSED"] as const;
export type BuddyState = (typeof BUDDY_STATES)[number];

export interface BuddyMessageDto {
  id: string;
  role: "USER" | "BUDDY";
  text: string;
  createdAt: string;
  cards: BuddyCardDto[];
  opens: BuddyOpenDto[];
  /** What the person said of this answer ("Helpful?"), Buddy's answers only. */
  outcome: "HELPFUL" | "NOT_HELPFUL" | null;
}

export interface BuddyChatSummaryDto {
  id: string;
  title: string;
  outletId: string | null;
  outletName: string | null;
  updatedAt: string;
  /** The day it will be removed, India date. */
  removedOn: string;
}

export interface BuddyChatDto extends BuddyChatSummaryDto {
  messages: BuddyMessageDto[];
}

/** What the Buddy screen needs when it opens. */
export interface BuddyStartDto {
  state: BuddyState;
  starters: BuddyStarterDto[];
  messagesLeft: number;
  dailyMessages: number;
  keepDays: number;
  cardMinutes: number;
  outletId: string | null;
  outletName: string | null;
}

/** The answer to a message: the chat, and the person's message with Buddy's answer (none when Buddy could not answer). */
export interface BuddyReplyDto {
  state: BuddyState | "FAILED";
  chat: BuddyChatSummaryDto | null;
  messages: BuddyMessageDto[];
  messagesLeft: number;
  /** With OUT_OF_SCOPE: a few things Buddy can help with instead. */
  starters?: BuddyStarterDto[];
}

/** The answer to a tap on a card: the card as it is now, and Buddy's line on what was done. */
export interface BuddyCardResultDto {
  card: BuddyCardDto;
  message: BuddyMessageDto | null;
}

/** ECCS's view of Buddy, per India day: no chat's words, only the counts the founder can act on. */
export interface BuddyStatsDayDto {
  date: string;
  chats: number;
  messages: number;
  /** Changes made through a card. */
  changes: number;
  notHelpful: number;
  /** Messages refused as out of scope or abuse, and answers replaced by the answer check. */
  blocked: number;
  /** People Buddy paused that day after too many refused messages. */
  paused: number;
  costUsd: number;
}

/** ECCS's counts per restaurant over the same days. Counts only, never what anyone wrote. */
export interface BuddyStatsRestaurantDto {
  organizationId: string;
  name: string;
  messages: number;
  blocked: number;
  paused: number;
}

export interface BuddyStatsDto {
  days: BuddyStatsDayDto[];
  restaurants: BuddyStatsRestaurantDto[];
}

// ───────────────────────── Security: defence in depth (16 Oct 2026) ─────────────────────────
//
// The founder: "make sure security wise the AI chatbot is perfect, no one should be able to abuse
// it, ask their own personal questions, coding etc, just about the app and few general answers".
// Following Anthropic's "Mitigate jailbreaks and prompt injections" (a harmlessness screen before
// the main model, checks on the output, throttling repeat offenders) and the OWASP Top 10 for LLM
// Applications 2025 (LLM01 prompt injection, LLM02 sensitive information, LLM05 output handling,
// LLM06 excessive agency, LLM07 system prompt leakage, LLM10 unbounded consumption). The prompt is
// one layer; these rules are the server's own, whatever the model says.

/**
 * What the scope screen (a small, quick Haiku call made at the same time as Buddy's first step)
 * makes of a message, read with the turn before it: about the app, about running the kitchen, an
 * emergency, a greeting or thanks, a follow-up of the conversation, out of scope, or abuse.
 */
export const BUDDY_SCOPE_KINDS = ["app", "restaurant", "emergency", "greeting", "followup", "offtopic", "abuse"] as const;
export type BuddyScopeKind = (typeof BUDDY_SCOPE_KINDS)[number];

/** True when Buddy may answer a message the screen put in this kind. */
export const buddyScopeAllows = (kind: BuddyScopeKind) => kind !== "offtopic" && kind !== "abuse";

export const buddyScreenSchema = z.object({ kind: z.enum(BUDDY_SCOPE_KINDS) });
export type BuddyScreenAnswer = z.infer<typeof buddyScreenSchema>;
export const BUDDY_SCREEN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { kind: { enum: [...BUDDY_SCOPE_KINDS] } },
  required: ["kind"],
  additionalProperties: false,
};

/** Why a stored refusal was made: the screen (OFFTOPIC, ABUSE) or the check on Buddy's answer (ANSWER). */
export const BUDDY_BLOCK_REASONS = ["OFFTOPIC", "ABUSE", "ANSWER"] as const;
export type BuddyBlockReason = (typeof BUDDY_BLOCK_REASONS)[number];

/** Whether refused messages today pause Buddy for the person: only the screen's refusals count, not answers the check replaced. */
export const buddyPaused = (screenBlocksToday: number, cap: number = BUDDY_RULES.blocksBeforePause) => screenBlocksToday >= cap;

// Words around a secret number, in the app's main languages: a PIN, a one-time code, a password, a card number.
const SECRET_WORDS = /(pin|otp|one[- ]time code|passcode|password|passwd|cvv|card (no|number)|पिन|ओटीपी|पासवर्ड|కోడ్|పిన్|ఓటీపీ|పాస్‌వర్డ్|پن|او ٹی پی|پاس ورڈ)/i;

/**
 * Text with secret numbers hidden before it goes anywhere near the model or the database: phone
 * numbers (see hidePhoneNumbers), and a 4 to 8 digit number written near a word for a PIN, a
 * one-time code or a password ("my PIN is 4821" becomes "my PIN is [hidden]"). OWASP LLM02.
 */
export function hideSecrets(text: string): string {
  const withoutPhones = hidePhoneNumbers(text);
  if (!SECRET_WORDS.test(withoutPhones)) return withoutPhones;
  return withoutPhones.replace(/\b\d{4,8}\b/g, (digits, offset: number, whole: string) => {
    const around = whole.slice(Math.max(0, offset - 25), offset + digits.length + 25);
    return SECRET_WORDS.test(around) ? "[hidden]" : digits;
  });
}

/**
 * An answer as the app shows it: plain text. Markdown the model may still write is taken out:
 * links keep only their words, images go, bold and headings become plain (OWASP LLM05).
 */
export function plainBuddyText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Why an answer failed the check on its way out. */
export type BuddyAnswerProblem = "CODE" | "LENGTH" | "LINK" | "NUMBER" | "LEAK";

const CODE_LIKE = [
  /```/,
  /<\/?(script|html|div|style|iframe|img)\b/i,
  /\b(function\s*\w*\s*\(|def\s+\w+\s*\(|console\.log|import\s+[\w{]|#include|public\s+static|SELECT\s+.+\s+FROM|=>\s*\{|\bvar\s+\w+\s*=|\blet\s+\w+\s*=|\bconst\s+\w+\s*=)/i,
  /^\s*[{}\[\];]\s*$/m,
  /=\s*(VLOOKUP|SUMIF|IF)\s*\(/i,
];
const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|in|org|net|io|ai|co|gov|edu|info|xyz|app|dev|me)\b/i;

/**
 * India's crisis line, which Buddy may always give: Tele-MANAS, the Health Ministry's free mental
 * health line, open day and night in about 20 languages (telemanas.mohfw.gov.in). The emergency
 * numbers (112, 101, 108) are short enough to pass the number check anyway.
 */
export const BUDDY_HELPLINES = ["14416", "1-800-891-4416"] as const;

/**
 * Long runs of digits that are no one's phone number, taken out before the number check (19 Oct
 * 2026, after the founder's "Can you help me with booking a pest service?" was replaced: the answer
 * named the last visit's report). ECCS's own references: letters, the year, a number (SR-2026-00005,
 * IR-2026-00001, CERT-2026-00003, Q-2026-0001, ECCS/AL/2026/0001); and dates (20-10-2026, 20/10/2026,
 * 20.10.2026, 2026-10-20).
 */
const NOT_PHONE_NUMBERS = [
  /\b[A-Z]{1,6}(?:[-/][A-Z]{1,6})*[-/](?:19|20)\d{2}[-/]\d{1,6}\b/g,
  /\b\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2}\b/g,
  /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g,
];

/** Whether a failed answer is replaced by the out-of-scope line (it was off-topic or an attack) or by "could not finish" (a slip in a real answer). */
export function buddyAnswerProblemIsScope(problem: BuddyAnswerProblem): boolean {
  return problem === "CODE" || problem === "LEAK";
}

/**
 * The check every answer passes before it is kept or shown (Anthropic's post-draft check; OWASP
 * LLM05 and LLM07): no code or code-like text, no longer than the cap, no links, no phone or other
 * long numbers except ECCS's own support numbers, the emergency numbers and the crisis line (ECCS's
 * references and dates are not phone numbers), nothing from the instructions (the canary, the
 * context block, the tools' names), and no secret the person typed. A failed answer is replaced by a
 * fixed line (buddyAnswerProblemIsScope), and the event is counted.
 */
export function checkBuddyAnswer(
  text: string,
  options: { canary: string; allowedNumbers?: readonly string[]; secrets?: readonly string[] },
): BuddyAnswerProblem | null {
  if (text.length > BUDDY_RULES.maxAnswerChars) return "LENGTH";
  if (CODE_LIKE.some((pattern) => pattern.test(text))) return "CODE";
  if (LINK.test(text)) return "LINK";
  // Tool names with an underscore only: "visits" or "plan" are ordinary words.
  const leak = [options.canary, "<app_context>", "app_context", "You are ECCS Buddy", ...BUDDY_TOOL_NAMES.filter((name) => name.includes("_"))];
  if (leak.some((marker) => marker && text.includes(marker))) return "LEAK";
  if (phoneLikeIn(text, options.allowedNumbers)) return "NUMBER";
  for (const secret of options.secrets ?? []) if (secret && text.includes(secret)) return "NUMBER";
  return null;
}

/** The first run of digits in an answer that could be a number someone calls, with the few characters before it; null if none. */
function phoneLikeIn(text: string, allowedNumbers: readonly string[] = []): { before: string; number: string } | null {
  const allowed = new Set([...allowedNumbers, ...BUDDY_HELPLINES].map((number) => number.replace(/\D/g, "")).filter(Boolean));
  const scanned = NOT_PHONE_NUMBERS.reduce((rest, pattern) => rest.replace(pattern, " "), text);
  for (const match of scanned.matchAll(/\+?\d[\d\s().-]{6,}\d/g)) {
    const digits = match[0].replace(/\D/g, "");
    // A long run of digits that is not an amount is treated as a number someone could call.
    // An FSSAI licence number (14 digits) is the restaurant's own record, not a number to call.
    if (digits.length >= 8 && digits.length !== 14 && !allowed.has(digits) && !allowed.has(digits.slice(-10))) {
      return { before: scanned.slice(Math.max(0, match.index - 6), match.index), number: match[0] };
    }
  }
  return null;
}

/**
 * What kind of number made an answer fail, for the refusal record: its shape, with the six
 * characters before it, digits written as 9 and letters as A ("AA-9999-99999"), so a wrong
 * refusal can be understood without keeping the number or the answer (19 Oct 2026). "secret"
 * when the answer repeated a PIN or code the person typed.
 */
export function buddyNumberShape(text: string, allowedNumbers?: readonly string[]): string {
  const found = phoneLikeIn(text, allowedNumbers);
  if (!found) return "secret";
  return `${found.before}${found.number}`.replace(/\d/g, "9").replace(/\p{L}/gu, "A").replace(/\s+/g, " ").trim();
}

/** The secret numbers in what the person typed (a PIN, a code), which no answer may repeat. */
export function secretsIn(text: string): string[] {
  if (!SECRET_WORDS.test(text)) return [];
  const found: string[] = [];
  for (const match of text.matchAll(/\b\d{4,8}\b/g)) {
    const offset = match.index ?? 0;
    const around = text.slice(Math.max(0, offset - 25), offset + match[0].length + 25);
    if (SECRET_WORDS.test(around)) found.push(match[0]);
  }
  return found;
}
