"use client";

import { useState } from "react";

import { Button, Card, HowItWorks, Switch } from "@/components/ui";
import { playSound, setSound, showDesktop, turnOffDesktop, turnOnDesktop, unlockSound, useAlertState } from "@/lib/desktop-alerts";

/**
 * Notifications on this PC: the switch for desktop notifications, the switch
 * for the sound, and a way to try each. The choices belong to this browser on
 * this computer, not to the person's login, because the browser's own
 * permission does too.
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
    unlockSound();
    const shown = showDesktop("Test notification", "This is how a new ECCS notification appears on this PC.", "eccs-test", () => undefined);
    if (state.sound) playSound();
    setTried(
      shown
        ? "Sent to this PC. If nothing appeared, Windows is holding it back: check Do not disturb and that notifications are allowed for your browser in Windows Settings (see “If nothing appears” below)."
        : "The browser would not show it.",
    );
  }

  function testSound() {
    // A click is what lets the browser make sound; the first click may only wake it, so it is tried again a moment later.
    unlockSound();
    if (playSound()) return setTried("Played. If you heard nothing, check the PC’s volume and that this browser tab is not muted.");
    window.setTimeout(() => {
      setTried(
        playSound()
          ? "Played. If you heard nothing, check the PC’s volume and that this browser tab is not muted."
          : "The browser would not play a sound. Check that sound is allowed for this site in the browser’s site settings.",
      );
    }, 300);
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
            ? { label: "On", good: true, text: "A pop-up appears on this PC for each new notification while the console is open in a tab, even in the background." }
            : { label: "Off", good: false, text: "New notifications show only inside the console: on the bell and in a message at the bottom of the page." };

  const canAsk = state.permission === "default" || (state.permission === "granted" && !state.wanted);

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Notifications on this PC</h2>
        <p className="text-sm text-muted">Get a pop-up and a sound for each new notification while the console is open in this browser.</p>
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

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border pt-4">
        <div>
          <Switch label="Sound for each new notification" checked={state.sound} onChange={setSound} />
          {state.sound && !state.soundReady && (
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Browsers keep a page silent until you have clicked or typed in it. After opening or reloading the console, click anywhere in it once
              and the sound will play from then on.
            </p>
          )}
        </div>
        <Button variant="secondary" onClick={testSound}>
          Play test sound
        </Button>
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
          <span className="font-semibold text-foreground">If nothing appears:</span> Windows decides whether a browser&apos;s notifications are
          shown. In Windows Settings, under System, Notifications: turn Notifications on, turn Do not disturb off, and make sure your browser
          (Chrome or Edge) is switched on in the list of apps. Some browsers put tabs that have not been used for a while to sleep to save memory;
          if notifications stop after a long quiet spell, add this site to the browser&apos;s list of sites that are always kept active.
        </p>
      </HowItWorks>
    </Card>
  );
}
