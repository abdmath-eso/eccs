"use client";

import { CONSOLE_GROUPS, CONSOLE_SECTIONS, opensSection, type CurrentUserDto } from "@eccs/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";

import { useNavCounts, type NavCounts } from "@/lib/nav-counts";

import {
  AiUsageIcon,
  CatalogueIcon,
  CertificatesIcon,
  ClientsIcon,
  CloseIcon,
  CollapseIcon,
  FinanceIcon,
  InspectionsIcon,
  InvoicesIcon,
  IssuesIcon,
  JoiningIcon,
  LogsIcon,
  MenuIcon,
  PlansIcon,
  QualityIcon,
  SalesIcon,
  SopsIcon,
  TeamIcon,
  TodayIcon,
  UsageIcon,
  VisitsIcon,
} from "./icons";

type Memberships = CurrentUserDto["memberships"];

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Names the number shown beside the section; `waiting` says in words what the number means. */
  count?: keyof NavCounts;
  waiting?: string;
  /** Shown only to people who may do this. It is the same check the page itself makes before showing anything. */
  needs?: (memberships: Memberships) => boolean;
  /** Shown only while the counts say so (the Joining ECCS page, for a new team member with an open onboarding). */
  shown?: (counts: NavCounts) => boolean;
}

/** Each section's picture, and the number shown beside it with what it means in words. */
const LOOKS: Record<string, { icon: ReactNode; count?: keyof NavCounts; waiting?: string }> = {
  // No number: Today's own headline gives the count, and the sections below keep theirs.
  today: { icon: <TodayIcon /> },
  visits: { icon: <VisitsIcon />, count: "visits", waiting: "waiting for a date, a Supervisor or a report check" },
  inspections: { icon: <InspectionsIcon /> },
  issues: { icon: <IssuesIcon />, count: "issues", waiting: "open" },
  // Follow-ups with nothing booked, photos to judge (the customer-page ones too) and open incidents.
  quality: { icon: <QualityIcon />, count: "quality", waiting: "things waiting in Quality" },
  clients: { icon: <ClientsIcon />, count: "newOutlets", waiting: "new outlets not live after 24 hours" },
  invoices: { icon: <InvoicesIcon />, count: "invoices", waiting: "overdue" },
  certificates: { icon: <CertificatesIcon /> },
  sales: { icon: <SalesIcon />, count: "sales", waiting: "things to do today" },
  finance: { icon: <FinanceIcon /> },
  team: { icon: <TeamIcon />, count: "team", waiting: "people to keep an eye on" },
  aiUsage: { icon: <AiUsageIcon />, count: "ai", waiting: "AI warnings" },
  usage: { icon: <UsageIcon /> },
  catalogue: { icon: <CatalogueIcon /> },
  plans: { icon: <PlansIcon /> },
  sops: { icon: <SopsIcon /> },
  logs: { icon: <LogsIcon /> },
};

/**
 * The console's sections, grouped by how ECCS works through a day and listed
 * in the order they are reached for: first what needs doing today, then the
 * clients and their paperwork, the business, and what is set up once and
 * changed rarely. The groups, entries and the grant each needs come from
 * CONSOLE_SECTIONS in packages/shared (the console plan's map, 20 Oct 2026),
 * which the Team page's access card reads too. A Supervisor or a BDE is shown
 * only the sections they can use. Today, the home page, stands first with no
 * heading (an empty label).
 */
const sectionItems = (group: (typeof CONSOLE_SECTIONS)[number]["group"]): NavItem[] =>
  CONSOLE_SECTIONS.filter((section) => section.group === group).map((section) => ({
    href: section.href,
    label: section.label,
    ...LOOKS[section.key],
    icon: LOOKS[section.key]?.icon ?? null,
    needs: (memberships: Memberships) => opensSection(memberships, section),
  }));

const GROUPS: readonly { label: string; items: readonly NavItem[] }[] = [
  { label: "", items: sectionItems(null) },
  {
    // A new team member's own joining page (16 Oct 2026), first while their onboarding is open.
    label: "You",
    items: [{ href: "/joining", label: "Joining ECCS", icon: <JoiningIcon />, count: "joining", waiting: "joining steps left", shown: (counts) => counts.joining !== null }],
  },
  ...CONSOLE_GROUPS.map((group) => ({ label: group, items: sectionItems(group) })),
];

// A badge has room for two digits; anything more is shown as "99+".
const MOST_SHOWN = 99;

/**
 * The list of sections, used both by the side menu on a wide window and by the
 * slide-in panel on a narrow one. With `collapsed` only the icons show; the
 * names stay in the page for screen readers and appear when the mouse rests on
 * an icon.
 */
function SectionList({ memberships, collapsed = false, onNavigate }: { memberships: Memberships; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { counts } = useNavCounts();
  const headingId = useId();

  return (
    <nav aria-label="Main menu" className="flex flex-col gap-5">
      {GROUPS.map((group, index) => {
        const items = group.items.filter((item) => (!item.needs || item.needs(memberships)) && (!item.shown || item.shown(counts)));
        if (items.length === 0) return null;
        return (
          <div key={group.label || "home"}>
            {/* Collapsed, the heading becomes a line between the groups; a screen reader still hears its name. */}
            {/* A label for the list below, not a heading of the page: the page's own headings start at its title. */}
            {group.label && (
              <p
                id={`${headingId}-${index}`}
                className={collapsed ? "sr-only" : "mb-1 px-3 text-xs font-semibold tracking-wide text-muted"}
              >
                {group.label}
              </p>
            )}
            {collapsed && index > 0 && <hr className="mx-3 mb-3 border-border" />}
            <ul aria-labelledby={group.label ? `${headingId}-${index}` : undefined} className="flex flex-col gap-0.5">
              {items.map((item) => {
                // "/visits" is current on "/visits?view=week" too, but "/sales" must not light up "/sales-something".
                const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const count = item.count ? counts[item.count] : null;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={current ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      // The current page is marked three ways, not by colour alone: a bar on its left edge, bold writing and a tint.
                      className={`relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm ${collapsed ? "justify-center" : ""} ${
                        current ? "bg-primary/10 font-bold text-primary" : "font-medium text-foreground hover:bg-background"
                      }`}
                    >
                      {current && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" />}
                      {item.icon}
                      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{item.label}</span>
                      {/* Nothing waiting shows no number at all, so a number always means there is something to do. */}
                      {count !== null && count > 0 && (
                        <span
                          className={`rounded-full bg-danger px-1.5 py-0.5 text-xs leading-none font-bold text-white ${collapsed ? "absolute top-0.5 right-1" : ""}`}
                        >
                          {count > MOST_SHOWN ? `${MOST_SHOWN}+` : count}
                          <span className="sr-only"> {item.waiting}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

// Whether the side menu is narrowed to icons is the person's choice and is remembered in this browser.
const COLLAPSED_KEY = "eccs.console.menu-collapsed";
const COLLAPSED_CHANGED = "eccs:menu-collapsed-changed";

function subscribeToCollapsed(onChange: () => void) {
  window.addEventListener(COLLAPSED_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(COLLAPSED_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "yes";
  } catch {
    // Storage switched off in the browser: the menu simply starts wide each time.
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(COLLAPSED_KEY, "yes");
    else localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // See `readCollapsed`.
  }
  window.dispatchEvent(new Event(COLLAPSED_CHANGED));
}

/**
 * The side menu on a wide window (1024px and up): always in view down the left
 * edge, under the top bar. It can be narrowed to icons to give a wide table
 * more room.
 */
export function SideMenu({ memberships }: { memberships: Memberships }) {
  const collapsed = useSyncExternalStore(subscribeToCollapsed, readCollapsed, () => false);

  return (
    <aside
      className={`sticky top-(--topbar) hidden h-[calc(100dvh-var(--topbar))] shrink-0 flex-col border-r border-border bg-surface motion-safe:transition-[width] lg:flex ${
        collapsed ? "w-[4.25rem]" : "w-60"
      }`}
    >
      <div className="flex-1 overflow-y-auto px-2 py-4">
        <SectionList memberships={memberships} collapsed={collapsed} />
      </div>
      <div className="border-t border-border p-2">
        <button
          type="button"
          // Says what pressing it will do; `aria-expanded` tells a screen reader which way the menu is now.
          aria-expanded={!collapsed}
          title={collapsed ? "Widen the menu" : undefined}
          onClick={() => writeCollapsed(!collapsed)}
          className={`flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-background hover:text-foreground ${collapsed ? "justify-center" : ""}`}
        >
          <CollapseIcon flipped={collapsed} />
          <span className={collapsed ? "sr-only" : ""}>{collapsed ? "Widen the menu" : "Narrow the menu"}</span>
        </button>
      </div>
    </aside>
  );
}

/**
 * The menu on a narrow window (a tablet held upright, a small browser window):
 * a button in the top bar that slides the same list in from the left, over the
 * page. It is a real dialog, so the keyboard stays inside it while it is open,
 * Escape closes it, and the keyboard returns to the button afterwards.
 */
export function MenuButton({ memberships }: { memberships: Memberships }) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = () => panelRef.current?.close();

  // Arriving on another page closes the panel, whichever way the person got there.
  useEffect(() => {
    panelRef.current?.close();
  }, [pathname]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Open the menu"
        onClick={() => panelRef.current?.showModal()}
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-foreground hover:bg-background"
      >
        <MenuIcon />
      </button>
      <dialog
        ref={panelRef}
        aria-labelledby={titleId}
        // A click on the dimmed page beside the panel lands on the dialog itself, not on anything inside it.
        onClick={(event) => event.target === event.currentTarget && close()}
        className="side-panel m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-border bg-surface p-0 text-foreground shadow-xl"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-(--topbar) shrink-0 items-center justify-between border-b border-border px-4">
            <h2 id={titleId} className="text-lg font-bold text-primary">
              ECCS Console
            </h2>
            <button
              type="button"
              aria-label="Close the menu"
              onClick={close}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-foreground hover:bg-background"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-4">
            <SectionList memberships={memberships} onNavigate={close} />
          </div>
        </div>
      </dialog>
    </div>
  );
}
