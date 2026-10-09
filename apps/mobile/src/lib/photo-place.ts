import type { PhotoPlace } from '@eccs/shared';
import { Platform } from 'react-native';

import { getItem, setItem } from './storage';

// Where the phone is when a proof photo is taken, so ECCS can see the photo
// was taken at the kitchen. This is light on purpose:
//   - the place is read only at the moment a proof photo is taken, never at
//     other times and never in the background;
//   - it is read only if the person has allowed it, and the app works exactly
//     the same if they have not: the photo is simply sent without a place;
//   - nothing here can fail or hold up a photo. No fix (indoors, location
//     switched off) just means no place.
//
// The browser preview has no use for this and it is skipped there. The
// location library is loaded only when first needed, and if this build of the
// app does not contain it (an APK made before it was added) that is treated
// the same as "not allowed".

type LocationModule = typeof import('expo-location');

const supported = Platform.OS !== 'web';
let loading: Promise<LocationModule | null> | null = null;

function loadLocation(): Promise<LocationModule | null> {
  if (!supported) return Promise.resolve(null);
  loading ??= import('expo-location').catch(() => null);
  return loading;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ───────────────────────── Asking ─────────────────────────

const ASKED_KEY = 'eccs.place.askedAt';
/** After "Not now" the question is not put again for this long. */
const ASK_AGAIN_AFTER_MS = 30 * 86_400_000;

/** Shows the app's own question and resolves with the answer. Set by the PlaceQuestion component while it is on screen. */
type Asker = () => Promise<boolean>;
let asker: Asker | null = null;

export function onPlaceQuestion(handler: Asker): () => void {
  asker = handler;
  return () => {
    if (asker === handler) asker = null;
  };
}

/**
 * Called just before the camera opens for a proof photo. The first time, it asks
 * in the app's own words whether the place may be added to proof photos, with the
 * reason; only on "Allow" does the phone's own permission box appear. Android's
 * and Apple's guidance both say to ask at the moment the feature is used, to
 * explain first, and to carry on normally after a refusal.
 * Never throws, and does nothing once the person has answered either way.
 */
export async function preparePlace(): Promise<void> {
  try {
    const Location = await loadLocation();
    if (!Location || !asker) return;
    const permission = await Location.getForegroundPermissionsAsync();
    // Already allowed, or refused in a way the phone will not ask about again: nothing to ask.
    if (permission.granted || !permission.canAskAgain) return;
    const askedAt = Number(await getItem(ASKED_KEY));
    if (askedAt && Date.now() - askedAt < ASK_AGAIN_AFTER_MS) return;

    const allow = await asker();
    await setItem(ASKED_KEY, String(Date.now()));
    if (allow) await Location.requestForegroundPermissionsAsync();
    // An iPhone will not open the camera while a pop-up is still closing.
    await wait(500);
  } catch {
    // The photo goes ahead without a place.
  }
}

// ───────────────────────── Reading ─────────────────────────

/** A fix this recent is as good as a new one for "which building is this phone in". */
const RECENT_MS = 2 * 60_000;
/** How long a photo may wait for a new fix after it is taken. Indoors there may be none; the photo is then sent without. */
const FIX_TIMEOUT_MS = 5000;

function toPlace(fix: import('expo-location').LocationObject): PhotoPlace {
  return {
    latitude: fix.coords.latitude,
    longitude: fix.coords.longitude,
    accuracy: typeof fix.coords.accuracy === 'number' ? fix.coords.accuracy : null,
    // Android says when the position came from a "mock location" app. An iPhone cannot tell.
    mocked: typeof fix.mocked === 'boolean' ? fix.mocked : null,
  };
}

/**
 * Starts the phone looking for its position, without waiting for the answer, so that
 * a fix is likely to be ready by the time the photo has been taken. Does nothing
 * unless the person has allowed location.
 */
export function warmUpPlace(): void {
  void (async () => {
    try {
      const Location = await loadLocation();
      if (!Location || !(await Location.getForegroundPermissionsAsync()).granted) return;
      await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch {
      // No fix: readPlace deals with it.
    }
  })();
}

/**
 * Where the phone is now, or null: not allowed, location switched off, no fix
 * within a few seconds, the browser preview, or a build without the location
 * library. Never throws.
 */
export async function readPlace(): Promise<PhotoPlace | null> {
  try {
    const Location = await loadLocation();
    if (!Location || !(await Location.getForegroundPermissionsAsync()).granted) return null;
    const recent = await Location.getLastKnownPositionAsync({ maxAge: RECENT_MS }).catch(() => null);
    if (recent) return toPlace(recent);
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
      wait(FIX_TIMEOUT_MS).then(() => null),
    ]);
    return fresh ? toPlace(fresh) : null;
  } catch {
    return null;
  }
}

/** Why a place could not be read when the person asked for it outright (saving the kitchen's location). */
export type PlaceFailure = 'unavailable' | 'denied' | 'noFix';

/**
 * Reads the place because the person pressed a button for it, asking the phone's
 * permission if it has not been given. Unlike readPlace, says why it failed.
 */
export async function requestPlace(): Promise<PhotoPlace | PlaceFailure> {
  try {
    const Location = await loadLocation();
    if (!Location) return 'unavailable';
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return 'denied';
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
      wait(15_000).then(() => null),
    ]);
    return fresh ? toPlace(fresh) : 'noFix';
  } catch {
    return 'noFix';
  }
}
