"use client";

import { can } from "@eccs/shared";

import { NoAccess, PageTabs } from "@/components/ui";
import { useNavCounts } from "@/lib/nav-counts";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import ClientsScreen from "../clients-screen";
import MonitoringScreen from "../monitoring/monitoring-screen";
import NewOutletsScreen from "./new-outlets-screen";

const TABS = ["health", "all", "new"] as const;
type Tab = (typeof TABS)[number];

/**
 * Clients (the console plan, 20 Oct 2026): one page with three tabs, each its own
 * web address (`tab=`):
 * - Health, the first: the monitoring board, every outlet worst first (a Supervisor's
 *   own outlets, and the only tab a Supervisor has);
 * - All clients: the client records, outlets, plans and codes, and onboarding;
 * - New outlets: each outlet's first ten days.
 * The last two are for the Super Admin and the Ops Manager.
 *
 * Pattern followed: one record, many views (the console plan's rule 3): how the clients
 * are doing sits beside the clients themselves, as tabs of one page rather than separate
 * entries in the menu.
 */
export default function ClientsTabsScreen() {
  const query = useQuery();
  const { user } = useSession();
  const { counts } = useNavCounts();
  const onboards = user ? can(user.memberships, "clients", "create") : false;

  // An old link to a client (`client=`) or onboarding from a lead (`onboard=`) means All clients.
  const asked = query.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(asked) ? (asked as Tab) : query.get("client") || query.get("onboard") ? "all" : "health";

  const tabs = onboards ? (
    <PageTabs
      label="Parts of Clients"
      tabs={[
        { href: "/clients?tab=health", label: "Health", current: tab === "health" },
        { href: "/clients?tab=all", label: "All clients", current: tab === "all" },
        { href: "/clients?tab=new", label: "New outlets", current: tab === "new", count: counts.newOutlets, countLabel: "not live after 24 hours" },
      ]}
    />
  ) : null;

  if (tab !== "health" && !onboards) {
    return (
      <NoAccess title="Clients">
        All clients and New outlets are for Super Admins and Operations Managers. Health, the first tab, shows the outlets you work at.
      </NoAccess>
    );
  }
  if (tab === "all") return <ClientsScreen tabs={tabs} />;
  if (tab === "new") return <NewOutletsScreen tabs={tabs} />;
  return <MonitoringScreen tabs={tabs} />;
}
