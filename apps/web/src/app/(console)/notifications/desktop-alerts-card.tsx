"use client";

import { useState } from "react";

import { Button, Card, HowItWorks, Switch } from "@/components/ui";
import { setSound, showDesktop, turnOffDesktop, turnOnDesktop, useAlertState } from "@/lib/desktop-alerts";

/** Where Windows decides whether a browser's pop-ups appear and make a sound. */
const WINDOWS_SETTINGS =
  "In Windows Settings, under System, Notifications: turn Notifications on and Do not disturb off, then open your browser (Chrome or Edge) in the list of apps and turn on both its notifications and “Play a sound when a notification arrives”.";

/**
 * Notifications on this PC: the switch for desktop notifications, the switch
 * for their sound, and a test. The pop-up and its sound are Windows' own (20 Oct
 * 2026, the founder), so they come through the PC's speakers like any other app's,
 * with the browser in the background or minimised. The choices belong to this
 * browser on this computer, not to the person's login, because the browser's
 * own permission does too.
 */
export function DesktopAlertsCard() {
  const state = useAlertState();
  const [busy, setBusy] = useState(false);
  // What a test button found, said beside it.
  const [tried, setTried] = useState<string | null>(null);

  async function turnOn() {
    setBusy(true);
    setTried(null);
    const permission = await turnOnDesktop();
    setBusy(false);
    if (permission === "granted") {
      showDesktop("Desktop notifications are on", "New ECCS notifications will appear like this while the console is open.", "eccs-test", () => undefined);
    }
  }

  function testDesktop() {
    const shown = showDesktop("Test notification", "This is how a new ECCS notification appears on this PC.", "eccs-test", () => undefined);
    setTried(
      shown
        ? `Sent to Windows${state.sound ? ", with its notification sound" : ", without a sound"}. If nothing appeared or you heard nothing: ${WINDOWS_SETTINGS} Also check the PC’s volume.`
        : "The browser would not show it.",
    );
  }

  const status: { label: string; good: boolean; text: string } =
    state.permission === "unsupported"
      ? { label: "Not available", good: false, text: "This browser cannot show desktop notifications. Use a current version of Chrome, Edge or Firefox on the PC." }
      : state.permission === "insecure"
        ? {
            label: "Not available here",
            good: false,
            text: "Browsers only allow desktop notifications on a secure address (https, or localhost on this PC). The console is open on a plain http address.",
          }
        : state.permission === "denied"
          ? {
              label: "Blocked in the browser",
              good: false,
              text: "Notifications from this site are blocked in this browser, so the console cannot show any and cannot ask again. To unblock: click the icon at the left end of the address bar (a padlock or sliders), find Notifications, and choose Allow; then reload this page.",
            }
          : state.desktopOn
            ? {
                label: "On",
                good: true,
                text: "Windows shows a pop-up for each new notification while the console is open in a tab, even with the browser in the background or minimised.",
              }
            : { label: "Off", good: false, text: "New notifications show only inside the console: on the bell and in a message at the bottom of the page." };

  const canAsk = state.permission === "default" || (state.permission === "granted" && !state.wanted);

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Notifications on this PC</h2>
        <p className="text-sm text-muted">Get a Windows pop-up, with Windows&apos; notification sound, for each new notification while the console is open in this browser.</p>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {/* The state is written out; the tick or dash is only decoration beside the word. */}
        <p role="status" className="max-w-2xl text-sm">
          <span className="font-semibold">
            <span aria-hidden="true">{status.good ? "✓ " : "– "}</span>
            Desktop notifications: {status.label}.
          </span>{" "}
          {status.text}
        </p>
        <div className="flex flex-wrap gap-2">
          {canAsk && (
            <Button loading={busy} onClick={() => void turnOn()}>
              Turn on desktop notifications
            </Button>
          )}
          {state.desktopOn && (
            <>
              <Button variant="secondary" onClick={testDesktop}>
                Show a test notification
              </Button>
              <Button variant="secondary" onClick={turnOffDesktop}>
                Turn off
              </Button>
            </>
          )}
        </div>
      </div>
      {canAsk && state.permission === "default" && (
        <p className="text-sm text-muted">Your browser will then ask whether to allow notifications from this site. Choose Allow.</p>
      )}

      <div className="border-t border-border pt-4">
        <Switch label="Windows notification sound with each pop-up" checked={state.sound} onChange={setSound} />
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {state.desktopOn
            ? "The sound is Windows’ own and comes through the PC’s speakers, like any other app’s notification. “Show a test notification” tries both."
            : "The sound comes with Windows’ pop-up, so it needs desktop notifications on."}
        </p>
      </div>

      {tried && (
        <p role="status" className="rounded-lg border border-border px-3 py-2 text-sm">
          {tried}
        </p>
      )}

      <HowItWorks label="How this works, and its limits">
        <p>
          These settings belong to this browser on this PC. Each person turns them on once in the browser they use; another browser or another PC
          has to be set up separately.
        </p>
        <p>
          <span className="font-semibold text-foreground">The console must be open.</span> Keep it open in a tab; the tab can be in the background
          and the browser can be minimised. If the browser is closed, or the PC is asleep, nothing appears and nothing sounds. The notifications are
          not lost: they are on the bell the next time the console is opened, and on your phone if push is on there.
        </p>
        <p>
          With several console tabs open, each notification pops up and sounds once, not once per tab. Clicking a pop-up brings the console to the
          front and opens the visit or issue it is about.
        </p>
        <p>
          <span className="font-semibold text-foreground">If nothing appears, or there is no sound:</span> Windows decides whether a
          browser&apos;s pop-ups are shown and make a sound. {WINDOWS_SETTINGS} Some browsers put tabs that have not been used for a while to
          sleep to save memory; if notifications stop after a long quiet spell, add this site to the browser&apos;s list of sites that are always
          kept active.
        </p>
      </HowItWorks>
    </Card>
  );
}
