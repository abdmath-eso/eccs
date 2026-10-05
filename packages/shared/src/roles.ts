export const ROLES = [
  "SUPER_ADMIN",
  "OPS_MANAGER",
  "SUPERVISOR",
  "OWNER",
  "MANAGER",
  "HEAD_CHEF",
] as const;

export type Role = (typeof ROLES)[number];

/** Company-side roles. They are not tied to one restaurant. */
export const ECCS_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "SUPERVISOR"] as const satisfies readonly Role[];

/** Restaurant-side roles. OWNER covers a whole brand; the others cover one outlet. */
export const RESTAURANT_ROLES = ["OWNER", "MANAGER", "HEAD_CHEF"] as const satisfies readonly Role[];

export const isEccsRole = (role: Role): boolean => (ECCS_ROLES as readonly Role[]).includes(role);

export const LANGUAGES = ["EN", "TE", "HI"] as const;
export type Language = (typeof LANGUAGES)[number];

/** A user's role and where it applies. Mirrors the Membership table. */
export interface MembershipScope {
  role: Role;
  organizationId: string | null;
  outletId: string | null;
}
