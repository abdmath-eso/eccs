"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useUnreadCount } from "@/lib/live-notifications";

import { BellIcon } from "./icons";

// A badge has room for two digits; anything more is shown as "99+".
const MOST_SHOWN = 99;

/**
 * The bell in the console's top bar, with the number of notifications not yet
 * read. It opens the notifications page. The number comes from
 * `LiveNotifications`, which hears of a new notification within a second or
 * two and of one marked read at once.
 */
export function NotificationBell() {
  const pathname = usePathname();
  const unread = useUnreadCount();
  const current = pathname.startsWith("/notifications");

  return (
    <Link
      href="/notifications"
      aria-current={current ? "page" : undefined}
      // The number is said in words; the badge itself is hidden from screen readers.
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      title="Notifications"
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${current ? "bg-primary/10 text-primary" : "text-muted hover:bg-background hover:text-foreground"}`}
    >
      <BellIcon />
      {/* Nothing unread shows no number at all, as with the counts in the menu. */}
      {unread > 0 && (
        <span aria-hidden="true" className="absolute -top-1 -right-1 rounded-full bg-danger px-1.5 py-0.5 text-xs leading-none font-bold text-white">
          {unread > MOST_SHOWN ? `${MOST_SHOWN}+` : unread}
        </span>
      )}
    </Link>
  );
}
