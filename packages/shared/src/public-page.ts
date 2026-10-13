// The public page a diner reaches by scanning an outlet's QR code.
//
// What the page is, in short. It was first built on 9 Oct 2026 and changed on
// 13 Oct 2026 at the founder's request; where the two differ, 13 Oct stands
// (see docs/STATUS.md):
// - The page shows as soon as the restaurant's Owner switches it on. It no longer waits
//   for an ECCS inspection (13 Oct; before that it showed nothing without one).
// - It shows yesterday's hygiene score out of 100, with its three parts each named as
//   what it is: ECCS's inspection, the licences, and the restaurant's own daily checks
//   (13 Oct; before that the combined score was kept off the page because 40 of its
//   points come from what the restaurant reports about itself). A score with no ECCS
//   inspection in it says so beside the number.
// - It lists the daily checklists the kitchen does, with yesterday's result for each,
//   and photos a person chose: from ECCS's visits or from the restaurant's own daily
//   checks, each approved by ECCS first.
// - ECCS's own inspection is shown when there is an approved one inside its validity
//   period, and drops off by itself afterwards. Photos drop off too.
// - With the restaurant, the outlet or the page switched off, or the page taken down,
//   a diner sees one plain "nothing to show" page, the same in every case and for an
//   unknown link.
// - Unchanged, and the reason for the disclaimer at the top of the page: this is a
//   private company's page about a restaurant that pays it. It is never a government
//   rating and must not look like one.

import { z } from "zod";
import type { LocalizedText } from "./checklists.js";
import type { InspectionGrade } from "./inspections.js";
import type { PhotoFlagCode } from "./photo-integrity.js";
import { SCORE_BANDS, SCORE_COMPONENTS, SCORE_RULE_VERSION, SCORE_RULES, type ScoreBand, type ScoreComponentKey } from "./scores.js";

/** The settings of the page. Change the numbers here to retune it. */
export const PUBLIC_PAGE_RULES = {
  /**
   * An approved inspection is shown for this many days after it was carried out, the
   * last day counted. The same period as in the hygiene score, so the two never disagree.
   */
  inspectionValidDays: SCORE_RULES.inspectionValidDays,
  /**
   * The score shown is yesterday's. If there is none for yesterday, the most recent
   * one is shown with its own date, as long as it is no older than this many days.
   */
  scoreWithinDays: 7,
  /** The kitchen's own daily checks are counted over this many days, ending yesterday. */
  selfCheckDays: 30,
  /** At most this many approved photos are shown, the newest first. */
  maxPhotos: 6,
  /**
   * A photo is shown for this many days after the day it was taken, the last day
   * counted, and then drops off by itself, so the page cannot go on showing an old kitchen.
   */
  photoShownDays: 90,
  /** The restaurant can put forward proof photos from its daily checks of this many days back. */
  checkPhotoDays: 14,
  /** At most this many ECCS services are listed: the latest of each kind, the newest first. */
  maxServices: 6,
  /** A service older than this many days is no longer "recent" and is left off. */
  serviceWithinDays: 365,
  /** How long an answer may be reused before the records are read again, in seconds. */
  cacheSeconds: 60,
} as const;

/** The first part of the page's address, after the site's own: https://example.in/k/<token>. */
export const PUBLIC_PAGE_PATH = "/k";

/** The page's full address for a token. `base` is the PUBLIC_PAGE_BASE_URL setting. */
export function publicPageUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}${PUBLIC_PAGE_PATH}/${token}`;
}

/**
 * True when an address only works on this computer or inside the office network
 * (localhost, a private Wi-Fi address, a name with no dot), so a printed QR code
 * pointing at it cannot work for a real diner.
 */
export function isLocalOnlyAddress(address: string): boolean {
  let host: string;
  try {
    host = new URL(address).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host.startsWith("[")) return true; // a bare IPv6 address is never a public site name
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") || !host.includes(".")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts as [number, number, number, number];
    // Loopback, the three private ranges, link-local, and carrier-grade NAT.
    return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return false;
}

// ───────────────────────── Is the page showing? ─────────────────────────

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const addDays = (date: string, days: number) => new Date(toTime(date) + days * DAY_MS).toISOString().slice(0, 10);

/** The last day an inspection carried out on `date` (YYYY-MM-DD) is still shown. */
export function inspectionShownUntil(date: string): string {
  return addDays(date, PUBLIC_PAGE_RULES.inspectionValidDays);
}

/** Where an outlet's latest approved inspection stands for the page. */
export type PublicInspectionState = "CURRENT" | "EXPIRED" | "NONE";

/** `date` is the day the latest approved inspection was carried out; null when there is none. */
export function publicInspectionState(date: string | null, today: string): PublicInspectionState {
  if (date === null) return "NONE";
  // An inspection dated after today (a wrong clock) is not shown either.
  return date <= today && today <= inspectionShownUntil(date) ? "CURRENT" : "EXPIRED";
}

/**
 * Why a page is or is not showing. Only the restaurant and ECCS are ever told
 * which; a diner sees the same plain page for every state but LIVE.
 *
 * Until 13 Oct 2026 there were two more states, for a page that was on but had
 * no current inspection to show. An inspection is no longer needed, so they are
 * gone; whether there is one is told separately (PublicPageSettingsDto.inspection).
 */
export const PUBLIC_PAGE_STATES = ["LIVE", "INACTIVE", "TAKEN_DOWN", "OFF"] as const;
export type PublicPageState = (typeof PUBLIC_PAGE_STATES)[number];

export interface PublicPageStateInput {
  /** The restaurant and the outlet are both still switched on as ECCS clients. */
  clientActive: boolean;
  /** ECCS has taken the page down. */
  takenDown: boolean;
  /** The restaurant's own switch. */
  enabled: boolean;
}

/**
 * The one rule for whether a diner is shown the page. The first reason that
 * applies is the one reported: a client that has left, then ECCS's take-down
 * (which the restaurant cannot override), then the restaurant's own switch.
 */
export function publicPageState(input: PublicPageStateInput): PublicPageState {
  if (!input.clientActive) return "INACTIVE";
  if (input.takenDown) return "TAKEN_DOWN";
  if (!input.enabled) return "OFF";
  return "LIVE";
}

// ───────────────────────── The score ─────────────────────────

/**
 * Which day's score the page shows, given the days that have one: yesterday's, or
 * failing that the most recent of the days before it, back to a week before today.
 * Today's is never used: the day is not over, so its number is not final.
 */
export function pickScoreDay(days: readonly string[], today: string): string | null {
  const newest = addDays(today, -1);
  const oldest = addDays(today, -PUBLIC_PAGE_RULES.scoreWithinDays);
  return [...days].filter((day) => day >= oldest && day <= newest).sort().at(-1) ?? null;
}

/**
 * Whether ECCS's inspection is part of the score shown, and if not, why not. Each
 * reason has its own sentence on the page, so the page never says more than is true.
 * COUNTED: the inspection is in the score.
 * NOT_INSPECTED: ECCS has not carried out an inspection of this kitchen.
 * NO_CURRENT_RESULT: ECCS has inspected, but there is no approved result inside its
 *   validity period (one is waiting for approval, or the last one is too old).
 * NOT_IN_THIS_SCORE: the page shows a current inspection, but the score is for a day
 *   it does not cover (the inspection came after it).
 */
export const PUBLIC_SCORE_INSPECTION = ["COUNTED", "NOT_INSPECTED", "NO_CURRENT_RESULT", "NOT_IN_THIS_SCORE"] as const;
export type PublicScoreInspection = (typeof PUBLIC_SCORE_INSPECTION)[number];

export function publicScoreInspection(input: {
  /** The score has inspection points in it. */
  counted: boolean;
  /** Where the outlet's latest approved inspection stands today. */
  inspection: PublicInspectionState;
  /** ECCS has finished at least one inspection of the outlet, approved or not. */
  everInspected: boolean;
}): PublicScoreInspection {
  if (input.counted) return "COUNTED";
  if (input.inspection === "CURRENT") return "NOT_IN_THIS_SCORE";
  return input.everInspected ? "NO_CURRENT_RESULT" : "NOT_INSPECTED";
}

/** One of the three parts of the score, as the page shows it: "24 of 30". */
export interface PublicPageScorePartDto {
  key: ScoreComponentKey;
  /** False when there was nothing to measure, so this part is left out of the score. */
  measured: boolean;
  /** Points earned, to one decimal place. 0 when not measured. */
  earned: number;
  /** The most points this part can give. */
  max: number;
}

/** The hygiene score of one finished day, as a diner is shown it. */
export interface PublicPageScoreDto {
  /** YYYY-MM-DD: the day the score is for. */
  date: string;
  /** True when that day is yesterday; false when yesterday had none and an earlier day's is shown. */
  isYesterday: boolean;
  /** Whole number out of 100. */
  score: number;
  band: ScoreBand;
  /** True when there is no ECCS inspection in the score: it then comes from the licences and the daily checks alone. */
  provisional: boolean;
  inspection: PublicScoreInspection;
  /** All three parts, in the order they are shown: inspection, licences, daily checks. */
  parts: PublicPageScorePartDto[];
}

/**
 * Reads one stored day's score (a HygieneScoreSnapshot row) into what the page
 * shows. Null for a row written under an older scoring rule or one that does not
 * read as expected: the page then shows no score from it, never a guess.
 */
export function readStoredScore(score: number, breakdown: unknown): Pick<PublicPageScoreDto, "score" | "band" | "provisional" | "parts"> | null {
  if (typeof breakdown !== "object" || breakdown === null || !Number.isFinite(score)) return null;
  const stored = breakdown as { version?: unknown; band?: unknown; components?: unknown };
  const band = SCORE_BANDS.find((entry) => entry === stored.band);
  if (stored.version !== SCORE_RULE_VERSION || !band || !Array.isArray(stored.components)) return null;

  type StoredPart = { key?: unknown; measured?: unknown; earned?: unknown; max?: unknown } | null;
  const parts: PublicPageScorePartDto[] = [];
  for (const key of SCORE_COMPONENTS) {
    const found = (stored.components as StoredPart[]).find((entry) => typeof entry === "object" && entry !== null && entry.key === key);
    if (!found || typeof found.measured !== "boolean" || typeof found.earned !== "number" || typeof found.max !== "number") return null;
    parts.push({ key, measured: found.measured, earned: found.measured ? found.earned : 0, max: found.max });
  }
  return { score: Math.round(score), band, provisional: !parts[0]!.measured, parts };
}

// ───────────────────────── The kitchen's own daily checks ─────────────────────────

/** The days the kitchen's own checks are counted over: the 30 days ending yesterday. */
export function selfCheckWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -PUBLIC_PAGE_RULES.selfCheckDays), to: addDays(today, -1) };
}

/**
 * "The kitchen's own daily checks were handed in on 26 of the last 30 days."
 * A day counts as handed in only when every checklist due that day was handed in.
 * Days on which nothing was due (before the outlet had checklists) are left out of
 * both numbers, and today is never counted because it is not over. Null when no day counts.
 */
export function selfCheckSummary(
  checklists: readonly { date: string; handedIn: boolean }[],
  today: string,
): { handedIn: number; days: number } | null {
  const { from, to } = selfCheckWindow(today);
  const byDay = new Map<string, boolean>();
  for (const checklist of checklists) {
    if (checklist.date < from || checklist.date > to) continue;
    byDay.set(checklist.date, (byDay.get(checklist.date) ?? true) && checklist.handedIn);
  }
  if (byDay.size === 0) return null;
  return { handedIn: [...byDay.values()].filter(Boolean).length, days: byDay.size };
}

/** How one daily checklist went yesterday. NOT_DUE: it did not exist yet that day. */
export const PUBLIC_CHECK_RESULTS = ["ON_TIME", "LATE", "NOT_DONE", "NOT_DUE"] as const;
export type PublicCheckResult = (typeof PUBLIC_CHECK_RESULTS)[number];

/** `run` is the checklist's record for the day, or null when there is none because it was not due. */
export function publicCheckResult(run: { handedIn: boolean; onTime: boolean } | null): PublicCheckResult {
  if (!run) return "NOT_DUE";
  if (!run.handedIn) return "NOT_DONE";
  return run.onTime ? "ON_TIME" : "LATE";
}

/**
 * One of the outlet's daily checklists, as the page lists it: its name, how many
 * checks it has, and yesterday's result. Never the checks themselves, who did them,
 * the time of day, or anything written about a problem.
 */
export interface PublicPageChecklistDto {
  name: LocalizedText;
  checks: number;
  result: PublicCheckResult;
}

// ───────────────────────── ECCS's services ─────────────────────────

/**
 * Which ECCS services are listed: the latest of each kind, done within the last
 * year, the newest first, at most six. `date` is the day the work was done.
 */
export function pickRecentServices<T extends { code: string; date: string }>(services: readonly T[], today: string): T[] {
  const oldest = addDays(today, -PUBLIC_PAGE_RULES.serviceWithinDays);
  const latest = new Map<string, T>();
  for (const service of services) {
    if (service.date > today || service.date < oldest) continue;
    const seen = latest.get(service.code);
    if (!seen || service.date > seen.date) latest.set(service.code, service);
  }
  return [...latest.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, PUBLIC_PAGE_RULES.maxServices);
}

// ───────────────────────── Photos ─────────────────────────

/** What a public photo shows. A fixed list, so nothing typed by anyone appears on the page. */
export const PUBLIC_PHOTO_CAPTIONS = ["GRILL", "HOOD", "COLD_STORAGE", "PREP_AREA", "FLOOR_DRAINS", "WASH_AREA"] as const;
export type PublicPhotoCaption = (typeof PUBLIC_PHOTO_CAPTIONS)[number];

export const PUBLIC_PHOTO_STATUSES = ["PROPOSED", "APPROVED", "REJECTED"] as const;
export type PublicPhotoStatus = (typeof PUBLIC_PHOTO_STATUSES)[number];

/**
 * Where a photo came from.
 * DAILY_CHECK: the restaurant's own staff took it as proof for a daily check, and the
 *   restaurant put it forward.
 * ECCS_VISIT, ECCS_INSPECTION: an ECCS Supervisor took it during a service visit or an inspection.
 * ECCS_FOR_PAGE: an ECCS Supervisor took it at the outlet specially for the page.
 */
export const PUBLIC_PHOTO_SOURCES = ["DAILY_CHECK", "ECCS_VISIT", "ECCS_INSPECTION", "ECCS_FOR_PAGE"] as const;
export type PublicPhotoSource = (typeof PUBLIC_PHOTO_SOURCES)[number];

/** Who took a photo, in the general words a diner is told: the restaurant's staff, or ECCS. */
export type PublicPhotoBy = "RESTAURANT" | "ECCS";
export const publicPhotoBy = (source: PublicPhotoSource): PublicPhotoBy => (source === "DAILY_CHECK" ? "RESTAURANT" : "ECCS");

/** The last day a photo taken on `takenOn` (YYYY-MM-DD) is still shown. */
export function photoShownUntil(takenOn: string): string {
  return addDays(takenOn, PUBLIC_PAGE_RULES.photoShownDays);
}

/** The oldest day a photo may have been taken and still be shown today. */
export function oldestPhotoShown(today: string): string {
  return addDays(today, -PUBLIC_PAGE_RULES.photoShownDays);
}

/** The days whose daily-check photos the restaurant can put forward: the last 14 days and today. */
export function checkPhotoWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -PUBLIC_PAGE_RULES.checkPhotoDays), to: today };
}

/**
 * A daily-check photo carrying one of these marks (see photo-integrity.ts) is not
 * offered for the page. Each puts in doubt something the page would state about the
 * photo: the day it was taken (the same picture was used before; the phone's time is
 * before the day of the check) or that it is this kitchen (taken far away; a faked
 * location). The marks for a phone clock running ahead and for a picture chosen from
 * files in the browser preview do not bar a photo: its day is taken from the
 * checklist it belongs to, and a person at ECCS looks at every photo anyway.
 */
export const PUBLIC_PHOTO_BARRED_FLAGS: readonly PhotoFlagCode[] = ["SAME_FILE", "LOOKS_SAME", "TAKEN_BEFORE", "FAR_FROM_OUTLET", "MOCK_LOCATION"];

/**
 * The languages the page can be read in, in the order of its language switch.
 * A language is only offered once the page's own text has been translated into it.
 */
export const PUBLIC_PAGE_LANGUAGES = ["EN", "TE", "HI", "UR"] as const;
export type PublicPageLanguage = (typeof PUBLIC_PAGE_LANGUAGES)[number];

// ───────────────────────── What is shown ─────────────────────────

/**
 * Everything a diner is shown, and nothing else about the outlet: no ids, no
 * staff names, no prices, no times of day, no individual checks, no issues.
 */
export interface PublicPageDto {
  restaurantName: string;
  outletName: string;
  city: string;
  /** YYYY-MM-DD: the day the page calls "yesterday" (the day before today in India). The checklist results are for this day. */
  yesterday: string;
  /** Yesterday's hygiene score, or the most recent one of the last week. Null when there is none. */
  score: PublicPageScoreDto | null;
  /** The outlet's daily checklists in the order they fall due, with yesterday's result for each. */
  checklists: PublicPageChecklistDto[];
  /** The kitchen's own daily checks over the last 30 days. Null when there are none to count. */
  selfChecks: { handedIn: number; days: number } | null;
  /** Approved photos, the newest first. `n` is the photo's place in the list, used in its address. */
  photos: { n: number; caption: PublicPhotoCaption; date: string; by: PublicPhotoBy }[];
  /** ECCS's latest approved inspection, while it is inside its validity period. Null when there is none. */
  inspection: {
    /** Whole number out of 100. */
    score: number;
    grade: InspectionGrade;
    /** YYYY-MM-DD, the day it was carried out. */
    date: string;
    /** YYYY-MM-DD, the last day this result is shown. */
    shownUntil: string;
    /** e.g. "IR-2026-00001": the reference a diner can ask the restaurant or ECCS about. */
    reportNumber: string;
  } | null;
  /** The latest ECCS service of each kind. */
  services: PublicPageServiceDto[];
  /** The outlet's FSSAI licence number as the restaurant gave it to ECCS, for the diner to check with FSSAI. */
  fssaiNumber: string | null;
  /** Where to ask ECCS whether this page is genuine. */
  eccsPhone: string;
  /** When this answer was put together from the records. */
  updatedAt: string;
}

export interface PublicPageServiceDto {
  /** The kind of service, e.g. "PEST". */
  code: string;
  name: LocalizedText;
  /** YYYY-MM-DD, the day the work was done. */
  date: string;
  /** The ECCS certificate for that visit, if it is still valid today. */
  certificateNumber: string | null;
  certificateValidUntil: string | null;
}

// ───────────────────────── For the restaurant and ECCS ─────────────────────────

/** A photo proposed for the page, as whoever proposed it, ECCS admins and the restaurant see it. */
export interface PublicPhotoDto {
  id: string;
  outletId: string;
  outletName: string;
  organizationName: string;
  caption: PublicPhotoCaption;
  status: PublicPhotoStatus;
  /** Where it came from: the restaurant's own daily check, or an ECCS visit or inspection. */
  source: PublicPhotoSource;
  /** YYYY-MM-DD: the day it was taken. For a daily-check photo, the day of that check. */
  takenOn: string;
  /** YYYY-MM-DD: the last day it can be shown (see photoShownUntil). */
  shownUntil: string;
  /** True once that day has passed: the photo has dropped off the page by itself. */
  expired: boolean;
  /** Relative to the API base URL. Valid for a limited time. Never the public address. */
  path: string;
  /**
   * The id of the visit or inspection photo this was proposed from, so the Supervisor's
   * screen can mark the photos already proposed. Null for the restaurant.
   */
  sourcePhotoId: string | null;
  /** Who proposed it. Null for the restaurant, which is not told. */
  proposedByName: string | null;
  proposedAt: string;
  decidedAt: string | null;
  /**
   * Why ECCS rejected it. Told to whoever proposed the photo: the Supervisor for an
   * ECCS photo, the restaurant for one from its own daily checks. Null otherwise.
   */
  rejectReason: string | null;
  /** True once the Owner or ECCS has taken an approved photo off the page. */
  removed: boolean;
  /** True when it is one of the photos a diner sees now (approved, not removed, not too old, among the newest six). */
  shown: boolean;
}

/** A proof photo from the outlet's own daily checks that the restaurant can put forward for its page. */
export interface PublicCheckPhotoDto {
  /** The id it is proposed with. */
  attachmentId: string;
  /** Relative to the API base URL. Valid for a limited time. */
  path: string;
  /** YYYY-MM-DD: the day of the daily check it was taken for. */
  date: string;
  /** The checklist and the check it was the proof for. Shown to the restaurant only, never on the page. */
  checklist: LocalizedText;
  check: LocalizedText;
}

/** The "Add photos from your daily checks" screen: what can be put forward, and what already has been. */
export interface PublicCheckPhotosDto {
  /** Photos of checks marked as fine, in checklists handed in during the last 14 days, not yet put forward. The newest first. */
  eligible: PublicCheckPhotoDto[];
  /** What the restaurant has put forward from its daily checks, the newest first: waiting, on the page, or not approved. */
  proposed: PublicPhotoDto[];
  /** What this person may do here. */
  canPropose: boolean;
}

/** The customer page of one outlet, for the app's "Customer page" screen and the console. */
export interface PublicPageSettingsDto {
  outletId: string;
  outletName: string;
  organizationName: string;
  /** The restaurant's own switch. */
  enabled: boolean;
  /** ECCS has taken the page down; the restaurant's switch has no effect until ECCS restores it. */
  takenDown: boolean;
  /** Why, as typed by ECCS. Null for the restaurant. */
  takenDownReason: string | null;
  state: PublicPageState;
  /** The address the QR code holds. */
  url: string;
  /** True while that address only works inside the office network (see isLocalOnlyAddress). */
  localOnly: boolean;
  /** When the link was last replaced; null if never. */
  linkChangedAt: string | null;
  /**
   * The latest approved inspection, whether or not it still counts. For information
   * only: since 13 Oct 2026 the page shows without one.
   */
  inspection: { state: PublicInspectionState; date: string | null; shownUntil: string | null };
  /** What a diner sees now, or would see if the page were on. Null only when the client is switched off. */
  preview: PublicPageDto | null;
  /** Approved photos that have not been removed and are not too old, the newest first. */
  photos: PublicPhotoDto[];
  /** Photos waiting for ECCS's approval. */
  photosWaiting: number;
  /** What this person may do here. */
  canSwitch: boolean;
  canTakeDown: boolean;
  /** May put forward photos from the outlet's own daily checks. */
  canPropose: boolean;
}

export const setPublicPageSchema = z.object({ enabled: z.boolean() });
export type SetPublicPageInput = z.input<typeof setPublicPageSchema>;

export const PUBLIC_PAGE_REASON_MAX = 300;

/** ECCS takes a page down: the reason is required, for ECCS's own record. */
export const takeDownPublicPageSchema = z.object({ reason: z.string().trim().min(1).max(PUBLIC_PAGE_REASON_MAX) });
export type TakeDownPublicPageInput = z.input<typeof takeDownPublicPageSchema>;

/**
 * A photo that already exists is put forward with what it shows: by a Supervisor from
 * a visit or an inspection, or by the restaurant from one of its own daily checks.
 */
export const proposePublicPhotoSchema = z.object({
  attachmentId: z.uuid(),
  caption: z.enum(PUBLIC_PHOTO_CAPTIONS),
});
export type ProposePublicPhotoInput = z.input<typeof proposePublicPhotoSchema>;

export const rejectPublicPhotoSchema = z.object({ reason: z.string().trim().min(1).max(PUBLIC_PAGE_REASON_MAX) });
export type RejectPublicPhotoInput = z.input<typeof rejectPublicPhotoSchema>;

/** The rule ECCS checks every photo against before it may appear. Shown beside the photo in the console. */
export const PUBLIC_PHOTO_RULE = "No people, no faces, no customer areas, nothing that identifies staff.";

/** One-tap reasons for rejecting a photo; anything else is typed. */
export const PUBLIC_PHOTO_REJECT_REASONS = [
  "Shows a person or a face",
  "Shows a customer area",
  "Identifies a member of staff (name, uniform badge, rota)",
  "Blurred, dark or unclear",
  "Does not show the area named",
  "Not fit to publish",
] as const;
