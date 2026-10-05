import { z } from "zod";

// Daily checklists. ECCS provides a short basic list for every restaurant;
// the Owner or Manager adds items for their own kitchen. Every item needs
// a photo as proof before the checklist can be submitted.

/** Text in each language. Items a restaurant adds have only the language they typed. */
export type LocalizedText = Partial<Record<"en" | "te" | "hi", string>>;

/** Picks the text for a language, falling back to English and then to anything present. */
export function localize(text: LocalizedText | null | undefined, language: "EN" | "TE" | "HI"): string {
  if (!text) return "";
  const key = language.toLowerCase() as "en" | "te" | "hi";
  return text[key] ?? text.en ?? text.te ?? text.hi ?? "";
}

export type ChecklistRunStatus = "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "MISSED";

export interface ChecklistResponseDto {
  /** True if the item was fine; false if a problem was found. */
  passed: boolean;
  note: string | null;
  capturedAt: string;
  /** Who took the proof photo. */
  takenByName: string | null;
  /** Path of the proof photo, relative to the API base URL. Valid for a limited time. */
  photoPath: string | null;
}

export interface ChecklistItemDto {
  id: string;
  label: LocalizedText;
  /** True if the restaurant added this item; false for ECCS's basic items. */
  isCustom: boolean;
  response: ChecklistResponseDto | null;
}

/** One checklist for one outlet on one day. */
export interface ChecklistRunDto {
  id: string;
  outletChecklistId: string;
  outletId: string;
  title: LocalizedText;
  /** Calendar date in India, YYYY-MM-DD. */
  date: string;
  /** "HH:mm" local time by which it should be done, if set. */
  dueTime: string | null;
  status: ChecklistRunStatus;
  /** True when the due time has passed today and it has not been submitted. */
  isOverdue: boolean;
  submittedAt: string | null;
  submittedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  items: ChecklistItemDto[];
}

/** A run without its items, for history lists. */
export interface ChecklistRunSummaryDto {
  id: string;
  title: LocalizedText;
  date: string;
  status: ChecklistRunStatus;
  itemCount: number;
  doneCount: number;
  problemCount: number;
  submittedByName: string | null;
  reviewedAt: string | null;
}

/** A checklist as set up for an outlet, for the screen where items are added. */
export interface OutletChecklistDto {
  id: string;
  outletId: string;
  title: LocalizedText;
  dueTime: string | null;
  /** True if the restaurant created this checklist; false for ECCS's basic ones. */
  isCustom: boolean;
  items: { id: string; label: LocalizedText; isCustom: boolean }[];
}

export const answerChecklistItemSchema = z
  .object({
  passed: z.boolean(),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** The uploaded proof photo. Required: an item cannot be answered without one. */
  attachmentId: z.string().min(1, "A photo is required"),
  /** When the answer was given on the phone, which may be before it was uploaded. */
  capturedAt: z.iso.datetime().optional(),
  })
  // Reporting a problem always needs a reason, so whoever reviews it knows what was wrong.
  .refine((answer) => answer.passed || Boolean(answer.note), {
    message: "Describe the problem",
    path: ["note"],
  });
export type AnswerChecklistItemInput = z.input<typeof answerChecklistItemSchema>;

/**
 * Adds an item to a checklist: either one picked from the suggestion
 * library (libraryItemId) or one the person typed themselves (label).
 */
export const addChecklistItemSchema = z
  .object({
    label: z.string().trim().min(2, "Describe what to check").max(160).optional(),
    libraryItemId: z.string().min(1).optional(),
  })
  .refine((input) => Boolean(input.label) !== Boolean(input.libraryItemId), {
    message: "Describe what to check",
    path: ["label"],
  });
export type AddChecklistItemInput = z.input<typeof addChecklistItemSchema>;

const dueTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the time as HH:MM, for example 14:30");

/** The Owner or Manager creates an extra checklist for their outlet, such as "Mid-day checklist". */
export const createChecklistSchema = z.object({
  outletId: z.string().min(1),
  title: z.string().trim().min(2, "Give the checklist a name").max(60),
  dueTime: dueTimeSchema.optional(),
});
export type CreateChecklistInput = z.input<typeof createChecklistSchema>;

/** Changes a checklist's due time (any checklist) or name (only ones the restaurant created). */
export const updateChecklistSchema = z.object({
  title: z.string().trim().min(2).max(60).optional(),
  dueTime: dueTimeSchema.nullable().optional(),
});
export type UpdateChecklistInput = z.input<typeof updateChecklistSchema>;

/** A ready-made check from the suggestion library, shown while the person types. */
export interface ChecklistSuggestionDto {
  id: string;
  text: LocalizedText;
  /** The checklist and category it comes from in the library, shown as a hint. */
  checklistName: string;
  category: string;
  priority: "HIGH" | "MEDIUM";
}

/** Returned when a photo is uploaded. */
export interface AttachmentDto {
  id: string;
  /** Path relative to the API base URL. Valid for a limited time. */
  path: string;
}
