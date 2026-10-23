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

  it("has 17 entries, with Quality after Issues and no Customer pages (console plan step 3; Usage added 23 Oct 2026)", () => {
    expect(CONSOLE_SECTIONS).toHaveLength(17);
    const keys = CONSOLE_SECTIONS.map((section) => section.key);
    expect(keys.indexOf("quality")).toBe(keys.indexOf("issues") + 1);
    expect(keys).not.toContain("customerPages");
    expect(CONSOLE_SECTIONS.find((section) => section.key === "quality")).toMatchObject({ href: "/quality", group: "Daily work" });
  });

  it("gives Quality to the Super Admin and the Ops Manager only", () => {
    expect(labels("SUPER_ADMIN")).toContain("Quality");
    expect(labels("OPS_MANAGER")).toContain("Quality");
    expect(labels("SUPERVISOR")).not.toContain("Quality");
    expect(labels("BDE")).not.toContain("Quality");
  });

  it("gives Usage to the Super Admin only (23 Oct 2026)", () => {
    expect(labels("SUPER_ADMIN")).toContain("Usage");
    for (const role of ["OPS_MANAGER", "SUPERVISOR", "BDE"] as const) expect(labels(role)).not.toContain("Usage");
    expect(CONSOLE_SECTIONS.find((section) => section.key === "usage")).toMatchObject({ href: "/usage", group: "Business" });
  });

  it("agrees with the menu's own check", () => {
    for (const role of ["SUPER_ADMIN", "OPS_MANAGER", "SUPERVISOR", "BDE"] as const) {
      expect(CONSOLE_SECTIONS.filter((section) => opensSection(as(role), section)).map((section) => section.label)).toEqual(labels(role));
    }
  });
});
