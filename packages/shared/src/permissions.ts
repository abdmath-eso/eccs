import { isEccsRole, type MembershipScope, type Role } from "./roles.js";

// The single definition of who may do what. It mirrors the two permission
// tables in docs/PROPOSAL.md section 3; change both together.

export const RESOURCES = [
  "clients", // organisations and outlets
  "eccsUsers",
  "restaurantUsers",
  "sopTemplates",
  "checklists",
  "foodLabels",
  "issues",
  "catalog", // service catalogue and subscription plans
  "bookings",
  "subscriptions",
  "schedule",
  "jobs",
  "inspections",
  "reports", // service reports and certificates
  "publicPage", // customer QR page
  "licences",
  "documents",
  "scores",
  "staff",
  "attendance",
  "salary",
  "invoices",
  "payments",
  "auditLog",
  "settings",
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["create", "read", "update", "approve"] as const;
export type Action = (typeof ACTIONS)[number];

const LETTER: Record<string, Action> = { C: "create", R: "read", U: "update", A: "approve" };

// C = create, R = read, U = update, A = approve or sign off.
// For checklists: C = fill one in, U = add or remove the outlet's own items,
// A = mark a submitted checklist as reviewed.
// ECCS roles get nothing on staff, attendance and salary: that is the
// restaurant's private employee data.
const GRANTS: Record<Role, Partial<Record<Resource, string>>> = {
  SUPER_ADMIN: {
    clients: "CRU", eccsUsers: "CRU", restaurantUsers: "CRU", sopTemplates: "CRU",
    checklists: "R", foodLabels: "R", issues: "CRU", catalog: "CRU", bookings: "CRU",
    subscriptions: "CRU", schedule: "CRU", jobs: "CRUA", inspections: "CRUA", reports: "CRA",
    publicPage: "RUA", licences: "R", documents: "R", scores: "R",
    invoices: "CRU", payments: "CRU", auditLog: "R", settings: "RU",
  },
  OPS_MANAGER: {
    clients: "CRU", eccsUsers: "R", restaurantUsers: "CRU", sopTemplates: "CRU",
    checklists: "R", foodLabels: "R", issues: "CRU", catalog: "CRU", bookings: "CRU",
    subscriptions: "CRU", schedule: "CRU", jobs: "CRUA", inspections: "CRUA", reports: "CRA",
    publicPage: "RUA", licences: "R", documents: "R", scores: "R",
    invoices: "CRU", payments: "CRU", auditLog: "R",
  },
  SUPERVISOR: {
    clients: "R", restaurantUsers: "R", sopTemplates: "R", checklists: "R",
    issues: "CRU", catalog: "R", bookings: "R", schedule: "RU", jobs: "RU",
    inspections: "CRU", reports: "CR", publicPage: "CR", licences: "R",
    documents: "R", scores: "R",
  },
  OWNER: {
    clients: "R", restaurantUsers: "CRU", sopTemplates: "R", checklists: "CRUA",
    foodLabels: "CRU", issues: "CR", catalog: "R", bookings: "CRU", subscriptions: "CRU",
    schedule: "R", jobs: "R", inspections: "R", reports: "R", publicPage: "RU",
    licences: "CRU", documents: "CRU", scores: "R", staff: "CRU", attendance: "CRU",
    salary: "CRU", invoices: "R", payments: "C",
  },
  MANAGER: {
    clients: "R", restaurantUsers: "CRU", sopTemplates: "R", checklists: "CRUA",
    foodLabels: "CRU", issues: "CRU", catalog: "R", bookings: "CRU", subscriptions: "R",
    schedule: "R", jobs: "RA", inspections: "R", reports: "R", publicPage: "R",
    licences: "CRU", documents: "CRU", scores: "R", staff: "CRU", attendance: "CRU",
    salary: "CRU", invoices: "R", payments: "C",
  },
  HEAD_CHEF: {
    sopTemplates: "R", checklists: "CR", foodLabels: "CR", issues: "CR",
    scores: "R", staff: "R", attendance: "C",
  },
};

export function roleCan(role: Role, resource: Resource, action: Action): boolean {
  const letters = GRANTS[role][resource] ?? "";
  return [...letters].some((letter) => LETTER[letter] === action);
}

/** What the action is being done to. Leave both empty for "anything I can reach". */
export interface Target {
  organizationId?: string | null;
  outletId?: string | null;
}

function covers(membership: MembershipScope, target: Target): boolean {
  if (isEccsRole(membership.role)) return true;
  if (membership.role === "OWNER") {
    return target.organizationId == null || target.organizationId === membership.organizationId;
  }
  // MANAGER and HEAD_CHEF are tied to one outlet. An outlet-less target inside
  // their organisation (for example the brand's invoices) is out of reach.
  if (target.outletId != null) return target.outletId === membership.outletId;
  return target.organizationId == null;
}

/**
 * True if any of the user's memberships allows the action on the target.
 * A SUPERVISOR is further limited to assigned outlets and jobs; that
 * row-level filter is applied by the API using `accessScope`.
 */
export function can(
  memberships: readonly MembershipScope[],
  resource: Resource,
  action: Action,
  target: Target = {},
): boolean {
  return memberships.some((m) => roleCan(m.role, resource, action) && covers(m, target));
}

export type AccessScope =
  | { kind: "all" }
  | { kind: "assigned" }
  | { kind: "restaurant"; organizationIds: string[]; outletIds: string[] };

/**
 * Which rows a user may see for a resource:
 * - all: Super Admin and Ops Manager
 * - assigned: Supervisor, only outlets and jobs assigned to them
 * - restaurant: whole organisations (Owner) and single outlets (Manager, Head Chef)
 * Returns null if no membership grants read access.
 */
export function accessScope(memberships: readonly MembershipScope[], resource: Resource): AccessScope | null {
  const granted = memberships.filter((m) => roleCan(m.role, resource, "read"));
  if (granted.length === 0) return null;
  if (granted.some((m) => m.role === "SUPER_ADMIN" || m.role === "OPS_MANAGER")) return { kind: "all" };
  if (granted.some((m) => m.role === "SUPERVISOR")) return { kind: "assigned" };

  const organizationIds = new Set<string>();
  const outletIds = new Set<string>();
  for (const m of granted) {
    if (m.role === "OWNER" && m.organizationId) organizationIds.add(m.organizationId);
    else if (m.outletId) outletIds.add(m.outletId);
  }
  return { kind: "restaurant", organizationIds: [...organizationIds], outletIds: [...outletIds] };
}
