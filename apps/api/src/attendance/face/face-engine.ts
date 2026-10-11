import type { Box, Landmarks } from './face-math.js';

// The one doorway to face recognition. Everything else in the attendance code
// talks to this interface and never to a model directly, so the engine can be
// replaced (a newer model, or a hosted service such as AWS Rekognition) without
// touching the rules about punches, consent or pay.

export interface DetectedFace {
  /** Where the face is in the photo, in the photo's own pixels as the engine read it. */
  box: Box;
  landmarks: Landmarks;
  /** How sure the detector is that this is a face, 0 to 1. */
  score: number;
  /** Average brightness of the face, 0 (black) to 255 (white). */
  brightness: number;
  /** How sharp the face is (see `sharpness` in face-math.ts); low means blurred. */
  sharpness: number;
}

export interface FaceAnalysis {
  /** The size of the photo as the engine read it (large photos are shrunk first). */
  width: number;
  height: number;
  /** Every face found, largest first. */
  faces: DetectedFace[];
  /**
   * Turns one of the faces above into its template: a list of numbers that is
   * alike for two photos of the same person. One unit long, ready for `cosine`.
   */
  embed(face: DetectedFace): Promise<Float32Array>;
}

export interface FaceEngine {
  /**
   * Names the model the templates come from. Stored with every template:
   * templates from different models cannot be compared, so a change of model
   * means everyone enrols again.
   */
  readonly modelId: string;
  /** Below this sharpness a face counts as blurred. Each engine knows its own scale. */
  readonly minSharpness: number;
  /** False when the engine cannot work (for example the model files are missing); `reason` then says why. */
  readonly ready: boolean;
  readonly reason: string | null;
  /** Finds the faces in a photo. Throws `UnreadablePhotoError` when the bytes are not a picture. */
  analyse(photo: Buffer): Promise<FaceAnalysis>;
  /** The small copy of a punch photo that is kept for the Owner to look at. */
  thumbnail(photo: Buffer): Promise<{ buffer: Buffer; mimeType: string; extension: string }>;
}

/** The photo could not be opened as a picture at all. */
export class UnreadablePhotoError extends Error {
  constructor() {
    super('That photo could not be read');
  }
}

/**
 * The engine when face recognition is switched off (FACE_ENGINE=off): never
 * ready, so every face endpoint answers "not available" and people clock in
 * through the assisted route.
 */
export class OffFaceEngine implements FaceEngine {
  readonly modelId = 'off';
  readonly minSharpness = 0;
  readonly ready = false;
  readonly reason = 'Face recognition is switched off on this server (FACE_ENGINE=off)';

  analyse(): Promise<FaceAnalysis> {
    return Promise.reject(new Error(this.reason));
  }

  thumbnail(): Promise<{ buffer: Buffer; mimeType: string; extension: string }> {
    return Promise.reject(new Error(this.reason));
  }
}

/** The token the engine is registered under in the Nest module. */
export const FACE_ENGINE = Symbol('FACE_ENGINE');
