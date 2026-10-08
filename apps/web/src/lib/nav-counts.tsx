"use client";

import { usePathname } from "next/navigation";
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";

import { api } from "./api";

/** How many things are waiting in each section. `null` until known, or if it could not be fetched. */
export interface NavCounts {
  /** Requests from restaurants not yet confirmed, visits with no Supervisor, and reports waiting to be checked. */
  visits: number | null;
  /** Issues that are open or in progress. */
  issues: number | null;
  /** Licences expired or expiring soon. */
  licences: number | null;
  /** Invoices past their due date with money still owed. */
  invoices: number | null;
}

const EMPTY: NavCounts = { visits: null, issues: null, licences: null, invoices: null };

const NavCountsContext = createContext<{ counts: NavCounts; refresh: () => void } | null>(null);

export function useNavCounts() {
  const value = use(NavCountsContext);
  if (!value) throw new Error("useNavCounts must be used inside NavCountsProvider");
  return value;
}

async function fetchCounts(): Promise<NavCounts> {
  // Each is fetched on its own, so one that fails (a Supervisor may not list requests) does not hide the others.
  const [requests, visits, issues, licences, billing] = await Promise.allSettled([
    api.bookings.list({ requestedOnly: true }),
    api.visits.list({ state: "open" }),
    api.issues.list({ openOnly: true }),
    api.licences.list({ attentionOnly: true }),
    api.billing.totals(),
  ]);
  const waiting = requests.status === "fulfilled" ? requests.value.length : 0;
  return {
    visits: visits.status === "fulfilled" ? waiting + visits.value.filter((visit) => visit.status === "SCHEDULED" || visit.status === "IN_REVIEW").length : null,
    issues: issues.status === "fulfilled" ? issues.value.length : null,
    licences: licences.status === "fulfilled" ? licences.value.length : null,
    invoices: billing.status === "fulfilled" ? billing.value.overdueCount : null,
  };
}

/**
 * Fetches the counts shown in the top menu: when the console opens, each time
 * the person moves to another section, and whenever a page calls `refresh()`
 * after changing something.
 */
export function NavCountsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<NavCounts>(EMPTY);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchCounts().then((next) => !cancelled && setCounts(next));
    return () => {
      cancelled = true;
    };
  }, [pathname, version]);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  return <NavCountsContext value={{ counts, refresh }}>{children}</NavCountsContext>;
}
