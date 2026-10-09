import { describe, expect, it } from "vitest";
import { MONITORING_RULES, photoLevel } from "./monitoring.js";
import { parseCoordinates, updateOutletSchema } from "./outlets.js";
import {
  assessPhoto,
  describePhotoFlag,
  duplicateFlag,
  fingerprintDistance,
  formatDistance,
  formatSpan,
  pictureFingerprint,
  locationFlags,
  metresBetween,
  PHOTO_INTEGRITY_RULES,
  readPhotoFlags,
  timeFlags,
  type EarlierPhoto,
  type PhotoPlace,
} from "./photo-integrity.js";

// ───────── Pictures made by program, so the tests need no files ─────────

/** A repeatable source of "random" numbers, so every run sees the same pictures. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

interface Scene {
  shapes: { x: number; y: number; w: number; h: number; shade: number }[];
  base: number;
}

/** A made-up kitchen: a wall with a slight gradient and a dozen blocks of different brightness (shelves, pans, a counter). */
function scene(seed: number): Scene {
  const next = random(seed);
  const shapes = Array.from({ length: 14 }, () => ({
    x: next() * 0.9,
    y: next() * 0.9,
    w: 0.08 + next() * 0.35,
    h: 0.08 + next() * 0.35,
    shade: 20 + next() * 220,
  }));
  return { shapes, base: 90 + next() * 80 };
}

/** Draws a scene in shades of grey. `shiftX`/`shiftY` move the camera (as a share of the frame); `gain` changes the light. */
function draw(
  picture: Scene,
  width: number,
  height: number,
  options: { shiftX?: number; shiftY?: number; gain?: number; noise?: number; seed?: number } = {},
): Uint8Array {
  const { shiftX = 0, shiftY = 0, gain = 1, noise = 0, seed = 1 } = options;
  const next = random(seed);
  const grey = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width + shiftX;
      const v = y / height + shiftY;
      let shade = picture.base + 30 * u - 20 * v;
      for (const shape of picture.shapes) {
        if (u >= shape.x && u < shape.x + shape.w && v >= shape.y && v < shape.y + shape.h) shade = shape.shade;
      }
      shade = shade * gain + (next() - 0.5) * noise;
      grey[y * width + x] = Math.max(0, Math.min(255, Math.round(shade)));
    }
  }
  return grey;
}

const hashOf = (picture: Scene, width = 640, height = 480, options = {}) =>
  pictureFingerprint(draw(picture, width, height, options), width, height)!;

const NEAR = PHOTO_INTEGRITY_RULES.duplicates.nearMaxCells;

/** A fingerprint written by hand: every cell at `base`, except the first `changed` cells, which are 40 brighter. */
const cells = (base: number, changed = 0) =>
  Array.from({ length: 72 }, (_, index) => (base + (index < changed ? 40 : 0)).toString(16).padStart(2, "0")).join("");

describe("pictureFingerprint", () => {
  it("gives 144 hex characters", () => {
    expect(hashOf(scene(1))).toMatch(/^[0-9a-f]{144}$/);
  });

  it("hardly moves when the same picture is shrunk or made grainier", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const picture = scene(seed);
      const original = hashOf(picture, 1280, 960);
      expect(fingerprintDistance(original, hashOf(picture, 640, 480))).toBeLessThanOrEqual(NEAR);
      expect(fingerprintDistance(original, hashOf(picture, 320, 240, { noise: 12, seed: 99 }))).toBeLessThanOrEqual(NEAR);
    }
  });

  it("puts different pictures far apart", () => {
    const hashes = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((seed) => hashOf(scene(seed)));
    for (let a = 0; a < hashes.length; a += 1) {
      for (let b = a + 1; b < hashes.length; b += 1) {
        expect(fingerprintDistance(hashes[a]!, hashes[b]!)).toBeGreaterThan(20);
      }
    }
  });

  it("does not match the same place in different light", () => {
    // Nothing moved, but the light is about a twelfth brighter: a new photo, not a copy.
    for (const seed of [1, 2, 3, 4]) {
      const picture = scene(seed);
      expect(fingerprintDistance(hashOf(picture), hashOf(picture, 640, 480, { gain: 1.08 }))).toBeGreaterThan(NEAR);
    }
  });

  it("does not match the same place photographed again from a slightly different spot", () => {
    // The honest case: the same clean counter on another day, hand-held, so the framing moves by a few percent.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const picture = scene(seed);
      const monday = hashOf(picture);
      // The same light, and the camera moved by a few percent of the frame: still a different photo.
      const tuesday = hashOf(picture, 640, 480, { shiftX: 0.07, shiftY: -0.05, noise: 8, seed: 7 });
      expect(fingerprintDistance(monday, tuesday)).toBeGreaterThan(NEAR);
      const wednesday = hashOf(picture, 640, 480, { shiftX: -0.03, shiftY: 0.03, noise: 8, seed: 8 });
      expect(fingerprintDistance(monday, wednesday)).toBeGreaterThan(NEAR);
    }
  });

  it("gives no fingerprint to a picture with almost no detail, or one too small", () => {
    const dark = new Uint8Array(200 * 200).fill(6);
    const wall = draw({ shapes: [], base: 200 }, 200, 200, { noise: 4 }).map((value) => Math.min(value, 205));
    expect(pictureFingerprint(dark, 200, 200)).toBeNull();
    expect(pictureFingerprint(wall, 200, 200)).toBeNull();
    expect(pictureFingerprint(new Uint8Array(16), 4, 4)).toBeNull();
  });
});

describe("fingerprintDistance", () => {
  it("counts the cells that clearly differ", () => {
    expect(fingerprintDistance(cells(100), cells(100))).toBe(0);
    expect(fingerprintDistance(cells(100), cells(100, 3))).toBe(3);
    expect(fingerprintDistance(cells(100), cells(180))).toBe(72);
  });

  it("ignores the small changes that saving a picture again makes", () => {
    const limit = PHOTO_INTEGRITY_RULES.duplicates.clearChange;
    expect(fingerprintDistance(cells(100), cells(100 + limit))).toBe(0);
    expect(fingerprintDistance(cells(100), cells(100 + limit + 1))).toBe(72);
  });

  it("refuses fingerprints it cannot compare", () => {
    expect(fingerprintDistance(cells(100), "00")).toBeNull();
    expect(fingerprintDistance("zz".repeat(72), cells(100))).toBeNull();
    expect(fingerprintDistance("", "")).toBeNull();
  });
});

describe("duplicateFlag", () => {
  const opening = { kind: "CHECKLIST" as const, name: { en: "Opening checklist" } };
  const earlier = (over: Partial<EarlierPhoto>): EarlierPhoto => ({
    contentHash: "file-a",
    perceptualHash: cells(30),
    subject: "item:fridge",
    day: "2026-10-03",
    what: opening,
    ...over,
  });
  const photo = { contentHash: "file-b", perceptualHash: cells(100), subject: "item:fridge", day: "2026-10-09" };

  it("finds nothing among different pictures", () => {
    expect(duplicateFlag(photo, [earlier({})])).toBeNull();
    expect(duplicateFlag(photo, [])).toBeNull();
  });

  it("is certain about the identical file, even for the same check on the same day", () => {
    const flag = duplicateFlag({ ...photo, contentHash: "file-a" }, [earlier({ day: "2026-10-09" })]);
    expect(flag).toEqual({ code: "SAME_FILE", certain: true, earlierOn: "2026-10-09", earlierWhat: opening });
  });

  it("flags a look-alike softly when it was for another day or another check", () => {
    const close = cells(100, 1); // one cell different
    expect(duplicateFlag(photo, [earlier({ perceptualHash: close })])).toEqual({
      code: "LOOKS_SAME",
      certain: false,
      earlierOn: "2026-10-03",
      earlierWhat: opening,
    });
    expect(duplicateFlag(photo, [earlier({ perceptualHash: close, subject: "item:floor", day: "2026-10-09" })])?.code).toBe("LOOKS_SAME");
  });

  it("does not flag a look-alike for the same check on the same day (a retake)", () => {
    expect(duplicateFlag(photo, [earlier({ perceptualHash: cells(100, 1), day: "2026-10-09" })])).toBeNull();
  });

  it("keeps to the limit: one cell over is not a look-alike", () => {
    expect(duplicateFlag(photo, [earlier({ perceptualHash: cells(100, NEAR) })])?.code).toBe("LOOKS_SAME");
    expect(duplicateFlag(photo, [earlier({ perceptualHash: cells(100, NEAR + 1) })])).toBeNull();
  });

  it("reports the closest look-alike, and never matches photos without a fingerprint", () => {
    const flag = duplicateFlag(photo, [
      earlier({ perceptualHash: cells(100, 2), day: "2026-10-05" }),
      earlier({ perceptualHash: cells(100), day: "2026-10-01" }),
    ]);
    expect(flag?.earlierOn).toBe("2026-10-01");
    expect(duplicateFlag({ ...photo, perceptualHash: null }, [earlier({ perceptualHash: null })])).toBeNull();
    expect(duplicateFlag({ ...photo, contentHash: null, perceptualHash: null }, [earlier({ contentHash: null })])).toBeNull();
  });
});

describe("location", () => {
  // Jubilee Hills check post, Hyderabad, and points measured from it.
  const outlet = { latitude: 17.4326, longitude: 78.4071 };
  const place = (over: Partial<PhotoPlace> = {}): PhotoPlace => ({ latitude: 17.4326, longitude: 78.4071, accuracy: 20, mocked: false, ...over });

  it("measures distance on the ground", () => {
    expect(metresBetween(17.4326, 78.4071, 17.4326, 78.4071)).toBe(0);
    // One thousandth of a degree of latitude is about 111 m.
    expect(metresBetween(17.4326, 78.4071, 17.4336, 78.4071)).toBeGreaterThan(105);
    expect(metresBetween(17.4326, 78.4071, 17.4336, 78.4071)).toBeLessThan(117);
  });

  it("does not flag a photo taken at the outlet, or a little way off as indoor positioning is", () => {
    expect(locationFlags(place(), outlet)).toEqual({ distanceMetres: 0, flags: [] });
    // About 220 m away: inside the allowance.
    expect(locationFlags(place({ latitude: 17.4346 }), outlet).flags).toEqual([]);
  });

  it("flags a photo far from the outlet, with the distance", () => {
    const result = locationFlags(place({ latitude: 17.4516 }), outlet); // about 2.1 km north
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({ code: "FAR_FROM_OUTLET", certain: false });
    expect(result.distanceMetres).toBeGreaterThan(2000);
    expect(describePhotoFlag(result.flags[0]!)).toBe("Taken 2.1 km from the outlet");
  });

  it("allows for the phone's own uncertainty, but not without limit", () => {
    const away = { latitude: 17.4416 }; // about 1 km
    expect(locationFlags(place({ ...away, accuracy: 1500 }), outlet).flags).toEqual([]);
    expect(locationFlags(place({ ...away, accuracy: 20 }), outlet).flags[0]?.code).toBe("FAR_FROM_OUTLET");
    // 30 km away with a made-up uncertainty of 1000 km is still far.
    expect(locationFlags(place({ latitude: 17.70, accuracy: 1_000_000 }), outlet).flags[0]?.code).toBe("FAR_FROM_OUTLET");
  });

  it("never flags missing information", () => {
    expect(locationFlags(null, outlet)).toEqual({ distanceMetres: null, flags: [] });
    expect(locationFlags(place(), null)).toEqual({ distanceMetres: null, flags: [] });
    expect(locationFlags(place({ latitude: 28.6 }), { latitude: null, longitude: null })).toEqual({ distanceMetres: null, flags: [] });
  });

  it("flags a location the phone reports as faked, wherever it is, and whether or not the outlet's is known", () => {
    expect(locationFlags(place({ mocked: true }), outlet).flags).toEqual([{ code: "MOCK_LOCATION", certain: true }]);
    expect(locationFlags(place({ mocked: true }), null).flags).toEqual([{ code: "MOCK_LOCATION", certain: true }]);
    expect(locationFlags(place({ mocked: null }), outlet).flags).toEqual([]);
  });
});

describe("time", () => {
  const received = new Date("2026-10-09T10:00:00.000Z");
  const dayStart = new Date("2026-10-08T18:30:00.000Z"); // 9 Oct, midnight in India
  const at = (iso: string) => new Date(iso);

  it("accepts a photo sent at once", () => {
    expect(timeFlags({ phoneCapturedAt: at("2026-10-09T09:59:58.000Z"), receivedAt: received, notBefore: dayStart })).toEqual({
      gapSeconds: 2,
      flags: [],
    });
  });

  it("accepts a photo sent hours later from the offline outbox, and keeps the gap", () => {
    const result = timeFlags({ phoneCapturedAt: at("2026-10-09T03:00:00.000Z"), receivedAt: received, notBefore: dayStart });
    expect(result).toEqual({ gapSeconds: 7 * 3600, flags: [] });
  });

  it("accepts a visit photo that waited days on the phone, as long as it was taken after the check-in", () => {
    const checkIn = at("2026-10-05T06:00:00.000Z");
    expect(timeFlags({ phoneCapturedAt: at("2026-10-05T06:20:00.000Z"), receivedAt: received, notBefore: checkIn }).flags).toEqual([]);
  });

  it("allows a phone clock a few minutes out either way", () => {
    expect(timeFlags({ phoneCapturedAt: at("2026-10-09T10:04:00.000Z"), receivedAt: received, notBefore: dayStart }).flags).toEqual([]);
    const justBefore = at("2026-10-08T18:20:00.000Z"); // ten minutes before the day began
    expect(timeFlags({ phoneCapturedAt: justBefore, receivedAt: received, notBefore: dayStart }).flags).toEqual([]);
  });

  it("flags a capture time in the future", () => {
    const result = timeFlags({ phoneCapturedAt: at("2026-10-09T13:00:00.000Z"), receivedAt: received, notBefore: dayStart });
    expect(result.flags).toEqual([{ code: "CLOCK_AHEAD", certain: false, minutes: 180 }]);
    expect(result.gapSeconds).toBe(-3 * 3600);
    expect(describePhotoFlag(result.flags[0]!)).toBe("Phone clock was 3 hours ahead");
  });

  it("flags a capture time from before the work began", () => {
    const result = timeFlags({ phoneCapturedAt: at("2026-10-06T10:00:00.000Z"), receivedAt: received, notBefore: dayStart });
    expect(result.flags[0]).toMatchObject({ code: "TAKEN_BEFORE", certain: false });
    expect(describePhotoFlag(result.flags[0]!)).toBe("Phone's time for the photo is 2 days before this work began");
  });

  it("flags nothing when the phone gave no time, or when the start of the work is not known", () => {
    expect(timeFlags({ phoneCapturedAt: null, receivedAt: received, notBefore: dayStart })).toEqual({ gapSeconds: null, flags: [] });
    expect(timeFlags({ phoneCapturedAt: at("2026-09-01T10:00:00.000Z"), receivedAt: received, notBefore: null }).flags).toEqual([]);
  });
});

describe("assessPhoto", () => {
  const base = {
    source: "CAMERA" as const,
    phoneCapturedAt: new Date("2026-10-09T09:59:00.000Z"),
    receivedAt: new Date("2026-10-09T10:00:00.000Z"),
    notBefore: new Date("2026-10-08T18:30:00.000Z"),
    place: null,
    outlet: { latitude: 17.4326, longitude: 78.4071 },
    fingerprint: { contentHash: "file-b", perceptualHash: null, subject: "item:fridge", day: "2026-10-09" },
    earlier: [],
  };

  it("finds nothing wrong with an ordinary photo, with or without a location", () => {
    expect(assessPhoto(base)).toEqual({ flags: [], distanceMetres: null, gapSeconds: 60 });
    const here = { latitude: 17.4327, longitude: 78.4071, accuracy: 15, mocked: false };
    expect(assessPhoto({ ...base, place: here }).flags).toEqual([]);
  });

  it("gathers every reason, in the order they are shown", () => {
    const result = assessPhoto({
      ...base,
      source: "FILE",
      phoneCapturedAt: new Date("2026-10-09T12:00:00.000Z"),
      place: { latitude: 17.4516, longitude: 78.4071, accuracy: 10, mocked: true },
      earlier: [{ contentHash: "file-b", perceptualHash: null, subject: "item:floor", day: "2026-10-03", what: { kind: "CHECKLIST", name: { en: "Opening checklist" } } }],
    });
    expect(result.flags.map((flag) => flag.code)).toEqual(["SAME_FILE", "MOCK_LOCATION", "FAR_FROM_OUTLET", "CLOCK_AHEAD", "NOT_CAMERA"]);
    expect(describePhotoFlag(result.flags[0]!)).toBe("Same photo as on 3 Oct, Opening checklist");
  });

  it("marks a photo picked from files, and says nothing when the sender did not say how it was made", () => {
    expect(assessPhoto({ ...base, source: "FILE" }).flags).toEqual([{ code: "NOT_CAMERA", certain: false }]);
    expect(assessPhoto({ ...base, source: null }).flags).toEqual([]);
  });
});

describe("words", () => {
  it("writes distances and spans of time the way a person would", () => {
    expect(formatDistance(448)).toBe("450 m");
    expect(formatDistance(2140)).toBe("2.1 km");
    expect(formatSpan(1)).toBe("1 minute");
    expect(formatSpan(20)).toBe("20 minutes");
    expect(formatSpan(180)).toBe("3 hours");
    expect(formatSpan(3 * 24 * 60)).toBe("3 days");
  });

  it("describes each kind of earlier photo", () => {
    const flag = { code: "LOOKS_SAME" as const, certain: false, earlierOn: "2026-10-03" };
    expect(describePhotoFlag({ ...flag, earlierWhat: { kind: "VISIT", name: { en: "Pest control" } } })).toBe(
      "Looks the same as a photo on 3 Oct, Pest control visit",
    );
    expect(describePhotoFlag({ ...flag, earlierWhat: { kind: "INSPECTION", name: null } })).toBe("Looks the same as a photo on 3 Oct, an inspection");
    expect(describePhotoFlag({ code: "MOCK_LOCATION", certain: true })).toBe("Location looks faked");
  });

  it("reads stored flags and drops anything else", () => {
    expect(readPhotoFlags(null)).toEqual([]);
    expect(readPhotoFlags([{ code: "MOCK_LOCATION", certain: true }, { code: "SOMETHING_ELSE" }, "text"])).toEqual([{ code: "MOCK_LOCATION", certain: true }]);
  });
});

describe("photoLevel", () => {
  const facts = (over: Partial<Parameters<typeof photoLevel>[0]>) => ({ checked: 40, doubtful: 0, certain: 0, fromChecklists: 0, ...over });

  it("has nothing to judge with no photos, and is fine with none doubtful", () => {
    expect(photoLevel(facts({ checked: 0 }))).toBe("NONE");
    expect(photoLevel(facts({}))).toBe("OK");
  });

  it("watches one or two soft doubts among many photos", () => {
    expect(photoLevel(facts({ doubtful: 1 }))).toBe("WATCH");
    expect(photoLevel(facts({ doubtful: 2 }))).toBe("WATCH");
  });

  it("needs attention for a certain one, for several, or for a large share", () => {
    expect(photoLevel(facts({ doubtful: 1, certain: 1 }))).toBe("ATTENTION");
    expect(photoLevel(facts({ doubtful: MONITORING_RULES.photos.attentionCount }))).toBe("ATTENTION");
    expect(photoLevel(facts({ checked: 12, doubtful: 2 }))).toBe("ATTENTION");
    // Too few photos for a share to mean anything: one soft doubt of two is only watched.
    expect(photoLevel(facts({ checked: 2, doubtful: 1 }))).toBe("WATCH");
  });
});

describe("an outlet's location", () => {
  it("reads coordinates typed plainly or pasted from a maps link", () => {
    expect(parseCoordinates("17.4326, 78.4071")).toEqual({ latitude: 17.4326, longitude: 78.4071 });
    expect(parseCoordinates("https://www.google.com/maps/@17.4326,78.4071,17z")).toEqual({ latitude: 17.4326, longitude: 78.4071 });
    expect(parseCoordinates("Road No. 36")).toBeNull();
    expect(parseCoordinates("95.0, 78.4")).toBeNull();
  });

  it("takes both numbers or neither", () => {
    expect(updateOutletSchema.safeParse({ latitude: 17.4, longitude: 78.4 }).success).toBe(true);
    expect(updateOutletSchema.safeParse({ latitude: null, longitude: null }).success).toBe(true);
    expect(updateOutletSchema.safeParse({ name: "Jubilee Hills" }).success).toBe(true);
    expect(updateOutletSchema.safeParse({ latitude: 17.4 }).success).toBe(false);
    expect(updateOutletSchema.safeParse({ latitude: 17.4, longitude: null }).success).toBe(false);
    expect(updateOutletSchema.safeParse({ latitude: 117.4, longitude: 78.4 }).success).toBe(false);
  });
});
