import { createHash } from 'node:crypto';
import { pictureFingerprint } from '@eccs/shared';
import { decode } from 'jpeg-js';

// Two fingerprints of an uploaded photo, worked out on the server so that no
// phone or modified app can skip them:
//  - of the file itself (SHA-256): the same file again gives the same value;
//  - of what the picture looks like (see pictureFingerprint in @eccs/shared): the
//    same picture saved again, shrunk or re-compressed gives nearly the same value.
//
// The picture is opened with `jpeg-js`, a small decoder written in plain
// JavaScript, so the API needs no compiled image library on the server. The
// app always sends JPEG. A PNG or WebP (only possible from outside the app)
// gets the file fingerprint only.

/** Photos from the app are at most 1280 px wide (about 1.2 megapixels). Anything far larger is not decoded. */
const MAX_MEGAPIXELS = 40;

export interface PhotoFingerprintValues {
  contentHash: string;
  perceptualHash: string | null;
}

/** Never throws: a picture that cannot be opened simply has no picture fingerprint. */
export function fingerprintPhoto(bytes: Buffer, mimeType: string): PhotoFingerprintValues {
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  if (mimeType !== 'image/jpeg') return { contentHash, perceptualHash: null };
  try {
    const image = decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: true,
      maxResolutionInMP: MAX_MEGAPIXELS,
      maxMemoryUsageInMB: 512,
    });
    return { contentHash, perceptualHash: pictureFingerprint(toGrey(image.data, image.width, image.height), image.width, image.height) };
  } catch {
    return { contentHash, perceptualHash: null };
  }
}

/** Red, green, blue and alpha per pixel to one brightness value per pixel (the usual weights for how bright each colour looks). */
export function toGrey(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const grey = new Uint8Array(width * height);
  for (let pixel = 0, offset = 0; pixel < grey.length; pixel += 1, offset += 4) {
    grey[pixel] = Math.round(0.299 * rgba[offset]! + 0.587 * rgba[offset + 1]! + 0.114 * rgba[offset + 2]!);
  }
  return grey;
}
