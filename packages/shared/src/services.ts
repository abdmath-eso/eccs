import { z } from "zod";
import type { LocalizedText } from "./checklists.js";
import type { VisitCertificateDto } from "./certificates.js";
import type { PhotoFlagDto } from "./photo-integrity.js";
import { isValidReading, READING_MAX, READING_MIN } from "./readings.js";

// The service loop: a restaurant books a service from the catalogue, ECCS
// confirms a date and assigns a Supervisor, the Supervisor records the visit
// on site, the restaurant signs it off, and the visit becomes a service report.

/**
 * When in the day a visit happens: the two-hour window in which the ECCS team
 * arrives, named by its starting time ("1000" is 10:00 to 12:00), or after the
 * restaurant has closed for the night.
 */
export const VISIT_SLOTS = ["0800", "1000", "1200", "1400", "1600", "1800", "AFTER_CLOSING"] as const;
export type VisitSlot = (typeof VISIT_SLOTS)[number];

export const VISIT_SLOT_HOURS = 2;

/** The windows grouped by part of the day, as a booking screen lays them out. */
export const VISIT_SLOT_PERIODS = [
  { period: "MORNING", slots: ["0800", "1000"] },
  { period: "AFTERNOON", slots: ["1200", "1400"] },
  { period: "EVENING", slots: ["1600", "1800"] },
] as const satisfies readonly { period: string; slots: readonly VisitSlot[] }[];

/** The start and end of a window as "HH:mm", or null for "after closing", which has no fixed time. */
export function visitSlotWindow(slot: VisitSlot): { start: string; end: string } | null {
  if (slot === "AFTER_CLOSING") return null;
  const hour = Number(slot.slice(0, 2));
  const clock = (value: number) => `${String(value).padStart(2, "0")}:${slot.slice(2)}`;
  return { start: clock(hour), end: clock(hour + VISIT_SLOT_HOURS) };
}

export const BOOKING_STATUSES = ["REQUESTED", "CONFIRMED", "CANCELLED", "COMPLETED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Where a visit stands:
 * SCHEDULED = a date is set but no Supervisor yet; ASSIGNED = a Supervisor has it;
 * IN_PROGRESS = the Supervisor has checked in at the outlet; COMPLETED = the work is
 * done and waits for the restaurant's sign-off; IN_REVIEW = the restaurant signed it
 * off and ECCS is checking the report; APPROVED = ECCS approved the report, which is
 * now final and available as a PDF.
 */
export const VISIT_STATUSES = [
  "SCHEDULED",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "IN_REVIEW",
  "APPROVED",
  "CANCELLED",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** The work has been done, whether or not it has been signed off yet. */
export const isVisitDone = (status: VisitStatus) =>
  status === "IN_REVIEW" || status === "COMPLETED" || status === "APPROVED";
/** Still to happen or happening now. */
export const isVisitAhead = (status: VisitStatus) =>
  status === "SCHEDULED" || status === "ASSIGNED" || status === "IN_PROGRESS";

/** A restaurant may ask for a date from today up to this many days ahead. */
export const BOOKING_MAX_DAYS_AHEAD = 90;
/** Plan visits are put in the diary this many days before they are due. */
export const PLAN_VISITS_DAYS_AHEAD = 30;
export const VISIT_MAX_PHOTOS = 12;
export const VISIT_MAX_TECHNICIANS = 8;
/** Result documents (lab report, attendance sheet and so on) one visit can carry. */
export const VISIT_MAX_DOCUMENTS = 6;
export const VISIT_PARTNER_NAME_MAX = 80;

/**
 * The headings the app lists services under, in the order they are shown. Stored on
 * each kind of service; add new ones, never rename (the labels can change).
 */
export const SERVICE_CATEGORIES = ["CLEANING", "PEST", "TESTING", "COMPLIANCE", "SUPPLIES"] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
/** The category of a kind as stored, or CLEANING if it is one this version does not know. */
export const toServiceCategory = (value: string | null | undefined): ServiceCategory =>
  SERVICE_CATEGORIES.find((known) => known === value) ?? "CLEANING";

/** The headings in English, for the console (the app words them through its own dictionary). */
export const SERVICE_CATEGORY_ENGLISH: Record<ServiceCategory, string> = {
  CLEANING: "Cleaning",
  PEST: "Pest control",
  TESTING: "Tests and inspections",
  COMPLIANCE: "FSSAI compliance and training",
  SUPPLIES: "Supplies",
};

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist");

export const createBookingSchema = z.object({
  outletId: z.string().min(1),
  catalogItemId: z.string().min(1),
  preferredDate: dateSchema,
  preferredSlot: z.enum(VISIT_SLOTS),
  notes: z.string().trim().max(500).optional(),
});
export type CreateBookingInput = z.input<typeof createBookingSchema>;

/** ECCS accepts a request: the date and time may differ from what was asked for. */
export const confirmBookingSchema = z.object({
  date: dateSchema,
  slot: z.enum(VISIT_SLOTS),
  /** Leave out to confirm the date now and choose the Supervisor later. */
  supervisorId: z.string().min(1).nullish(),
});
export type ConfirmBookingInput = z.input<typeof confirmBookingSchema>;

/** ECCS puts a visit in the diary directly, without a request from the restaurant. */
export const createVisitSchema = z.object({
  outletId: z.string().min(1),
  /** The kind of service, e.g. "PEST". */
  serviceCode: z.string().min(1),
  date: dateSchema,
  slot: z.enum(VISIT_SLOTS),
  supervisorId: z.string().min(1).nullish(),
});
export type CreateVisitInput = z.input<typeof createVisitSchema>;

/** ECCS moves a visit or changes who does it. Only what is given changes. */
export const updateVisitSchema = z.object({
  date: dateSchema.optional(),
  slot: z.enum(VISIT_SLOTS).optional(),
  /** `null` takes the Supervisor off the visit. */
  supervisorId: z.string().min(1).nullable().optional(),
});
export type UpdateVisitInput = z.input<typeof updateVisitSchema>;

/** The Supervisor ticks one task of the service off, or marks it as not done with a reason. */
export const answerVisitTaskSchema = z
  .object({
    done: z.boolean(),
    note: z.string().trim().max(300).optional(),
    /**
     * For a task that records a meter reading instead of a tick (the frying oil test):
     * the number read, in percent. The server requires it when such a task is done.
     */
    value: z
      .number({ error: "Enter the reading in figures" })
      .refine(isValidReading, `Enter a reading from ${READING_MIN} to ${READING_MAX}, with at most one decimal place`)
      .optional(),
  })
  .refine((value) => value.done || (value.note ?? "").length > 0, "Say why this was not done");
export type AnswerVisitTaskInput = z.input<typeof answerVisitTaskSchema>;

/** Who did the work and anything the restaurant should know. */
export const updateVisitRecordSchema = z.object({
  technicianNames: z.array(z.string().trim().min(1).max(60)).max(VISIT_MAX_TECHNICIANS).optional(),
  notes: z.string().trim().max(1000).optional(),
  /** The outside partner that did its share of the work (the lab, clinic, training partner or audit agency). Empty clears it. */
  partnerName: z.string().trim().max(VISIT_PARTNER_NAME_MAX).optional(),
});
export type UpdateVisitRecordInput = z.input<typeof updateVisitRecordSchema>;

/**
 * The words that go with a result document attached to a visit (the file itself is sent
 * beside them): what it is, and optionally which partner it came from.
 */
export const addVisitDocumentSchema = z.object({
  title: z.string().trim().min(2, "Say what the document is").max(80),
  partnerName: z.string().trim().max(VISIT_PARTNER_NAME_MAX).optional(),
});
export type AddVisitDocumentInput = z.input<typeof addVisitDocumentSchema>;

/** The restaurant signs off a finished visit: a rating out of five, and a comment if they wish. */
export const signOffVisitSchema = z.object({
  rating: z.number().int().min(1, "Choose a rating").max(5),
  comment: z.string().trim().max(500).optional(),
});
export type SignOffVisitInput = z.input<typeof signOffVisitSchema>;

/** ECCS sends a finished visit's report back to the Supervisor, saying what to correct. */
export const returnReportSchema = z.object({
  note: z.string().trim().min(3, "Say what needs correcting").max(500),
});
export type ReturnReportInput = z.input<typeof returnReportSchema>;

export const VISIT_PHOTO_KINDS = ["BEFORE", "AFTER"] as const;
export type VisitPhotoKind = (typeof VISIT_PHOTO_KINDS)[number];

/** A one-time service a restaurant can book, with its sample price. */
export interface ServiceCatalogItemDto {
  id: string;
  /** The kind of service, e.g. "PEST". */
  serviceCode: string;
  name: LocalizedText;
  description: LocalizedText | null;
  /** Before GST, in paise. */
  pricePaise: number;
  durationMinutes: number;
  /** The heading it is listed under. Optional: a list saved on a phone before headings existed has none. */
  category?: ServiceCategory;
  /** True when an outside partner (a lab, a clinic, a training partner, an audit agency) delivers part of it. */
  partnerDelivered?: boolean;
}

/** ECCS puts an outlet on a plan from a given day. */
export const setOutletPlanSchema = z.object({
  /** The plan's code, e.g. "ESSENTIAL". */
  planCode: z.string().min(1),
  /** YYYY-MM-DD: every service of the plan is first due on this day. */
  startDate: dateSchema,
});
export type SetOutletPlanInput = z.input<typeof setOutletPlanSchema>;

/** One service of a plan and how often it is done. */
export interface PlanServiceDto {
  serviceCode: string;
  serviceName: LocalizedText;
  intervalDays: number;
}

/** A bundle of services, each repeated at its own interval, for a price per billing cycle. */
export interface PlanDto {
  code: string;
  name: LocalizedText;
  description: LocalizedText | null;
  /** Per billing cycle, before GST, in paise. */
  pricePaise: number;
  billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  services: PlanServiceDto[];
}

/** The plan an outlet is on. `plan` is null when it is on none. */
export interface OutletPlanDto {
  outletId: string;
  plan: PlanDto | null;
  /** YYYY-MM-DD the plan started. */
  since: string | null;
  /** Each service of the plan with the date of its next visit. */
  services: (PlanServiceDto & { nextDate: string })[];
}

/** A kind of service ECCS can put in the diary. */
export interface ServiceTypeDto {
  code: string;
  name: LocalizedText;
}

/** Someone a visit can be given to. */
export interface SupervisorDto {
  id: string;
  name: string;
}

/** A restaurant's request for a one-time service. */
export interface BookingDto {
  id: string;
  outletId: string;
  outletName: string;
  organizationName: string;
  serviceName: LocalizedText;
  pricePaise: number;
  /** YYYY-MM-DD */
  preferredDate: string;
  preferredSlot: VisitSlot | null;
  notes: string | null;
  status: BookingStatus;
  requestedByName: string;
  createdAt: string;
  /** The visit ECCS created when confirming, if it has. */
  visitId: string | null;
  /** The confirmed date and time, once there is a visit. */
  visitDate: string | null;
  visitSlot: VisitSlot | null;
}

/** One visit as shown in lists. */
export interface VisitSummaryDto {
  id: string;
  outletId: string;
  outletName: string;
  /** Street address and city, so the Supervisor can see where to go from the list. */
  outletAddress: string | null;
  organizationName: string;
  serviceCode: string;
  serviceName: LocalizedText;
  /** YYYY-MM-DD */
  date: string;
  slot: VisitSlot | null;
  status: VisitStatus;
  supervisorId: string | null;
  supervisorName: string | null;
  /** True if the restaurant booked it; false if it comes from their plan or ECCS added it. */
  booked: boolean;
  /** True if it was put in the diary automatically from the outlet's plan. */
  fromPlan: boolean;
  /** The service report's number, once the work is completed. */
  reportNumber: string | null;
}

export interface VisitTaskDto {
  itemId: string;
  label: LocalizedText;
  /** `null` until the Supervisor has answered it. */
  done: boolean | null;
  note: string | null;
  /**
   * Set (not null) for a task that records a meter reading instead of a tick: the number
   * read, null until it is taken, and the limit it is judged against (25 for frying oil).
   * The verdict is worked out from the two by `readingVerdict`. Optional because a visit
   * saved on a phone before readings existed does not have the field.
   */
  reading?: { value: number | null; limit: number | null } | null;
}

/** A result document attached to a visit: a lab report, a list of staff seen, an attendance sheet, an audit report. */
export interface VisitDocumentDto {
  /** The vault document's id. */
  id: string;
  title: string;
  file: { path: string; mimeType: string };
  createdAt: string;
}

export interface VisitPhotoDto {
  id: string;
  kind: VisitPhotoKind;
  /** Relative to the API base URL. Valid for a limited time. */
  path: string;
  /** Why the photo is doubtful, if it is. Only ECCS admins are told; left out for everyone else. */
  flags?: PhotoFlagDto[];
}

export interface VisitSignOffDto {
  name: string;
  /** The signer's role at the restaurant, e.g. "MANAGER". */
  role: string | null;
  signedAt: string;
  /** 1 (poor) to 5 (excellent). Null for visits signed off before ratings existed. */
  rating: number | null;
  comment: string | null;
}

/** One visit in full. Once completed, this is the service report. */
export interface VisitDto extends VisitSummaryDto {
  technicianNames: string[];
  checkInAt: string | null;
  completedAt: string | null;
  notes: string | null;
  tasks: VisitTaskDto[];
  photos: VisitPhotoDto[];
  signOff: VisitSignOffDto | null;
  /** What the person asking may do with it now. */
  canRecord: boolean;
  canSignOff: boolean;
  /**
   * What ECCS asked the Supervisor to correct, while the visit is back with them.
   * Only ECCS staff are told; null for the restaurant.
   */
  correctionNote: string | null;
  /** ECCS admins, once the restaurant has signed off: approve the report or send it back. */
  canReview: boolean;
  canManage: boolean;
  /**
   * True while the person recording the visit is at an outlet whose location ECCS does not
   * know yet: they can save where the kitchen is, from the kitchen. Left out when not so.
   */
  canSetOutletLocation?: boolean;
  /**
   * The certificate issued for this visit, once ECCS has approved the report of a kind
   * of service that carries one. Null when there is none (or the person may not read
   * certificates). Optional because a visit saved on a phone before certificates
   * existed does not have the field at all.
   */
  certificate?: VisitCertificateDto | null;
  /** True when an outside partner delivers part of this kind of service. (Optional like `certificate`, for visits saved on a phone earlier.) */
  partnerDelivered?: boolean;
  /** Which partner did its share of the work, as ECCS recorded it. */
  partnerName?: string | null;
  /** The result documents attached to the visit, oldest first. They are also in the outlet's documents. Empty for people who may not read documents. */
  documents?: VisitDocumentDto[];
  /** Whether the person asking may attach a result document now. */
  canAttachDocument?: boolean;
}
