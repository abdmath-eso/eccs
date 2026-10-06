import type { Language, Role } from "./roles.js";

// "My profile": what a person sees about their own login.

export interface ProfileOutletDto {
  id: string;
  name: string;
  address: string;
  city: string;
  /**
   * The restaurant code staff type once to link a phone. Only for people who
   * hand it out (the Owner, the outlet's Manager); null for everyone else.
   */
  code: string | null;
}

export interface ProfileDto {
  id: string;
  name: string;
  /** Only people who log in with a one-time code (the Owner, ECCS staff) have these. */
  phone: string | null;
  email: string | null;
  language: Language;
  role: Role;
  /** Path of the profile photo, relative to the API base URL. Valid for a limited time. */
  photoPath: string | null;
  /** The restaurant brand. Null for ECCS staff. */
  organizationName: string | null;
  /** Every outlet of the brand for the Owner; the one outlet for a Manager or Head Chef. */
  outlets: ProfileOutletDto[];
  /** When the login was created. */
  memberSince: string;
  /**
   * False for a Manager or Head Chef: their name appears on checklists and
   * issues, so it is changed by whoever manages staff logins, not by them.
   */
  canEditName: boolean;
}

/** True if someone with these roles may change their own name. */
export const mayRenameSelf = (roles: readonly Role[]) => roles.some((role) => role !== "MANAGER" && role !== "HEAD_CHEF");
