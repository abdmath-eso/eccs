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
  "vendors", // the directory of nearby wholesalers and distributors
  "finance", // ECCS's own books: expenses, budgets, founders' money, cash (the console's Finance page)
  "sales", // leads, their steps and quotes, and the BDEs' targets (the console's Sales page)
  "team", // ECCS's own team: who is in, their week, leave and salaries (the console's Team page)
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["create", "read", "update", "approve"] as const;
export type Action = (typeof ACTIONS)[number];

const LETTER: Record<string, Action> = { C: "create", R: "read", U: "update", A: "approve" };

// C = create, R = read, U = update, A = approve or sign off.
// For issues: restaurant roles with U may only close or reopen; ECCS roles
// with U move an issue through in progress and resolved.
// For checklists: C = fill one in, U = add or remove the outlet's own items,
// A = mark a submitted checklist as reviewed.
// For foodLabels: C = make a label, and save a new one (a name and how long it
// keeps) for the outlet, so the Head Chef can make a label for anything
// (founder, 9 Oct 2026); U = change or remove a saved label, and add where it
// is stored and its allergens, which stays with the Owner and the Manager.
// For sopTemplates: restaurant roles with C and U write SOPs for their own
// outlet only; ECCS's standard SOPs are read-only to them.
// For jobs (service visits): ECCS roles with U record the visit on site; restaurant
// roles with A sign off the finished work.
// For attendance (face attendance, 11 Oct 2026): nobody marks attendance by hand.
// R = read the month, the punches and what is waiting for review, and open
// punch photos; C = add a missing punch, set leave or the weekly off;
// U = correct a day, void a punch, change the full-day and half-day hours.
// Only the Owner has C and U. The Manager reads. The Head Chef has no grant on
// staff, attendance or salary at all (founder, 13 Oct 2026: attendance is by
// clocking in and out, so the Head Chef has no attendance page; until then the
// Head Chef read today's sheet of who is in under staff "R"). Clocking in and
// out needs no grant: it is done on the outlet's linked phone with nobody
// logged in.
// For staff: enrolling a person's face is the Owner's alone (checked in the
// service), although the Manager also holds C and U on staff.
// On top of these grants, nobody but the Owner can change their OWN staff
// record, attendance or pay, whatever their role allows for other people: see
// `ownRecordLocked` in staff.ts. The API's services check it.
// ECCS roles get nothing on staff, attendance and salary: that is the
// restaurant's private employee data.
// For vendors (the vendor directory, 13 Oct 2026): R = see the wholesalers and
// distributors near the outlet. The Owner and the Manager, who do the buying,
// have it; the Head Chef does not. Nobody has C or U: the list is loaded by
// ECCS and nothing is written through the API yet. ECCS roles have no grant
// either, until the console gets a page for keeping the list.
// For finance (the Finance page, 15 Oct 2026): ECCS's own money in, money out, the
// budget and the founders' money. R = read the page and export the books for the CA;
// C = enter expenses, budgets and founders' money; U = change or remove them, mark
// bills paid and set the opening balance. The Super Admin (the founders) only; the
// Ops Manager, the Supervisor and every restaurant role have no grant (Claude's
// default, which the founder may widen).
// For sales (the Sales page and the CRM, 15 Oct 2026): R = read leads, the dashboard
// and the targets; C = add a lead, log a step, make a quote; U = change a lead, park
// it, mark it lost, link it to a client, send a quote; A = set the BDEs' weekly
// targets and their floors (the Super Admin only). The Super Admin and the Ops
// Manager reach every lead; a BDE reaches only the leads they own: see `salesScope`
// in sales.ts, which the API's sales service checks on every request. A BDE has no
// other grant at all: no clients' records, no visits, no finance.
// For team (the Team page, 16 Oct 2026): ECCS's own staff, not a restaurant's. R = read
// the team list and each person's page; C = record leave; U = remove leave; A = see and
// set salaries (the Super Admin only; the Ops Manager sees everything else). Adding a team
// member (their ECCS login), changing their details and marking them as left use the
// existing eccsUsers grant (C and U), which only the Super Admin holds. A BDE and a
// Supervisor have no grant on team.
// Onboarding (16 Oct 2026) uses the same grants: R = a person's checklist and progress (the
// Ops Manager ticks the tasks the Ops Manager owns, checked in the service); A = the joining
// file, documents, appointment letter, handbook and templates (the Super Admin only). A new
// hire reaches only their own joining page, with no grant: the service checks it is theirs.
const GRANTS: Record<Role, Partial<Record<Resource, string>>> = {
  SUPER_ADMIN: {
    clients: "CRU", eccsUsers: "CRU", restaurantUsers: "CRU", sopTemplates: "CRU",
    checklists: "R", foodLabels: "R", issues: "CRU", catalog: "CRU", bookings: "CRU",
    subscriptions: "CRU", schedule: "CRU", jobs: "CRUA", inspections: "CRUA", reports: "CRA",
    publicPage: "RUA", licences: "CRU", documents: "CRU", scores: "R",
    invoices: "CRU", payments: "CRU", auditLog: "R", settings: "RU", finance: "CRU", sales: "CRUA",
    team: "CRUA",
  },
  OPS_MANAGER: {
    clients: "CRU", eccsUsers: "R", restaurantUsers: "CRU", sopTemplates: "CRU",
    checklists: "R", foodLabels: "R", issues: "CRU", catalog: "CRU", bookings: "CRU",
    subscriptions: "CRU", schedule: "CRU", jobs: "CRUA", inspections: "CRUA", reports: "CRA",
    publicPage: "RUA", licences: "CRU", documents: "CRU", scores: "R",
    invoices: "CRU", payments: "CRU", auditLog: "R", sales: "CRU", team: "CRU",
  },
  BDE: {
    sales: "CRU",
  },
  SUPERVISOR: {
    clients: "R", restaurantUsers: "R", sopTemplates: "R", checklists: "R",
    issues: "CRU", catalog: "R", bookings: "R", schedule: "RU", jobs: "RU",
    inspections: "CRU", reports: "CR", publicPage: "CR", licences: "R",
    documents: "R", scores: "R",
  },
  OWNER: {
    clients: "R", restaurantUsers: "CRU", sopTemplates: "CRU", checklists: "CRUA",
    foodLabels: "CRU", issues: "CRU", catalog: "R", bookings: "CRU", subscriptions: "CRU",
    schedule: "R", jobs: "RA", inspections: "R", reports: "R", publicPage: "RU",
    licences: "CRU", documents: "CRU", scores: "R", staff: "CRU", attendance: "CRU",
    salary: "CRU", invoices: "R", payments: "C", vendors: "R",
  },
  MANAGER: {
    clients: "R", restaurantUsers: "CRU", sopTemplates: "CRU", checklists: "CRUA",
    foodLabels: "CRU", issues: "CRU", catalog: "R", bookings: "CRU", subscriptions: "R",
    schedule: "R", jobs: "RA", inspections: "R", reports: "R", publicPage: "R",
    licences: "CRU", documents: "CRU", scores: "R", staff: "CRU", attendance: "R",
    // The Manager reads invoices. The grant on payments lets a Manager reach the payment
    // routes, where the billing service turns away anyone but the client's Owner.
    salary: "CRU", invoices: "R", payments: "C", vendors: "R",
  },
  HEAD_CHEF: {
    sopTemplates: "R", checklists: "CR", foodLabels: "CR", issues: "CR",
    scores: "R",
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
