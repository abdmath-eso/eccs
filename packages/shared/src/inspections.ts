import { z } from "zod";
import type { LocalizedText } from "./checklists.js";
import type { PhotoFlagDto } from "./photo-integrity.js";

// Scored inspections: an ECCS Supervisor audits an outlet against an FSSAI-style
// checklist and the outlet gets a scored report. ECCS approves the report before
// the restaurant can read it. This is ECCS's periodic audit; it is separate from
// the restaurant's own daily checklists and from service visits.

/** The English name of the standard template (packages/db/prisma/data/inspection-template.json). */
export const INSPECTION_TEMPLATE_NAME = "Kitchen hygiene inspection (FSSAI Schedule 4)";

export const INSPECTION_ANSWERS = ["COMPLIANT", "NON_COMPLIANT", "NOT_APPLICABLE"] as const;
export type InspectionAnswer = (typeof INSPECTION_ANSWERS)[number];

/** How serious a non-compliance is, mildest first. */
export const INSPECTION_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type InspectionSeverity = (typeof INSPECTION_SEVERITIES)[number];

/**
 * Where an inspection stands:
 * PLANNED = it has a day and a Supervisor but no check is answered yet;
 * IN_PROGRESS = the Supervisor is answering (also after ECCS sent it back);
 * SUBMITTED = finished and scored, waiting for ECCS to approve;
 * APPROVED = ECCS approved the report, which is now final and visible to the restaurant.
 */
export const INSPECTION_STATUSES = ["PLANNED", "IN_PROGRESS", "SUBMITTED", "APPROVED"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/** Best first. NON_COMPLIANT is FSSAI's "no grade". */
export const INSPECTION_GRADES = ["A_PLUS", "A", "B", "NON_COMPLIANT"] as const;
export type InspectionGrade = (typeof INSPECTION_GRADES)[number];

/** Marks for an ordinary check and for a critical one, as on FSSAI's checklists (2, and 4 for asterisk questions). */
export const INSPECTION_MARKS = 2;
export const INSPECTION_CRITICAL_MARKS = 4;
/** A check is critical when it carries the critical marks. */
export const isCriticalCheck = (marks: number) => marks >= INSPECTION_CRITICAL_MARKS;

/**
 * The lowest score, out of 100, for each grade. They are FSSAI's bands for its
 * catering inspection checklist (A+ 100 to 114, A 91 to 99, B 77 to 90 out of 114
 * marks; below 77 no grade) turned into percentages.
 */
export const INSPECTION_GRADE_FROM = { A_PLUS: 88, A: 80, B: 68 } as const;

export const INSPECTION_MAX_PHOTOS = 4;
export const INSPECTION_NOTE_MAX = 500;

export interface ScoredCheck {
  /** The section's name; checks with the same name are scored together. */
  section: string;
  /** 2, or 4 for a critical check. */
  marks: number;
  /** `null` while unanswered: counted as not earned. */
  answer: InspectionAnswer | null;
}

export interface SectionScore {
  section: string;
  /** Whole number out of 100; `null` when every check in the section is not applicable. */
  score: number | null;
  earned: number;
  possible: number;
  nonCompliant: number;
  notApplicable: number;
}

export interface InspectionScore {
  /** Whole number out of 100. */
  overallScore: number;
  grade: InspectionGrade;
  earned: number;
  possible: number;
  nonCompliant: number;
  /** Critical checks answered "not compliant". Any at all makes the grade NON_COMPLIANT. */
  criticalFailed: number;
  notApplicable: number;
  sections: SectionScore[];
}

/**
 * The scoring rule, following FSSAI's hygiene rating checklists:
 * 1. A compliant check earns its marks (2, or 4 if critical); a non-compliant one earns 0.
 * 2. A check that is not applicable is left out: it adds to neither the marks earned
 *    nor the marks possible.
 * 3. A score is marks earned ÷ marks possible × 100, rounded to a whole number. This is
 *    done once per section and once over all checks together (so the overall score is
 *    not the average of the section scores: bigger sections count for more).
 * 4. Grade from the overall score: A+ from 88, A from 80, B from 68, below that no grade
 *    (NON_COMPLIANT).
 * 5. Failing any critical check makes the grade NON_COMPLIANT whatever the score.
 */
export function scoreInspection(checks: readonly ScoredCheck[]): InspectionScore {
  const sections: SectionScore[] = [];
  let criticalFailed = 0;
  for (const check of checks) {
    let section = sections.find((entry) => entry.section === check.section);
    if (!section) {
      section = { section: check.section, score: null, earned: 0, possible: 0, nonCompliant: 0, notApplicable: 0 };
      sections.push(section);
    }
    if (check.answer === "NOT_APPLICABLE") {
      section.notApplicable += 1;
      continue;
    }
    section.possible += check.marks;
    if (check.answer === "COMPLIANT") section.earned += check.marks;
    if (check.answer === "NON_COMPLIANT") {
      section.nonCompliant += 1;
      if (isCriticalCheck(check.marks)) criticalFailed += 1;
    }
  }

  const percent = (earned: number, possible: number) => Math.round((earned / possible) * 100);
  for (const section of sections) {
    section.score = section.possible > 0 ? percent(section.earned, section.possible) : null;
  }
  const sum = (pick: (section: SectionScore) => number) => sections.reduce((total, section) => total + pick(section), 0);
  const earned = sum((section) => section.earned);
  const possible = sum((section) => section.possible);
  const overallScore = possible > 0 ? percent(earned, possible) : 0;

  let grade: InspectionGrade = "NON_COMPLIANT";
  if (criticalFailed === 0 && possible > 0) {
    if (overallScore >= INSPECTION_GRADE_FROM.A_PLUS) grade = "A_PLUS";
    else if (overallScore >= INSPECTION_GRADE_FROM.A) grade = "A";
    else if (overallScore >= INSPECTION_GRADE_FROM.B) grade = "B";
  }
  return {
    overallScore,
    grade,
    earned,
    possible,
    nonCompliant: sum((section) => section.nonCompliant),
    criticalFailed,
    notApplicable: sum((section) => section.notApplicable),
    sections,
  };
}

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist");

/** Puts an inspection of an outlet in the list. */
export const startInspectionSchema = z.object({
  outletId: z.string().min(1),
  /** ECCS admins only: who carries it out. Left out, it is the person starting it. */
  supervisorId: z.string().min(1).nullish(),
  /** YYYY-MM-DD, today or later. Left out, it is today. */
  date: dateSchema.optional(),
});
export type StartInspectionInput = z.input<typeof startInspectionSchema>;

/** ECCS moves a planned inspection or gives it to someone else. Only what is given changes. */
export const updateInspectionSchema = z.object({
  supervisorId: z.string().min(1).optional(),
  date: dateSchema.optional(),
});
export type UpdateInspectionInput = z.input<typeof updateInspectionSchema>;

/**
 * The answer to one check. It is saved as soon as it is given, so the details of a
 * non-compliance (what was found, how serious, what to do, by when) may arrive after
 * the answer itself; every one of them, and a photo, is required before the
 * inspection can be finished. Each save replaces the details with what is sent.
 */
export const answerInspectionCheckSchema = z.object({
  answer: z.enum(INSPECTION_ANSWERS),
  /** What was found. */
  note: z.string().trim().max(INSPECTION_NOTE_MAX).optional(),
  severity: z.enum(INSPECTION_SEVERITIES).nullish(),
  /** What the restaurant must do to put it right. */
  correctiveAction: z.string().trim().max(INSPECTION_NOTE_MAX).optional(),
  /** YYYY-MM-DD the restaurant must have put it right by. */
  dueDate: dateSchema.nullish(),
  /**
   * When the check was answered on the phone. Sent by a phone that may have had no
   * signal at the time, so the inspection is dated by when it was done, not when it arrived.
   */
  at: z.iso.datetime().optional(),
});
export type AnswerInspectionCheckInput = z.input<typeof answerInspectionCheckSchema>;

/** ECCS sends a finished inspection back to the Supervisor, saying what to correct. */
export const returnInspectionSchema = z.object({
  note: z.string().trim().min(3, "Say what needs correcting").max(500),
});
export type ReturnInspectionInput = z.input<typeof returnInspectionSchema>;

/** An outlet an inspection can be started for. */
export interface InspectionOutletDto {
  id: string;
  name: string;
  organizationName: string;
  address: string | null;
}

/** One inspection as shown in lists. */
export interface InspectionSummaryDto {
  id: string;
  outletId: string;
  outletName: string;
  outletAddress: string | null;
  organizationName: string;
  status: InspectionStatus;
  /** YYYY-MM-DD: the day it is planned for, or was carried out. */
  date: string;
  supervisorId: string;
  supervisorName: string;
  /** Checks answered so far, and how many there are. */
  answered: number;
  total: number;
  /** Out of 100, once finished. */
  overallScore: number | null;
  grade: InspectionGrade | null;
  /** How many checks were answered "not compliant". */
  nonCompliant: number;
  /** e.g. "IR-2026-00001", once finished. */
  reportNumber: string | null;
  completedAt: string | null;
  approvedAt: string | null;
}

export interface InspectionPhotoDto {
  id: string;
  /** Relative to the API base URL. Valid for a limited time. */
  path: string;
  /** Why the photo is doubtful, if it is. Only ECCS admins are told; left out for everyone else. */
  flags?: PhotoFlagDto[];
}

export interface InspectionCheckDto {
  itemId: string;
  /** Its number in the whole inspection, 1 to 92. */
  number: number;
  label: LocalizedText;
  critical: boolean;
  marks: number;
  /** `null` until answered. */
  answer: InspectionAnswer | null;
  /** The rest is filled in for a non-compliance only. */
  note: string | null;
  severity: InspectionSeverity | null;
  correctiveAction: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  photos: InspectionPhotoDto[];
  /**
   * True when nothing more is needed for this check: it is answered, and a
   * non-compliance has its note, severity, corrective action, date and a photo.
   */
  complete: boolean;
}

export interface InspectionSectionDto {
  /** "1" to "10": its place in the inspection. */
  key: string;
  title: string;
  /** Out of 100 from the answers so far; `null` when nothing in it applies. */
  score: number | null;
  earned: number;
  possible: number;
  checks: InspectionCheckDto[];
}

/** One inspection in full. Once approved, this is the inspection report. */
export interface InspectionDto extends InspectionSummaryDto {
  sections: InspectionSectionDto[];
  /** Checks that are complete (see `InspectionCheckDto.complete`); finishing needs all of them. */
  complete: number;
  criticalFailed: number;
  startedAt: string | null;
  /** What ECCS asked to be corrected, while it is back with the Supervisor. Never sent to the restaurant. */
  correctionNote: string | null;
  /** What the person asking may do with it now. */
  canRecord: boolean;
  /** ECCS admins, once it is finished: approve it or send it back. */
  canReview: boolean;
  /** ECCS admins, before the first answer: move it, reassign it or remove it. */
  canManage: boolean;
}

/** What comes back after answering one check: just that check and the counts, to keep it light on a slow connection. */
export interface InspectionAnswerResultDto {
  check: InspectionCheckDto;
  status: InspectionStatus;
  answered: number;
  complete: number;
  total: number;
}
