import type { ApiClient } from '@eccs/api-client';
import type { Translator } from '@eccs/i18n';
import { PUSH_CHANNELS, readPushData, type PushData } from '@eccs/shared';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { getItem, removeItem, setItem } from './storage';

// Push notifications on this phone: asking the phone's permission, getting the
// phone's "push token" (the address Expo's push service delivers to) and
// telling our server whose phone this is.
//
// Push only exists in the installed app on a real phone. In Expo Go and in the
// browser preview there is none, and this file then does nothing at all: it
// does not even load the notifications library, which complains inside Expo Go.

type NotificationsModule = typeof import('expo-notifications');

/**
 * False in the browser preview, in Expo Go and on an iPhone simulator: there this file
 * stays silent. An Android virtual phone with Google Play can receive push like a real
 * one, so it counts, which lets push be tried on the office PC.
 */
export const pushSupported = Platform.OS !== 'web' && !isRunningInExpoGo() && (Device.isDevice || Platform.OS === 'android');

let loading: Promise<NotificationsModule | null> | null = null;

/** The notifications library, or null where push is not available. Loaded only when it can be used. */
export function loadNotifications(): Promise<NotificationsModule | null> {
  if (!pushSupported) return Promise.resolve(null);
  loading ??= import('expo-notifications').catch(() => null);
  return loading;
}

// ───────────────────────── Where things stand ─────────────────────────

/**
 * - `checking`: not known yet.
 * - `unavailable`: this version of the app cannot receive push (Expo Go, the browser).
 * - `off`: the person has not allowed notifications; they can be asked.
 * - `blocked`: they refused, and the phone will not ask again; only the phone's settings can change it.
 * - `failed`: allowed, but the phone could not be registered (no internet, or the build lacks its Firebase file).
 * - `serverOff`: registered, but our server is not switched on to send push.
 * - `on`: registered and the server is sending.
 */
export type PushState = 'checking' | 'unavailable' | 'off' | 'blocked' | 'failed' | 'serverOff' | 'on';

let state: PushState = pushSupported ? 'checking' : 'unavailable';
const stateListeners = new Set<() => void>();

function setState(next: PushState): PushState {
  if (next !== state) {
    state = next;
    for (const listener of stateListeners) listener();
  }
  return next;
}

const subscribeToState = (listener: () => void) => {
  stateListeners.add(listener);
  return () => void stateListeners.delete(listener);
};

// Why the last attempt to register this phone failed, in the phone's or the server's own
// words (English, technical). Shown small under the "could not be set up" line, because
// without it nobody, including ECCS support, can tell a missing Firebase file from no signal.
let failure: string | null = null;
export const pushFailure = (): string | null => failure;

function failed(step: string, error?: unknown): PushState {
  const detail = error instanceof Error ? error.message : error === undefined ? '' : String(error);
  failure = (detail ? `${step}: ${detail}` : step).slice(0, 300);
  return setState('failed');
}

/** Whether push is on for this phone, kept up to date for any screen that shows it. */
export const usePushState = (): PushState => useSyncExternalStore(subscribeToState, () => state, () => state);

// ───────────────────────── Setting up ─────────────────────────

// Who is logged in on this phone now. A notification meant for someone else
// (the last person to use a shared phone) is not shown while the app is open.
let currentUserId: string | null = null;
export const setPushUser = (userId: string | null) => {
  currentUserId = userId;
};

/** True if this push was meant for the person logged in now (or carries no owner at all). */
export const isForCurrentUser = (data: PushData | null) => !data || data.userId === currentUserId;

let handlerSet = false;

/**
 * Makes the phone ready to show notifications: how one is shown while the app
 * is open, and (Android) the channels they arrive on. Android will not show
 * its permission question until a channel exists, so this runs before asking.
 * Safe to call again; calling it after a change of language renames the
 * channels in the phone's settings.
 */
export async function preparePush(t: Translator): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  if (!handlerSet) {
    handlerSet = true;
    // While the app is open a notification still drops down from the top, as it
    // does in other apps, and the bell's count is refreshed (see `onPushArrived`).
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const mine = isForCurrentUser(readPushData(notification.request.content.data));
        return { shouldShowBanner: mine, shouldShowList: mine, shouldPlaySound: mine, shouldSetBadge: false };
      },
    });
  }
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(PUSH_CHANNELS.updates, {
      name: t('push.channel.updates'),
      description: t('push.channel.updatesHelp'),
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(PUSH_CHANNELS.reminders, {
      name: t('push.channel.reminders'),
      description: t('push.channel.remindersHelp'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {
    // Without channels Android falls back to one of its own; nothing to tell the person.
  }
}

const TOKEN_KEY = 'eccs.pushToken';
const ASKED_KEY = 'eccs.pushAsked';

const OPENS_KEY = 'eccs.pushOpens';

/** Whether this phone has already been shown our own "turn on notifications?" question. */
export const wasPushAsked = async () => (await getItem(ASKED_KEY)) !== null;
export const rememberPushAsked = () => setItem(ASKED_KEY, '1');

/**
 * Counts one more time the app was opened or logged in to on this phone, and
 * returns the count. The question is not put to someone on their very first
 * visit, before they have seen what the app is for.
 */
export async function countPushOpen(): Promise<number> {
  const count = (Number(await getItem(OPENS_KEY)) || 0) + 1;
  await setItem(OPENS_KEY, String(count));
  return count;
}

// A screen can ask for our own "turn on notifications?" question to be shown
// (the Notifications screen does, the first time it is opened). `PushSetup` shows it.
const questionListeners = new Set<() => void>();
export function onPushQuestionWanted(listener: () => void): () => void {
  questionListeners.add(listener);
  return () => void questionListeners.delete(listener);
}
export function wantPushQuestion() {
  for (const listener of questionListeners) listener();
}

/**
 * Brings this phone and the server into step for the person logged in: if
 * notifications are allowed, gets the phone's push token and registers it as
 * theirs. With `ask`, the phone's own permission question is shown first if it
 * has not been answered. Never throws; returns where things stand.
 */
export async function syncPush(api: ApiClient, options: { ask?: boolean } = {}): Promise<PushState> {
  const Notifications = await loadNotifications();
  if (!Notifications) return setState('unavailable');
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && options.ask && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return setState(permission.canAskAgain ? 'off' : 'blocked');

    // The project id ties the token to this app's project at expo.dev. It is written
    // into the app's configuration by `eas init` (see docs/APK_BUILD.md).
    const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (typeof projectId !== 'string' || !projectId) return failed('No Expo project id in this build');
    let token: string;
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch (error) {
      return failed('Getting the push address', error);
    }
    let serverEnabled: boolean;
    try {
      ({ serverEnabled } = await api.push.register({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' }));
    } catch (error) {
      return failed('Telling the ECCS server', error);
    }
    await setItem(TOKEN_KEY, token);
    failure = null;
    return setState(serverEnabled ? 'on' : 'serverOff');
  } catch (error) {
    return failed('Checking permission', error);
  }
}

// Lock must never hang on a phone with no signal.
const UNREGISTER_WAIT_MS = 3000;

/**
 * Tells the server to stop sending this person's notifications to this phone.
 * Called on Lock and logout, before the login ends, so a shared phone only
 * ever shows notifications for whoever is logged in. Never throws, and gives
 * up after a few seconds without signal (the server then stops by itself,
 * because it sends nothing to a person who is not logged in anywhere).
 */
export async function unregisterPush(api: ApiClient): Promise<void> {
  try {
    const token = await getItem(TOKEN_KEY);
    if (!token) return;
    await removeItem(TOKEN_KEY);
    await Promise.race([
      api.push.unregister(token).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, UNREGISTER_WAIT_MS)),
    ]);
  } catch {
    // Storage could not be read: nothing more can be done from here.
  } finally {
    if (pushSupported) setState('checking');
  }
}

// ───────────────────────── A push arriving while the app is open ─────────────────────────

const arrivalListeners = new Set<() => void>();

/** Runs `listener` whenever a push arrives while the app is open, so counts and lists can refresh. */
export function onPushArrived(listener: () => void): () => void {
  arrivalListeners.add(listener);
  return () => void arrivalListeners.delete(listener);
}

export function announcePushArrived() {
  for (const listener of arrivalListeners) listener();
}
