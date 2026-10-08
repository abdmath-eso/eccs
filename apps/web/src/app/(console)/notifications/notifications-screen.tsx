"use client";

import type { NotificationDto } from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import { Button, EmptyState, ErrorMessage, LoadError, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { addDays, describe, today } from "@/lib/format";
import { NOTIFICATION_ARRIVED, NOTIFICATIONS_CHANGED } from "@/lib/live-notifications";
import { hrefFor } from "@/lib/notification-link";

import { DesktopAlertsCard } from "./desktop-alerts-card";
import { PushTest } from "./push-test";

const indiaDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));
const indiaTime = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const fullDay = (isoDate: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );

/**
 * The logged-in person's notifications, newest first and grouped by day. One
 * not yet read has a dot and bold writing. Opening one marks it read and goes
 * to the visit or issue it is about. The wording is the English the server
 * keeps with each notification.
 */
export default function NotificationsScreen() {
  const notify = useToast();
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<"older" | "all" | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.notifications
      .list()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setUnread(page.unreadCount);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // One that arrives while the page is open is added by loading the newest page again.
  useEffect(() => {
    const reload = () => setAttempt((current) => current + 1);
    window.addEventListener(NOTIFICATION_ARRIVED, reload);
    return () => window.removeEventListener(NOTIFICATION_ARRIVED, reload);
  }, []);

  const tellBell = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

  async function loadOlder() {
    if (!nextCursor) return;
    setBusy("older");
    try {
      const page = await api.notifications.list({ before: nextCursor });
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
      setUnread(page.unreadCount);
      setError(null);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function markAllRead() {
    setBusy("all");
    try {
      await api.notifications.markAllRead();
      const now = new Date().toISOString();
      setItems((current) => current?.map((item) => (item.readAt ? item : { ...item, readAt: now })) ?? null);
      setUnread(0);
      setError(null);
      tellBell();
      notify("All marked as read");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  function markRead(item: NotificationDto) {
    if (item.readAt) return;
    // Shown as read at once; if the request fails it is simply unread again next time.
    const now = new Date().toISOString();
    setItems((current) => current?.map((other) => (other.id === item.id ? { ...other, readAt: now } : other)) ?? null);
    setUnread((current) => Math.max(0, current - 1));
    void api.notifications
      .markRead(item.id)
      .then(tellBell)
      .catch(() => undefined);
  }

  const thisDay = today();
  const dayName = (day: string) => (day === thisDay ? "Today" : day === addDays(thisDay, -1) ? "Yesterday" : fullDay(day));

  // The list arrives newest first, so each day's notifications are already together.
  const days: { day: string; items: NotificationDto[] }[] = [];
  for (const item of items ?? []) {
    const day = indiaDay(item.createdAt);
    const last = days[days.length - 1];
    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Notifications"
        description={items === null ? "What has happened that you should know about, newest first." : unread > 0 ? `${unread} unread` : "Nothing unread"}
        secondary={
          <a href="#this-pc" className="rounded-md px-2 py-1.5 text-sm font-semibold text-primary hover:underline">
            Pop-ups and sound on this PC
          </a>
        }
        action={
          unread > 0 && (
            <Button variant="secondary" loading={busy === "all"} onClick={() => void markAllRead()}>
              Mark all as read
            </Button>
          )
        }
      />

      {/* Before anything has loaded the failure comes with "Try again"; after that it is about one action and sits alone. */}
      {items === null ? <LoadError message={error} onRetry={() => setAttempt((current) => current + 1)} /> : <ErrorMessage message={error} />}
      {items === null && !error && <Loading />}

      {items?.length === 0 && (
        <EmptyState title="No notifications yet">
          When a restaurant asks for a visit, signs one off, raises an issue or replies to one, it will appear here.
        </EmptyState>
      )}

      {days.map((group) => (
        <section key={group.day} aria-label={dayName(group.day)}>
          <h2 className="mb-2 text-sm font-semibold text-muted">{dayName(group.day)}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {group.items.map((item) => {
              const isUnread = !item.readAt;
              const href = hrefFor(item.link);
              const content = (
                <>
                  {/* Unread is marked by a dot and bold writing, not by colour alone. */}
                  <span className="mt-1.5 flex w-2.5 shrink-0 justify-center" aria-hidden="true">
                    {isUnread && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block ${isUnread ? "font-bold" : "font-medium"}`}>
                      {isUnread && <span className="sr-only">Unread: </span>}
                      {item.title}
                    </span>
                    <span className={`block text-sm ${isUnread ? "" : "text-muted"}`}>{item.body}</span>
                  </span>
                  <time dateTime={item.createdAt} className="shrink-0 text-sm whitespace-nowrap text-muted">
                    {indiaTime(item.createdAt)}
                  </time>
                </>
              );
              const rowStyle = "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-background";
              return (
                <li key={item.id}>
                  {href ? (
                    <Link href={href} onClick={() => markRead(item)} className={rowStyle}>
                      {content}
                    </Link>
                  ) : (
                    // Nothing to open in the console: clicking only marks it read.
                    <button type="button" onClick={() => markRead(item)} className={`${rowStyle} cursor-pointer`}>
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {nextCursor && (
        <div className="text-center">
          <Button variant="secondary" loading={busy === "older"} onClick={() => void loadOlder()}>
            Show older
          </Button>
        </div>
      )}

      {/* Settings come after the list, which is what the page is for; the link in the header jumps here. */}
      <div id="this-pc" className="scroll-mt-20">
        <DesktopAlertsCard />
      </div>

      {/* For ECCS admins: check that notifications reach phones. */}
      <PushTest />
    </div>
  );
}
