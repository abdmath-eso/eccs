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

export const updateServiceKindSchema = z.object({
  name: z.string().trim().min(2, "Enter the name of this kind of service").max(120).optional(),
  isActive: z.boolean().optional(),
  /** Whether a visit of this kind ends with a certificate for the restaurant. */
  issuesCertificate: z.boolean().optional(),
  /** How many days that certificate is valid for, counted from the day of the visit. */
  certificateValidDays: typedNumber(
    z
      .number({ error: "Enter the number of days, in figures" })
      .int("Enter whole days")
      .min(1, "Enter at least 1 day")
      .max(CERTIFICATE_MAX_VALID_DAYS, `Enter no more than ${CERTIFICATE_MAX_VALID_DAYS} days (five years)`),
  ).optional(),
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
