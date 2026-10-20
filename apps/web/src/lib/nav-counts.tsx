"use client";

import { can, type CurrentUserDto } from "@eccs/shared";
import { usePathname } from "next/navigation";
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";

import { api } from "./api";
import { useSession } from "./session";

type Memberships = CurrentUserDto["memberships"];

/** How many things are waiting in each section. `null` until known, or if it could not be fetched. */
export interface NavCounts {
  /** Requests from restaurants not yet confirmed, visits with no Supervisor, and reports waiting to be checked. */
  visits: number | null;
  /** Issues that are open or in progress. */
  issues: number | null;
  /** Invoices past their due date with money still owed. */
  invoices: number | null;
  /**
   * Quality: open follow-ups with nothing booked, photos to judge (the customer-page photos among them,
   * for those who approve them) and open incidents (20 Oct 2026; they replaced Customer pages' count).
   */
  quality: number | null;
  /** Sales: today's to-dos for the leads the person reaches (Do today). */
  sales: number | null;
  /** Team: people on ECCS's own team with something to keep an eye on. */
  team: number | null;
  /** AI usage: the warnings true now (a limit's warning share passed, credit low, AI off, a helper failing; 19 Oct 2026). */
  ai: number | null;
  /** Joining ECCS: how many of their four joining steps a new team member has left; null with no onboarding of their own (16 Oct 2026). */
  joining: number | null;
  /** Clients: new outlets not live 24 hours after being added (New outlets, 20 Oct 2026). */
  newOutlets: number | null;
}

const EMPTY: NavCounts = { visits: null, issues: null, invoices: null, quality: null, sales: null, team: null, ai: null, joining: null, newOutlets: null };

const NavCountsContext = createContext<{ counts: NavCounts; refresh: () => void } | null>(null);

export function useNavCounts() {
  const value = use(NavCountsContext);
  if (!value) throw new Error("useNavCounts must be used inside NavCountsProvider");
  return value;
}

async function fetchCounts(memberships: Memberships): Promise<NavCounts> {
  // A BDE (sales only) reaches none of the operations pages, so only Sales is asked for.
  const operations = can(memberships, "jobs", "read");
  const skipped = Promise.reject(new Error("not part of this role"));
  skipped.catch(() => undefined);
  // Each is fetched on its own, so one that fails (a Supervisor may not list requests) does not hide the others.
  const [requests, visits, issues, billing, quality, sales, team, ai, joining, newOutlets] = await Promise.allSettled([
    operations ? api.bookings.list({ requestedOnly: true }) : skipped,
    operations ? api.visits.list({ state: "open" }) : skipped,
    operations ? api.issues.list({ openOnly: true }) : skipped,
    operations ? api.billing.totals() : skipped,
    // The Super Admin and the Ops Manager only; one number for the three tabs.
    can(memberships, "quality", "read") ? api.quality.counts() : skipped,
    can(memberships, "sales", "read") ? api.sales.doToday() : skipped,
    can(memberships, "team", "read") ? api.eccsTeam.list() : skipped,
    can(memberships, "aiUsage", "read") ? api.aiUsage.alerts() : skipped,
    // Anyone on ECCS's team may have their own joining page; the answer is empty for everyone else.
    api.onboarding.mine(),
    // New outlets is for those who onboard restaurants; a Supervisor's Clients is Health only.
    can(memberships, "clients", "create") ? api.outletOnboarding.attention() : skipped,
  ]);
  const waiting = requests.status === "fulfilled" ? requests.value.length : 0;
  return {
    visits: visits.status === "fulfilled" ? waiting + visits.value.filter((visit) => visit.status === "SCHEDULED" || visit.status === "IN_REVIEW").length : null,
    issues: issues.status === "fulfilled" ? issues.value.length : null,
    invoices: billing.status === "fulfilled" ? billing.value.overdueCount : null,
    quality: quality.status === "fulfilled" ? quality.value.total : null,
    sales: sales.status === "fulfilled" ? sales.value.items.length : null,
    team: team.status === "fulfilled" ? team.value.flagged : null,
    ai: ai.status === "fulfilled" ? ai.value.warnings.length : null,
    // Shown while their onboarding is open; done, the page leaves the menu.
    joining: joining.status === "fulfilled" && joining.value.page && !joining.value.page.doneOn ? joining.value.page.left : null,
    newOutlets: newOutlets.status === "fulfilled" ? newOutlets.value.stuck.length : null,
  };
}

/**
 * Fetches the counts shown in the side menu: when the console opens, each time
 * the person moves to another section, and whenever a page calls `refresh()`
 * after changing something.
 */
export function NavCountsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();
  const [counts, setCounts] = useState<NavCounts>(EMPTY);
  const [version, setVersion] = useState(0);
  const memberships = user?.memberships;

  useEffect(() => {
    if (!memberships) return;
    let cancelled = false;
    void fetchCounts(memberships).then((next) => !cancelled && setCounts(next));
    return () => {
      cancelled = true;
    };
  }, [pathname, version, memberships]);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  return <NavCountsContext value={{ counts, refresh }}>{children}</NavCountsContext>;
}
