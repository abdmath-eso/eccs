import { z } from "zod";
import type { LocalizedText } from "./checklists.js";
import { addDays, daysFrom } from "./finance.js";
import { indiaDay } from "./food-labels.js";
import type { PhotoFlagDto } from "./photo-integrity.js";
import { clockWords, salesRupees, shortDate } from "./sales.js";
import { visitSlotWindow, VISIT_SLOTS, type VisitSlot, type VisitStatus } from "./services.js";

// Quality (20 Oct 2026; docs/CONSOLE_PLAN.md section 4.5, the founder's design page 5): three
// work queues and a month strip, for the Super Admin and the Ops Manager.
// - Follow-ups: an unhappy kitchen to call back. It comes in by itself when a rule trips (a visit
//   rated 3 or fewer, an issue reopened, the hygiene score down 15 points in a week, an inspection
//   with no grade), once per cause, and leaves when its free visit is done or it is closed. Nothing
//   here changes a score: there is no re-inspection (the founder, 7 Oct 2026).
// - Photos: doubtful proof photos (photo-integrity.ts), and a checklist ticked too fast, judged by a
//   person: accepted, or rejected with a retake asked for. The customer-page photos to approve are
//   on the same tab (they moved from Customer pages).
// - Incidents: anything that could become a claim, a complaint or a lesson.
// The rules, the thresholds and the words are here; the API gathers the facts (apps/api/src/quality/).

/** Every number Quality uses. Change one here and the server and the console follow. */
export const QUALITY_RULES = {
  /** A visit rated this many stars or fewer by the restaurant brings the outlet into Follow-ups. */
  lowRatingStars: 3,
  /** The hygiene score falling this many points or more ... */
  scoreDropPoints: 15,
  /** ... below its highest of the previous this-many days brings the outlet in. */
  scoreDropDays: 7,
  /** Causes older than this many days are not brought in: a call back weeks later is no longer a follow-up. */
  causeLookbackDays: 14,
  /** Doubtful photos older than this many days are no longer asked about: a retake is pointless by then. */
  photoLookbackDays: 14,
  /** Closed follow-ups and judged photos stay listed under "Done" for this many days. */
  doneShownDays: 30,
  /** The longest note, reason or incident text. */
  noteMax: 1000,
  textMax: 4000,
  /** The most photos and files on one incident. */
  maxIncidentFiles: 20,
  /** A cost above this (₹10,00,000) is a typing mistake. */
  maxCostRupees: 1_000_000,
} as const;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// ───────────────────────── Follow-ups: what brings an outlet in ─────────────────────────

/**
 * RATING: a visit the restaurant rated 3 stars or fewer when signing it off (SignOff.rating).
 * ISSUE_REOPENED: an issue the restaurant reopened after ECCS resolved it or it was closed (Issue.reopenedAt).
 * SCORE_DROP: the hygiene score's daily record (HygieneScoreSnapshot) 15 points or more below its highest of the week before.
 * INSPECTION: an ECCS inspection approved with no grade: FSSAI's "no grade", which any failed critical check also gives.
 */
export const FOLLOW_UP_CAUSES = ["RATING", "ISSUE_REOPENED", "SCORE_DROP", "INSPECTION"] as const;
export type FollowUpCause = (typeof FOLLOW_UP_CAUSES)[number];

/** What a follow-up was made from, kept with it (FollowUp.facts) so its words never change afterwards. */
export type FollowUpFacts =
  | { cause: "RATING"; visitDate: string; serviceName: string; stars: number; comment: string | null }
  | { cause: "ISSUE_REOPENED"; reference: string; title: string; times: number }
  | { cause: "SCORE_DROP"; from: number; to: number; fromDate: string; toDate: string }
  | { cause: "INSPECTION"; inspectionDate: string; score: number | null; criticalFailed: number; reportNumber: string | null };

/** One cause found in the records: its key (one follow-up per key, ever) and its facts. */
export interface FollowUpCauseFound {
  causeKey: string;
  outletId: string;
  facts: FollowUpFacts;
  /** When it happened (ISO). */
  causedAt: string;
  jobId?: string | null;
  issueId?: string | null;
  inspectionId?: string | null;
}

/** A signed-off visit's rating: a cause when it is 3 stars or fewer. One per visit. */
export function ratingCause(signOff: {
  jobId: string;
  outletId: string;
  rating: number | null;
  comment: string | null;
  signedAt: string;
  visitDate: string;
  serviceName: string;
}): FollowUpCauseFound | null {
  if (signOff.rating === null || signOff.rating > QUALITY_RULES.lowRatingStars) return null;
  return {
    causeKey: `RATING:${signOff.jobId}`,
    outletId: signOff.outletId,
    jobId: signOff.jobId,
    causedAt: signOff.signedAt,
    facts: { cause: "RATING", visitDate: signOff.visitDate, serviceName: signOff.serviceName, stars: signOff.rating, comment: signOff.comment?.trim() || null },
  };
}

/** A reopened issue: one cause each time it is reopened. */
export function issueReopenedCause(issue: {
  id: string;
  outletId: string;
  reference: string;
  title: string;
  reopenedAt: string | null;
  reopenCount: number;
}): FollowUpCauseFound | null {
  if (!issue.reopenedAt || issue.reopenCount < 1) return null;
  return {
    causeKey: `ISSUE_REOPENED:${issue.id}:${issue.reopenCount}`,
    outletId: issue.outletId,
    issueId: issue.id,
    causedAt: issue.reopenedAt,
    facts: { cause: "ISSUE_REOPENED", reference: issue.reference, title: issue.title, times: issue.reopenCount },
  };
}

/** An approved inspection: a cause when it has no grade (any failed critical check gives none). */
export function inspectionCause(inspection: {
  id: string;
  outletId: string;
  grade: string | null;
  approvedAt: string | null;
  conductedOn: string;
  score: number | null;
  criticalFailed: number;
  reportNumber: string | null;
}): FollowUpCauseFound | null {
  if (!inspection.approvedAt || inspection.grade !== "NON_COMPLIANT") return null;
  return {
    causeKey: `INSPECTION:${inspection.id}`,
    outletId: inspection.outletId,
    inspectionId: inspection.id,
    causedAt: inspection.approvedAt,
    facts: {
      cause: "INSPECTION",
      inspectionDate: inspection.conductedOn,
      score: inspection.score === null ? null : Math.round(inspection.score),
      criticalFailed: inspection.criticalFailed,
      reportNumber: inspection.reportNumber,
    },
  };
}

/**
 * The score's falls of 15 points or more in a week at one outlet, from its daily records (any
 * order). For each day, the highest of the seven days before is the score it fell from; a fall
 * from the same high point is the same drop, so it gives one cause, keyed by that day, however
 * many days the score stays down. The first day the fall reached 15 points is when it happened.
 */
export function scoreDropCauses(outletId: string, snapshots: readonly { date: string; score: number }[]): FollowUpCauseFound[] {
  const days = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const found = new Map<string, FollowUpCauseFound>();
  for (const day of days) {
    const from = addDays(day.date, -QUALITY_RULES.scoreDropDays);
    let peak: { date: string; score: number } | null = null;
    for (const before of days) {
      if (before.date < from || before.date >= day.date) continue;
      // The latest of equal highs, so the key does not jump back to an older day.
      if (!peak || before.score >= peak.score) peak = before;
    }
    if (!peak || peak.score - day.score < QUALITY_RULES.scoreDropPoints) continue;
    const causeKey = `SCORE_DROP:${outletId}:${peak.date}`;
    if (found.has(causeKey)) continue;
    found.set(causeKey, {
      causeKey,
      outletId,
      // The record is for a day; the fall is known by the end of it (India).
      causedAt: new Date(`${day.date}T23:59:00.000+05:30`).toISOString(),
      facts: { cause: "SCORE_DROP", from: Math.round(peak.score), to: Math.round(day.score), fromDate: peak.date, toDate: day.date },
    });
  }
  return [...found.values()];
}

/** "Visit 25 Nov rated 2: "crew left early, floor still wet"". The console's English. */
export function followUpReason(facts: FollowUpFacts): string {
  switch (facts.cause) {
    case "RATING":
      return `${facts.serviceName} on ${shortDate(facts.visitDate)} rated ${plural(facts.stars, "star")}${facts.comment ? `: "${facts.comment}"` : ""}`;
    case "ISSUE_REOPENED":
      return `Issue ${facts.reference} reopened${facts.times > 1 ? ` (${facts.times === 2 ? "twice" : `${facts.times} times`})` : ""}: ${facts.title}`;
    case "SCORE_DROP":
      return `Hygiene score fell ${facts.from - facts.to} points in a week: ${facts.from} on ${shortDate(facts.fromDate)}, ${facts.to} on ${shortDate(facts.toDate)}`;
    case "INSPECTION": {
      const what = facts.criticalFailed > 0 ? `${plural(facts.criticalFailed, "critical check")} failed, no grade` : "no grade";
      return `Inspection on ${shortDate(facts.inspectionDate)}: ${what}${facts.score !== null ? ` (score ${facts.score})` : ""}`;
    }
  }
}

/** Short names for the causes, for the filter and the strip. */
export const FOLLOW_UP_CAUSE_LABELS: Record<FollowUpCause, string> = {
  RATING: "Low rating",
  ISSUE_REOPENED: "Issue reopened",
  SCORE_DROP: "Score fell",
  INSPECTION: "Inspection, no grade",
};

// ───────────────────────── Follow-ups: where one stands ─────────────────────────

/** OPEN: in the queue. DONE: its free visit was done. CLOSED: closed with a note. */
export const FOLLOW_UP_STATUSES = ["OPEN", "DONE", "CLOSED"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/** A free visit is done once the Supervisor has finished it (whatever the restaurant's sign-off). */
export const followUpVisitDone = (status: VisitStatus | "COMPLETED" | "APPROVED") =>
  status === "COMPLETED" || status === "APPROVED" || status === "IN_REVIEW";

/** NOT_BOOKED: needs the office. BOOKED: a free visit is in the diary. DONE and CLOSED: out of the queue. */
export type FollowUpStanding = "NOT_BOOKED" | "BOOKED" | "DONE" | "CLOSED";

/** The free visit booked for a follow-up, as the queue shows it. */
export interface FollowUpVisitDto {
  id: string;
  date: string;
  slot: VisitSlot | null;
  status: VisitStatus;
  serviceName: LocalizedText;
  supervisorName: string | null;
}

/** "Fri 23 Oct, 3 pm". */
export function visitWhenWords(date: string, slot: VisitSlot | null): string {
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));
  if (!slot) return day;
  const window = visitSlotWindow(slot);
  return `${day}, ${window ? clockWords(window.start) : "after closing"}`;
}

/** Where a follow-up stands, and the words for it ("Booked Fri 23 Oct, 3 pm", "Not booked"). */
export function followUpStanding(status: FollowUpStatus, visit: Pick<FollowUpVisitDto, "date" | "slot" | "status"> | null): { standing: FollowUpStanding; words: string } {
  if (status === "CLOSED") return { standing: "CLOSED", words: "Closed" };
  if (status === "DONE") return { standing: "DONE", words: "Free visit done" };
  if (!visit) return { standing: "NOT_BOOKED", words: "Not booked" };
  if (visit.status === "CANCELLED") return { standing: "NOT_BOOKED", words: "Not booked: the free visit was cancelled" };
  if (followUpVisitDone(visit.status)) return { standing: "DONE", words: "Free visit done" };
  return { standing: "BOOKED", words: `Booked ${visitWhenWords(visit.date, visit.slot)}` };
}

/** The queue's order: what needs the office first (nothing booked), then booked; the longest waiting first. */
export function sortFollowUps<T extends { standing: FollowUpStanding; causedAt: string }>(rows: readonly T[]): T[] {
  const rank: Record<FollowUpStanding, number> = { NOT_BOOKED: 0, BOOKED: 1, DONE: 2, CLOSED: 3 };
  return [...rows].sort((a, b) => rank[a.standing] - rank[b.standing] || a.causedAt.localeCompare(b.causedAt));
}

/** Where the cause can be seen. */
export type FollowUpSource =
  | { kind: "VISIT"; visitId: string }
  | { kind: "ISSUE"; issueId: string }
  | { kind: "INSPECTION"; inspectionId: string }
  | { kind: "HEALTH"; outletId: string };

export interface FollowUpCallDto {
  id: string;
  note: string;
  calledByName: string;
  loggedByName: string;
  at: string;
}

export interface FollowUpDto {
  id: string;
  outletId: string;
  outletName: string;
  area: string | null;
  /** The outlet's latest hygiene score, if it has one. */
  score: number | null;
  cause: FollowUpCause;
  /** "Chimney and hood cleaning on 25 Oct rated 2 stars: "crew left early"". */
  reason: string;
  source: FollowUpSource;
  causedAt: string;
  /** Whole days since the cause (India days). */
  sinceDays: number;
  status: FollowUpStatus;
  standing: FollowUpStanding;
  /** "Booked Fri 23 Oct, 3 pm", "Not booked". */
  standingWords: string;
  /** What the kitchen was told: the latest call's note, with who called ("Abdul: a free redo offered"); null for "Nothing yet". */
  told: string | null;
  calls: FollowUpCallDto[];
  visit: FollowUpVisitDto | null;
  /** The kind of service to offer for the free visit: the rated visit's, when there is one. */
  suggestedService: string | null;
  closedAt: string | null;
  closedByName: string | null;
  closeNote: string | null;
}

/** GET /quality/follow-ups. */
export interface FollowUpsDto {
  /** OPEN ones (the queue), or those done or closed in the last 30 days, as asked. */
  items: FollowUpDto[];
  /** Who can be named as having made a call: ECCS's office and Supervisors. */
  callers: { id: string; name: string }[];
}

export const logFollowUpCallSchema = z.object({
  note: z.string().trim().min(2, "Say what was said").max(QUALITY_RULES.noteMax),
  /** Who called; the person logging it when left out. */
  calledById: z.uuid().optional(),
});
export type LogFollowUpCallInput = z.input<typeof logFollowUpCallSchema>;

/** Book a free redo or check-in visit: a normal visit in the diary, marked free (no invoice, no score). */
export const bookFollowUpVisitSchema = z.object({
  serviceCode: z.string().trim().min(1, "Choose the service"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day"),
  slot: z.enum(VISIT_SLOTS, { error: "Choose the time" }),
  supervisorId: z.uuid().nullable().optional(),
});
export type BookFollowUpVisitInput = z.input<typeof bookFollowUpVisitSchema>;

export const closeFollowUpSchema = z.object({ note: z.string().trim().min(2, "Say how it was settled").max(QUALITY_RULES.noteMax) });
export type CloseFollowUpInput = z.input<typeof closeFollowUpSchema>;

// ───────────────────────── Photos ─────────────────────────

/** CHECKLIST: a restaurant's checklist (its doubtful photos, or the whole list ticked too fast). VISIT: an ECCS visit's before and after photos. */
export const PHOTO_REVIEW_KINDS = ["CHECKLIST", "VISIT"] as const;
export type PhotoReviewKind = (typeof PHOTO_REVIEW_KINDS)[number];

export const PHOTO_VERDICTS = ["ACCEPTED", "REJECTED"] as const;
export type PhotoVerdict = (typeof PHOTO_VERDICTS)[number];

/** The reasons offered when rejecting; another can be typed. The person told reads the one chosen. */
export const PHOTO_REJECT_REASONS = [
  "The photo does not show the check being done",
  "The same photo as an earlier one",
  "Not taken at the kitchen",
  "Too dark or blurred to see",
  "The checklist was ticked too fast to be real",
] as const;

/** One photo in a queue item. */
export interface QualityPhotoDto {
  id: string;
  /** A signed link to the picture, valid for a while. */
  path: string;
  /** PROOF for a checklist check; BEFORE or AFTER for a visit. */
  kind: "PROOF" | "BEFORE" | "AFTER";
  /** The checklist item it is proof of ("Fridge temperature"); null for a visit's photo. */
  itemLabel: LocalizedText | null;
  /** Its reasons for doubt, empty when it is shown only as part of a list ticked too fast. */
  flags: PhotoFlagDto[];
  /** Who took it, with their role in words ("Kiran, Head Chef"); null when not known. */
  takenBy: string | null;
  /** When the server received it (ISO). */
  receivedAt: string;
}

/** One thing to judge: a checklist's or a visit's doubtful proof. */
export interface PhotoQueueItemDto {
  /** "CHECKLIST:<run id>" or "VISIT:<visit id>". */
  key: string;
  kind: PhotoReviewKind;
  /** The checklist run's id, or the visit's. */
  id: string;
  outletId: string;
  outletName: string;
  /** The checklist's title, or the kind of service. */
  what: LocalizedText;
  /** The day of the work (India). */
  date: string;
  photos: QualityPhotoDto[];
  /** Reasons that belong to the whole checklist (TOO_FAST). */
  runFlags: PhotoFlagDto[];
  /** Every reason in words, without repeats, the strongest first. */
  reasons: string[];
  /** True when a reason has no innocent explanation (the identical file again, a faked location). */
  certain: boolean;
  /** The oldest of its photos or its handing in (ISO): the queue runs oldest first. */
  waitingSince: string;
  /** Who a rejection tells, in words: "The outlet's Manager" or "Naveen, the Supervisor". */
  tells: string;
  /** For a visit: its id, to open it. */
  visitId: string | null;
}

/** GET /quality/photos: the doubtful-photo queue, and this month's judgements. */
export interface PhotoQueueDto {
  items: PhotoQueueItemDto[];
  /** This month (India) so far. */
  month: { judged: number; rejected: number };
}

/** Accept or reject one queue item. `photoIds` are the photos the page showed, so one arriving since is not judged unseen. */
export const judgePhotosSchema = z.object({
  kind: z.enum(PHOTO_REVIEW_KINDS),
  id: z.uuid(),
  photoIds: z.array(z.uuid()).max(50),
});
export type JudgePhotosInput = z.input<typeof judgePhotosSchema>;

export const rejectPhotosSchema = judgePhotosSchema.extend({
  note: z.string().trim().min(3, "Say why, for the person who took it").max(300),
});
export type RejectPhotosInput = z.input<typeof rejectPhotosSchema>;

/** What a judgement answers. */
export interface PhotoJudgedDto {
  reviewId: string;
  verdict: PhotoVerdict;
  /** How many people were told (a rejection only). */
  told: number;
}

/** The strongest reasons first: those with no innocent explanation, then the order photo-integrity.ts lists them in. */
export function orderFlags(flags: readonly PhotoFlagDto[]): PhotoFlagDto[] {
  return [...flags].sort((a, b) => Number(b.certain) - Number(a.certain));
}

// ───────────────────────── Incidents ─────────────────────────

export const INCIDENT_STATUSES = ["OPEN", "CLOSED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** "INC-0003". */
export const incidentReference = (value: number) => `INC-${String(value).padStart(4, "0")}`;

const costRupees = z
  .number({ error: "Enter the cost in rupees" })
  .min(0, "The cost cannot be below nothing")
  .max(QUALITY_RULES.maxCostRupees, "That cost looks too high");

export const createIncidentSchema = z.object({
  outletId: z.uuid({ error: "Choose the outlet" }),
  /** The visit it happened on, if any. */
  visitId: z.uuid().nullable().optional(),
  happenedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day it happened"),
  whatHappened: z.string().trim().min(5, "Say what happened").max(QUALITY_RULES.textMax),
  whatWasDone: z.string().trim().max(QUALITY_RULES.textMax).optional(),
  costRupees: costRupees.nullable().optional(),
  /** Photos or files already uploaded for the outlet (POST /attachments). */
  attachmentIds: z.array(z.uuid()).max(QUALITY_RULES.maxIncidentFiles).optional(),
});
export type CreateIncidentInput = z.input<typeof createIncidentSchema>;

export const updateIncidentSchema = z.object({
  visitId: z.uuid().nullable().optional(),
  happenedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  whatHappened: z.string().trim().min(5, "Say what happened").max(QUALITY_RULES.textMax).optional(),
  whatWasDone: z.string().trim().max(QUALITY_RULES.textMax).optional(),
  costRupees: costRupees.nullable().optional(),
  /** Photos or files to add (uploaded first). */
  addAttachmentIds: z.array(z.uuid()).max(QUALITY_RULES.maxIncidentFiles).optional(),
  /** Photos or files to take off it. */
  removeAttachmentIds: z.array(z.uuid()).max(QUALITY_RULES.maxIncidentFiles).optional(),
});
export type UpdateIncidentInput = z.input<typeof updateIncidentSchema>;

export const closeIncidentSchema = z.object({
  note: z.string().trim().min(3, "Say how it ended: what was paid or done").max(QUALITY_RULES.textMax),
  costRupees: costRupees.nullable().optional(),
});
export type CloseIncidentInput = z.input<typeof closeIncidentSchema>;

export interface IncidentFileDto {
  id: string;
  path: string;
  /** A PDF (a clinic note, a bill) rather than a photo. */
  isPdf: boolean;
}

export interface IncidentSummaryDto {
  id: string;
  /** "INC-0003". */
  reference: string;
  outletId: string;
  outletName: string;
  happenedOn: string;
  whatHappened: string;
  whatWasDone: string | null;
  costPaise: number | null;
  status: IncidentStatus;
  fileCount: number;
}

export interface IncidentDto extends IncidentSummaryDto {
  organizationName: string;
  outletAddress: string | null;
  /** The visit it happened on, if any. */
  visit: { id: string; date: string; serviceName: LocalizedText; supervisorName: string | null; reportNumber: string | null } | null;
  files: IncidentFileDto[];
  createdByName: string;
  createdAt: string;
  closedByName: string | null;
  closedAt: string | null;
  closeNote: string | null;
}

/** GET /quality/incidents. */
export interface IncidentsDto {
  /** Open first, then the most recent. */
  items: IncidentSummaryDto[];
}

/** "₹1,200 paid out", "No cost". */
export const costWords = (paise: number | null) => (paise ? `${salesRupees(paise)}` : "No cost");

// ───────────────────────── The page as a whole ─────────────────────────

/** How many things wait in each tab: the menu's badge is their total. */
export interface QualityCountsDto {
  /** Open follow-ups with nothing booked. */
  followUps: number;
  /** Doubtful-photo items to judge. */
  photos: number;
  /** Customer-page photos waiting for approval (0 for someone who may not approve them). */
  customerPhotos: number;
  /** Open incidents. */
  incidents: number;
  total: number;
}

/** "3 kitchens need a follow-up. 2 photos to review. 1 incident open." */
export function qualityHeadline(counts: { followUpKitchens: number; photos: number; incidents: number }): string {
  const parts: string[] = [];
  if (counts.followUpKitchens > 0) parts.push(`${plural(counts.followUpKitchens, "kitchen")} ${counts.followUpKitchens === 1 ? "needs" : "need"} a follow-up.`);
  if (counts.photos > 0) parts.push(`${plural(counts.photos, "photo")} to review.`);
  if (counts.incidents > 0) parts.push(`${plural(counts.incidents, "incident")} open.`);
  return parts.length > 0 ? parts.join(" ") : "Nothing is waiting in Quality.";
}

/** The month's figures behind the strip, as the server counts them (India month). */
export interface QualityMonthFacts {
  /** "2026-10". */
  month: string;
  /** Visits signed off this month, and how many of them were rated, with the stars added up. */
  signedOff: number;
  rated: number;
  starsTotal: number;
  /** Rated 3 or fewer. */
  lowRated: number;
  /** Visit and inspection reports approved this month, and of those, approved without being sent back. */
  reportsApproved: number;
  reportsFirstTime: number;
  /** Follow-ups that came in this month, those done or closed this month, and those open now. */
  followUpsIn: number;
  followUpsClosed: number;
  followUpsOpen: number;
  /** Incidents that happened this month, those still open, and what they cost. */
  incidents: number;
  incidentsOpen: number;
  incidentCostPaise: number;
}

export interface QualityTileDto {
  key: "RATINGS" | "FIRST_TIME" | "FOLLOW_UPS" | "INCIDENTS";
  label: string;
  /** "18 of 24", "96%", "3". */
  value: string;
  /** "average 4.4 · 2 rated 3 or below". */
  detail: string;
}

/** The month strip at the foot of the page: four figures, the field-service "callback rate" idea in ECCS's own measures. */
export function qualityStrip(facts: QualityMonthFacts): QualityTileDto[] {
  const average = facts.rated > 0 ? (facts.starsTotal / facts.rated).toFixed(1) : null;
  const sentBack = facts.reportsApproved - facts.reportsFirstTime;
  return [
    {
      key: "RATINGS",
      label: "Visits rated this month",
      value: facts.signedOff > 0 ? `${facts.rated} of ${facts.signedOff}` : "None yet",
      detail: average ? `average ${average} · ${facts.lowRated === 0 ? "none" : facts.lowRated} rated 3 or below` : "no visit signed off yet",
    },
    {
      key: "FIRST_TIME",
      label: "Reports approved first time",
      value: facts.reportsApproved > 0 ? `${Math.round((facts.reportsFirstTime / facts.reportsApproved) * 100)}%` : "None yet",
      detail:
        facts.reportsApproved > 0
          ? `${facts.reportsFirstTime} of ${facts.reportsApproved}${sentBack > 0 ? ` · ${sentBack} sent back first` : ""}`
          : "no report approved yet",
    },
    {
      key: "FOLLOW_UPS",
      label: "Follow-ups closed this month",
      value: String(facts.followUpsClosed),
      detail: `${facts.followUpsIn} came in · ${facts.followUpsOpen} still open`,
    },
    {
      key: "INCIDENTS",
      label: "Incidents this month",
      value: String(facts.incidents),
      detail: `${facts.incidentsOpen} open${facts.incidentCostPaise > 0 ? ` · ${salesRupees(facts.incidentCostPaise)} paid out` : ""}`,
    },
  ];
}

/** GET /quality: the headline, the counts for the tabs, and the month strip. */
export interface QualitySummaryDto {
  headline: string;
  counts: QualityCountsDto;
  strip: QualityTileDto[];
  /** May approve customer-page photos (the Photos tab's second queue). */
  approvesCustomerPhotos: boolean;
}

/** Whole India days from one moment to another. */
export const daysSince = (at: string, now: Date) => Math.max(0, daysFrom(indiaDay(at), indiaDay(now)));
