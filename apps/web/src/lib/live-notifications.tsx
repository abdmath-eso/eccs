"use client";

import { ApiError } from "@eccs/api-client";
import { NOTIFICATIONS_NEWS_SIZE, type NotificationDto } from "@eccs/shared";
import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";

import { useToast } from "@/components/toast";

import { api } from "./api";
import { alertState, claim, playSound, showDesktop, unlockSound } from "./desktop-alerts";
import { useNavCounts } from "./nav-counts";
import { hrefFor } from "./notification-link";

/** Sent by the notifications page after it marks something read, so the bell's number follows at once. */
export const NOTIFICATIONS_CHANGED = "eccs:notifications-changed";
/** Sent when a notification has just arrived, so the notifications page adds it to its list. */
export const NOTIFICATION_ARRIVED = "eccs:notification-arrived";

/** The name the open console tabs use to pass on what the watching tab hears. */
const CHANNEL = "eccs-console-notifications";
/** Only the tab holding this lock keeps a request open to the server; the others hear from it. */
const WATCH_LOCK = "eccs-console-notifications-watch";
/** After a failure (server restarting, no network) the next try waits this long, then longer, up to the limit. */
const RETRY_FIRST_MS = 3_000;
const RETRY_LIMIT_MS = 60_000;
/** More than this many arriving together are announced as one "5 new notifications", not one by one. */
const ANNOUNCED_ONE_BY_ONE = 3;

interface News {
  /** Arrived since this tab last heard, newest first. */
  fresh: NotificationDto[];
  unreadCount: number;
}

const UnreadContext = createContext<number | null>(null);

/** The number of unread notifications, for the bell. */
export function useUnreadCount(): number {
  const value = use(UnreadContext);
  if (value === null) throw new Error("useUnreadCount must be used inside LiveNotifications");
  return value;
}

/** Resolves after `ms`, or at once when `signal` is set. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Asks the server "anything new?" over and over. Each request is held open by
 * the server until something arrives (see `GET /notifications/wait`), so a new
 * notification is heard within a second or two, and an answer arriving is not
 * a timer, so a background or minimised tab is not slowed down by the browser.
 * `seen` holds what this tab has already heard of; anything else is fresh.
 */
async function watch(seen: Set<string>, latest: { id: string | null }, signal: AbortSignal, onNews: (news: News) => void) {
  let retryIn = RETRY_FIRST_MS;
  while (!signal.aborted) {
    const asked = Date.now();
    try {
      const news = await api.notifications.wait(latest.id, signal);
      if (signal.aborted) return;
      const fresh = news.items.filter((item) => !seen.has(item.id));
      for (const item of fresh) seen.add(item.id);
      latest.id = news.latestId;
      onNews({ fresh, unreadCount: news.unreadCount });
      retryIn = RETRY_FIRST_MS;
      // A server that answers at once with nothing new must not be asked in a tight loop.
      if (fresh.length === 0 && Date.now() - asked < 1_000) await pause(1_000, signal);
    } catch (error) {
      if (signal.aborted) return;
      // Logged out or the session ended: the console goes to the login page by itself.
      if (error instanceof ApiError && error.status === 401) return;
      await pause(retryIn, signal);
      retryIn = Math.min(retryIn * 2, RETRY_LIMIT_MS);
    }
  }
}

/**
 * Keeps the console up to date with the logged-in person's notifications while
 * it is open: the number on the bell, a message at the bottom of the page, and,
 * if the person turned them on, a desktop notification and a sound.
 *
 * Only what arrives after the page opened is announced, never the backlog.
 * With several console tabs open, one of them watches the server and tells the
 * others, and each notification is shown on the desktop and sounded once.
 */
export function LiveNotifications({ children }: { children: ReactNode }) {
  const router = useRouter();
  const notify = useToast();
  const [unread, setUnread] = useState(0);

  // The watcher outlives renders; it reaches the newest router and toast through this.
  const { refresh: recountMenu } = useNavCounts();
  const tools = useRef({ router, notify, recountMenu });
  useEffect(() => {
    tools.current = { router, notify, recountMenu };
  }, [router, notify, recountMenu]);

  useEffect(() => {
    const stop = new AbortController();
    const seen = new Set<string>();
    const latest: { id: string | null } = { id: null };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);

    function open(item: NotificationDto | null) {
      tools.current.router.push((item && hrefFor(item.link)) ?? "/notifications");
      if (item && !item.readAt) {
        void api.notifications
          .markRead(item.id)
          .then(() => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED)))
          .catch(() => undefined);
      }
    }

    /** What every open tab does when it hears of new notifications. */
    function hear({ fresh, unreadCount }: News) {
      setUnread(unreadCount);
      // Read already (on the phone, say): nothing to announce.
      const unreadFresh = fresh.filter((item) => !item.readAt);
      if (unreadFresh.length === 0) return;
      window.dispatchEvent(new Event(NOTIFICATION_ARRIVED));
      // Something new usually means a number in the side menu has changed too (a request, an open issue).
      tools.current.recountMenu();

      const newest = unreadFresh[0]!;
      const together = unreadFresh.length > ANNOUNCED_ONE_BY_ONE;
      const summary = `${unreadFresh.length} new notifications`;

      // In the page: one message at the bottom, in every tab (a tab nobody is looking at loses nothing by it).
      if (together) tools.current.notify(summary, { kind: "news", href: "/notifications" });
      else tools.current.notify(newest.title, { kind: "news", detail: newest.body, href: hrefFor(newest.link) ?? "/notifications" });

      // On the desktop and through the speakers: one tab only.
      const state = alertState();
      if (state.desktopOn) {
        if (together) {
          void claim("desktop", newest.id).then((mine) => mine && showDesktop(summary, newest.title, "eccs-many", () => open(null)));
        } else {
          for (const item of [...unreadFresh].reverse()) {
            void claim("desktop", item.id).then((mine) => mine && showDesktop(item.title, item.body, item.id, () => open(item)));
          }
        }
      }
      // One sound for whatever arrived together. Only a tab the browser allows to make sound puts itself forward.
      if (state.sound && state.soundReady) void claim("sound", newest.id).then((mine) => mine && playSound());
    }

    if (channel) {
      // News from the tab that is watching. This tab remembers it too, in case it becomes the watcher later.
      channel.onmessage = (event: MessageEvent<News>) => {
        const fresh = event.data.fresh.filter((item) => !seen.has(item.id));
        for (const item of fresh) seen.add(item.id);
        if (event.data.fresh[0]) latest.id = event.data.fresh[0].id;
        hear({ fresh, unreadCount: event.data.unreadCount });
      };
    }

    /** What the watching tab does: acts on the news itself and passes it to the other tabs. */
    const pass = (news: News) => {
      channel?.postMessage(news);
      hear(news);
    };

    async function start() {
      // What is already there when the page opens is the backlog: counted on the bell, never announced.
      let retryIn = RETRY_FIRST_MS;
      while (!stop.signal.aborted) {
        try {
          const page = await api.notifications.list({ limit: NOTIFICATIONS_NEWS_SIZE });
          if (stop.signal.aborted) return;
          for (const item of page.items) seen.add(item.id);
          latest.id = page.items[0]?.id ?? null;
          setUnread(page.unreadCount);
          break;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) return;
          await pause(retryIn, stop.signal);
          retryIn = Math.min(retryIn * 2, RETRY_LIMIT_MS);
        }
      }
      if (stop.signal.aborted) return;
      // One tab watches at a time; when it is closed the browser hands the lock to the next. This keeps
      // the console to one held-open request however many tabs are open (a browser allows only six to one server).
      if (navigator.locks) {
        await navigator.locks.request(WATCH_LOCK, { signal: stop.signal }, () => watch(seen, latest, stop.signal, pass)).catch(() => undefined);
      } else {
        // An old browser: every tab watches for itself. Each notification is still announced once (see `claim`).
        await watch(seen, latest, stop.signal, hear);
      }
    }
    void start();

    // The notifications page marked something read in this tab: follow at once, without waiting for the server's answer.
    const recount = () =>
      void api.notifications
        .unreadCount()
        .then(({ unreadCount }) => !stop.signal.aborted && setUnread(unreadCount))
        // The bell keeps the number it had; the notifications page itself reports a failure.
        .catch(() => undefined);
    window.addEventListener(NOTIFICATIONS_CHANGED, recount);

    // Browsers keep a page silent until the person has clicked or typed in it. The first click or key
    // press anywhere in the console is used to allow the sound, so nobody has to press a special button after a reload.
    const allowSound = () => {
      if (alertState().sound) unlockSound();
      if (alertState().soundReady) {
        window.removeEventListener("pointerdown", allowSound, true);
        window.removeEventListener("keydown", allowSound, true);
      }
    };
    window.addEventListener("pointerdown", allowSound, true);
    window.addEventListener("keydown", allowSound, true);

    return () => {
      stop.abort();
      channel?.close();
      window.removeEventListener(NOTIFICATIONS_CHANGED, recount);
      window.removeEventListener("pointerdown", allowSound, true);
      window.removeEventListener("keydown", allowSound, true);
    };
  }, []);

  return <UnreadContext value={unread}>{children}</UnreadContext>;
}
