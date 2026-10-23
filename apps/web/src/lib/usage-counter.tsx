"use client";

import { ApiError } from "@eccs/api-client";
import { USAGE_RULES, usageScreenFromPath, type UsageViewsInput } from "@eccs/shared";
import { useParams, usePathname } from "next/navigation";
import { useEffect } from "react";

import { api } from "./api";

// The console's part of the Usage page (23 Oct 2026): notes each page a logged-in person
// opens, by its pattern ("/team/[id]", never the id) and its tab, and sends the notes every
// half minute and when the window is hidden. What is kept is in packages/shared/src/usage.ts.

type View = UsageViewsInput["views"][number];

let waiting: View[] = [];
let sending = false;

async function send() {
  if (sending || waiting.length === 0) return;
  sending = true;
  const batch = waiting.slice(0, USAGE_RULES.maxBatch);
  try {
    await api.usage.record({ app: "CONSOLE", views: batch });
    waiting = waiting.slice(batch.length);
  } catch (error) {
    // Kept for the next try when the server could not be reached; a note it refused is dropped.
    const unreachable = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
    waiting = unreachable ? waiting.slice(-USAGE_RULES.maxWaiting) : waiting.slice(batch.length);
  } finally {
    sending = false;
  }
}

/** Counts the pages this person opens. Draws nothing. */
export function UsageCounter({ userId }: { userId: string }) {
  const pathname = usePathname();
  const params = useParams();
  const screen = usageScreenFromPath(pathname, params ?? {});

  // Another person's notes are never sent under this login.
  useEffect(() => {
    waiting = [];
    return () => {
      waiting = [];
    };
  }, [userId]);

  useEffect(() => {
    // The tab is read when the page opens; switching tabs on the page is not counted again.
    const tab = new URLSearchParams(window.location.search).get("tab");
    waiting.push({ screen: tab ? usageScreenFromPath(screen, {}, tab) : screen, at: new Date().toISOString() });
    if (waiting.length >= 10) void send();
  }, [screen]);

  useEffect(() => {
    const timer = window.setInterval(() => void send(), USAGE_RULES.sendEveryMs);
    const hidden = () => {
      if (document.visibilityState === "hidden") void send();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  return null;
}
