import { describe, expect, it } from "vitest";
import { calculateScore, scoreBand, SCORE_WEIGHTS, topScoreFactors, type ScoreInput } from "./scores.js";

/** Three checklists today, all handed in on time, licences in order, a perfect inspection. */
const clean: ScoreInput = {
  checklists: { day: "TODAY", due: 3, onTime: 3, late: 0 },
  licences: { valid: 2, withoutCopy: 0, expired: 0, expiringSoon: 0, fssaiMissing: false },
  inspection: { score: 100, nonCompliant: 0 },
};
const withInput = (changes: Partial<ScoreInput>): ScoreInput => ({ ...clean, ...changes });
const today = (onTime: number, late: number, due = 3): ScoreInput["checklists"] => ({ day: "TODAY", due, onTime, late });
const part = (input: ScoreInput, key: string) => calculateScore(input).components.find((entry) => entry.key === key)!;

describe("the weights", () => {
  it("are 60 for the inspection, 10 for licences and 30 for checklists", () => {
    expect(SCORE_WEIGHTS).toEqual({ inspection: 60, licences: 10, checklists: 30 });
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("calculateScore", () => {
  it("gives 100 when the inspection is perfect, licences are in order and every checklist is on time", () => {
    const result = calculateScore(clean);
    expect(result).toMatchObject({ score: 100, band: "EXCELLENT", provisional: false, checklistsDay: "TODAY", earned: 100, possible: 100 });
    expect(result.components.map((entry) => [entry.key, entry.max, entry.earned])).toEqual([
      ["inspection", 60, 60],
      ["licences", 10, 10],
      ["checklists", 30, 30],
    ]);
  });

  it("takes the inspection's score as a share of 60", () => {
    const input = withInput({ inspection: { score: 90, nonCompliant: 4 } });
    expect(part(input, "inspection")).toEqual({
      key: "inspection",
      measured: true,
      max: 60,
      earned: 54,
      lost: 6,
      reasons: [{ code: "INSPECTION_NON_COMPLIANT", count: 4, lost: 6 }],
    });
    expect(calculateScore(input).score).toBe(94);
  });

  it("moves with the day's checklists: on time in full, late half, missed nothing", () => {
    const inspected = (checklists: ScoreInput["checklists"]) => calculateScore(withInput({ checklists, inspection: { score: 90, nonCompliant: 4 } }));
    // The founder's examples, with an inspection of 90 (54 points) and licences in order (10).
    expect(inspected(today(3, 0)).score).toBe(94);
    expect(inspected(today(2, 0)).score).toBe(84);
    expect(inspected(today(2, 1)).score).toBe(89);
    expect(inspected(today(0, 0)).score).toBe(64);
    // With a perfect inspection: two of three done is 90, and 85 if one of the two was late.
    expect(calculateScore(withInput({ checklists: today(2, 0) })).score).toBe(90);
    expect(calculateScore(withInput({ checklists: today(1, 1) })).score).toBe(85);
  });

  it("says how many checklists were missed or late and what that cost", () => {
    expect(part(withInput({ checklists: today(1, 1) }), "checklists")).toEqual({
      key: "checklists",
      measured: true,
      max: 30,
      earned: 15,
      lost: 15,
      reasons: [
        { code: "CHECKLISTS_MISSED", count: 1, total: 3, lost: 10 },
        { code: "CHECKLISTS_LATE", count: 1, total: 3, lost: 5 },
      ],
    });
    // Nothing lost, nothing to say.
    expect(part(clean, "checklists").reasons).toEqual([]);
  });

  it("names yesterday when yesterday's checklists are the ones counted", () => {
    const result = calculateScore(withInput({ checklists: { day: "YESTERDAY", due: 2, onTime: 0, late: 1 } }));
    expect(result.checklistsDay).toBe("YESTERDAY");
    expect(result.components[2]!.reasons.map((reason) => reason.code)).toEqual(["CHECKLISTS_MISSED_YESTERDAY", "CHECKLISTS_LATE_YESTERDAY"]);
  });

  it("scores an outlet not yet inspected on licences and checklists alone, and says it is provisional", () => {
    // Licences 10 of 10, checklists 2 of 3 on time (20 of 30): 30 of 40 = 75.
    const result = calculateScore(withInput({ inspection: null, checklists: today(2, 0) }));
    expect(result).toMatchObject({ score: 75, band: "FAIR", provisional: true, earned: 30, possible: 40 });
    expect(result.components[0]).toMatchObject({ key: "inspection", measured: false, earned: 0, reasons: [] });
  });

  it("leaves the checklists out when none has fallen due, and still scores an inspected outlet", () => {
    const result = calculateScore(withInput({ checklists: today(0, 0, 0), inspection: { score: 80, nonCompliant: 6 } }));
    expect(result.components[2]!.measured).toBe(false);
    expect(result.checklistsDay).toBeNull();
    // 48 of 60 and 10 of 10: 58 of 70 = 83.
    expect(result).toMatchObject({ score: 83, possible: 70, provisional: false });
  });

  it("gives no number on licences alone", () => {
    const result = calculateScore(withInput({ inspection: null, checklists: today(0, 0, 0) }));
    expect(result).toMatchObject({ score: null, band: null, provisional: false });
    // The licences are still worked out, so the screen can show what is known so far.
    expect(result.components[1]).toMatchObject({ measured: true, earned: 10 });
  });

  it("does not let a brand-new outlet with nothing recorded get a score", () => {
    const result = calculateScore({
      checklists: today(0, 0, 0),
      licences: { valid: 0, withoutCopy: 0, expired: 0, expiringSoon: 0, fssaiMissing: false },
      inspection: null,
    });
    expect(result.score).toBeNull();
    expect(result.possible).toBe(0);
    expect(result.components.every((entry) => !entry.measured && entry.earned === 0)).toBe(true);
  });

  it("marks licences: expired 0, no copy on file half, missing FSSAI as one licence at 0", () => {
    const licences = (changes: Partial<ScoreInput["licences"]>) => withInput({ licences: { ...clean.licences, ...changes } });
    expect(part(licences({ valid: 1, expired: 1 }), "licences")).toMatchObject({
      earned: 5,
      reasons: [{ code: "LICENCES_EXPIRED", count: 1, total: 2, lost: 5 }],
    });
    expect(part(licences({ valid: 1, withoutCopy: 1 }), "licences")).toMatchObject({
      earned: 7.5,
      reasons: [{ code: "LICENCE_COPIES_MISSING", count: 1, total: 2, lost: 2.5 }],
    });
    // Nothing recorded at all: the FSSAI licence every kitchen needs is missing.
    expect(part(licences({ valid: 0, fssaiMissing: true }), "licences")).toMatchObject({
      measured: true,
      earned: 0,
      reasons: [{ code: "FSSAI_MISSING", count: 1, lost: 10 }],
    });
    // Expiring soon is a warning, not a loss.
    expect(part(licences({ expiringSoon: 1 }), "licences")).toMatchObject({
      earned: 10,
      reasons: [{ code: "LICENCES_EXPIRING", count: 1, lost: 0 }],
    });
  });
});

describe("scoreBand", () => {
  it("uses the same cut-offs as the inspection grades", () => {
    expect([100, 88, 87, 80, 79, 68, 67, 0].map(scoreBand)).toEqual([
      "EXCELLENT",
      "EXCELLENT",
      "GOOD",
      "GOOD",
      "FAIR",
      "FAIR",
      "NEEDS_ATTENTION",
      "NEEDS_ATTENTION",
    ]);
  });
});

describe("topScoreFactors", () => {
  it("lists what costs the most first and skips notes that cost nothing", () => {
    const result = calculateScore(
      withInput({
        checklists: today(1, 1),
        licences: { valid: 1, withoutCopy: 0, expired: 1, expiringSoon: 1, fssaiMissing: false },
        inspection: { score: 70, nonCompliant: 8 },
      }),
    );
    expect(topScoreFactors(result.components).map((factor) => factor.reason.code)).toEqual(["INSPECTION_NON_COMPLIANT", "CHECKLISTS_MISSED"]);
    expect(topScoreFactors(result.components, 5).map((factor) => factor.reason.code)).toEqual([
      "INSPECTION_NON_COMPLIANT",
      "CHECKLISTS_MISSED",
      "LICENCES_EXPIRED",
      "CHECKLISTS_LATE",
    ]);
    expect(topScoreFactors(calculateScore(clean).components)).toEqual([]);
  });
});
