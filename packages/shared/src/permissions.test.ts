import { describe, expect, it } from "vitest";
import { normalizePhone } from "./auth.js";
import { accessScope, can } from "./permissions.js";
import type { MembershipScope } from "./roles.js";

const eccs = (role: MembershipScope["role"]): MembershipScope[] => [{ role, organizationId: null, outletId: null }];
const owner: MembershipScope[] = [{ role: "OWNER", organizationId: "org-1", outletId: null }];
const manager: MembershipScope[] = [{ role: "MANAGER", organizationId: "org-1", outletId: "outlet-1" }];
const headChef: MembershipScope[] = [{ role: "HEAD_CHEF", organizationId: "org-1", outletId: "outlet-1" }];

describe("can", () => {
  it("lets ECCS admins manage any client", () => {
    expect(can(eccs("SUPER_ADMIN"), "clients", "create")).toBe(true);
    expect(can(eccs("OPS_MANAGER"), "clients", "update", { organizationId: "org-9" })).toBe(true);
  });

  it("keeps supervisors read-only on clients and out of billing", () => {
    expect(can(eccs("SUPERVISOR"), "clients", "read")).toBe(true);
    expect(can(eccs("SUPERVISOR"), "clients", "update")).toBe(false);
    expect(can(eccs("SUPERVISOR"), "invoices", "read")).toBe(false);
    expect(can(eccs("SUPERVISOR"), "jobs", "update")).toBe(true);
  });

  it("hides restaurant employee data from every ECCS role", () => {
    for (const role of ["SUPER_ADMIN", "OPS_MANAGER", "SUPERVISOR"] as const) {
      expect(can(eccs(role), "salary", "read")).toBe(false);
      expect(can(eccs(role), "attendance", "read")).toBe(false);
      expect(can(eccs(role), "staff", "read")).toBe(false);
    }
  });

  it("limits an owner to their own organisation", () => {
    expect(can(owner, "invoices", "read", { organizationId: "org-1" })).toBe(true);
    expect(can(owner, "invoices", "read", { organizationId: "org-2" })).toBe(false);
    expect(can(owner, "salary", "update", { organizationId: "org-1", outletId: "outlet-2" })).toBe(true);
  });

  it("limits a manager to their own outlet", () => {
    expect(can(manager, "salary", "read", { organizationId: "org-1", outletId: "outlet-1" })).toBe(true);
    expect(can(manager, "salary", "read", { organizationId: "org-1", outletId: "outlet-2" })).toBe(false);
    expect(can(manager, "checklists", "approve", { outletId: "outlet-1" })).toBe(true);
    expect(can(manager, "subscriptions", "update", { outletId: "outlet-1" })).toBe(false);
  });

  it("lets only the owner correct attendance; the manager reads it; the head chef has no grant on it", () => {
    const here = { organizationId: "org-1", outletId: "outlet-1" };
    for (const action of ["create", "read", "update"] as const) expect(can(owner, "attendance", action, here)).toBe(true);
    expect(can(manager, "attendance", "read", here)).toBe(true);
    expect(can(manager, "attendance", "create", here)).toBe(false);
    expect(can(manager, "attendance", "update", here)).toBe(false);
    for (const action of ["create", "read", "update"] as const) expect(can(headChef, "attendance", action, here)).toBe(false);
    // Since 13 Oct 2026 the Head Chef has no attendance page, and so no reason to read the staff list either.
    for (const action of ["create", "read", "update"] as const) expect(can(headChef, "staff", action, here)).toBe(false);
  });

  it("shows the vendor directory to the owner and the manager only, and lets nobody change it", () => {
    const here = { organizationId: "org-1", outletId: "outlet-1" };
    expect(can(owner, "vendors", "read", here)).toBe(true);
    expect(can(owner, "vendors", "read", { organizationId: "org-1", outletId: "outlet-2" })).toBe(true);
    expect(can(owner, "vendors", "read", { organizationId: "org-2", outletId: "outlet-9" })).toBe(false);
    expect(can(manager, "vendors", "read", here)).toBe(true);
    expect(can(manager, "vendors", "read", { organizationId: "org-1", outletId: "outlet-2" })).toBe(false);
    expect(can(headChef, "vendors", "read", here)).toBe(false);
    for (const role of ["SUPER_ADMIN", "OPS_MANAGER", "SUPERVISOR"] as const) expect(can(eccs(role), "vendors", "read")).toBe(false);
    for (const action of ["create", "update", "approve"] as const) {
      for (const who of [owner, manager, headChef, eccs("SUPER_ADMIN")]) expect(can(who, "vendors", action, here)).toBe(false);
    }
  });

  it("gives the head chef checklists and labels only", () => {
    expect(can(headChef, "checklists", "create", { outletId: "outlet-1" })).toBe(true);
    // "create" covers making a label and saving a new one; changing a saved label is "update".
    expect(can(headChef, "foodLabels", "create", { outletId: "outlet-1" })).toBe(true);
    expect(can(headChef, "foodLabels", "update", { outletId: "outlet-1" })).toBe(false);
    expect(can(headChef, "attendance", "create", { outletId: "outlet-1" })).toBe(false);
    expect(can(headChef, "salary", "read", { outletId: "outlet-1" })).toBe(false);
    expect(can(headChef, "invoices", "read", { outletId: "outlet-1" })).toBe(false);
    expect(can(headChef, "bookings", "create", { outletId: "outlet-1" })).toBe(false);
    expect(can(headChef, "checklists", "create", { outletId: "outlet-2" })).toBe(false);
  });

  it("shows ECCS's own team to the Super Admin and the Ops Manager, salaries and logins to the Super Admin only (16 Oct 2026)", () => {
    for (const role of ["SUPER_ADMIN", "OPS_MANAGER"] as const) {
      expect(can(eccs(role), "team", "read")).toBe(true);
      // Both record and remove leave.
      expect(can(eccs(role), "team", "create")).toBe(true);
      expect(can(eccs(role), "team", "update")).toBe(true);
    }
    expect(can(eccs("SUPER_ADMIN"), "team", "approve")).toBe(true);
    expect(can(eccs("OPS_MANAGER"), "team", "approve")).toBe(false);
    // Adding a member and marking one as left go through the ECCS logins grant.
    expect(can(eccs("SUPER_ADMIN"), "eccsUsers", "create")).toBe(true);
    expect(can(eccs("OPS_MANAGER"), "eccsUsers", "update")).toBe(false);
    for (const role of ["SUPERVISOR", "BDE"] as const) expect(can(eccs(role), "team", "read")).toBe(false);
    for (const members of [owner, manager, headChef]) expect(can(members, "team", "read")).toBe(false);
  });

  it("shows the AI usage page to the Super Admin and the Ops Manager, and lets only the Super Admin change the AI settings (19 Oct 2026)", () => {
    expect(can(eccs("SUPER_ADMIN"), "aiUsage", "read")).toBe(true);
    expect(can(eccs("SUPER_ADMIN"), "aiUsage", "update")).toBe(true);
    expect(can(eccs("OPS_MANAGER"), "aiUsage", "read")).toBe(true);
    expect(can(eccs("OPS_MANAGER"), "aiUsage", "update")).toBe(false);
    for (const role of ["SUPERVISOR", "BDE"] as const) expect(can(eccs(role), "aiUsage", "read")).toBe(false);
    for (const members of [owner, manager, headChef]) expect(can(members, "aiUsage", "read")).toBe(false);
  });

  it("shows the Usage page to the Super Admin only, and lets nobody change it (23 Oct 2026)", () => {
    expect(can(eccs("SUPER_ADMIN"), "usage", "read")).toBe(true);
    expect(can(eccs("SUPER_ADMIN"), "usage", "update")).toBe(false);
    for (const role of ["OPS_MANAGER", "SUPERVISOR", "BDE"] as const) expect(can(eccs(role), "usage", "read")).toBe(false);
    for (const members of [owner, manager, headChef]) expect(can(members, "usage", "read")).toBe(false);
  });
});

describe("accessScope", () => {
  it("returns the right kind per role", () => {
    expect(accessScope(eccs("OPS_MANAGER"), "clients")).toEqual({ kind: "all" });
    expect(accessScope(eccs("SUPERVISOR"), "clients")).toEqual({ kind: "assigned" });
    expect(accessScope(owner, "clients")).toEqual({ kind: "restaurant", organizationIds: ["org-1"], outletIds: [] });
    expect(accessScope(manager, "clients")).toEqual({ kind: "restaurant", organizationIds: [], outletIds: ["outlet-1"] });
    expect(accessScope(headChef, "clients")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("accepts common ways of typing an Indian mobile number", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("09876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
  });

  it("rejects anything else", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("1234567890")).toBeNull();
    expect(normalizePhone("+1 415 555 0100")).toBeNull();
  });
});
