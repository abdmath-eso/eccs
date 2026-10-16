import { describe, expect, it } from "vitest";
import { boardMobile, cleanShopBoardAnswer, shopBoardAnswerSchema } from "./ai.js";
import {
  FREE_CHECK_FIX_LABELS,
  FREE_CHECK_FIXES,
  FREE_CHECK_INSPECTION_CHECKS,
  FREE_CHECK_POINT_LABELS,
  FREE_CHECK_POINTS,
  freeCheckCounts,
  freeCheckFindings,
  freeCheckPhotoIds,
  freeCheckSchema,
  freeCheckServices,
  freeCheckToFix,
  storedFreeCheck,
  type FreeCheckAnswer,
  type FreeCheckPoint,
} from "./free-check.js";

/** Every point answered OK, with some changed. */
const answers = (changes: Partial<Record<FreeCheckPoint, FreeCheckAnswer>> = {}) =>
  FREE_CHECK_POINTS.map((point) => ({ point, answer: changes[point] ?? ("OK" as FreeCheckAnswer) }));

// The ECCS services in the catalogue (the kinds' codes, as in the sample seed and new-services.ts).
const CATALOGUE = ["PEST", "DEEP_CLEAN", "CHIMNEY", "SAFETY_INSPECTION", "GREASE_TRAP", "CHEMICAL_REFILL", "FSS_TRAINING", "RATING_READINESS", "OIL_TEST", "WATER_TEST", "STAFF_MEDICAL"];
// The founder's 92 inspection checks, by code, section by section.
const INSPECTION = { 1: 8, 2: 10, 3: 10, 4: 13, 5: 10, 6: 7, 7: 10, 8: 8, 9: 8, 10: 8 } as const;
const inspectionCodes = new Set(Object.entries(INSPECTION).flatMap(([section, count]) => Array.from({ length: count }, (_, index) => `${section}.${index + 1}`)));

describe("the free-check points", () => {
  it("has ten points, each with English words, a fix and the inspection checks it stands for", () => {
    expect(FREE_CHECK_POINTS).toHaveLength(10);
    expect(inspectionCodes.size).toBe(92);
    for (const point of FREE_CHECK_POINTS) {
      expect(FREE_CHECK_POINT_LABELS[point].length).toBeGreaterThan(3);
      expect(FREE_CHECK_FIX_LABELS[point].length).toBeGreaterThan(3);
      const fix = FREE_CHECK_FIXES[point];
      if (fix.kind === "SERVICE") expect(CATALOGUE, point).toContain(fix.service);
      for (const code of FREE_CHECK_INSPECTION_CHECKS[point]) expect(inspectionCodes.has(code), `${point} ${code}`).toBe(true);
    }
    // Only the fire extinguisher and gas lie outside the 92 checks.
    expect(FREE_CHECK_POINTS.filter((point) => FREE_CHECK_INSPECTION_CHECKS[point].length === 0)).toEqual(["FIRE_GAS"]);
  });

  it("sends each point to the service that fixes it", () => {
    expect(FREE_CHECK_FIXES.HOOD).toEqual({ kind: "SERVICE", service: "CHIMNEY" });
    expect(FREE_CHECK_FIXES.DRAINS).toEqual({ kind: "SERVICE", service: "GREASE_TRAP" });
    expect(FREE_CHECK_FIXES.PESTS).toEqual({ kind: "SERVICE", service: "PEST" });
    expect(FREE_CHECK_FIXES.FIRE_GAS).toEqual({ kind: "SERVICE", service: "SAFETY_INSPECTION" });
    expect(FREE_CHECK_FIXES.STORAGE).toEqual({ kind: "APP", feature: "LABELS" });
  });
});

describe("a finished scorecard", () => {
  it("counts the things to fix, which Likely to close reads, and lists them in the points' order", () => {
    const card = answers({ STAFF: "FIX", HOOD: "FIX", PESTS: "UNSEEN", WASTE: "FIX" });
    expect(freeCheckCounts(card)).toEqual({ OK: 6, FIX: 3, UNSEEN: 1 });
    expect(freeCheckFindings(card)).toBe(3);
    expect(freeCheckToFix([...card].reverse()).map((entry) => entry.point)).toEqual(["HOOD", "WASTE", "STAFF"]);
    // Could not see is never a fault.
    expect(freeCheckFindings(answers({ PESTS: "UNSEEN", DRAINS: "UNSEEN" }))).toBe(0);
  });

  it("offers the services found, each once, and leaves out what the app fixes", () => {
    const card = answers({ HOOD: "FIX", HANDWASH: "FIX", WASTE: "FIX", FLOOR_WALLS: "FIX" });
    expect(freeCheckServices(card)).toEqual(["CHIMNEY", "DEEP_CLEAN"]);
    expect(freeCheckServices(answers())).toEqual([]);
  });

  it("accepts every point answered once, with photos on Needs fixing only", () => {
    const photo = "6f1b8c0e-6a4d-4a8e-9d43-0d7f0a8f2b11";
    const card = answers({ HOOD: "FIX" }).map((entry) => (entry.point === "HOOD" ? { ...entry, photoId: photo } : entry));
    expect(freeCheckSchema.safeParse({ answers: card }).success).toBe(true);
    expect(freeCheckPhotoIds(card)).toEqual([photo]);

    const short = freeCheckSchema.safeParse({ answers: card.slice(0, 7) });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toBe("Answer every point (3 left)");
    expect(freeCheckSchema.safeParse({ answers: [...card, { point: "HOOD", answer: "OK" }] }).success).toBe(false);
    const photoOnOk = card.map((entry) => (entry.point === "DRAINS" ? { ...entry, photoId: photo } : entry));
    expect(freeCheckSchema.safeParse({ answers: photoOnOk }).success).toBe(false);
    expect(freeCheckSchema.safeParse({ answers: answers().map((entry) => ({ ...entry, answer: "MAYBE" })) }).success).toBe(false);
  });

  it("reads a stored scorecard back in the points' order, and nothing that is not one", () => {
    expect(storedFreeCheck({ answers: [...answers({ STAFF: "FIX" })].reverse() })?.answers[0]?.point).toBe("HOOD");
    expect(storedFreeCheck(null)).toBeNull();
    expect(storedFreeCheck({ answers: [] })).toBeNull();
  });
});

describe("the shop board reader's answer", () => {
  const answer = (over: Partial<Parameters<typeof cleanShopBoardAnswer>[0]> = {}) =>
    shopBoardAnswerSchema.parse({ seen: "words", businessName: null, area: null, address: null, phones: [], ...over });

  it("reads Indian mobile numbers however the board writes them, and nothing else", () => {
    expect(boardMobile("98480 22338")).toBe("+919848022338");
    expect(boardMobile("+91-98480-22338")).toBe("+919848022338");
    expect(boardMobile("098480 22338")).toBe("+919848022338");
    expect(boardMobile("040-2345 6789")).toBeNull();
    expect(boardMobile("1800 123 4567")).toBeNull();
  });

  it("puts the first mobile in the phone field and keeps the other numbers as written", () => {
    const cleaned = cleanShopBoardAnswer(answer({ phones: ["040 2345 6789", "98480 22338", "+91 98480 22338", "70930 11223"] }));
    expect(cleaned.phone).toBe("+919848022338");
    expect(cleaned.otherPhones).toEqual(["040 2345 6789", "70930 11223"]);
    expect(cleanShopBoardAnswer(answer({ phones: ["Ph: 040-2345 6789"] }))).toMatchObject({ phone: null, otherPhones: ["Ph: 040-2345 6789"] });
    // "24 hours" is not a phone number.
    expect(cleanShopBoardAnswer(answer({ phones: ["24 hrs"] })).otherPhones).toEqual([]);
  });

  it("tidies the words, cuts them to what the form holds, and drops an area that only repeats the name", () => {
    const cleaned = cleanShopBoardAnswer(
      answer({ businessName: "  Sri   Venkateswara Tiffins ,", area: "Kukatpally", address: "Plot 12,  KPHB Colony, Kukatpally, Hyderabad - 500072", seen: "x" }),
    );
    expect(cleaned).toEqual({
      businessName: "Sri Venkateswara Tiffins",
      area: "Kukatpally",
      address: "Plot 12, KPHB Colony, Kukatpally, Hyderabad - 500072",
      phone: null,
      otherPhones: [],
    });
    expect(cleanShopBoardAnswer(answer({ businessName: "Gachibowli", area: "gachibowli" })).area).toBeNull();
    expect(cleanShopBoardAnswer(answer({ businessName: "x".repeat(150) })).businessName).toHaveLength(100);
    expect(cleanShopBoardAnswer(answer({ businessName: "   " })).businessName).toBeNull();
  });
});
