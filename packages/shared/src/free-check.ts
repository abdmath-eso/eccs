// The free-check scorecard (16 Oct 2026): a short check a BDE does in a prospect's kitchen
// to show the owner what ECCS would fix. Ten points, each OK, Needs fixing or Could not
// see, a photo on "Needs fixing" if the BDE wants one, and a note. Finishing logs "free
// check done" on the lead with how many things need fixing (which "Likely to close"
// already reads, sales.ts), and the owner can be sent on WhatsApp what needs fixing and
// which ECCS service fixes each.
//
// The ten points are the parts of the founder's 92 inspection checks
// (packages/db/prisma/data/inspection-template.json) a person can see in a few minutes
// in a kitchen they do not own, plus the fire extinguisher and gas, which the inspection
// does not cover and ECCS's safety inspection does. Each is matched to the ECCS service
// that puts it right, or to the ECCS app where the fix is a daily habit (labels, the
// hand-wash station, bins). The wording the phone shows is app text (packages/i18n,
// "bde.check.*"); the English here is the console's.
//
// PATTERN FOLLOWED: SafetyCulture-style inspection templates: a short list of questions
// with a fixed set of answers (Pass, Fail, N/A; Safe, At risk), a failed answer flagged,
// and a photo and note on a flagged item (help.safetyculture.com, "Response sets" and
// "Flagged responses"). "Could not see" is the N/A: it is never counted as fine or as a fault.

import { z } from "zod";

/** The ten points, in the order the BDE walks the kitchen: the cooking line, the floor, storage, the people. Stored keys: add, never rename. */
export const FREE_CHECK_POINTS = ["HOOD", "DRAINS", "PESTS", "FLOOR_WALLS", "STORAGE", "HANDWASH", "WASTE", "FIRE_GAS", "CHEMICALS", "STAFF"] as const;
export type FreeCheckPoint = (typeof FREE_CHECK_POINTS)[number];

/** OK, Needs fixing, Could not see. Stored keys. */
export const FREE_CHECK_ANSWERS = ["OK", "FIX", "UNSEEN"] as const;
export type FreeCheckAnswer = (typeof FREE_CHECK_ANSWERS)[number];

/** The points in English, for the console. */
export const FREE_CHECK_POINT_LABELS: Record<FreeCheckPoint, string> = {
  HOOD: "Grease on the hood and filters",
  DRAINS: "Drains and grease trap",
  PESTS: "Signs of pests",
  FLOOR_WALLS: "Floor and walls",
  STORAGE: "Food storage and labels",
  HANDWASH: "Hand-wash station",
  WASTE: "Waste bins",
  FIRE_GAS: "Fire extinguisher and gas",
  CHEMICALS: "Cleaning chemicals stored safely",
  STAFF: "Staff hair and uniform",
};

export const FREE_CHECK_ANSWER_LABELS: Record<FreeCheckAnswer, string> = { OK: "OK", FIX: "Needs fixing", UNSEEN: "Could not see" };

/**
 * What ECCS does about a point that needs fixing: one of its services (by the code of the
 * kind of service in the catalogue, so a quote can offer it), or the ECCS app itself.
 */
export type FreeCheckFix = { kind: "SERVICE"; service: string } | { kind: "APP"; feature: "LABELS" | "CHECKLISTS" };

export const FREE_CHECK_FIXES: Record<FreeCheckPoint, FreeCheckFix> = {
  HOOD: { kind: "SERVICE", service: "CHIMNEY" },
  DRAINS: { kind: "SERVICE", service: "GREASE_TRAP" },
  PESTS: { kind: "SERVICE", service: "PEST" },
  FLOOR_WALLS: { kind: "SERVICE", service: "DEEP_CLEAN" },
  STORAGE: { kind: "APP", feature: "LABELS" },
  HANDWASH: { kind: "APP", feature: "CHECKLISTS" },
  WASTE: { kind: "APP", feature: "CHECKLISTS" },
  FIRE_GAS: { kind: "SERVICE", service: "SAFETY_INSPECTION" },
  CHEMICALS: { kind: "SERVICE", service: "CHEMICAL_REFILL" },
  STAFF: { kind: "SERVICE", service: "FSS_TRAINING" },
};

/** The fixes in English, for the console. */
export const FREE_CHECK_FIX_LABELS: Record<FreeCheckPoint, string> = {
  HOOD: "Chimney and hood cleaning",
  DRAINS: "Grease trap cleaning",
  PESTS: "Pest control",
  FLOOR_WALLS: "Kitchen deep clean",
  STORAGE: "Food labels with use-by dates in the ECCS app",
  HANDWASH: "Daily hygiene checks in the ECCS app",
  WASTE: "Daily hygiene checks in the ECCS app",
  FIRE_GAS: "Fire and equipment safety inspection",
  CHEMICALS: "Cleaning chemicals refill, labelled",
  STAFF: "Food Safety Supervisor training",
};

/** Which of the founder's 92 inspection checks each point stands for (the inspection template's codes). FIRE_GAS has none. */
export const FREE_CHECK_INSPECTION_CHECKS: Record<FreeCheckPoint, readonly string[]> = {
  HOOD: ["2.6", "10.1"],
  DRAINS: ["2.10", "9.6", "9.7"],
  PESTS: ["8.1", "8.2", "8.3", "8.4"],
  FLOOR_WALLS: ["2.2", "2.3", "7.4"],
  STORAGE: ["4.5", "4.6", "4.13", "6.6"],
  HANDWASH: ["3.1", "7.8"],
  WASTE: ["8.5", "9.2", "9.3", "9.4"],
  FIRE_GAS: [],
  CHEMICALS: ["4.12", "7.5", "7.6"],
  STAFF: ["3.3", "3.4", "3.5", "3.6"],
};

export const FREE_CHECK_RULES = {
  /** One photo a point at most: it is there to show the owner, not to document the kitchen. */
  photosPerPoint: 1,
  noteMax: 200,
} as const;

/** One point's answer as the phone sends it. A photo only on "Needs fixing". */
export const freeCheckAnswerSchema = z.object({
  point: z.enum(FREE_CHECK_POINTS, "Unknown point"),
  answer: z.enum(FREE_CHECK_ANSWERS, "Choose OK, Needs fixing or Could not see"),
  photoId: z.uuid().nullable().optional(),
});

/** The whole scorecard: every point answered, each once. */
export const freeCheckSchema = z
  .object({ answers: z.array(freeCheckAnswerSchema).max(FREE_CHECK_POINTS.length * 2) })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, entry] of value.answers.entries()) {
      if (seen.has(entry.point)) context.addIssue({ code: "custom", path: ["answers", index, "point"], message: "Each point once" });
      seen.add(entry.point);
      if (entry.photoId && entry.answer !== "FIX") context.addIssue({ code: "custom", path: ["answers", index, "photoId"], message: "A photo goes only with Needs fixing" });
    }
    const missing = FREE_CHECK_POINTS.filter((point) => !seen.has(point));
    if (missing.length > 0) context.addIssue({ code: "custom", path: ["answers"], message: `Answer every point (${missing.length} left)` });
  });
export type FreeCheckInput = z.input<typeof freeCheckSchema>;
export type FreeCheckValues = z.output<typeof freeCheckSchema>;

/** One point as kept on the lead's timeline and sent to the apps, its photo with a link. */
export interface FreeCheckPointDto {
  point: FreeCheckPoint;
  answer: FreeCheckAnswer;
  photo: { id: string; path: string } | null;
}

/** A finished scorecard as the apps show it. */
export interface FreeCheckDto {
  answers: FreeCheckPointDto[];
  counts: Record<FreeCheckAnswer, number>;
}

/** The answers in the points' own order, whatever order they came in. */
export function inPointOrder<T extends { point: FreeCheckPoint }>(answers: readonly T[]): T[] {
  return [...answers].sort((a, b) => FREE_CHECK_POINTS.indexOf(a.point) - FREE_CHECK_POINTS.indexOf(b.point));
}

/** How many of each answer. */
export function freeCheckCounts(answers: readonly { answer: FreeCheckAnswer }[]): Record<FreeCheckAnswer, number> {
  const counts: Record<FreeCheckAnswer, number> = { OK: 0, FIX: 0, UNSEEN: 0 };
  for (const entry of answers) counts[entry.answer] += 1;
  return counts;
}

/** "Things to fix": the number the lead keeps (Lead.checkFindings) and "Likely to close" reads. */
export const freeCheckFindings = (answers: readonly { answer: FreeCheckAnswer }[]) => freeCheckCounts(answers).FIX;

/** The points that need fixing, in the points' order, each with what fixes it. */
export function freeCheckToFix(answers: readonly { point: FreeCheckPoint; answer: FreeCheckAnswer }[]): { point: FreeCheckPoint; fix: FreeCheckFix }[] {
  return inPointOrder(answers.filter((entry) => entry.answer === "FIX")).map((entry) => ({ point: entry.point, fix: FREE_CHECK_FIXES[entry.point] }));
}

/** The ECCS services the check found a need for, each once, in the points' order: offered first when the BDE makes the quote. */
export function freeCheckServices(answers: readonly { point: FreeCheckPoint; answer: FreeCheckAnswer }[]): string[] {
  const services = freeCheckToFix(answers).flatMap((entry) => (entry.fix.kind === "SERVICE" ? [entry.fix.service] : []));
  return [...new Set(services)];
}

/** Every photo the scorecard points at. */
export const freeCheckPhotoIds = (answers: readonly { point: FreeCheckPoint; photoId?: string | null | undefined }[]) => answers.map((entry) => entry.photoId).filter((id): id is string => Boolean(id));

/** A scorecard as stored on the lead's timeline (LeadActivity.scorecard), read back safely; null when it is not one. */
export function storedFreeCheck(value: unknown): FreeCheckValues | null {
  const parsed = freeCheckSchema.safeParse(value);
  return parsed.success ? { answers: inPointOrder(parsed.data.answers) } : null;
}
