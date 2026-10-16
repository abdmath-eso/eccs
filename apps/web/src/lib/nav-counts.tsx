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
  /** Licences expired or expiring soon. */
  licences: number | null;
  /** Invoices past their due date with money still owed. */
  invoices: number | null;
  /** Photos proposed for customer pages and waiting for ECCS's approval. */
  publicPhotos: number | null;
  /** Sales: today's to-dos for the leads the person reaches (Do today). */
  sales: number | null;
  /** Team: people on ECCS's own team with something to keep an eye on. */
  team: number | null;
}

const EMPTY: NavCounts = { visits: null, issues: null, licences: null, invoices: null, publicPhotos: null, sales: null, team: null };

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
  const [requests, visits, issues, licences, billing, photos, sales, team] = await Promise.allSettled([
    operations ? api.bookings.list({ requestedOnly: true }) : skipped,
    operations ? api.visits.list({ state: "open" }) : skipped,
    operations ? api.issues.list({ openOnly: true }) : skipped,
    operations ? api.licences.list({ attentionOnly: true }) : skipped,
    operations ? api.billing.totals() : skipped,
    operations ? api.publicPage.photosWaiting() : skipped,
    can(memberships, "sales", "read") ? api.sales.doToday() : skipped,
    can(memberships, "team", "read") ? api.eccsTeam.list() : skipped,
  ]);
  const waiting = requests.status === "fulfilled" ? requests.value.length : 0;
  return {
    visits: visits.status === "fulfilled" ? waiting + visits.value.filter((visit) => visit.status === "SCHEDULED" || visit.status === "IN_REVIEW").length : null,
    issues: issues.status === "fulfilled" ? issues.value.length : null,
    licences: licences.status === "fulfilled" ? licences.value.length : null,
    invoices: billing.status === "fulfilled" ? billing.value.overdueCount : null,
    publicPhotos: photos.status === "fulfilled" ? photos.value.waiting : null,
    sales: sales.status === "fulfilled" ? sales.value.items.length : null,
    team: team.status === "fulfilled" ? team.value.flagged : null,
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
