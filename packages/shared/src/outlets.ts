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

export interface OrganizationOutletDto {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  isActive: boolean;
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
