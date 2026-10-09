import { fingerprintDistance, PHOTO_INTEGRITY_RULES } from '@eccs/shared';
import { encode } from 'jpeg-js';
import { fingerprintPhoto } from './photo-fingerprint.js';

// Real JPEG files, made here by program: a made-up kitchen scene is drawn, saved as a JPEG and
// handed to the same function the upload uses. No picture files are kept in the repository.

/** A repeatable source of "random" numbers, so every run sees the same pictures. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

interface Scene {
  base: [number, number, number];
  shapes: { x: number; y: number; w: number; h: number; colour: [number, number, number] }[];
}

function scene(seed: number): Scene {
  const next = random(seed);
  const colour = (): [number, number, number] => [20 + next() * 220, 20 + next() * 220, 20 + next() * 220];
  return {
    base: colour(),
    shapes: Array.from({ length: 14 }, () => ({
      x: next() * 0.9,
      y: next() * 0.9,
      w: 0.08 + next() * 0.35,
      h: 0.08 + next() * 0.35,
      colour: colour(),
    })),
  };
}

/** Draws the scene and saves it as a JPEG. `shift` moves the camera sideways and down, as a share of the frame. */
function jpeg(picture: Scene, width: number, height: number, quality: number, shift = 0, noiseSeed = 0): Buffer {
  const next = random(noiseSeed + 1);
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width + shift;
      const v = y / height + shift * 0.7;
      let colour: [number, number, number] = [picture.base[0] + 30 * u, picture.base[1] - 20 * v, picture.base[2]];
      for (const shape of picture.shapes) {
        if (u >= shape.x && u < shape.x + shape.w && v >= shape.y && v < shape.y + shape.h) colour = shape.colour;
      }
      const grain = noiseSeed ? (next() - 0.5) * 14 : 0;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = Math.max(0, Math.min(255, Math.round(colour[channel]! + grain)));
      }
      data[offset + 3] = 255;
    }
  }
  return encode({ data, width, height }, quality).data;
}

const NEAR = PHOTO_INTEGRITY_RULES.duplicates.nearMaxCells;

describe('fingerprintPhoto', () => {
  it('gives the same two fingerprints for the same file, every time', () => {
    const file = jpeg(scene(1), 640, 480, 60);
    const first = fingerprintPhoto(file, 'image/jpeg');
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.perceptualHash).toMatch(/^[0-9a-f]{144}$/);
    expect(fingerprintPhoto(Buffer.from(file), 'image/jpeg')).toEqual(first);
  });

  it('recognises the same picture saved again smaller and more compressed: a different file, nearly the same look', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const original = fingerprintPhoto(jpeg(scene(seed), 1280, 960, 90), 'image/jpeg');
      const copy = fingerprintPhoto(jpeg(scene(seed), 640, 480, 35, 0, 5), 'image/jpeg');
      expect(copy.contentHash).not.toBe(original.contentHash);
      expect(fingerprintDistance(original.perceptualHash!, copy.perceptualHash!)).toBeLessThanOrEqual(NEAR);
    }
  });

  it('keeps different pictures far apart', () => {
    const hashes = [11, 12, 13, 14, 15, 16].map((seed) => fingerprintPhoto(jpeg(scene(seed), 640, 480, 60), 'image/jpeg').perceptualHash!);
    for (let a = 0; a < hashes.length; a += 1) {
      for (let b = a + 1; b < hashes.length; b += 1) expect(fingerprintDistance(hashes[a]!, hashes[b]!)).toBeGreaterThan(20);
    }
  });

  it('does not match the same scene photographed again with the camera moved a little', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const monday = fingerprintPhoto(jpeg(scene(seed), 640, 480, 60), 'image/jpeg').perceptualHash!;
      const tuesday = fingerprintPhoto(jpeg(scene(seed), 640, 480, 60, 0.07, 9), 'image/jpeg').perceptualHash!;
      expect(fingerprintDistance(monday, tuesday)).toBeGreaterThan(NEAR);
    }
  });

  it('gives a plain picture, a broken file and a non-JPEG no picture fingerprint, without failing', () => {
    const plain = jpeg({ base: [200, 200, 200], shapes: [] }, 320, 240, 60);
    expect(fingerprintPhoto(plain, 'image/jpeg').perceptualHash).toBeNull();
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('not really a picture')]);
    expect(fingerprintPhoto(broken, 'image/jpeg')).toEqual({ contentHash: expect.stringMatching(/^[0-9a-f]{64}$/), perceptualHash: null });
    expect(fingerprintPhoto(Buffer.from('png bytes'), 'image/png').perceptualHash).toBeNull();
  });
});
