import type { UploadFile } from '@eccs/api-client';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

// Where the offline pieces are kept on the phone: small JSON files (the
// outbox, the saved checklists) and the photos still waiting to be sent.
// On a phone they go in the app's own documents folder, which the system does
// not clear by itself (unlike the cache folder the camera saves into).
// The secure store used for the login is not suitable: it holds only very
// small values. The browser preview has no such folder and uses localStorage.

const isWeb = Platform.OS === 'web';
const WEB_PREFIX = 'eccs.offline.';

function folder(): Directory {
  const directory = new Directory(Paths.document, 'offline');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** Ids and names become part of a file name, so anything unusual is replaced. */
const safe = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_');

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    if (isWeb) {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(WEB_PREFIX + name);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    const directory = folder();
    // The ".new" copy is only there if the app was closed half-way through a save; see writeJson.
    for (const candidate of [`${safe(name)}.json`, `${safe(name)}.new`]) {
      const file = new File(directory, candidate);
      if (!file.exists) continue;
      try {
        return JSON.parse(await file.text()) as T;
      } catch {
        // Unreadable: try the other copy.
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Saves a value under a name. On a phone the new contents are written beside
 * the old file first and then swapped in, so being closed in the middle of a
 * save cannot leave a half-written file where the outbox used to be.
 */
export async function writeJson(name: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  if (isWeb) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(WEB_PREFIX + name, text);
    return;
  }
  const directory = folder();
  const file = new File(directory, `${safe(name)}.json`);
  const fresh = new File(directory, `${safe(name)}.new`);
  if (fresh.exists) fresh.delete();
  fresh.create();
  fresh.write(text);
  if (file.exists) file.delete();
  fresh.moveSync(file);
}

// ---- photos waiting to be sent ----

// Browser preview only: the photos chosen since the page was opened.
const webPhotos = new Map<string, { blob: Blob; uri: string }>();
const webKey = (id: string) => `${WEB_PREFIX}photo.${id}`;

const photoFile = (id: string) => new File(folder(), `photo-${safe(id)}.jpg`);

/**
 * Keeps a photo that was just taken until the server has it. `id` is the id
 * the photo will have on the server.
 */
export async function keepPhoto(id: string, photo: { uri: string; file: UploadFile }): Promise<void> {
  if (!isWeb) {
    const kept = photoFile(id);
    if (kept.exists) kept.delete();
    await new File(photo.uri).copy(kept);
    return;
  }
  webPhotos.set(id, { blob: photo.file, uri: photo.uri });
  // Also kept across a page reload where the browser has room for it; the preview is not relied on for this.
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(photo.file);
    });
    localStorage.setItem(webKey(id), dataUrl);
  } catch {
    // No room: the photo lasts until the page is closed.
  }
}

/** The address of a kept photo, for showing it on screen. Null if it is not on this phone. */
export function keptPhotoUri(id: string): string | null {
  try {
    if (!isWeb) return photoFile(id).uri;
    return webPhotos.get(id)?.uri ?? (typeof localStorage === 'undefined' ? null : localStorage.getItem(webKey(id)));
  } catch {
    return null;
  }
}

/** A kept photo in the form the upload takes. Null if it is no longer on this phone. */
export async function openKeptPhoto(id: string): Promise<UploadFile | null> {
  if (!isWeb) {
    const kept = photoFile(id);
    // See lib/photo.ts for why a phone hands over an Expo `File`.
    return kept.exists ? (kept as unknown as Blob) : null;
  }
  const inMemory = webPhotos.get(id);
  if (inMemory) return inMemory.blob;
  const dataUrl = typeof localStorage === 'undefined' ? null : localStorage.getItem(webKey(id));
  return dataUrl ? (await fetch(dataUrl)).blob() : null;
}

/** Removes a kept photo once the server has it, or it is no longer wanted. */
export function discardPhoto(id: string) {
  try {
    if (!isWeb) {
      const kept = photoFile(id);
      if (kept.exists) kept.delete();
      return;
    }
    webPhotos.delete(id);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(webKey(id));
  } catch {
    // Left behind; it is small and does no harm.
  }
}

/**
 * A new random id in the standard form (UUID version 4). The photo upload
 * takes an id chosen by the phone, so that sending the same photo twice
 * stores it once.
 */
export function newId(): string {
  const random = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof random?.randomUUID === 'function') return random.randomUUID();
  // Not every phone's JavaScript engine has randomUUID; this gives the same shape.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (slot) => {
    const value = Math.floor(Math.random() * 16);
    return (slot === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}
