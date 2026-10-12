import type { UploadFile } from '@eccs/api-client';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

// What the two face cameras have in common: the countdown camera in
// face-capture.tsx and the camera that follows the face in
// tracked-face-camera.tsx. Kept in a file of its own so neither has to import
// the other.

/** The photo is shrunk to this many pixels on its longer side: plenty for a face, and quick to send on a weak signal. */
export const LONG_SIDE = 720;
/** JPEG quality. At this size a photo comes to well under 200 KB; the server accepts up to 1.5 MB. */
export const JPEG_QUALITY = 0.7;
/** If the live camera has not started after this long, the next way of taking the photo is offered instead. */
export const START_TIMEOUT_MS = 8000;
// The camera screen's own colours, the same in light and dark mode: the bright
// surround lights the face in a dim kitchen.
export const SURROUND = 'rgba(255,255,255,0.9)';
export const INK = '#111111';

export interface FaceShot {
  /** The photo of the face, ready to hand to the API client. */
  photo: UploadFile;
  /** Clocking in only: a second photo with the head turned a little. Missing when the head turn was not seen, or the phone's own camera app had to be used. */
  turned?: UploadFile;
  /** Where the photo sits on the phone, for showing it on screen. */
  uri: string;
}

/** What one continuous "move your head in a circle" session gives back when adding a face. */
export interface FaceSweep {
  /** Three to five photos, the one looking straight at the camera first. */
  photos: UploadFile[];
  /** Where each photo sits on the phone, in the same order. */
  uris: string[];
}

export interface RawPhoto {
  uri: string;
  width: number;
  height: number;
}

/** Shrinks a photo and saves it as a JPEG, ready to send. */
export async function shrink(raw: RawPhoto): Promise<{ photo: UploadFile; uri: string }> {
  const context = ImageManipulator.manipulate(raw.uri);
  if (raw.width >= raw.height && raw.width > LONG_SIDE) context.resize({ width: LONG_SIDE });
  else if (raw.height > raw.width && raw.height > LONG_SIDE) context.resize({ height: LONG_SIDE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  // On a phone the photo is handed over as an Expo `File` (see lib/photo.ts for why).
  const photo: UploadFile =
    Platform.OS === 'web' ? await (await fetch(saved.uri)).blob() : (new File(saved.uri) as unknown as Blob);
  return { photo, uri: saved.uri };
}
