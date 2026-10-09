// Managing the service catalogue from the ECCS console: the services a
// restaurant can book and their prices, the kinds of service, and the tasks a
// Supervisor ticks during a visit of each kind. (Changing clients and outlets
// is beside their other types, in outlets.ts.)
//
// Nothing here is ever deleted, because bookings and finished visits refer to
// it. A service is "no longer offered" and a task is "retired" instead.

import { z } from "zod";
import { CERTIFICATE_MAX_VALID_DAYS } from "./certificates.js";
import type { LocalizedText } from "./checklists.js";
import { SERVICE_CATEGORIES, type ServiceCategory } from "./services.js";

export const CATALOG_MAX_PRICE_RUPEES = 1_000_000;
export const CATALOG_MAX_DURATION_MINUTES = 24 * 60;

/**
 * A number typed into a form box (which arrives as text) or sent as a number.
 * An empty box is "nothing typed", not zero.
 */
const typedNumber = (rules: z.ZodNumber) =>
  z.preprocess((value) => (typeof value === "string" ? (value.trim() === "" ? undefined : Number(value)) : value), rules);

const priceRupees = typedNumber(
  z
    .number({ error: "Enter the price in rupees, in figures" })
    .min(0, "The price cannot be less than zero")
    .max(CATALOG_MAX_PRICE_RUPEES, `The price cannot be more than ₹${CATALOG_MAX_PRICE_RUPEES.toLocaleString("en-IN")}`),
);

const durationMinutes = typedNumber(
  z
    .number({ error: "Enter how long it usually takes, in minutes" })
    .int("Enter whole minutes")
    .min(5, "Enter at least 5 minutes")
    .max(CATALOG_MAX_DURATION_MINUTES, "Enter no more than 24 hours (1440 minutes)"),
);

const itemName = z.string().trim().min(2, "Enter the name of the service").max(120);
const itemDescription = z.string().trim().max(500);

/** A new bookable service. Written in English; it shows in English to everyone until translated. */
export const createCatalogItemSchema = z.object({
  /** The kind of service it is, e.g. "PEST". Decides which task list its visits use. */
  serviceCode: z.string().min(1, "Choose the kind of service"),
  name: itemName,
  description: itemDescription.optional(),
  /** Before GST. */
  priceRupees,
  durationMinutes,
});
export type CreateCatalogItemInput = z.input<typeof createCatalogItemSchema>;

/**
 * Changes a bookable service; only what is sent changes. Changing the price
 * or the kind of a service that has already been booked does not touch the
 * booked one: it is kept as it was, no longer offered, and a new one takes
 * its place.
 */
export const updateCatalogItemSchema = z.object({
  serviceCode: z.string().min(1).optional(),
  name: itemName.optional(),
  description: itemDescription.optional(),
  priceRupees: priceRupees.optional(),
  durationMinutes: durationMinutes.optional(),
  /** False stops offering it; true offers it again. */
  isActive: z.boolean().optional(),
});
export type UpdateCatalogItemInput = z.input<typeof updateCatalogItemSchema>;

const kindName = z.string().trim().min(2, "Enter the name of this kind of service").max(120);

/**
 * The GST code printed on invoices for this kind: an SAC for a service (six
 * digits starting 99, such as 998533 for specialised cleaning) or an HSN for
 * goods (four, six or eight digits, such as 3402 for cleaning chemicals).
 */
const taxCode = z
  .string()
  .trim()
  .regex(/^(\d{4}|\d{6}|\d{8})$/, "Enter the SAC or HSN code: 4, 6 or 8 digits, no spaces");

/** GST in percent. Any rate from 0 to 40 is accepted, so a change in the law needs no change here. */
const gstRatePercent = typedNumber(
  z
    .number({ error: "Enter the GST rate in figures, for example 18" })
    .min(0, "The GST rate cannot be less than zero")
    .max(40, "Enter a GST rate of 40 or less")
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Enter at most two decimal places"),
);

const certificateValidDays = typedNumber(
  z
    .number({ error: "Enter the number of days, in figures" })
    .int("Enter whole days")
    .min(1, "Enter at least 1 day")
    .max(CERTIFICATE_MAX_VALID_DAYS, `Enter no more than ${CERTIFICATE_MAX_VALID_DAYS} days (five years)`),
);

/**
 * A brand-new kind of service, added from the console. Its code (the stable
 * name the system uses, such as "TANK_CLEANING") is made from the English name
 * by `serviceCodeFromName` and never changes afterwards. Its bookable services
 * and its task list are added on the same page once it exists.
 */
export const createServiceKindSchema = z
  .object({
    name: kindName,
    category: z.enum(SERVICE_CATEGORIES, { error: "Choose the heading it is listed under" }),
    sacCode: taxCode,
    gstRatePercent,
    /** True when an outside partner (a lab, a clinic, a trainer, an auditor) delivers part of it. */
    partnerDelivered: z.boolean().optional(),
    /** Whether a visit of this kind ends with an ECCS certificate of service. */
    issuesCertificate: z.boolean().optional(),
    /** How many days that certificate is valid for. Needed when it issues one. */
    certificateValidDays: certificateValidDays.optional(),
  })
  .refine((value) => !value.issuesCertificate || value.certificateValidDays !== undefined, {
    message: "Enter how many days the certificate is valid for",
    path: ["certificateValidDays"],
  })
  .refine((value) => serviceCodeFromName(value.name).length >= 2, {
    message: "Use ordinary letters or figures in the name",
    path: ["name"],
  });
export type CreateServiceKindInput = z.input<typeof createServiceKindSchema>;

/**
 * The stable code of a kind made from its English name: capital letters,
 * figures and underscores only ("Water tank cleaning" becomes
 * "WATER_TANK_CLEANING"), at most 40 characters.
 */
export function serviceCodeFromName(name: string): string {
  return name
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
}

export const updateServiceKindSchema = z.object({
  name: kindName.optional(),
  isActive: z.boolean().optional(),
  /** Whether a visit of this kind ends with a certificate for the restaurant. */
  issuesCertificate: z.boolean().optional(),
  /** How many days that certificate is valid for, counted from the day of the visit. */
  certificateValidDays: certificateValidDays.optional(),
  /** The heading it is listed under in the app. */
  category: z.enum(SERVICE_CATEGORIES).optional(),
  /** The GST code and rate. A change applies to invoices raised from now on; issued invoices keep theirs. */
  sacCode: taxCode.optional(),
  gstRatePercent: gstRatePercent.optional(),
  partnerDelivered: z.boolean().optional(),
});
export type UpdateServiceKindInput = z.input<typeof updateServiceKindSchema>;

const taskLabel = z.string().trim().min(3, "Say what the task is").max(200);

export const addServiceTaskSchema = z.object({ label: taskLabel });
export type AddServiceTaskInput = z.input<typeof addServiceTaskSchema>;

export const updateServiceTaskSchema = z.object({
  label: taskLabel.optional(),
  /** False retires the task; true brings it back. */
  isActive: z.boolean().optional(),
});
export type UpdateServiceTaskInput = z.input<typeof updateServiceTaskSchema>;

export const moveServiceTaskSchema = z.object({ direction: z.enum(["up", "down"]) });
export type MoveServiceTaskInput = z.input<typeof moveServiceTaskSchema>;

/** One bookable service as the office sees it, offered or not. */
export interface CatalogAdminItemDto {
  id: string;
  serviceCode: string;
  name: LocalizedText;
  description: LocalizedText | null;
  /** Before GST, in paise. */
  pricePaise: number;
  durationMinutes: number;
  /** Whether restaurants can book it now. */
  isActive: boolean;
  /** How many requests have ever been made for it. Once there are any, its price is fixed. */
  bookingCount: number;
  createdAt: string;
}

/** One task of a kind of service. */
export interface ServiceTaskAdminDto {
  id: string;
  label: LocalizedText;
  /** Set for a task that records a meter reading instead of a tick: the limit the reading is judged against. */
  readingLimit: number | null;
  /** False once retired: new visits no longer show it, finished ones still do. */
  isActive: boolean;
  /** How many visits have an answer for it. */
  answerCount: number;
}

/** A kind of service, with the tasks its visits are made of. */
export interface ServiceKindAdminDto {
  code: string;
  name: LocalizedText;
  isActive: boolean;
  /** In the order the Supervisor sees them; retired ones are included. */
  tasks: ServiceTaskAdminDto[];
  /** How many visits of this kind are on record. */
  visitCount: number;
  /** The plans on offer that include this kind of service. */
  planNames: LocalizedText[];
  /** Whether a visit of this kind ends with a certificate for the restaurant. */
  issuesCertificate: boolean;
  /** How many days that certificate is valid for; null when none is set. */
  certificateValidDays: number | null;
  /** How many certificates of this kind have been issued so far. */
  certificateCount: number;
  /** The heading it is listed under in the app. */
  category: ServiceCategory;
  /** The GST code on its invoices: an SAC (service) or an HSN (goods). */
  sacCode: string;
  gstRatePercent: number;
  /** True when an outside partner delivers part of it. */
  partnerDelivered: boolean;
}

export interface CatalogAdminDto {
  kinds: ServiceKindAdminDto[];
  items: CatalogAdminItemDto[];
}

/** The answer to changing a bookable service. */
export interface CatalogItemChangeDto {
  catalogue: CatalogAdminDto;
  /**
   * Set when the change could not be made to the booked service itself: the
   * id of the new service that replaced it. Null when it was changed in place.
   */
  replacedById: string | null;
}
