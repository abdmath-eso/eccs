// The public page a diner reaches by scanning an outlet's QR code.
//
// What the page is, in short (the rules below were chosen on 9 Oct 2026 from the
// research the founder accepted that day; see docs/STATUS.md):
// - The headline is ECCS's own inspection: its score, its date and its report number.
//   The combined hygiene score out of 100 is NOT shown, because 40 of its points come
//   from what the restaurant reports about itself. A diner is told the inspected part
//   and the self-reported part separately, each as what it is.
// - The page lapses by itself. With no approved inspection inside the validity period,
//   or with the restaurant, the outlet or the page switched off, a diner sees one plain
//   "nothing current to show" page, the same in every case and for an unknown link.
// - It is ECCS's private result, never a government rating, and must not look like one.

import { z } from "zod";
import type { LocalizedText } from "./checklists.js";
import type { InspectionGrade } from "./inspections.js";
import { SCORE_RULES } from "./scores.js";

/** The settings of the page. Change the numbers here to retune it. */
export const PUBLIC_PAGE_RULES = {
  /**
   * An approved inspection is shown for this many days after it was carried out, the
   * last day counted. The same period as in the hygiene score, so the two never disagree.
   */
  inspectionValidDays: SCORE_RULES.inspectionValidDays,
  /** The kitchen's own daily checks are counted over this many days, ending yesterday. */
  selfCheckDays: 30,
  /** At most this many approved photos are shown, the newest first. */
  maxPhotos: 6,
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

// ───────────────────────── Is there anything to show? ─────────────────────────

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
 */
export const PUBLIC_PAGE_STATES = ["LIVE", "INACTIVE", "TAKEN_DOWN", "OFF", "NO_INSPECTION", "INSPECTION_EXPIRED"] as const;
export type PublicPageState = (typeof PUBLIC_PAGE_STATES)[number];

export interface PublicPageStateInput {
  /** The restaurant and the outlet are both still switched on as ECCS clients. */
  clientActive: boolean;
  /** ECCS has taken the page down. */
  takenDown: boolean;
  /** The restaurant's own switch. */
  enabled: boolean;
  /** The day of the latest approved inspection, or null. */
  inspectionDate: string | null;
  today: string;
}

/**
 * The one rule for whether a diner is shown the page. The first reason that
 * applies is the one reported: a client that has left, then ECCS's take-down
 * (which the restaurant cannot override), then the restaurant's own switch,
 * then the inspection.
 */
export function publicPageState(input: PublicPageStateInput): PublicPageState {
  if (!input.clientActive) return "INACTIVE";
  if (input.takenDown) return "TAKEN_DOWN";
  if (!input.enabled) return "OFF";
  const inspection = publicInspectionState(input.inspectionDate, input.today);
  if (inspection === "NONE") return "NO_INSPECTION";
  if (inspection === "EXPIRED") return "INSPECTION_EXPIRED";
  return "LIVE";
}

// ───────────────────────── What is shown ─────────────────────────

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

/** What a public photo shows. A fixed list, so nothing typed by anyone appears on the page. */
export const PUBLIC_PHOTO_CAPTIONS = ["GRILL", "HOOD", "COLD_STORAGE", "PREP_AREA", "FLOOR_DRAINS", "WASH_AREA"] as const;
export type PublicPhotoCaption = (typeof PUBLIC_PHOTO_CAPTIONS)[number];

export const PUBLIC_PHOTO_STATUSES = ["PROPOSED", "APPROVED", "REJECTED"] as const;
export type PublicPhotoStatus = (typeof PUBLIC_PHOTO_STATUSES)[number];

/**
 * The languages the page can be read in, in the order of its language switch.
 * A language is only offered once the page's own text has been translated into it.
 */
export const PUBLIC_PAGE_LANGUAGES = ["EN", "TE", "HI", "UR"] as const;
export type PublicPageLanguage = (typeof PUBLIC_PAGE_LANGUAGES)[number];

/**
 * Everything a diner is shown, and nothing else about the outlet: no ids, no
 * staff names, no prices, no checklist content, no issues.
 */
export interface PublicPageDto {
  restaurantName: string;
  outletName: string;
  city: string;
  /** ECCS's latest approved inspection: the headline. */
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
  };
  /** The kitchen's own daily checks, reported by the restaurant itself. Null when there are none to count. */
  selfChecks: { handedIn: number; days: number } | null;
  /** The latest ECCS service of each kind. */
  services: PublicPageServiceDto[];
  /** Approved photos, the newest first. `n` is the photo's place in the list, used in its address. */
  photos: { n: number; caption: PublicPhotoCaption; date: string }[];
  /** The outlet's FSSAI licence number as recorded with ECCS, for the diner to check with FSSAI. */
  fssaiNumber: string | null;
  /** Where to ask ECCS whether this result is genuine. */
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

/** A photo proposed for the page, as the Supervisor, ECCS admins and the Owner see it. */
export interface PublicPhotoDto {
  id: string;
  outletId: string;
  outletName: string;
  organizationName: string;
  caption: PublicPhotoCaption;
  status: PublicPhotoStatus;
  /** Relative to the API base URL. Valid for a limited time. Never the public address. */
  path: string;
  /**
   * The id of the visit or inspection photo this was proposed from, so the Supervisor's
   * screen can mark the photos already proposed. Null for the restaurant.
   */
  sourcePhotoId: string | null;
  /** The Supervisor who proposed it. Null for the restaurant, which is not told. */
  proposedByName: string | null;
  proposedAt: string;
  decidedAt: string | null;
  /** Why ECCS rejected it. Null for the restaurant. */
  rejectReason: string | null;
  /** True once the Owner or ECCS has taken an approved photo off the page. */
  removed: boolean;
  /** True when it is one of the photos a diner sees now (approved, not removed, among the newest six). */
  shown: boolean;
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
  /** The latest approved inspection, whether or not it still counts. */
  inspection: { state: PublicInspectionState; date: string | null; shownUntil: string | null };
  /** What a diner sees now, or would see if the page were on. Null when there is no current inspection or the client is switched off. */
  preview: PublicPageDto | null;
  /** Approved photos that have not been removed, the newest first. */
  photos: PublicPhotoDto[];
  /** Photos waiting for ECCS's approval. */
  photosWaiting: number;
  /** What this person may do here. */
  canSwitch: boolean;
  canTakeDown: boolean;
}

export const setPublicPageSchema = z.object({ enabled: z.boolean() });
export type SetPublicPageInput = z.input<typeof setPublicPageSchema>;

export const PUBLIC_PAGE_REASON_MAX = 300;

/** ECCS takes a page down: the reason is required, for ECCS's own record. */
export const takeDownPublicPageSchema = z.object({ reason: z.string().trim().min(1).max(PUBLIC_PAGE_REASON_MAX) });
export type TakeDownPublicPageInput = z.input<typeof takeDownPublicPageSchema>;

/** A Supervisor proposes an existing photo of a visit or an inspection. */
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
