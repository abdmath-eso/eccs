import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as Ort from 'onnxruntime-node';
import type Sharp from 'sharp';
import { UnreadablePhotoError, type DetectedFace, type FaceAnalysis, type FaceEngine } from './face-engine.js';
import {
  ALIGNED_LANDMARKS,
  ALIGNED_SIZE,
  dropOverlapping,
  normalise,
  sharpness,
  similarityScale,
  similarityTransform,
  warpToAligned,
  type Box,
  type Landmarks,
  type Point,
} from './face-math.js';

// Face recognition that runs on this server, with no outside service.
//
// Two small models from the OpenCV model zoo, both free for commercial use:
//   YuNet (MIT)        finds the faces in a photo and five points on each
//                      (two eyes, nose tip, two mouth corners);
//   SFace (Apache-2.0) turns one lined-up face into a template of 128 numbers.
// They are run with ONNX Runtime; `sharp` opens, turns and resizes the photos.
//
// Deliberately NOT used, because their licences forbid commercial use:
// InsightFace's "buffalo" model packs, EdgeFace, and dlib's 68-point landmarks.
//
// The model files are not in git. `pnpm --filter @eccs/api face:models` fetches
// them into apps/api/models/; each is checked against the SHA-256 written in
// models/manifest.json before it is used. If a file is missing or does not
// match, the engine reports itself not ready and the face endpoints answer 503.

/** The folder the model files are in: apps/api/models, or wherever FACE_MODELS_DIR points. */
export const faceModelsDir = () => process.env.FACE_MODELS_DIR || resolve(import.meta.dirname, '../../../models');

interface ModelEntry {
  role: 'detector' | 'recogniser';
  name: string;
  file: string;
  sha256: string;
}

/** Photos larger than this on their longer side are shrunk before anything else; more adds time, not accuracy. */
const MAX_SIDE = 1280;
/** YuNet takes a 640 by 640 picture. The photo is fitted inside it and the rest left black. */
const DETECTOR_SIDE = 640;
const STRIDES = [8, 16, 32] as const;
/** How sure the detector must be before something counts as a face, and how much two boxes may overlap before they are the same face. */
const MIN_FACE_SCORE = 0.7;
const MAX_BOX_OVERLAP = 0.3;
/** Quality is only measured, and templates only made, for the largest few faces. */
const MAX_FACES = 4;

type SharpFactory = typeof Sharp;
type Session = Ort.InferenceSession;

interface PreparedFace extends DetectedFace {
  /** The face lined up for the recogniser: 112 by 112, red-green-blue bytes. */
  aligned: Uint8Array;
}

export class OnnxFaceEngine implements FaceEngine {
  readonly modelId = 'opencv-sface-2021dec';
  /**
   * Measured on the lined-up 112 by 112 face. Ordinary photos score in the
   * hundreds or thousands; this only turns away a face with almost no detail
   * left (heavy blur, a smeared lens). A starting figure, to be tuned on real
   * kitchen phones.
   */
  readonly minSharpness = 15;

  private ort: typeof Ort | null = null;
  private sharp: SharpFactory | null = null;
  private detector: Session | null = null;
  private recogniser: Session | null = null;
  private failure: string | null = 'The face models have not been loaded yet';
  /** The models are asked one photo at a time; requests wait their turn here. */
  private queue: Promise<unknown> = Promise.resolve();

  get ready() {
    return this.failure === null;
  }

  get reason() {
    return this.failure;
  }

  /** Loads the models. Never throws: on any failure the engine stays "not ready" and says why. */
  async load(): Promise<this> {
    try {
      const dir = faceModelsDir();
      const manifestPath = resolve(dir, 'manifest.json');
      if (!existsSync(manifestPath)) throw new Error(`No manifest.json in ${dir}`);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { models: ModelEntry[] };
      const paths = new Map<string, string>();
      for (const model of manifest.models) {
        const path = resolve(dir, model.file);
        if (!existsSync(path)) throw new Error(`Model file ${model.file} is missing. Run: pnpm --filter @eccs/api face:models`);
        // A changed or half-downloaded file would give wrong matches without any error, so it is refused here.
        const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
        if (hash !== model.sha256) throw new Error(`Model file ${model.file} does not match its recorded SHA-256`);
        paths.set(model.role, path);
      }
      const detectorPath = paths.get('detector');
      const recogniserPath = paths.get('recogniser');
      if (!detectorPath || !recogniserPath) throw new Error('manifest.json must list a detector and a recogniser');

      // Loaded here, not at the top of the file, so an API on a machine where
      // these native packages are not installed still starts.
      this.ort = await import('onnxruntime-node');
      this.sharp = (await import('sharp')).default;
      // Level 3 = errors only: SFace's file makes ONNX Runtime print hundreds of harmless warnings.
      const options: Ort.InferenceSession.SessionOptions = { logSeverityLevel: 3 };
      this.detector = await this.ort.InferenceSession.create(detectorPath, options);
      this.recogniser = await this.ort.InferenceSession.create(recogniserPath, options);
      this.failure = null;
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
    }
    return this;
  }

  async analyse(photo: Buffer): Promise<FaceAnalysis> {
    const sharp = this.sharp;
    if (!sharp || !this.ready) throw new Error(this.failure ?? 'The face engine is not ready');

    let rgb: Buffer;
    let width: number;
    let height: number;
    try {
      // rotate() with no angle turns the photo the way the phone held it (its EXIF note).
      const decoded = await sharp(photo, { failOn: 'error' })
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (decoded.info.channels !== 3) throw new Error('Unexpected channels');
      ({ data: rgb, info: { width, height } } = decoded);
    } catch {
      throw new UnreadablePhotoError();
    }

    return this.inTurn(async () => {
      // A face that fills the whole photo is larger than the detector likes; if
      // nothing is found at full size, look again at half and quarter size.
      let found: { box: Box; landmarks: Landmarks; score: number }[] = [];
      for (const shrink of [1, 0.5, 0.25]) {
        found = await this.detect(rgb, width, height, shrink);
        if (found.length > 0) break;
      }
      const largestFirst = found.sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height).slice(0, MAX_FACES);
      const faces: PreparedFace[] = [];
      for (const face of largestFirst) {
        const aligned = await this.align(rgb, width, height, face.landmarks);
        faces.push({ ...face, aligned, brightness: meanBrightness(aligned), sharpness: sharpness(toGrey(aligned), ALIGNED_SIZE, ALIGNED_SIZE) });
      }
      return {
        width,
        height,
        faces,
        embed: (face: DetectedFace) => this.inTurn(() => this.embed((face as PreparedFace).aligned)),
      };
    });
  }

  async thumbnail(photo: Buffer) {
    if (!this.sharp) throw new Error(this.failure ?? 'The face engine is not ready');
    // Re-encoding drops everything the phone wrote into the file (place, phone model): only the picture is kept.
    const buffer = await this.sharp(photo).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    return { buffer, mimeType: 'image/jpeg', extension: 'jpg' };
  }

  // ───────────────────────── Finding faces (YuNet) ─────────────────────────

  private async detect(rgb: Buffer, width: number, height: number, shrink: number) {
    const ort = this.ort!;
    const ratio = Math.min(DETECTOR_SIDE / width, DETECTOR_SIDE / height, 1) * shrink;
    const w = Math.max(1, Math.round(width * ratio));
    const h = Math.max(1, Math.round(height * ratio));
    const small =
      w === width && h === height
        ? rgb
        : await this.sharp!(rgb, { raw: { width, height, channels: 3 } }).resize(w, h, { fit: 'fill' }).raw().toBuffer();

    // The model wants blue, green, red as three separate planes of plain 0 to 255 numbers.
    const plane = DETECTOR_SIDE * DETECTOR_SIDE;
    const input = new Float32Array(3 * plane);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const from = (y * w + x) * 3;
        const to = y * DETECTOR_SIDE + x;
        input[to] = small[from + 2]!;
        input[plane + to] = small[from + 1]!;
        input[2 * plane + to] = small[from]!;
      }
    }
    const output = await this.detector!.run({ input: new ort.Tensor('float32', input, [1, 3, DETECTOR_SIDE, DETECTOR_SIDE]) });

    // The answer comes as three grids (cells of 8, 16 and 32 pixels). Each cell
    // says how sure it is that a face is centred on it, and where the face's box
    // and five points are relative to the cell. Same arithmetic as OpenCV's FaceDetectorYN.
    const found: { box: Box; landmarks: Landmarks; score: number }[] = [];
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    for (const stride of STRIDES) {
      const cols = DETECTOR_SIDE / stride;
      const cls = output[`cls_${stride}`]!.data as Float32Array;
      const obj = output[`obj_${stride}`]!.data as Float32Array;
      const bbox = output[`bbox_${stride}`]!.data as Float32Array;
      const kps = output[`kps_${stride}`]!.data as Float32Array;
      for (let cell = 0; cell < cls.length; cell += 1) {
        const score = Math.sqrt(clamp(cls[cell]!) * clamp(obj[cell]!));
        if (score < MIN_FACE_SCORE) continue;
        const col = cell % cols;
        const row = Math.floor(cell / cols);
        const centreX = (col + bbox[cell * 4]!) * stride;
        const centreY = (row + bbox[cell * 4 + 1]!) * stride;
        const boxWidth = Math.exp(bbox[cell * 4 + 2]!) * stride;
        const boxHeight = Math.exp(bbox[cell * 4 + 3]!) * stride;
        const point = (n: number): Point => [((kps[cell * 10 + 2 * n]! + col) * stride) / ratio, ((kps[cell * 10 + 2 * n + 1]! + row) * stride) / ratio];
        found.push({
          score,
          box: { x: (centreX - boxWidth / 2) / ratio, y: (centreY - boxHeight / 2) / ratio, width: boxWidth / ratio, height: boxHeight / ratio },
          landmarks: [point(0), point(1), point(2), point(3), point(4)],
        });
      }
    }
    return dropOverlapping(found, MAX_BOX_OVERLAP);
  }

  // ───────────────────────── Lining a face up ─────────────────────────

  private async align(rgb: Buffer, width: number, height: number, landmarks: Landmarks): Promise<Uint8Array> {
    const scale = similarityScale(similarityTransform(landmarks, ALIGNED_LANDMARKS));
    if (scale >= 0.7) return warpToAligned(rgb, width, height, similarityTransform(landmarks, ALIGNED_LANDMARKS));

    // The face is much bigger in the photo than the 112 pixels it will become.
    // Shrinking that far in one step with a simple blend loses detail, so the
    // area around the face is first shrunk properly (sharp averages the pixels)
    // and the lining-up is then done at about its final size.
    const xs = landmarks.map((point) => point[0]);
    const ys = landmarks.map((point) => point[1]);
    const reach = ALIGNED_SIZE / scale;
    const left = Math.max(0, Math.floor(Math.min(...xs) - reach));
    const top = Math.max(0, Math.floor(Math.min(...ys) - reach));
    const right = Math.min(width, Math.ceil(Math.max(...xs) + reach));
    const bottom = Math.min(height, Math.ceil(Math.max(...ys) + reach));
    const cropWidth = right - left;
    const cropHeight = bottom - top;
    const smallWidth = Math.max(1, Math.round(cropWidth * scale));
    const smallHeight = Math.max(1, Math.round(cropHeight * scale));
    const small = await this.sharp!(rgb, { raw: { width, height, channels: 3 } })
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize(smallWidth, smallHeight, { fit: 'fill' })
      .raw()
      .toBuffer();
    const moved = landmarks.map((point): Point => [((point[0] - left) * smallWidth) / cropWidth, ((point[1] - top) * smallHeight) / cropHeight]);
    return warpToAligned(small, smallWidth, smallHeight, similarityTransform(moved, ALIGNED_LANDMARKS));
  }

  // ───────────────────────── Making the template (SFace) ─────────────────────────

  private async embed(aligned: Uint8Array): Promise<Float32Array> {
    const ort = this.ort!;
    // Red, green, blue as three planes of plain 0 to 255 numbers, as OpenCV's FaceRecognizerSF feeds it.
    const plane = ALIGNED_SIZE * ALIGNED_SIZE;
    const input = new Float32Array(3 * plane);
    for (let at = 0; at < plane; at += 1) {
      input[at] = aligned[at * 3]!;
      input[plane + at] = aligned[at * 3 + 1]!;
      input[2 * plane + at] = aligned[at * 3 + 2]!;
    }
    const output = await this.recogniser!.run({ data: new ort.Tensor('float32', input, [1, 3, ALIGNED_SIZE, ALIGNED_SIZE]) });
    return normalise(Float32Array.from(output.fc1!.data as Float32Array));
  }

  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function toGrey(rgb: Uint8Array): Float32Array {
  const grey = new Float32Array(rgb.length / 3);
  for (let at = 0; at < grey.length; at += 1) grey[at] = 0.299 * rgb[at * 3]! + 0.587 * rgb[at * 3 + 1]! + 0.114 * rgb[at * 3 + 2]!;
  return grey;
}

function meanBrightness(rgb: Uint8Array): number {
  const grey = toGrey(rgb);
  let sum = 0;
  for (const value of grey) sum += value;
  return grey.length ? sum / grey.length : 0;
}
