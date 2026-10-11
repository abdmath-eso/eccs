import { createHash } from 'node:crypto';
import type { DetectedFace, FaceAnalysis, FaceEngine } from './face-engine.js';
import { normalise, type Landmarks } from './face-math.js';

// A stand-in engine for the automated tests, so they need no model files and
// run in milliseconds. It recognises nobody real: a test "photo" is a file that
// begins like a JPEG and then carries a short note saying which made-up faces
// are in it, and the template is worked out from that note alone. The same
// made-up person always gives the same template.
//
// Selected with FACE_ENGINE=fake (the default under tests). env.ts refuses it in
// production.

/** One made-up face in a test photo. */
export interface FakeFace {
  /** Who it is: any text. The same text is the same person. */
  id: string;
  /** How alike this photo is to the person's "true" face, as a cosine: 1 (the default) is identical, 0.45 a poor likeness. */
  like?: number;
  /** How far the head is turned (see `headTurn`); 0 faces the camera. */
  turn?: number;
  /** The width of the face in pixels. Default 200. */
  size?: number;
  dark?: boolean;
  blurred?: boolean;
}

const MARKER = '\nFAKEFACE';
const DIMENSIONS = 128;

/** Builds a test photo: a JPEG's opening bytes, then the note. `salt` makes two otherwise equal photos different files. */
export function fakePhoto(faces: FakeFace[], salt = ''): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from(`${MARKER}${JSON.stringify({ faces, salt })}`)]);
}

/** A direction in template space that depends only on the text given: the same text, the same direction. */
function direction(seed: string): Float32Array {
  const values = new Float32Array(DIMENSIONS);
  for (let block = 0; block * 32 < DIMENSIONS; block += 1) {
    const bytes = createHash('sha256').update(`${seed}:${block}`).digest();
    for (let index = 0; index < 32 && block * 32 + index < DIMENSIONS; index += 1) values[block * 32 + index] = bytes[index]! / 127.5 - 1;
  }
  return normalise(values);
}

/** The template of a made-up face: the person's own direction, tilted away from it just far enough to be `like` alike. */
export function fakeTemplate(face: FakeFace): Float32Array {
  const base = direction(`person:${face.id}`);
  const like = Math.min(1, Math.max(-1, face.like ?? 1));
  if (like === 1) return base;
  // A second direction with the person's own taken out of it, so the result is exactly `like` alike.
  const other = direction(`away:${face.id}`);
  let along = 0;
  for (let index = 0; index < DIMENSIONS; index += 1) along += other[index]! * base[index]!;
  const away = normalise(other.map((value, index) => value - along * base[index]!));
  const lean = Math.sqrt(1 - like * like);
  return normalise(base.map((value, index) => like * value + lean * away[index]!));
}

export class FakeFaceEngine implements FaceEngine {
  readonly modelId = 'fake';
  readonly minSharpness = 15;
  readonly ready = true;
  readonly reason = null;

  analyse(photo: Buffer): Promise<FaceAnalysis> {
    const at = photo.indexOf(MARKER);
    let listed: FakeFace[] = [];
    if (at >= 0) {
      try {
        listed = (JSON.parse(photo.subarray(at + MARKER.length).toString('utf8')) as { faces: FakeFace[] }).faces;
      } catch {
        listed = [];
      }
    }
    const made = new Map<DetectedFace, FakeFace>();
    const faces = listed
      .map((fake, position) => {
        const size = fake.size ?? 200;
        const unit = size / 200;
        const left = 100 + position * 300;
        // Eyes, nose tip and mouth corners where a face of this size, turned this far, would have them.
        const landmarks: Landmarks = [
          [left + 70 * unit, 100 * unit],
          [left + 130 * unit, 100 * unit],
          [left + (100 + (fake.turn ?? 0) * 60) * unit, 135 * unit],
          [left + 78 * unit, 165 * unit],
          [left + 122 * unit, 165 * unit],
        ];
        const face: DetectedFace = {
          box: { x: left, y: 20 * unit, width: size, height: size * 1.25 },
          landmarks,
          score: 0.99,
          brightness: fake.dark ? 10 : 120,
          sharpness: fake.blurred ? 1 : 100,
        };
        made.set(face, fake);
        return face;
      })
      .sort((a, b) => b.box.width - a.box.width);
    return Promise.resolve({
      width: 1000,
      height: 1000,
      faces,
      embed: (face: DetectedFace) => Promise.resolve(fakeTemplate(made.get(face)!)),
    });
  }

  /** Test photos are not real pictures, so they are kept exactly as sent. */
  thumbnail(photo: Buffer) {
    return Promise.resolve({ buffer: photo, mimeType: 'image/jpeg', extension: 'jpg' });
  }
}
