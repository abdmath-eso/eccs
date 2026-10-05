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

  it("gives the head chef checklists, labels and attendance marking only", () => {
    expect(can(headChef, "checklists", "create", { outletId: "outlet-1" })).toBe(true);
    expect(can(headChef, "foodLabels", "create", { outletId: "outlet-1" })).toBe(true);
    expect(can(headChef, "attendance", "create", { outletId: "outlet-1" })).toBe(true);
    expect(can(headChef, "salary", "read", { outletId: "outlet-1" })).toBe(false);
    expect(can(headChef, "invoices", "read", { outletId: "outlet-1" })).toBe(false);
    expect(can(headChef, "bookings", "create", { outletId: "outlet-1" })).toBe(false);
    expect(can(headChef, "checklists", "create", { outletId: "outlet-2" })).toBe(false);
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
