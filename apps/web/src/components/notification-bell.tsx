"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";

/** Sent by the notifications page after it marks something read, so the bell's number follows at once. */
export const NOTIFICATIONS_CHANGED = "eccs:notifications-changed";

// The console is left open on a desk all day, so the number is also refreshed by itself.
const REFRESH_EVERY_MS = 60_000;
// A badge has room for two digits; anything more is shown as "99+".
const MOST_SHOWN = 99;

/**
 * The bell in the console's header, with the number of notifications not yet
 * read. It opens the notifications page. The number is fetched when the
 * console opens, each time the person moves to another section, once a minute,
 * and whenever the notifications page says something changed.
 */
export function NotificationBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void api.notifications
        .unreadCount()
        .then(({ unreadCount }) => !cancelled && setUnread(unreadCount))
        // The bell keeps the number it had; the notifications page itself reports a failure.
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, REFRESH_EVERY_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
    };
  }, [pathname]);

  const current = pathname.startsWith("/notifications");

  return (
    <Link
      href="/notifications"
      aria-current={current ? "page" : undefined}
      // The number is said in words; the badge itself is hidden from screen readers.
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      title="Notifications"
      className={`relative flex h-10 w-10 items-center justify-center rounded-lg ${current ? "bg-primary/10 text-primary" : "text-muted hover:text-foreground"}`}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {/* Nothing unread shows no number at all, as with the counts in the menu. */}
      {unread > 0 && (
        <span aria-hidden="true" className="absolute -top-1 -right-1 rounded-full bg-danger px-1.5 py-0.5 text-xs leading-none font-bold text-white">
          {unread > MOST_SHOWN ? `${MOST_SHOWN}+` : unread}
        </span>
      )}
    </Link>
  );
}
