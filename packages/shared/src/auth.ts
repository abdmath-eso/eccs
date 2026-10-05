import { z } from "zod";
import { LANGUAGES, ROLES } from "./roles.js";

// How people log in (see docs/PROPOSAL.md section 2, "Auth"):
//
// - ECCS staff: phone number + one-time code.
// - Restaurant owner, first time or after forgetting the PIN: phone number +
//   one-time code. This links the phone and gives the owner a PIN.
// - Everyone at a restaurant after that: PIN only. A new phone is linked once
//   by typing the outlet's restaurant code.

/**
 * Accepts an Indian mobile number as typed ("98765 43210", "09876543210",
 * "+91 98765 43210") and returns it as +91XXXXXXXXXX, or null if invalid.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits.length === 11 && digits.startsWith("0")
      ? digits.slice(1)
      : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

export const phoneSchema = z.string().transform((value, ctx) => {
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" });
    return z.NEVER;
  }
  return phone;
});

export const OTP_LENGTH = 6;
export const PIN_LENGTH = 4;

const deviceNameSchema = z.string().max(100).optional();

export const requestOtpSchema = z.object({ phone: phoneSchema });
export type RequestOtpInput = z.input<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  deviceName: deviceNameSchema,
  /** Owner only: replace the existing PIN with a new one ("forgot PIN"). */
  resetPin: z.boolean().optional(),
});
export type VerifyOtpInput = z.input<typeof verifyOtpSchema>;

export const linkDeviceSchema = z.object({
  code: z.string().trim().min(5, "Enter the restaurant code").max(40),
  deviceName: deviceNameSchema,
});
export type LinkDeviceInput = z.input<typeof linkDeviceSchema>;

export const linkedDeviceSchema = z.object({
  deviceToken: z.string(),
  organizationName: z.string(),
  outletName: z.string().nullable(),
});
export type LinkedDeviceDto = z.infer<typeof linkedDeviceSchema>;

export const pinLoginSchema = z.object({
  deviceToken: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
});
export type PinLoginInput = z.input<typeof pinLoginSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  language: z.enum(LANGUAGES).optional(),
});
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const membershipSchema = z.object({
  role: z.enum(ROLES),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  outletId: z.string().nullable(),
  outletName: z.string().nullable(),
});
export type MembershipDto = z.infer<typeof membershipSchema>;

export const currentUserSchema = z.object({
  id: z.string(),
  phone: z.string().nullable(),
  name: z.string(),
  language: z.enum(LANGUAGES),
  memberships: z.array(membershipSchema),
});
export type CurrentUserDto = z.infer<typeof currentUserSchema>;

export const sessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: currentUserSchema,
  /** Present after an owner's one-time-code login: the phone is now linked. */
  linkedDevice: linkedDeviceSchema.optional(),
  /** Present when a PIN was just created. Shown once; it cannot be read back later. */
  generatedPin: z.string().optional(),
});
export type SessionDto = z.infer<typeof sessionSchema>;

/** Error codes the apps react to, sent as `code` in an error response. */
export const AUTH_ERROR = {
  deviceNotLinked: "DEVICE_NOT_LINKED",
} as const;

// ───────── Restaurant staff logins, managed by the Owner or Manager ─────────

export const STAFF_LOGIN_ROLES = ["MANAGER", "HEAD_CHEF"] as const;

export const createRestaurantUserSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  role: z.enum(STAFF_LOGIN_ROLES),
  outletId: z.string().min(1),
  language: z.enum(LANGUAGES).optional(),
});
export type CreateRestaurantUserInput = z.input<typeof createRestaurantUserSchema>;

export const updateRestaurantUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  language: z.enum(LANGUAGES).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateRestaurantUserInput = z.input<typeof updateRestaurantUserSchema>;

export const restaurantUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.enum(LANGUAGES),
  isActive: z.boolean(),
  role: z.enum(ROLES),
  organizationId: z.string(),
  outletId: z.string().nullable(),
  outletName: z.string().nullable(),
});
export type RestaurantUserDto = z.infer<typeof restaurantUserSchema>;

export const restaurantUserWithPinSchema = z.object({
  user: restaurantUserSchema,
  /** Shown once so it can be told to the employee. */
  pin: z.string(),
});
export type RestaurantUserWithPinDto = z.infer<typeof restaurantUserWithPinSchema>;
