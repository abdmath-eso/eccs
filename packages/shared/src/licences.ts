import { z } from "zod";

// Licences and the document vault. The Owner and Manager keep their outlet's
// licences and documents here; ECCS admins can add and update them too, for
// example while onboarding a client. Files are photos or PDFs.

export const LICENCE_TYPES = ["FSSAI", "FIRE_NOC", "TRADE_LICENCE", "PEST_CONTROL", "OTHER"] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number];

/** How close a licence is to expiring. */
export type LicenceState = "VALID" | "EXPIRING" | "EXPIRED";

/** A licence within this many days of its expiry date counts as expiring. */
export const LICENCE_WARNING_DAYS = 60;

export const DOCUMENT_CATEGORIES = ["licence", "certificate", "report", "invoice", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** True for a real calendar date written as YYYY-MM-DD (so not 31 February). */
export function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine(isCalendarDate, "That date does not exist");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const licenceFields = {
  type: z.enum(LICENCE_TYPES),
  /** What the licence is called. Needed for type OTHER; optional otherwise. */
  name: optionalText(80),
  number: optionalText(60),
  issuedOn: dateSchema.optional(),
  expiresOn: dateSchema,
  /** An uploaded photo or PDF of the licence. Optional. */
  attachmentId: z.string().min(1).optional(),
};

export const createLicenceSchema = z
  .object({ outletId: z.string().min(1), ...licenceFields })
  .refine((licence) => licence.type !== "OTHER" || Boolean(licence.name), {
    message: "Give the licence a name",
    path: ["name"],
  });
export type CreateLicenceInput = z.input<typeof createLicenceSchema>;

export const updateLicenceSchema = z.object({
  name: optionalText(80),
  number: optionalText(60),
  issuedOn: dateSchema.optional(),
  expiresOn: dateSchema.optional(),
  attachmentId: z.string().min(1).optional(),
});
export type UpdateLicenceInput = z.input<typeof updateLicenceSchema>;

export const createDocumentSchema = z.object({
  outletId: z.string().min(1),
  category: z.enum(DOCUMENT_CATEGORIES).exclude(["licence"]),
  title: z.string().trim().min(2, "Give the document a name").max(100),
  attachmentId: z.string().min(1, "Choose a file"),
});
export type CreateDocumentInput = z.input<typeof createDocumentSchema>;

/** A stored file: where to load it from and what kind it is. */
export interface StoredFileDto {
  /** Path relative to the API base URL. Valid for a limited time. */
  path: string;
  mimeType: string;
}

export interface LicenceDto {
  id: string;
  outletId: string;
  outletName: string;
  organizationName: string;
  type: LicenceType;
  name: string | null;
  number: string | null;
  /** YYYY-MM-DD */
  issuedOn: string | null;
  /** YYYY-MM-DD */
  expiresOn: string;
  /** Days until expiry, counted in India. Negative once expired. */
  daysLeft: number;
  state: LicenceState;
  file: StoredFileDto | null;
}

export interface DocumentDto {
  id: string;
  outletId: string;
  category: DocumentCategory;
  title: string;
  file: StoredFileDto;
  uploadedByName: string | null;
  /** True if ECCS staff uploaded it rather than the restaurant. */
  uploadedByEccs: boolean;
  createdAt: string;
}
