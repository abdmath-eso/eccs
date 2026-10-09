import { z } from "zod";
import { phoneSchema } from "./auth.js";

/** One row of GET /outlets. */
export interface OutletSummaryDto {
  id: string;
  name: string;
  address: string;
  city: string;
  /**
   * The restaurant code staff type once to link a phone. Only sent to people
   * who hand it out (ECCS admins, the Owner, the outlet's Manager); null otherwise.
   */
  code: string | null;
  organization: { id: string; name: string };
}

// ───────── Clients, managed by ECCS in the web console ─────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const outletFields = {
  outletName: z.string().trim().min(1, "Enter the outlet name").max(120),
  outletAddress: z.string().trim().min(1, "Enter the outlet address").max(300),
  city: optionalText(80),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "PIN code must be 6 digits")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  fssaiNumber: optionalText(20),
};

/** Onboards a restaurant: the brand, its first outlet and its Owner, in one step. */
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Enter the restaurant name").max(120),
  legalName: optionalText(160),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z0-9]{13}$/, "GSTIN must be 15 characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  ownerName: z.string().trim().min(1, "Enter the owner's name").max(100),
  ownerPhone: phoneSchema,
  ownerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  ...outletFields,
});
export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;

export const createOutletSchema = z.object(outletFields);
export type CreateOutletInput = z.input<typeof createOutletSchema>;

// ───────── Changing a client afterwards ─────────
// Only what is sent changes. A box sent empty clears that detail.

const gstinOrEmpty = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^([0-9]{2}[A-Z0-9]{13})?$/, "GSTIN must be 15 characters");

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Enter the restaurant name").max(120).optional(),
  legalName: z.string().trim().max(160).optional(),
  gstin: gstinOrEmpty.optional(),
  /** False switches the whole client off; true brings it back. Nothing is ever deleted. */
  isActive: z.boolean().optional(),
});
export type UpdateOrganizationInput = z.input<typeof updateOrganizationSchema>;

export const updateOutletSchema = z.object({
  name: z.string().trim().min(1, "Enter the outlet name").max(120).optional(),
  address: z.string().trim().min(1, "Enter the outlet address").max(300).optional(),
  city: z.string().trim().min(1, "Enter the city").max(80).optional(),
  pincode: z
    .string()
    .trim()
    .regex(/^(\d{6})?$/, "PIN code must be 6 digits")
    .optional(),
  fssaiNumber: z.string().trim().max(20).optional(),
  isActive: z.boolean().optional(),
  /**
   * Where the kitchen is, in decimal degrees, for comparing with where proof photos are taken.
   * Both together, or both `null` to clear them.
   */
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
})
  .refine(
    (input) =>
      (input.latitude === undefined && input.longitude === undefined) ||
      (input.latitude !== undefined && input.longitude !== undefined && (input.latitude === null) === (input.longitude === null)),
    {
      message: "Enter both the latitude and the longitude, or leave both empty",
      path: ["latitude"],
    },
  );
export type UpdateOutletInput = z.input<typeof updateOutletSchema>;

/**
 * Reads a place typed or pasted by a person: "17.4326, 78.4071", or the two numbers in a
 * Google Maps link ("@17.4326,78.4071" or "q=17.4326,78.4071"). Returns `null` if it holds none.
 */
export function parseCoordinates(text: string): { latitude: number; longitude: number } | null {
  const match = /(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** A place a phone read for itself, sent to set an outlet's location from the kitchen. */
export const outletLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type OutletLocationInput = z.input<typeof outletLocationSchema>

/** The Owner's contact details. The mobile number is where their one-time code goes. */
export const updateOwnerSchema = z.object({
  name: z.string().trim().min(1, "Enter the owner's name").max(100).optional(),
  phone: phoneSchema.optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === "" || z.string().email().safeParse(value).success, "Enter a valid email address")
    .optional(),
});
export type UpdateOwnerInput = z.input<typeof updateOwnerSchema>;

/** A phone that was linked to a restaurant and can reach its PIN pad. */
export interface LinkedPhoneDto {
  id: string;
  /** What the phone called itself when it was linked, e.g. "Redmi Note 12". Often empty. */
  name: string | null;
  /** The outlet whose restaurant code was typed; null for a phone the Owner linked with their one-time code. */
  outletId: string | null;
  linkedAt: string;
  lastUsedAt: string;
}

export interface OrganizationOutletDto {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  pincode: string | null;
  fssaiNumber: string | null;
  isActive: boolean;
  /** Where the kitchen is; both `null` until ECCS sets it. */
  latitude: number | null;
  longitude: number | null;
}

/** One client in the ECCS console. */
export interface OrganizationDto {
  id: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  isActive: boolean;
  createdAt: string;
  owners: { id: string; name: string; phone: string | null; email: string | null; hasPin: boolean }[];
  outlets: OrganizationOutletDto[];
}
