// The arithmetic of face matching that needs no model: comparing two templates,
// lining a face up for the recognition model, and estimating how far a head is
// turned. Kept apart from the engine so it can be unit-tested with plain numbers.

export type Point = readonly [number, number];

/**
 * The five points the detector finds on a face, in this order: the eye on the
 * left of the picture, the eye on the right of the picture, the tip of the
 * nose, the mouth corner on the left of the picture, the mouth corner on the
 * right of the picture.
 */
export type Landmarks = readonly [Point, Point, Point, Point, Point];

/**
 * Where those five points must sit in the 112 by 112 picture the recognition
 * model expects. These are the standard positions the model was trained with
 * (the same table OpenCV's FaceRecognizerSF uses).
 */
export const ALIGNED_SIZE = 112;
export const ALIGNED_LANDMARKS: Landmarks = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** Makes a template one unit long, so that comparing two of them is a plain dot product. */
export function normalise(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum) || 1;
  return vector.map((value) => value / length);
}

/** How alike two templates are: 1 the same, 0 unrelated. Both must already be one unit long. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) dot += a[index]! * b[index]!;
  return dot;
}

/** A turn, a resize and a shift: x' = a·x − b·y + tx, y' = b·x + a·y + ty. */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/**
 * The turn, resize and shift that best moves the found points onto the target
 * points (least squares, no mirroring). This is what lines a tilted or
 * off-centre face up the way the recognition model expects; a mistake here
 * does not fail loudly, it just makes matching quietly worse, which is why it
 * has its own tests.
 */
export function similarityTransform(from: readonly Point[], to: readonly Point[]): Similarity {
  const count = Math.min(from.length, to.length);
  let fromX = 0;
  let fromY = 0;
  let toX = 0;
  let toY = 0;
  for (let index = 0; index < count; index += 1) {
    fromX += from[index]![0];
    fromY += from[index]![1];
    toX += to[index]![0];
    toY += to[index]![1];
  }
  fromX /= count;
  fromY /= count;
  toX /= count;
  toY /= count;

  let dot = 0;
  let cross = 0;
  let spread = 0;
  for (let index = 0; index < count; index += 1) {
    const px = from[index]![0] - fromX;
    const py = from[index]![1] - fromY;
    const qx = to[index]![0] - toX;
    const qy = to[index]![1] - toY;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    spread += px * px + py * py;
  }
  const a = spread ? dot / spread : 1;
  const b = spread ? cross / spread : 0;
  return { a, b, tx: toX - (a * fromX - b * fromY), ty: toY - (b * fromX + a * fromY) };
}

/** How much the transform resizes: 0.5 means the face is drawn at half its size in the photo. */
export const similarityScale = (transform: Similarity) => Math.hypot(transform.a, transform.b);

/**
 * Draws the lined-up face: for every dot of the 112 by 112 result, works out
 * where it comes from in the photo and blends the four dots around that place.
 * `rgb` is the photo as plain red, green, blue bytes, row by row.
 */
export function warpToAligned(rgb: Uint8Array, width: number, height: number, transform: Similarity): Uint8Array {
  const out = new Uint8Array(ALIGNED_SIZE * ALIGNED_SIZE * 3);
  const { a, b, tx, ty } = transform;
  const det = a * a + b * b || 1;
  for (let v = 0; v < ALIGNED_SIZE; v += 1) {
    for (let u = 0; u < ALIGNED_SIZE; u += 1) {
      // The transform run backwards: from the result's dot to the photo's.
      const dx = u - tx;
      const dy = v - ty;
      const x = (a * dx + b * dy) / det;
      const y = (-b * dx + a * dy) / det;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const target = (v * ALIGNED_SIZE + u) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0;
        // Outside the photo counts as black, as in OpenCV's warp.
        for (const [px, py, weight] of [
          [x0, y0, (1 - fx) * (1 - fy)],
          [x0 + 1, y0, fx * (1 - fy)],
          [x0, y0 + 1, (1 - fx) * fy],
          [x0 + 1, y0 + 1, fx * fy],
        ] as const) {
          if (px >= 0 && py >= 0 && px < width && py < height) value += rgb[(py * width + px) * 3 + channel]! * weight;
        }
        out[target + channel] = Math.round(value);
      }
    }
  }
  return out;
}

/**
 * How far the head is turned to one side, from the five points alone: how far
 * the nose tip sits from the middle of the eyes, measured along the line of the
 * eyes, as a share of the distance between the eyes. About 0 facing the camera;
 * roughly ±0.2 to ±0.5 for a clear turn. Positive and negative are the two
 * sides. A rough measure, good enough to tell "turned" from "did not move".
 */
export function headTurn(landmarks: Landmarks): number {
  const [leftEye, rightEye, nose] = landmarks;
  const axisX = rightEye[0] - leftEye[0];
  const axisY = rightEye[1] - leftEye[1];
  const eyeDistance = Math.hypot(axisX, axisY);
  if (!eyeDistance) return 0;
  const midX = (leftEye[0] + rightEye[0]) / 2;
  const midY = (leftEye[1] + rightEye[1]) / 2;
  return ((nose[0] - midX) * axisX + (nose[1] - midY) * axisY) / (eyeDistance * eyeDistance);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How much two boxes overlap: the shared area as a share of the area they cover together. */
export function overlap(a: Box, b: Box): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const shared = Math.max(0, right - left) * Math.max(0, bottom - top);
  const total = a.width * a.height + b.width * b.height - shared;
  return total > 0 ? shared / total : 0;
}

/**
 * The detector reports the same face several times over, in slightly different
 * boxes. This keeps the surest report of each face and drops the others that
 * overlap it.
 */
export function dropOverlapping<T extends { box: Box; score: number }>(found: readonly T[], maxOverlap: number): T[] {
  const kept: T[] = [];
  for (const candidate of [...found].sort((a, b) => b.score - a.score)) {
    if (kept.every((face) => overlap(face.box, candidate.box) <= maxOverlap)) kept.push(candidate);
  }
  return kept;
}

/**
 * How sharp a grey picture is: the spread of the differences between each dot
 * and its four neighbours (the "variance of the Laplacian"). A blurred picture
 * has soft edges and scores low.
 */
export function sharpness(grey: Uint8Array | Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumOfSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const value = grey[at - 1]! + grey[at + 1]! + grey[at - width]! + grey[at + width]! - 4 * grey[at]!;
      sum += value;
      sumOfSquares += value * value;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return sumOfSquares / count - mean * mean;
}
