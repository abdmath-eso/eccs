import { describe, expect, it } from "vitest";
import { CONSOLE_SECTIONS, consoleSectionsFor, opensSection } from "./console-sections.js";
import type { MembershipScope } from "./roles.js";

const labels = (role: Parameters<typeof consoleSectionsFor>[0]) => consoleSectionsFor(role).map((section) => section.label);
const as = (role: MembershipScope["role"]): MembershipScope[] => [{ role, organizationId: null, outletId: null }];

describe("consoleSectionsFor", () => {
  it("gives the BDE Sales only", () => {
    expect(labels("BDE")).toEqual(["Sales"]);
  });

  it("gives the Supervisor Today, the field sections and Clients' Health tab only", () => {
    expect(labels("SUPERVISOR")).toEqual(["Today", "Visits", "Inspections", "Issues", "Clients", "Certificates", "SOPs"]);
    const clients = consoleSectionsFor("SUPERVISOR").find((section) => section.key === "clients");
    expect(clients?.tabsNotOpened).toEqual(["All clients", "New outlets"]);
    expect(clients?.onlyTab).toBe("Health");
  });

  it("gives the Ops Manager everything but Finance", () => {
    expect(labels("OPS_MANAGER")).not.toContain("Finance");
    expect(labels("OPS_MANAGER")).toContain("Logs");
    expect(consoleSectionsFor("OPS_MANAGER").find((section) => section.key === "clients")?.tabsNotOpened).toEqual([]);
  });

  it("puts Today first, above the groups, for everyone but the BDE", () => {
    expect(CONSOLE_SECTIONS[0]).toMatchObject({ key: "today", href: "/", group: null });
    for (const role of ["SUPER_ADMIN", "OPS_MANAGER", "SUPERVISOR"] as const) expect(labels(role)[0]).toBe("Today");
    expect(labels("BDE")).not.toContain("Today");
  });

  it("gives the Super Admin every section", () => {
    expect(labels("SUPER_ADMIN")).toEqual(CONSOLE_SECTIONS.map((section) => section.label));
  });

  it("agrees with the menu's own check", () => {
    for (const role of ["SUPER_ADMIN", "OPS_MANAGER", "SUPERVISOR", "BDE"] as const) {
      expect(CONSOLE_SECTIONS.filter((section) => opensSection(as(role), section)).map((section) => section.label)).toEqual(labels(role));
    }
  });
});
