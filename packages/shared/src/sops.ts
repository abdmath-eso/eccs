import { z } from "zod";
import type { LocalizedText } from "./checklists.js";

// The SOP library: step-by-step procedures staff can read in the app.
// ECCS provides a standard set for every restaurant; the Owner or Manager
// can add SOPs for their own outlet alongside them.

export const SOP_CATEGORIES = [
  "PERSONAL_HYGIENE",
  "FOOD_STORAGE",
  "CLEANING",
  "EQUIPMENT",
  "PEST_CONTROL",
  "WASTE",
  "SAFETY",
  "OTHER",
] as const;
export type SopCategory = (typeof SOP_CATEGORIES)[number];

export const SOP_LANGUAGES = ["en", "te", "hi"] as const;
export type SopLanguage = (typeof SOP_LANGUAGES)[number];

/** One step is one line of text; line breaks inside a step are flattened. */
const stepSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "A step cannot be empty").max(300));
const stepsSchema = z.array(stepSchema).min(1, "Add at least one step").max(30);
const titleSchema = z.string().trim().min(2, "Give the SOP a name").max(100);

export const createSopSchema = z.object({
  /** The outlet a restaurant's own SOP belongs to. Left out by ECCS for a standard SOP. */
  outletId: z.string().min(1).optional(),
  category: z.enum(SOP_CATEGORIES),
  title: titleSchema,
  steps: stepsSchema,
  /** The language the text is written in. Defaults to the writer's own language. */
  language: z.enum(SOP_LANGUAGES).optional(),
});
export type CreateSopInput = z.input<typeof createSopSchema>;

/**
 * Changes an SOP. The title and steps are saved for one language at a time,
 * so a translation is added by sending them again with another `language`.
 */
export const updateSopSchema = z.object({
  category: z.enum(SOP_CATEGORIES).optional(),
  title: titleSchema.optional(),
  steps: stepsSchema.optional(),
  language: z.enum(SOP_LANGUAGES).optional(),
  /** ECCS only: whether restaurants can see this standard SOP. */
  isPublished: z.boolean().optional(),
});
export type UpdateSopInput = z.input<typeof updateSopSchema>;

export interface SopDto {
  id: string;
  category: SopCategory;
  title: LocalizedText;
  /** The steps in each language the SOP has been written in. */
  steps: Partial<Record<SopLanguage, string[]>>;
  /** True if a restaurant wrote this for its own outlet; false for ECCS's standard SOPs. */
  isCustom: boolean;
  outletId: string | null;
  /** Standard SOPs are shown to restaurants only once published. Always true for a restaurant's own. */
  isPublished: boolean;
  /** True if the person asking may change or remove it. */
  canEdit: boolean;
  updatedAt: string;
}

/** The steps in a language, falling back to English and then to whatever exists. */
export function sopSteps(sop: Pick<SopDto, "steps">, language: "EN" | "TE" | "HI"): string[] {
  const key = language.toLowerCase() as SopLanguage;
  return sop.steps[key] ?? sop.steps.en ?? sop.steps.te ?? sop.steps.hi ?? [];
}
