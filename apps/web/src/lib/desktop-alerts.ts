// Notifications on the PC: the browser's own desktop notification and a short
// sound, for a console left open in a tab. Nothing here knows about React; the
// part that watches for new notifications is `live-notifications.tsx`.
//
// What this can and cannot do: it works while the console is open in a tab,
// even a background or minimised one. With the browser closed nothing is
// shown; that needs "web push" (a service worker and a subscription kept on
// the server), which is not built.

import { useSyncExternalStore } from "react";

// The person's two choices, remembered in this browser. Desktop notifications
// are off until they turn them on; the sound is on until they turn it off.
const DESKTOP_KEY = "eccs.console.alerts.desktop";
const SOUND_KEY = "eccs.console.alerts.sound";
const DISMISSED_KEY = "eccs.console.alerts.offer-dismissed";
/** The few most recent notifications already announced, so several open tabs announce each one once. */
const DONE_KEY = "eccs.console.alerts.done";
const DONE_KEPT = 60;
/** How long the tab that announces a notification keeps the others from doing so. */
const CLAIM_HELD_MS = 10_000;
const CHANGED = "eccs:alert-settings-changed";

export type DesktopPermission =
  /** This browser cannot show desktop notifications at all. */
  | "unsupported"
  /** The page is not on https (or localhost), where browsers refuse them. */
  | "insecure"
  /** Not asked yet. */
  | "default"
  | "granted"
  /** Blocked in the browser's settings for this site; only the person can undo it there. */
  | "denied";

export interface AlertState {
  permission: DesktopPermission;
  /** The person turned desktop notifications on in the console. */
  wanted: boolean;
  /** Desktop notifications will actually appear: wanted, and allowed by the browser. */
  desktopOn: boolean;
  /** The person's choice for the sound. */
  sound: boolean;
  /** The browser lets this tab make sound, which it only does after a click or key press in the tab. */
  soundReady: boolean;
  /** The one-line offer at the top of the console was closed. */
  offerDismissed: boolean;
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage can be switched off in the browser; the choices then last for this visit only.
    return null;
  }
};

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // See `read`.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function desktopPermission(): DesktopPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  return Notification.permission;
}

// ───────────────────────── Sound ─────────────────────────

let audio: AudioContext | null = null;

/**
 * Lets this tab make sound. Browsers keep a page silent until the person has
 * clicked or pressed a key in it, so this must be called from inside such a
 * click or key press; calling it again does no harm.
 */
export function unlockSound() {
  try {
    if (!audio) {
      audio = new AudioContext();
      audio.addEventListener("statechange", () => window.dispatchEvent(new Event(CHANGED)));
    }
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  } catch {
    // No sound on this browser; desktop notifications still work.
  }
}

const soundReady = () => audio?.state === "running";

/**
 * Plays the notification sound: two soft rising notes, about half a second,
 * made here with the browser's sound generator, so there is no audio file to
 * ship or to license. Returns false if the browser would not let it play.
 */
export function playSound(): boolean {
  if (!audio || audio.state !== "running") return false;
  const start = audio.currentTime;
  const notes: [frequency: number, at: number][] = [
    [880, 0],
    [1174.66, 0.16],
  ];
  for (const [frequency, at] of notes) {
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    // A quick rise and a slow fade, so each note sounds like a chime and not a beep.
    volume.gain.setValueAtTime(0.0001, start + at);
    volume.gain.exponentialRampToValueAtTime(0.25, start + at + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.45);
    tone.connect(volume).connect(audio.destination);
    tone.start(start + at);
    tone.stop(start + at + 0.5);
  }
  return true;
}

// ───────────────────────── The person's choices ─────────────────────────

/**
 * The click on "Turn on desktop notifications". This is the only place the
 * browser's permission question is asked, so it always follows a click and the
 * console's own explanation. The same click lets the tab make sound.
 */
export async function turnOnDesktop(): Promise<DesktopPermission> {
  unlockSound();
  let permission = desktopPermission();
  if (permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      // Treated as not answered.
    }
    permission = desktopPermission();
  }
  // Remembered even if blocked, so they start by themselves once the person unblocks the site.
  if (permission !== "unsupported" && permission !== "insecure") write(DESKTOP_KEY, "on");
  else window.dispatchEvent(new Event(CHANGED));
  return permission;
}

export const turnOffDesktop = () => write(DESKTOP_KEY, null);

export function setSound(on: boolean) {
  if (on) unlockSound();
  write(SOUND_KEY, on ? null : "off");
}

export const dismissOffer = () => write(DISMISSED_KEY, "yes");

// ───────────────────────── Showing one ─────────────────────────

/**
 * Shows a desktop notification. `tag` names what it is about: the browser
 * keeps one notification per tag, which also stops two tabs showing the same
 * one twice. It is always silent as far as the browser goes, because the
 * console plays its own sound, which has its own switch.
 */
export function showDesktop(title: string, body: string, tag: string, onClick: () => void): boolean {
  if (desktopPermission() !== "granted") return false;
  try {
    const shown = new Notification(title, { body, tag, silent: true, icon: "/favicon.ico" });
    shown.addEventListener("click", () => {
      // Brings the console's window and tab to the front, then opens what the notification is about.
      window.focus();
      onClick();
      shown.close();
    });
    return true;
  } catch {
    // Some phone browsers only allow notifications from a service worker.
    return false;
  }
}

/**
 * True for exactly one of the open console tabs: the one that should announce
 * this notification in this way. The others get false and stay quiet.
 */
export async function claim(what: "desktop" | "sound", id: string): Promise<boolean> {
  const key = `${DONE_KEY}.${what}`;
  const take = () => {
    let done: string[] = [];
    try {
      done = JSON.parse(read(key) ?? "[]") as string[];
    } catch {
      // Unreadable: start again.
    }
    if (done.includes(id)) return false;
    try {
      localStorage.setItem(key, JSON.stringify([...done, id].slice(-DONE_KEPT)));
    } catch {
      // Without storage each tab stands alone; the notification's `tag` still keeps one on screen.
    }
    return true;
  };
  // Without locks (an old browser) the stored list is all there is, and two tabs could, rarely, both win.
  if (typeof navigator === "undefined" || !navigator.locks) return take();
  // The open tabs all hear of a notification within a moment of each other, and what one tab stores can take
  // a moment to reach the others, so the stored list alone is not enough. A lock named after the notification
  // is: the browser gives it to one tab only, which keeps it while the others ask and are turned away. The
  // stored list then covers a tab that hears of the same notification much later.
  return new Promise<boolean>((resolve) => {
    navigator.locks
      .request(`${key}.${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) return resolve(false);
        resolve(take());
        await new Promise((done) => setTimeout(done, CLAIM_HELD_MS));
      })
      .catch(() => resolve(false));
  });
}

// ───────────────────────── For the screens ─────────────────────────

const SERVER_STATE: AlertState = {
  permission: "unsupported",
  wanted: false,
  desktopOn: false,
  sound: true,
  soundReady: false,
  offerDismissed: true,
};

let cached = SERVER_STATE;

function currentState(): AlertState {
  const permission = desktopPermission();
  const wanted = read(DESKTOP_KEY) === "on";
  const next: AlertState = {
    permission,
    wanted,
    desktopOn: wanted && permission === "granted",
    sound: read(SOUND_KEY) !== "off",
    soundReady: soundReady(),
    offerDismissed: read(DISMISSED_KEY) === "yes",
  };
  // The same object is handed back while nothing has changed, as React requires.
  if ((Object.keys(next) as (keyof AlertState)[]).some((key) => next[key] !== cached[key])) cached = next;
  return cached;
}

function subscribe(onChange: () => void) {
  // This tab's changes, another tab's changes, and coming back to the tab after changing the browser's own setting.
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/** The state of desktop notifications and sound in this browser, kept up to date. */
export const useAlertState = (): AlertState => useSyncExternalStore(subscribe, currentState, () => SERVER_STATE);

/** For code outside React (the watcher), which reads the state at the moment something arrives. */
export const alertState = currentState;
