import { can, roleCan, type Action, type Resource } from "./permissions.js";
import type { MembershipScope, Role } from "./roles.js";

// The console's menu as data (20 Oct 2026, the console plan's map, docs/CONSOLE_PLAN.md
// section 3): its groups, its entries, and the grant each entry's page checks before showing
// anything. The side menu (apps/web/src/components/console-nav.tsx) draws it with icons and
// counts, and the Team page's "Console access" card says from it, in words, what a person's
// role opens. Roles stay fixed (the founder, 20 Oct 2026): there are no per-login sections.

/** A grant: a resource and the action on it. */
export interface ConsoleGrant {
  resource: Resource;
  action: Action;
}

/** A tab of a section that needs more than the section itself (Clients: All clients and New outlets). */
export interface ConsoleTab {
  label: string;
  needs: ConsoleGrant;
}

export interface ConsoleSection {
  /** Stable key, used by the menu to pick its icon and count. */
  key: string;
  label: string;
  href: string;
  /** The menu group it is listed under; null for Today, which stands above the groups with no heading. */
  group: ConsoleGroupLabel | null;
  /** The grant the page reads with: the menu shows the entry only to people who have it. */
  needs: ConsoleGrant;
  /** What it is for, in a few plain words, for the access card. */
  about: string;
  /** The name of the tab the section's own grant opens, when it has tabs that need more ("Health"). */
  firstTab?: string;
  tabs?: readonly ConsoleTab[];
}

export const CONSOLE_GROUPS = ["Daily work", "Clients", "Business", "Set-up"] as const;
export type ConsoleGroupLabel = (typeof CONSOLE_GROUPS)[number];

/** In menu order: Today, then what needs doing today, then the clients, the business, and what is set up once. */
export const CONSOLE_SECTIONS: readonly ConsoleSection[] = [
  // The home page (step 2 of the console plan, 20 Oct 2026). The visit grant opens it, so the Super
  // Admin, the Ops Manager and a Supervisor (their own day) have it and a BDE, who starts on Sales, does not.
  { key: "today", label: "Today", href: "/", group: null, needs: { resource: "jobs", action: "read" }, about: "what needs doing today" },
  { key: "visits", label: "Visits", href: "/visits", group: "Daily work", needs: { resource: "jobs", action: "read" }, about: "the visit diary and the week board" },
  { key: "inspections", label: "Inspections", href: "/inspections", group: "Daily work", needs: { resource: "inspections", action: "read" }, about: "inspection reports" },
  { key: "issues", label: "Issues", href: "/issues", group: "Daily work", needs: { resource: "issues", action: "read" }, about: "issues raised by restaurants" },
  // Step 3 of the console plan (20 Oct 2026): three work queues, Follow-ups, Photos and Incidents. The
  // customer-page photos moved into its Photos tab, so Customer pages left the menu (it stays at 16).
  { key: "quality", label: "Quality", href: "/quality", group: "Daily work", needs: { resource: "quality", action: "read" }, about: "follow-ups, photos to judge and incidents" },
  {
    key: "clients",
    label: "Clients",
    href: "/clients",
    group: "Clients",
    // Health is the first tab and needs only reading; a Supervisor sees their own outlets there.
    needs: { resource: "clients", action: "read" },
    about: "how each outlet is doing",
    firstTab: "Health",
    tabs: [
      { label: "All clients", needs: { resource: "clients", action: "create" } },
      { label: "New outlets", needs: { resource: "clients", action: "create" } },
    ],
  },
  { key: "invoices", label: "Invoices", href: "/invoices", group: "Clients", needs: { resource: "invoices", action: "update" }, about: "invoices and payments" },
  // No Licences page since 20 Oct 2026: licences are the restaurant's own, kept in its app.
  { key: "certificates", label: "Certificates", href: "/certificates", group: "Clients", needs: { resource: "reports", action: "read" }, about: "service certificates" },
  { key: "sales", label: "Sales", href: "/sales", group: "Business", needs: { resource: "sales", action: "read" }, about: "leads and quotes" },
  { key: "finance", label: "Finance", href: "/finance", group: "Business", needs: { resource: "finance", action: "read" }, about: "ECCS's own money" },
  { key: "team", label: "Team", href: "/team", group: "Business", needs: { resource: "team", action: "read" }, about: "ECCS's own team" },
  { key: "aiUsage", label: "AI usage", href: "/ai-usage", group: "Business", needs: { resource: "aiUsage", action: "read" }, about: "what the AI helpers cost" },
  { key: "catalogue", label: "Catalogue", href: "/catalogue", group: "Set-up", needs: { resource: "catalog", action: "update" }, about: "services and prices" },
  { key: "plans", label: "Plans", href: "/plans", group: "Set-up", needs: { resource: "catalog", action: "update" }, about: "subscription plans" },
  { key: "sops", label: "SOPs", href: "/sops", group: "Set-up", needs: { resource: "sopTemplates", action: "read" }, about: "standard procedures" },
  { key: "logs", label: "Logs", href: "/logs", group: "Set-up", needs: { resource: "auditLog", action: "read" }, about: "the record of everything that happened" },
];

/** Whether these memberships open a section (the menu's check). */
export const opensSection = (memberships: readonly MembershipScope[], section: Pick<ConsoleSection, "needs">) =>
  can(memberships, section.needs.resource, section.needs.action);

/** One section a role opens, with the tabs it does not reach named, for the access card. */
export interface RoleSection {
  key: string;
  label: string;
  group: ConsoleGroupLabel | null;
  about: string;
  /** The tabs of the section this role cannot open ("All clients", "New outlets"); empty when it opens all. */
  tabsNotOpened: string[];
  /** The first tab's name when it is the only one this role opens ("Health"); null otherwise. */
  onlyTab: string | null;
}

/** The sections a role opens, in menu order. Derived from the grants alone, so it never disagrees with the menu. */
export function consoleSectionsFor(role: Role): RoleSection[] {
  return CONSOLE_SECTIONS.filter((section) => roleCan(role, section.needs.resource, section.needs.action)).map((section) => {
    const tabs = section.tabs ?? [];
    const tabsNotOpened = tabs.filter((tab) => !roleCan(role, tab.needs.resource, tab.needs.action)).map((tab) => tab.label);
    return {
      key: section.key,
      label: section.label,
      group: section.group,
      about: section.about,
      tabsNotOpened,
      onlyTab: section.firstTab && tabs.length > 0 && tabsNotOpened.length === tabs.length ? section.firstTab : null,
    };
  });
}
