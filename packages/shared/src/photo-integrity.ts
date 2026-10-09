import type { LocalizedText } from "./checklists.js";

// Photo integrity: is a proof photo what it claims to be (taken now, at this
// kitchen, of this thing)? This file holds the rules, and every number they
// depend on, with no database or phone code in it, so they can be unit-tested.
//
// The principle (founder, 9 Oct 2026): a doubtful photo is MARKED for ECCS to
// look at. It is never refused, it never blocks a checklist or a visit, and it
// does not change the hygiene score. Missing information (no location, no
// phone time) is never held against anyone.

/**
 * Why a photo is doubtful.
 * SAME_FILE: the very same file was already used as proof at this outlet.
 * LOOKS_SAME: the picture is all but identical to an earlier proof photo used for another check or another day.
 * FAR_FROM_OUTLET: the phone said it was far from the outlet when the photo was taken.
 * MOCK_LOCATION: the phone itself reported that its location came from a "mock location" (fake GPS) app.
 * CLOCK_AHEAD: the phone's time for the photo is later than the moment our server received it.
 * TAKEN_BEFORE: the phone's time for the photo is before the work it belongs to began.
 * NOT_CAMERA: the photo was picked from files instead of taken with the app's camera (only possible in the browser preview).
 */
export const PHOTO_FLAG_CODES = [
  "SAME_FILE",
  "LOOKS_SAME",
  "FAR_FROM_OUTLET",
  "MOCK_LOCATION",
  "CLOCK_AHEAD",
  "TAKEN_BEFORE",
  "NOT_CAMERA",
] as const;
export type PhotoFlagCode = (typeof PHOTO_FLAG_CODES)[number];

/** Every threshold the photo checks use, in one place. Sample values chosen while building. */
export const PHOTO_INTEGRITY_RULES = {
  time: {
    /** A phone time later than our receipt time by more than this is a clock that is ahead. The same allowance the offline replay uses. */
    clockAheadMinutes: 5,
    /** A phone time earlier than the start of the work (the checklist's day, the check-in, the inspection) by more than this is flagged. */
    beforeToleranceMinutes: 15,
  },
  location: {
    /**
     * Further than this from the outlet, after allowing for the phone's own stated
     * uncertainty, is "far". Generous on purpose: indoors a phone is often placed by
     * Wi-Fi or mobile towers and can be a street or two out. Field-service apps use
     * about 200 m as their default check-in radius outdoors.
     */
    farMetres: 300,
    /** The most uncertainty a phone can claim for itself, so a made-up huge figure cannot excuse any distance. */
    maxAccuracyAllowanceMetres: 2000,
  },
  duplicates: {
    /**
     * A picture's fingerprint is its brightness in 72 cells (see pictureFingerprint). Two
     * pictures "look the same" when at most this many cells differ. Deliberately tight
     * (about 1 cell in 18): it is meant to catch the same picture saved again, shrunk or
     * re-compressed, which differs in none. Two honest hand-held photos of the same clean
     * counter on different days differ in many cells (the framing moves by a few percent
     * and the light is never quite the same), so they are not flagged. The usual guidance
     * for picture fingerprints is in the same proportion: up to 5 parts in 64 different
     * is the same picture, 6 to 10 may be a variation, more is a different picture.
     */
    nearMaxCells: 4,
    /** A cell counts as different when its brightness (0 to 255) differs by more than this. Saving a picture again moves a cell by about 1. */
    clearChange: 4,
    /** Earlier photos are compared this far back. */
    lookbackDays: 90,
    /**
     * A picture with almost no detail (a dark frame, a plain white wall) gives a
     * fingerprint that matches any other such picture, so it gets none and is only
     * ever matched as the identical file. Measured as the spread of brightness (0 to 255).
     */
    minContrast: 24,
  },
} as const;

/** What a proof photo was proof for. */
export const PHOTO_SUBJECT_KINDS = ["CHECKLIST", "VISIT", "INSPECTION"] as const;
export type PhotoSubjectKind = (typeof PHOTO_SUBJECT_KINDS)[number];

/** Enough to say "Opening checklist" or "Pest control visit" in a reason. Never includes what a checklist problem was. */
export interface PhotoSubjectDto {
  kind: PhotoSubjectKind;
  /** The checklist's title or the kind of service; `null` for an inspection. */
  name: LocalizedText | null;
}

/** One reason a photo is doubtful, with the figures needed to say it in words. */
export interface PhotoFlagDto {
  code: PhotoFlagCode;
  /**
   * True when there is no innocent explanation (the identical file again; a
   * location the phone itself says is faked). False for the softer signs that
   * deserve a look but can happen honestly.
   */
  certain: boolean;
  /** SAME_FILE, LOOKS_SAME: the day (YYYY-MM-DD) of the earlier photo, and what it was for. */
  earlierOn?: string;
  earlierWhat?: PhotoSubjectDto;
  /** FAR_FROM_OUTLET: metres from the outlet. */
  distanceMetres?: number;
  /** CLOCK_AHEAD: minutes the phone was ahead. TAKEN_BEFORE: minutes before the work began. */
  minutes?: number;
}

/** Where the phone was when a photo was taken, as the phone reported it. */
export interface PhotoPlace {
  latitude: number;
  longitude: number;
  /** The phone's own uncertainty, as a radius in metres; `null` when it did not say. */
  accuracy: number | null;
  /** True when the phone reported a mock (fake) location; `null` where the phone cannot tell (iPhone, browser). */
  mocked: boolean | null;
}

/** How the picture came to be: the app's camera, or a file picked in the browser preview. */
export const PHOTO_SOURCES = ["CAMERA", "FILE"] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

// ───────────────────────── Looking the same ─────────────────────────

const COLUMNS = 9;
const ROWS = 8;

/**
 * A fingerprint of what a picture looks like ("perceptual hash"), as 144 hex
 * characters. The picture, in shades of grey, is averaged down to 9 columns by
 * 8 rows, and the brightness of each of those 72 cells is kept. Shrinking or
 * re-compressing a picture hardly moves any cell; a different picture, or the
 * same scene photographed again, moves many. Two fingerprints are compared
 * with `fingerprintDistance` below.
 *
 * (The common "average hash" and "difference hash" start from the same tiny
 * grey picture but keep only one yes/no answer per cell. Tried here first, that
 * proved unsteady on plain areas such as a wall, where the answer flips from
 * re-compression alone; keeping the brightness itself avoids that.)
 *
 * `grey` holds one brightness value (0 to 255) per pixel, row by row.
 * Returns `null` for a picture too small or with too little detail to tell apart.
 */
export function pictureFingerprint(grey: ArrayLike<number>, width: number, height: number): string | null {
  const columns = COLUMNS;
  const rows = ROWS;
  if (width < columns || height < rows || grey.length < width * height) return null;

  const cells: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    const top = Math.floor((row * height) / rows);
    const bottom = Math.floor(((row + 1) * height) / rows);
    for (let column = 0; column < columns; column += 1) {
      const left = Math.floor((column * width) / columns);
      const right = Math.floor(((column + 1) * width) / columns);
      let sum = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) sum += grey[y * width + x]!;
      }
      cells.push(sum / ((bottom - top) * (right - left)));
    }
  }
  if (Math.max(...cells) - Math.min(...cells) < PHOTO_INTEGRITY_RULES.duplicates.minContrast) return null;

  return cells.map((cell) => Math.round(cell).toString(16).padStart(2, "0")).join("");
}

function readCells(fingerprint: string): number[] | null {
  if (fingerprint.length !== COLUMNS * ROWS * 2 || !/^[0-9a-f]+$/.test(fingerprint)) return null;
  const cells: number[] = [];
  for (let index = 0; index < fingerprint.length; index += 2) cells.push(Number.parseInt(fingerprint.slice(index, index + 2), 16));
  return cells;
}

/**
 * How different two pictures are: the number of the 72 cells whose brightness differs
 * clearly (by more than `clearChange`). 0 is the same picture; 72 is nothing in common.
 * `null` if either fingerprint cannot be read.
 */
export function fingerprintDistance(a: string, b: string): number | null {
  const first = readCells(a);
  const second = readCells(b);
  if (!first || !second) return null;
  let different = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (Math.abs(first[index]! - second[index]!) > PHOTO_INTEGRITY_RULES.duplicates.clearChange) different += 1;
  }
  return different;
}

/** A proof photo as the duplicate check sees it. */
export interface PhotoFingerprint {
  /** SHA-256 of the file. */
  contentHash: string | null;
  perceptualHash: string | null;
  /** What it is proof for, as a key: the same check, visit or finding gives the same key. */
  subject: string;
  /** The day (YYYY-MM-DD) of the work it belongs to. */
  day: string;
}

export interface EarlierPhoto extends PhotoFingerprint {
  what: PhotoSubjectDto;
}

/**
 * Has this picture been used as proof before at this outlet?
 *  - The identical file again is certain, whatever it was used for: a camera never produces the same file twice.
 *  - A picture that merely looks the same is a softer sign, and only counts when the earlier one was for a
 *    different check or a different day. (Two photos of one check on one day, such as a retake, are expected to be alike.)
 * At most one flag is returned: the identical file if there is one, otherwise the closest look-alike.
 * `earlier` should be newest first; of equal matches the first is reported.
 */
export function duplicateFlag(photo: PhotoFingerprint, earlier: readonly EarlierPhoto[]): PhotoFlagDto | null {
  const same = photo.contentHash ? earlier.find((other) => other.contentHash === photo.contentHash) : undefined;
  if (same) return { code: "SAME_FILE", certain: true, earlierOn: same.day, earlierWhat: same.what };

  if (!photo.perceptualHash) return null;
  let closest: { other: EarlierPhoto; bits: number } | null = null;
  for (const other of earlier) {
    if (!other.perceptualHash || (other.subject === photo.subject && other.day === photo.day)) continue;
    const bits = fingerprintDistance(photo.perceptualHash, other.perceptualHash);
    if (bits === null || bits > PHOTO_INTEGRITY_RULES.duplicates.nearMaxCells) continue;
    if (!closest || bits < closest.bits) closest = { other, bits };
  }
  return closest
    ? { code: "LOOKS_SAME", certain: false, earlierOn: closest.other.day, earlierWhat: closest.other.what }
    : null;
}

// ───────────────────────── Place ─────────────────────────

/** Distance between two points on the ground, in whole metres. */
export function metresBetween(latA: number, lonA: number, latB: number, lonB: number): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(radians(latB - latA) / 2) ** 2 +
    Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(radians(lonB - lonA) / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.asin(Math.sqrt(a)));
}

/**
 * Compares where the phone was with where the outlet is.
 * No place (permission refused, no fix indoors) or no outlet location is not a flag.
 * A place is "far" only beyond the allowance plus the phone's own stated uncertainty.
 */
export function locationFlags(
  place: PhotoPlace | null,
  outlet: { latitude: number | null; longitude: number | null } | null,
): { distanceMetres: number | null; flags: PhotoFlagDto[] } {
  if (!place) return { distanceMetres: null, flags: [] };
  const rules = PHOTO_INTEGRITY_RULES.location;
  const flags: PhotoFlagDto[] = [];
  if (place.mocked === true) flags.push({ code: "MOCK_LOCATION", certain: true });

  if (outlet?.latitude == null || outlet.longitude == null) return { distanceMetres: null, flags };
  const distanceMetres = metresBetween(place.latitude, place.longitude, outlet.latitude, outlet.longitude);
  const uncertainty = Math.min(Math.max(place.accuracy ?? 0, 0), rules.maxAccuracyAllowanceMetres);
  if (distanceMetres > rules.farMetres + uncertainty) {
    flags.push({ code: "FAR_FROM_OUTLET", certain: false, distanceMetres });
  }
  return { distanceMetres, flags };
}

// ───────────────────────── Time ─────────────────────────

/**
 * Compares the phone's time for the photo with what the server knows.
 * The server's receipt time is the reference. A photo sent hours or days later from
 * the offline outbox is legitimate, so "old" alone is never a flag. Flagged are:
 *  - a phone time in the future of our receipt (the clock is wrong, or was set forward);
 *  - a phone time before the work the photo belongs to had begun (`notBefore`: the start of the
 *    checklist's day, the visit's check-in, the inspection being planned), which no offline
 *    queue can explain.
 * `gapSeconds` is receipt minus phone time, kept with the photo whether or not anything is flagged.
 */
export function timeFlags(input: {
  phoneCapturedAt: Date | null;
  receivedAt: Date;
  notBefore: Date | null;
}): { gapSeconds: number | null; flags: PhotoFlagDto[] } {
  const { phoneCapturedAt, receivedAt, notBefore } = input;
  if (!phoneCapturedAt || Number.isNaN(phoneCapturedAt.getTime())) return { gapSeconds: null, flags: [] };
  const rules = PHOTO_INTEGRITY_RULES.time;
  const gapSeconds = Math.round((receivedAt.getTime() - phoneCapturedAt.getTime()) / 1000);
  const aheadMinutes = Math.round(-gapSeconds / 60);
  if (aheadMinutes > rules.clockAheadMinutes) {
    return { gapSeconds, flags: [{ code: "CLOCK_AHEAD", certain: false, minutes: aheadMinutes }] };
  }
  if (notBefore) {
    const earlyMinutes = Math.round((notBefore.getTime() - phoneCapturedAt.getTime()) / 60_000);
    if (earlyMinutes > rules.beforeToleranceMinutes) {
      return { gapSeconds, flags: [{ code: "TAKEN_BEFORE", certain: false, minutes: earlyMinutes }] };
    }
  }
  return { gapSeconds, flags: [] };
}

// ───────────────────────── All together ─────────────────────────

export interface PhotoAssessmentInput {
  source: PhotoSource | null;
  phoneCapturedAt: Date | null;
  /** When our server received the file. */
  receivedAt: Date;
  /** When the work the photo belongs to began; `null` when not known. */
  notBefore: Date | null;
  place: PhotoPlace | null;
  outlet: { latitude: number | null; longitude: number | null } | null;
  fingerprint: PhotoFingerprint;
  /** Earlier proof photos of the same outlet, newest first. */
  earlier: readonly EarlierPhoto[];
}

export interface PhotoAssessment {
  flags: PhotoFlagDto[];
  distanceMetres: number | null;
  gapSeconds: number | null;
}

/** Every check on one proof photo. The order of the flags is the order they are shown in. */
export function assessPhoto(input: PhotoAssessmentInput): PhotoAssessment {
  const flags: PhotoFlagDto[] = [];
  const duplicate = duplicateFlag(input.fingerprint, input.earlier);
  if (duplicate) flags.push(duplicate);
  const place = locationFlags(input.place, input.outlet);
  flags.push(...place.flags);
  const time = timeFlags(input);
  flags.push(...time.flags);
  if (input.source === "FILE") flags.push({ code: "NOT_CAMERA", certain: false });
  return { flags, distanceMetres: place.distanceMetres, gapSeconds: time.gapSeconds };
}

/** Reads the flags stored with a photo, ignoring anything that is not one. */
export function readPhotoFlags(stored: unknown): PhotoFlagDto[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (entry): entry is PhotoFlagDto =>
      typeof entry === "object" &&
      entry !== null &&
      PHOTO_FLAG_CODES.includes((entry as { code?: unknown }).code as PhotoFlagCode),
  );
}

// ───────────────────────── Saying it in words (English, for the console) ─────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Oct" from "2026-10-03". */
const shortDay = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ""}`.trim();

/** "450 m" or "2.1 km". */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** "20 minutes", "3 hours" or "2 days", rounded to what matters. */
export function formatSpan(minutes: number): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (minutes < 90) return plural(Math.max(1, Math.round(minutes)), "minute");
  if (minutes < 36 * 60) return plural(Math.round(minutes / 60), "hour");
  return plural(Math.round(minutes / (24 * 60)), "day");
}

function subjectWords(what: PhotoSubjectDto | undefined): string {
  if (!what) return "";
  const name = what.name?.en ?? (what.name ? Object.values(what.name)[0] : undefined);
  if (what.kind === "INSPECTION") return "an inspection";
  if (what.kind === "VISIT") return name ? `${name} visit` : "a visit";
  return name ?? "a checklist";
}

/**
 * One reason in plain English for ECCS staff, e.g. "Same photo as on 3 Oct, Opening checklist",
 * "Taken 2.1 km from the outlet", "Phone clock was 3 hours ahead", "Location looks faked".
 */
export function describePhotoFlag(flag: PhotoFlagDto): string {
  const earlier = [flag.earlierOn ? `on ${shortDay(flag.earlierOn)}` : "earlier", subjectWords(flag.earlierWhat)]
    .filter(Boolean)
    .join(", ");
  switch (flag.code) {
    case "SAME_FILE":
      return `Same photo as ${earlier}`;
    case "LOOKS_SAME":
      return `Looks the same as a photo ${earlier}`;
    case "FAR_FROM_OUTLET":
      return `Taken ${formatDistance(flag.distanceMetres ?? 0)} from the outlet`;
    case "MOCK_LOCATION":
      return "Location looks faked";
    case "CLOCK_AHEAD":
      return `Phone clock was ${formatSpan(flag.minutes ?? 0)} ahead`;
    case "TAKEN_BEFORE":
      return `Phone's time for the photo is ${formatSpan(flag.minutes ?? 0)} before this work began`;
    case "NOT_CAMERA":
      return "Picked from files, not taken with the app's camera";
  }
}
