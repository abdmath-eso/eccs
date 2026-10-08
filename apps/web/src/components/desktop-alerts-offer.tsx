"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { dismissOffer, turnOnDesktop, useAlertState } from "@/lib/desktop-alerts";

import { Button } from "./ui";

/**
 * One line at the top of the console offering desktop notifications, shown
 * until the person turns them on or closes it. It is the console's own
 * explanation: the browser's permission question appears only after "Turn on"
 * is pressed, never by itself. Once answered either way it does not come
 * back; the full settings are on the Notifications page.
 */
export function DesktopAlertsOffer() {
  const pathname = usePathname();
  const state = useAlertState();

  // Nothing to offer if the browser cannot do it, it was already asked, or the person is on the page that has the full card.
  if (state.permission !== "default" || state.wanted || state.offerDismissed || pathname.startsWith("/notifications")) return null;

  return (
    <aside aria-label="Desktop notifications" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
      <p>
        <span className="font-semibold">Hear about new requests and issues straight away. </span>
        Turn on desktop notifications to get a pop-up on this PC, with a sound, while the console is open.{" "}
        <Link href="/notifications" className="font-semibold text-primary hover:underline">
          More about this
        </Link>
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void turnOnDesktop()}>
          Turn on desktop notifications
        </Button>
        <Button size="sm" variant="secondary" onClick={dismissOffer}>
          Not now
        </Button>
      </div>
    </aside>
  );
}
