"use client";

import { can } from "@eccs/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { ConfirmProvider } from "@/components/confirm-dialog";
import { MenuButton, SideMenu } from "@/components/console-nav";
import { DesktopAlertsOffer } from "@/components/desktop-alerts-offer";
import { NotificationBell } from "@/components/notification-bell";
import { ToastProvider } from "@/components/toast";
import { Button, Loading } from "@/components/ui";
import { LiveNotifications } from "@/lib/live-notifications";
import { NavCountsProvider } from "@/lib/nav-counts";
import { useSession } from "@/lib/session";

const ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  OPS_MANAGER: "Operations Manager",
  SUPERVISOR: "Supervisor",
};

/**
 * Frame for every console page. Sends anyone who is not logged in to the login page.
 *
 * A slim bar across the top holds the product name, the bell, who is logged in
 * and Log out, and stays in view. The sections are in a menu down the left
 * side (`SideMenu`); on a narrow window that menu is behind a button in the
 * top bar instead (`MenuButton`).
 */
export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user, signOut } = useSession();

  // Clients is for Super Admins and Operations Managers. A Supervisor starts on Visits instead.
  const seesClients = user ? can(user.memberships, "clients", "create") : false;
  const redirectToVisits = status === "signedIn" && !seesClients && pathname === "/";

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
    else if (redirectToVisits) router.replace("/visits");
  }, [status, redirectToVisits, router]);

  if (status !== "signedIn" || !user) {
    return <Loading className="p-8" />;
  }

  const role = user.memberships[0]?.role ?? "";

  return (
    <ToastProvider>
      <ConfirmProvider>
        <NavCountsProvider>
          <LiveNotifications>
            <div className="flex flex-1 flex-col">
              {/* The first thing the keyboard reaches: jumps over the top bar and the menu. */}
              <a href="#main-content" className="skip-link rounded-lg bg-surface px-4 py-2 font-semibold text-primary shadow-lg">
                Skip to the page
              </a>
              <header className="sticky top-0 z-30 flex h-(--topbar) items-center justify-between gap-3 border-b border-border bg-surface px-3 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <MenuButton memberships={user.memberships} />
                  <Link href={seesClients ? "/" : "/visits"} className="truncate rounded-md px-1 text-lg font-bold text-primary">
                    ECCS Console
                  </Link>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <NotificationBell />
                  {/* The name gives way first on a small window; Log out and the bell always stay. */}
                  <span className="hidden text-right leading-tight sm:block">
                    <span className="block font-semibold">{user.name}</span>
                    <span className="block text-xs text-muted">{ROLE_NAMES[role] ?? role}</span>
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => void signOut()}>
                    Log out
                  </Button>
                </div>
              </header>
              <div className="flex flex-1">
                <SideMenu memberships={user.memberships} />
                <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
                  <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
                    <DesktopAlertsOffer />
                    {redirectToVisits ? <Loading /> : children}
                  </div>
                </main>
              </div>
            </div>
          </LiveNotifications>
        </NavCountsProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
