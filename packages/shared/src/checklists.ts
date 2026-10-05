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
  items: { id: string; label: LocalizedText; isCustom: boolean }[];
}

export const answerChecklistItemSchema = z.object({
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
});
export type AnswerChecklistItemInput = z.input<typeof answerChecklistItemSchema>;

export const addChecklistItemSchema = z.object({
  label: z.string().trim().min(2, "Describe what to check").max(160),
});
export type AddChecklistItemInput = z.input<typeof addChecklistItemSchema>;

/** Returned when a photo is uploaded. */
export interface AttachmentDto {
  id: string;
  /** Path relative to the API base URL. Valid for a limited time. */
  path: string;
}
