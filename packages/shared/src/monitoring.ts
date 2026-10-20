import type { LocalizedText } from "./checklists.js";
import { daysFrom } from "./finance.js";
import type { InspectionGrade } from "./inspections.js";
import type { IssueCategory, IssueStatus } from "./issues.js";
import type { PhotoFlagDto, PhotoSubjectDto } from "./photo-integrity.js";

// The ECCS monitoring board: every outlet at a glance, with what it is falling behind on.
//
// The board is for ECCS office staff deciding whom to call today. For each
// outlet it gathers the facts the platform already records, area by area, and
// judges each area as one of four levels. The rules for that judgement, and
// every number they depend on, are in this file and nowhere else.
//
// Only what ECCS acts on is here (the founder, 20 Oct 2026: the restaurant's own checklists and
// licences are "redundant, what will we do by watching that"; they are the restaurant's to keep,
// in its app, and both still count in the hygiene score). An operations board keeps the numbers its
// team can move and drops the rest.

/**
 * How an area, or a whole outlet, is doing:
 * ATTENTION = something is wrong or late and someone should act today;
 * WATCH = not wrong yet, but heading that way or waiting on someone;
 * OK = nothing to do;
 * NONE = nothing recorded yet to judge by (a new outlet, no score yet).
 */
export const MONITORING_LEVELS = ["ATTENTION", "WATCH", "OK", "NONE"] as const;
export type MonitoringLevel = (typeof MONITORING_LEVELS)[number];

/** The areas an outlet is judged on: one column of the board each. */
export const MONITORING_AREAS = ["issues", "visits", "inspections", "score", "photos"] as const;
export type MonitoringArea = (typeof MONITORING_AREAS)[number];

/** The board looks back this many days unless asked otherwise, and never further than the maximum. */
export const MONITORING_DEFAULT_DAYS = 7;
export const MONITORING_MAX_DAYS = 31;

/**
 * Every threshold the board uses, in one place. These are sample values chosen
 * while building; change them here and both the server and the console follow.
 */
export const MONITORING_RULES = {
  issues: {
    /** An issue nobody at ECCS has picked up ("open") for more than this many days: needs attention. */
    notStartedAttentionDays: 2,
    /** An issue still unresolved, picked up or not, after more than this many days: needs attention. */
    unresolvedAttentionDays: 7,
  },
  visits: {
    /** A visit with no Supervisor that is due within this many days: needs attention. */
    unassignedAttentionWithinDays: 2,
    /** A finished visit the restaurant has not signed off for more than this many days: needs attention. */
    signOffAttentionDays: 3,
    /** A signed-off report ECCS has not approved for more than this many days: needs attention. */
    approvalAttentionDays: 2,
    /** A rating of this many stars or fewer is a low rating: needs attention. */
    lowRatingStars: 2,
    /** An average rating below this over the period: worth watching. */
    watchAverageBelow: 4,
  },
  inspections: {
    /** An inspection report ECCS has not approved for more than this many days: needs attention. */
    approvalAttentionDays: 2,
  },
  score: {
    /** A hygiene score below this: needs attention. */
    attentionBelow: 60,
    /** A hygiene score below this: worth watching. */
    watchBelow: 75,
    /** A fall of at least this many points since about a week earlier: needs attention. */
    attentionDrop: 10,
    /** A fall of at least this many points: worth watching. */
    watchDrop: 5,
    /** The earlier score to compare with is the latest one at least this many days before the current one. */
    compareDaysBack: 7,
  },
  photos: {
    /** This many doubtful proof photos in the period, or more: needs attention. */
    attentionCount: 3,
    /** This share of the period's proof photos doubtful, or more: needs attention. */
    attentionPercent: 10,
    /** Fewer proof photos than this in the period and the share is not used (one doubtful photo of two is not "50%"). */
    percentFromPhotos: 10,
    /** This many photo judgements in Quality that rejected the proof, or more, in the period: needs attention. */
    attentionRejected: 1,
  },
} as const;

// ───────────────────────── The facts, area by area ─────────────────────────

export interface MonitoringIssueFacts {
  /** Open or in progress. */
  unresolved: number;
  /** Of those, how many nobody at ECCS has picked up yet. */
  notStarted: number;
  /** Whole days since the oldest issue nobody has picked up was raised; `null` when there is none. */
  oldestNotStartedDays: number | null;
  /** Whole days since the oldest unresolved issue was raised; `null` when there is none. */
  oldestUnresolvedDays: number | null;
}

export interface MonitoringVisitFacts {
  /** Before today and the work has not been done. */
  overdue: number;
  /** Still to do and no Supervisor chosen. */
  unassigned: number;
  /** Of the unassigned, those due within the next few days (or already overdue). */
  unassignedSoon: number;
  /** Finished, waiting for the restaurant to sign off. */
  awaitingSignOff: number;
  /** Whole days the longest-waiting one has waited; `null` when there is none. */
  oldestSignOffDays: number | null;
  /** Signed off, waiting for ECCS to approve the report. */
  reportsToApprove: number;
  oldestApprovalDays: number | null;
  /** Reports ECCS sent back to the Supervisor to correct. */
  reportsReturned: number;
  /** Ratings the restaurant gave when signing off during the period. */
  ratingCount: number;
  /** Their average, to one decimal place; `null` when there are none. */
  ratingAverage: number | null;
  /** How many of them were low (two stars or fewer). */
  lowRatings: number;
}

export interface MonitoringInspectionFacts {
  /** The grade of the latest approved inspection; `null` when the outlet has none. */
  latestGrade: InspectionGrade | null;
  /** Corrective actions of that inspection whose fix-by date has passed and that are not marked as put right. */
  actionsOverdue: number;
  /** Finished inspections waiting for ECCS to approve the report. */
  toApprove: number;
  oldestApprovalDays: number | null;
  /** Planned inspections whose day has passed without the report being finished. */
  overduePlanned: number;
}

export interface MonitoringScoreFacts {
  /** The latest hygiene score, 0 to 100; `null` when the outlet has not been scored yet. */
  score: number | null;
  /** The score from about a week before it, if there is one. */
  previous: number | null;
}

/**
 * Proof photos received in the period (checklist checks, visit before and after photos,
 * inspection findings) and how many of them are doubtful. An indicator of how far the
 * self-reported part of the picture can be trusted; it does not change the hygiene score.
 */
export interface MonitoringPhotoFacts {
  /** Proof photos received in the period. */
  checked: number;
  /** Of those, how many carry at least one reason for doubt. */
  doubtful: number;
  /** Of the doubtful, how many have a reason with no innocent explanation (the identical file again, a faked location). */
  certain: number;
  /** Of the doubtful, how many are the restaurant's own checklist photos; the rest were taken by ECCS's Supervisors. */
  fromChecklists: number;
  /**
   * Judgements in Quality > Photos in the period that rejected the proof and asked for a retake
   * (20 Oct 2026). A doubtful photo the office accepted is no longer counted as doubtful.
   * Optional so a board saved before it reads as none.
   */
  rejected?: number;
}

// ───────────────────────── The rules ─────────────────────────
// One function per area. Each returns the worst level that applies.

const share = (part: number, whole: number) => Math.round((part / whole) * 100);

/**
 * Issues raised with ECCS.
 * ATTENTION: one has waited more than 2 days without ECCS picking it up, or is still unresolved after more than 7 days.
 * WATCH: any issue is unresolved.
 */
export function issueLevel(facts: MonitoringIssueFacts): MonitoringLevel {
  const rules = MONITORING_RULES.issues;
  if (facts.unresolved === 0) return "OK";
  if ((facts.oldestNotStartedDays ?? 0) > rules.notStartedAttentionDays) return "ATTENTION";
  if ((facts.oldestUnresolvedDays ?? 0) > rules.unresolvedAttentionDays) return "ATTENTION";
  return "WATCH";
}

/**
 * Service visits.
 * ATTENTION: a visit is overdue; a visit due within 2 days has no Supervisor; a finished visit has waited more
 * than 3 days for the restaurant's sign-off; a report has waited more than 2 days for ECCS's approval; or the
 * restaurant gave a rating of two stars or fewer in the period.
 * WATCH: anything else is waiting on someone (no Supervisor, sign-off, approval, a report sent back), or the
 * average rating over the period is below 4.
 */
export function visitLevel(facts: MonitoringVisitFacts): MonitoringLevel {
  const rules = MONITORING_RULES.visits;
  if (
    facts.overdue > 0 ||
    facts.unassignedSoon > 0 ||
    (facts.oldestSignOffDays ?? 0) > rules.signOffAttentionDays ||
    (facts.oldestApprovalDays ?? 0) > rules.approvalAttentionDays ||
    facts.lowRatings > 0
  ) {
    return "ATTENTION";
  }
  if (
    facts.unassigned > 0 ||
    facts.awaitingSignOff > 0 ||
    facts.reportsToApprove > 0 ||
    facts.reportsReturned > 0 ||
    (facts.ratingAverage !== null && facts.ratingAverage < rules.watchAverageBelow)
  ) {
    return "WATCH";
  }
  return "OK";
}

/**
 * Scored inspections.
 * ATTENTION: the latest approved inspection ended with no grade (not compliant); or a finished report has waited
 * more than 2 days for ECCS's approval. A corrective action past its fix-by date is not held against the outlet:
 * there is no re-inspection (founder, 7 Oct 2026), so nothing could ever clear it. The count is still reported.
 * WATCH: the latest grade is B; a report is waiting for approval; or a planned inspection's day has passed.
 * NONE: the outlet has never been inspected and nothing is planned late.
 */
export function inspectionLevel(facts: MonitoringInspectionFacts): MonitoringLevel {
  const rules = MONITORING_RULES.inspections;
  if (
    facts.latestGrade === "NON_COMPLIANT" ||
    (facts.oldestApprovalDays ?? 0) > rules.approvalAttentionDays
  ) {
    return "ATTENTION";
  }
  if (facts.latestGrade === "B" || facts.toApprove > 0 || facts.overduePlanned > 0) return "WATCH";
  return facts.latestGrade === null ? "NONE" : "OK";
}

/**
 * The hygiene score.
 * ATTENTION: below 60, or down 10 points or more on about a week earlier.
 * WATCH: below 75, or down 5 points or more.
 * NONE: not yet scored.
 */
export function scoreLevel(facts: MonitoringScoreFacts): MonitoringLevel {
  const rules = MONITORING_RULES.score;
  if (facts.score === null) return "NONE";
  const drop = facts.previous === null ? 0 : facts.previous - facts.score;
  if (facts.score < rules.attentionBelow || drop >= rules.attentionDrop) return "ATTENTION";
  if (facts.score < rules.watchBelow || drop >= rules.watchDrop) return "WATCH";
  return "OK";
}

/**
 * Proof photos.
 * ATTENTION: any photo is doubtful for a reason with no innocent explanation (the identical file used again,
 * a location the phone reports as faked); or 3 or more are doubtful; or, once there are at least 10 photos,
 * 10% or more of them are.
 * Also ATTENTION: the office rejected a photo or a checklist in Quality > Photos in the period.
 * WATCH: any photo is doubtful (and not accepted in Quality).
 * NONE: no proof photo was received in the period.
 */
export function photoLevel(facts: MonitoringPhotoFacts): MonitoringLevel {
  const rules = MONITORING_RULES.photos;
  // A rejection is ECCS's own judgement that the proof was not good enough: it needs attention whatever else.
  if ((facts.rejected ?? 0) >= rules.attentionRejected) return "ATTENTION";
  if (facts.checked === 0) return "NONE";
  if (facts.doubtful === 0) return "OK";
  if (facts.certain > 0 || facts.doubtful >= rules.attentionCount) return "ATTENTION";
  if (facts.checked >= rules.percentFromPhotos && share(facts.doubtful, facts.checked) >= rules.attentionPercent) {
    return "ATTENTION";
  }
  return "WATCH";
}

/** What the board needs to know about one visit not yet finished with, to say what it is waiting on. */
export interface VisitStandingFacts {
  /** As stored: SCHEDULED, ASSIGNED, IN_PROGRESS, COMPLETED, APPROVED or CANCELLED. */
  status: string;
  /** YYYY-MM-DD the visit is in the diary for. */
  date: string;
  /** India date the Supervisor finished it; null while not finished. */
  finishedOn: string | null;
  /** India date the restaurant signed it off; null while not signed off. */
  signedOffOn: string | null;
  /** The restaurant has signed it off (a report sent back for correction keeps its sign-off). */
  hasSignOff: boolean;
  /** ECCS has approved the report. */
  reviewed: boolean;
}

/**
 * Where a visit stands and for how long, in whole India days. The one reading of a visit's
 * status that the monitoring board and the Today page (20 Oct 2026) share:
 * AWAITING_SIGN_OFF = finished, the restaurant has not signed it off (days since finished);
 * REPORT_TO_APPROVE = signed off, ECCS has not approved the report (days since signed off);
 * REPORT_RETURNED = ECCS sent the signed-off report back to the Supervisor to correct;
 * TO_DO = still to do, or under way (days late, or days ahead);
 * CLOSED = cancelled, or approved by ECCS.
 */
export type VisitStanding =
  | { stage: "AWAITING_SIGN_OFF" | "REPORT_TO_APPROVE"; waitingDays: number }
  | { stage: "REPORT_RETURNED" }
  | { stage: "TO_DO"; daysLate: number; daysAhead: number }
  | { stage: "CLOSED" };

export function visitStanding(visit: VisitStandingFacts, today: string): VisitStanding {
  if (visit.status === "CANCELLED" || (visit.status === "APPROVED" && visit.reviewed)) return { stage: "CLOSED" };
  if (visit.status === "COMPLETED") return { stage: "AWAITING_SIGN_OFF", waitingDays: daysFrom(visit.finishedOn ?? visit.date, today) };
  if (visit.status === "APPROVED") return { stage: "REPORT_TO_APPROVE", waitingDays: daysFrom(visit.signedOffOn ?? visit.date, today) };
  // The work itself is done, so a report sent back is never late.
  if (visit.status === "IN_PROGRESS" && visit.hasSignOff) return { stage: "REPORT_RETURNED" };
  const ahead = daysFrom(today, visit.date);
  return { stage: "TO_DO", daysLate: Math.max(0, -ahead), daysAhead: Math.max(0, ahead) };
}

/**
 * An outlet as a whole is as bad as its worst area: ATTENTION if any area needs
 * attention, otherwise WATCH if any is worth watching, otherwise OK. Areas with
 * nothing to judge by are left out; an outlet with nothing at all is NONE.
 */
export function overallLevel(levels: readonly MonitoringLevel[]): MonitoringLevel {
  if (levels.includes("ATTENTION")) return "ATTENTION";
  if (levels.includes("WATCH")) return "WATCH";
  return levels.includes("OK") ? "OK" : "NONE";
}

// ───────────────────────── What the endpoint returns ─────────────────────────

/** One unresolved issue, for the link to where it is answered. */
export interface MonitoringIssueItemDto {
  id: string;
  /** e.g. "ECCS-0042" */
  reference: string;
  status: IssueStatus;
  category: IssueCategory;
  /** Whole days since it was raised. */
  ageDays: number;
}

export interface MonitoringIssuesDto extends MonitoringIssueFacts {
  level: MonitoringLevel;
  /** The unresolved issues, oldest first. */
  items: MonitoringIssueItemDto[];
}

/** Why a visit is on the board. */
export const MONITORING_VISIT_PROBLEMS = ["OVERDUE", "UNASSIGNED", "AWAITING_SIGN_OFF", "REPORT_TO_APPROVE", "REPORT_RETURNED", "LOW_RATING"] as const;
export type MonitoringVisitProblem = (typeof MONITORING_VISIT_PROBLEMS)[number];

export interface MonitoringVisitItemDto {
  id: string;
  serviceName: LocalizedText;
  /** YYYY-MM-DD the visit is or was in the diary for. */
  date: string;
  /** A visit can be here for more than one reason, e.g. overdue and without a Supervisor. */
  problems: MonitoringVisitProblem[];
  /** Whole days it has been waiting (overdue, for sign-off or for approval); `null` where that does not apply. */
  waitingDays: number | null;
  /** The stars given, for a low rating. */
  rating: number | null;
}

export interface MonitoringVisitsDto extends MonitoringVisitFacts {
  level: MonitoringLevel;
  /** YYYY-MM-DD of the next visit still to do, today or later; `null` when none is in the diary. */
  nextDate: string | null;
  /** The visits behind the numbers, longest-waiting first. */
  items: MonitoringVisitItemDto[];
}

export const MONITORING_INSPECTION_PROBLEMS = ["NO_GRADE", "REPORT_TO_APPROVE", "OVERDUE_PLANNED"] as const;
export type MonitoringInspectionProblem = (typeof MONITORING_INSPECTION_PROBLEMS)[number];

export interface MonitoringInspectionItemDto {
  id: string;
  /** YYYY-MM-DD it was carried out, or is planned for. */
  date: string;
  problems: MonitoringInspectionProblem[];
}

export interface MonitoringInspectionsDto extends MonitoringInspectionFacts {
  level: MonitoringLevel;
  /** The latest approved inspection; `null` when the outlet has none. */
  latest: { id: string; date: string; score: number; grade: InspectionGrade; reportNumber: string | null } | null;
  /** Corrective actions of the latest approved inspection not yet marked as put right, whether or not their date has passed. */
  actionsOpen: number;
  /** The inspections behind the numbers. */
  items: MonitoringInspectionItemDto[];
}

export interface MonitoringScoreDto extends MonitoringScoreFacts {
  level: MonitoringLevel;
  /** YYYY-MM-DD the latest score is for. */
  date: string | null;
  /** YYYY-MM-DD the earlier score is for. */
  previousDate: string | null;
  /** Latest minus earlier, in points; `null` when there is nothing to compare with. */
  change: number | null;
}

/**
 * One doubtful proof photo: when, what it was for and why it is doubtful. The picture itself is
 * not here. A visit's or an inspection's photo is seen on that visit or inspection; a restaurant's
 * checklist photo is not shown to ECCS in the console at all, so for those this is all there is.
 */
export interface MonitoringPhotoItemDto {
  id: string;
  /** YYYY-MM-DD (India) our server received it. */
  receivedOn: string;
  what: PhotoSubjectDto;
  /** Set for a visit's photo, to link to the visit. */
  visitId: string | null;
  /** Set for an inspection's photo, to link to the inspection. */
  inspectionId: string | null;
  flags: PhotoFlagDto[];
}

export interface MonitoringPhotosDto extends MonitoringPhotoFacts {
  level: MonitoringLevel;
  /** The doubtful photos, newest first (at most 20). */
  items: MonitoringPhotoItemDto[];
}

/** One outlet on the board. */
export interface MonitoringOutletDto {
  outletId: string;
  outletName: string;
  organizationId: string;
  organizationName: string;
  /** The plan the outlet is on; `null` when it is on none. */
  plan: { code: string; name: LocalizedText } | null;
  /** The worst of the areas. */
  level: MonitoringLevel;
  /** The areas that need attention, and those worth watching. */
  attention: MonitoringArea[];
  watch: MonitoringArea[];
  issues: MonitoringIssuesDto;
  visits: MonitoringVisitsDto;
  inspections: MonitoringInspectionsDto;
  score: MonitoringScoreDto;
  photos: MonitoringPhotosDto;
}

/** The counts for the strip above the table. */
export interface MonitoringTotalsDto {
  outlets: number;
  /** Outlets by their overall level. */
  attention: number;
  watch: number;
  ok: number;
  /** For each area, how many outlets need attention there and how many are worth watching. */
  areas: Record<MonitoringArea, { attention: number; watch: number }>;
}

export interface MonitoringBoardDto {
  /** Today in India, YYYY-MM-DD. */
  date: string;
  /** The period the rating and photo figures cover, both days included. */
  from: string;
  to: string;
  days: number;
  totals: MonitoringTotalsDto;
  /** Worst first: outlets needing attention, then those to watch, then the rest. */
  outlets: MonitoringOutletDto[];
}
