import { z } from "zod";
import { LANGUAGES, ROLES } from "./roles.js";

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

export const requestOtpSchema = z.object({ phone: phoneSchema });
export type RequestOtpInput = z.input<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  deviceName: z.string().max(100).optional(),
});
export type VerifyOtpInput = z.input<typeof verifyOtpSchema>;

export const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits") });
export type PinInput = z.input<typeof pinSchema>;

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
  phone: z.string(),
  name: z.string(),
  language: z.enum(LANGUAGES),
  hasPin: z.boolean(),
  memberships: z.array(membershipSchema),
});
export type CurrentUserDto = z.infer<typeof currentUserSchema>;

export const sessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: currentUserSchema,
});
export type SessionDto = z.infer<typeof sessionSchema>;
