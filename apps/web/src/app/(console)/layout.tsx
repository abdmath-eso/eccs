"use client";

import { can } from "@eccs/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { ConfirmProvider } from "@/components/confirm-dialog";
import { ToastProvider } from "@/components/toast";
import { Button, Loading } from "@/components/ui";
import { NavCountsProvider, useNavCounts, type NavCounts } from "@/lib/nav-counts";
import { useSession } from "@/lib/session";

const ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  OPS_MANAGER: "Operations Manager",
  SUPERVISOR: "Supervisor",
};

// `count` names the number shown beside the section; `waiting` says in words what the number means.
const NAV: readonly { href: string; label: string; count?: keyof NavCounts; waiting?: string }[] = [
  { href: "/", label: "Clients" },
  { href: "/visits", label: "Visits", count: "visits", waiting: "waiting for a date or a Supervisor" },
  { href: "/issues", label: "Issues", count: "issues", waiting: "open" },
  { href: "/licences", label: "Licences", count: "licences", waiting: "expired or expiring" },
  { href: "/sops", label: "SOPs" },
];

/** Frame for every console page. Sends anyone who is not logged in to the login page. */
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
          <div className="flex flex-1 flex-col">
            <header className="border-b border-border bg-surface">
              <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <span className="text-lg font-bold text-primary">ECCS Console</span>
                  <SectionNav pathname={pathname} seesClients={seesClients} />
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span>
                    {user.name}
                    <span className="ml-2 text-muted">{ROLE_NAMES[role] ?? role}</span>
                  </span>
                  <Button variant="secondary" onClick={() => void signOut()}>
                    Log out
                  </Button>
                </div>
              </div>
            </header>
            <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{redirectToVisits ? <Loading /> : children}</main>
          </div>
        </NavCountsProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function SectionNav({ pathname, seesClients }: { pathname: string; seesClients: boolean }) {
  const { counts } = useNavCounts();

  return (
    <nav className="flex flex-wrap gap-1 text-sm font-semibold" aria-label="Sections">
      {NAV.filter((item) => item.href !== "/" || seesClients).map((item) => {
        const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const count = item.count ? counts[item.count] : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${current ? "bg-primary/10 text-primary" : "text-muted hover:text-foreground"}`}
          >
            {item.label}
            {/* Nothing waiting shows no number at all, so a number always means there is something to do. */}
            {count !== null && count > 0 && (
              <span className="rounded-full bg-danger px-1.5 py-0.5 text-xs leading-none font-bold text-white">
                {count}
                <span className="sr-only"> {item.waiting}</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
