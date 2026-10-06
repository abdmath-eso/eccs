"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui";
import { useSession } from "@/lib/session";

const ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  OPS_MANAGER: "Operations Manager",
  SUPERVISOR: "Supervisor",
};

const NAV = [
  { href: "/", label: "Clients" },
  { href: "/issues", label: "Issues" },
] as const;

/** Frame for every console page. Sends anyone who is not logged in to the login page. */
export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user, signOut } = useSession();

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
  }, [status, router]);

  if (status !== "signedIn" || !user) {
    return <p className="p-8 text-muted">Loading…</p>;
  }

  const role = user.memberships[0]?.role ?? "";

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold text-primary">ECCS Console</span>
            <nav className="flex gap-1 text-sm font-semibold" aria-label="Sections">
              {NAV.map((item) => {
                const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={`rounded-lg px-3 py-1.5 ${current ? "bg-primary/10 text-primary" : "text-muted hover:text-foreground"}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
