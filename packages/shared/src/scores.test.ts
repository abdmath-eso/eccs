import { describe, expect, it } from "vitest";
import { calculateScore, scoreBand, SCORE_WEIGHTS, topScoreFactors, type ScoreInput } from "./scores.js";

/** A week of two checklists a day, all handed in on time, licences in order, nothing else recorded. */
const clean: ScoreInput = {
  checklists: { due: 14, submitted: 14 },
  onTime: { submitted: 14, onTime: 14 },
  problems: { answered: 70, open: [] },
  services: { signedOff: 0, notSignedOff: 0, awaitingSignOff: 0, missedByEccs: 0 },
  licences: { valid: 2, withoutCopy: 0, expired: 0, expiringSoon: 0, fssaiMissing: false },
  inspection: null,
};
const withInput = (changes: Partial<ScoreInput>): ScoreInput => ({ ...clean, ...changes });
const part = (input: ScoreInput, key: string) => calculateScore(input).components.find((entry) => entry.key === key)!;

describe("the weights", () => {
  it("are the proposal's five, adding up to 100, plus the inspection as one fifth of the whole", () => {
    const { inspection, ...five } = SCORE_WEIGHTS;
    expect(Object.values(five).reduce((a, b) => a + b, 0)).toBe(100);
    expect(inspection / (100 + inspection)).toBe(0.2);
  });
});

describe("calculateScore", () => {
  it("gives 100 when everything measured is in order, and leaves out what is not measured", () => {
    const result = calculateScore(clean);
    expect(result.score).toBe(100);
    expect(result.band).toBe("EXCELLENT");
    // No visits and no inspection yet: 40 + 15 + 20 + 10 possible.
    expect(result.possible).toBe(85);
    expect(result.earned).toBe(85);
    expect(result.components.map((entry) => [entry.key, entry.measured])).toEqual([
      ["checklists", true],
      ["onTime", true],
      ["problems", true],
      ["services", false],
      ["licences", true],
      ["inspection", false],
    ]);
  });

  it("scores an outlet with no inspection out of the proposal's 100", () => {
    // 12 of 14 handed in (40 × 12/14 = 34.3), 9 of 12 on time (11.3), one visit of two signed off (7.5),
    // one licence of two expired (5), no problems (20): 78 of 100.
    const result = calculateScore(
      withInput({
        checklists: { due: 14, submitted: 12 },
        onTime: { submitted: 12, onTime: 9 },
        services: { signedOff: 1, notSignedOff: 1, awaitingSignOff: 0, missedByEccs: 0 },
        licences: { valid: 1, withoutCopy: 0, expired: 1, expiringSoon: 0, fssaiMissing: false },
      }),
    );
    expect(result.possible).toBe(100);
    expect(result.components.map((entry) => entry.earned)).toEqual([34.3, 11.3, 20, 7.5, 5, 0]);
    // The total is added up before rounding, so it can differ from the sum of the rounded parts by 0.1.
    expect(result.earned).toBe(78);
    expect(result.score).toBe(78);
    expect(result.band).toBe("FAIR");
  });

  it("makes the inspection one fifth of the score once there is one", () => {
    // Everything else perfect (100 of 100) and an inspection of 60: 100 + 15 of 125 = 92.
    const result = calculateScore(
      withInput({
        services: { signedOff: 2, notSignedOff: 0, awaitingSignOff: 0, missedByEccs: 0 },
        inspection: { score: 60, nonCompliant: 9 },
      }),
    );
    expect(result.possible).toBe(125);
    expect(result.earned).toBe(115);
    expect(result.score).toBe(92);
    expect(part(withInput({ inspection: { score: 60, nonCompliant: 9 } }), "inspection").reasons).toEqual([
      { code: "INSPECTION_NON_COMPLIANT", count: 9, lost: 10 },
    ]);
  });

  it("says how many checklists were missed or late and what that cost", () => {
    const input = withInput({ checklists: { due: 14, submitted: 12 }, onTime: { submitted: 10, onTime: 7 } });
    expect(part(input, "checklists")).toMatchObject({
      earned: 34.3,
      lost: 5.7,
      reasons: [{ code: "CHECKLISTS_MISSED", count: 2, total: 14, lost: 5.7 }],
    });
    expect(part(input, "onTime")).toMatchObject({
      earned: 10.5,
      reasons: [{ code: "CHECKLISTS_LATE", count: 3, total: 10, lost: 4.5 }],
    });
    // Nothing lost, nothing to say.
    expect(part(clean, "checklists").reasons).toEqual([]);
  });

  it("gives no number until three checklists have fallen due", () => {
    const early = calculateScore(withInput({ checklists: { due: 2, submitted: 2 }, onTime: { submitted: 2, onTime: 2 } }));
    expect(early.score).toBeNull();
    expect(early.band).toBeNull();
    // The parts are still worked out, so the screen can show what is known so far.
    expect(early.components[0]).toMatchObject({ measured: true, earned: 40 });
    expect(calculateScore(withInput({ checklists: { due: 3, submitted: 3 } })).score).toBe(100);
  });

  it("does not let a brand-new outlet with nothing recorded get a score", () => {
    const result = calculateScore({
      checklists: { due: 0, submitted: 0 },
      onTime: { submitted: 0, onTime: 0 },
      problems: { answered: 0, open: [] },
      services: { signedOff: 0, notSignedOff: 0, awaitingSignOff: 0, missedByEccs: 0 },
      licences: { valid: 0, withoutCopy: 0, expired: 0, expiringSoon: 0, fssaiMissing: false },
      inspection: null,
    });
    expect(result.score).toBeNull();
    expect(result.possible).toBe(0);
    expect(result.components.every((entry) => !entry.measured && entry.earned === 0)).toBe(true);
  });

  it("does not count a missed checklist a second time as late", () => {
    // All seven of one checklist missed, none handed in: "on time" has nothing to measure.
    const result = calculateScore(
      withInput({ checklists: { due: 7, submitted: 0 }, onTime: { submitted: 0, onTime: 0 }, problems: { answered: 0, open: [] } }),
    );
    expect(result.components[1]!.measured).toBe(false);
    expect(result.components[2]!.measured).toBe(false);
    // 0 of 40 for checklists and 10 of 10 for licences: 10 of 50.
    expect(result.score).toBe(20);
    expect(result.band).toBe("NEEDS_ATTENTION");
  });

  it("charges nothing for a problem on the day it is reported, then 2 points a day up to 3 days", () => {
    const problem = (ageDays: number) => ({ kind: "CHECKLIST_ITEM" as const, severity: "MEDIUM" as const, ageDays });
    const open = (...ages: number[]) => withInput({ problems: { answered: 70, open: ages.map(problem) } });
    expect(part(open(0), "problems")).toMatchObject({ earned: 20, reasons: [] });
    expect(part(open(1), "problems")).toMatchObject({
      earned: 18,
      reasons: [{ code: "PROBLEMS_NOT_FIXED", count: 1, lost: 2 }],
    });
    expect(part(open(2, 0), "problems")).toMatchObject({ earned: 16, reasons: [{ count: 1, lost: 4 }] });
    // Six days is charged as three.
    expect(part(open(6), "problems").earned).toBe(14);
    // It cannot go below zero.
    expect(part(open(3, 3, 3, 3), "problems")).toMatchObject({ earned: 0, lost: 20 });
  });

  it("weights a problem by how serious it is, and names issues separately", () => {
    const input = withInput({
      problems: {
        answered: 10,
        open: [
          { kind: "ISSUE", severity: "HIGH", ageDays: 2 },
          { kind: "CHECKLIST_ITEM", severity: "LOW", ageDays: 1 },
        ],
      },
    });
    expect(part(input, "problems")).toMatchObject({
      earned: 11,
      reasons: [
        { code: "ISSUES_OPEN", count: 1, lost: 8 },
        { code: "PROBLEMS_NOT_FIXED", count: 1, lost: 1 },
      ],
    });
  });

  it("never holds a visit ECCS missed against the restaurant", () => {
    const missed = withInput({ services: { signedOff: 0, notSignedOff: 0, awaitingSignOff: 0, missedByEccs: 2 } });
    expect(part(missed, "services")).toMatchObject({ measured: false, lost: 0 });
    expect(calculateScore(missed).score).toBe(100);

    const mixed = withInput({ services: { signedOff: 3, notSignedOff: 1, awaitingSignOff: 1, missedByEccs: 1 } });
    expect(part(mixed, "services")).toMatchObject({
      measured: true,
      earned: 11.3,
      reasons: [
        { code: "VISITS_NOT_SIGNED_OFF", count: 1, total: 4, lost: 3.8 },
        { code: "VISITS_MISSED_BY_ECCS", count: 1, lost: 0 },
      ],
    });
  });

  it("leaves out a visit that still has time to be signed off", () => {
    const waiting = withInput({ services: { signedOff: 0, notSignedOff: 0, awaitingSignOff: 1, missedByEccs: 0 } });
    expect(part(waiting, "services").measured).toBe(false);
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
        checklists: { due: 14, submitted: 12 },
        onTime: { submitted: 12, onTime: 11 },
        licences: { valid: 1, withoutCopy: 0, expired: 1, expiringSoon: 1, fssaiMissing: false },
      }),
    );
    expect(topScoreFactors(result.components).map((factor) => factor.reason.code)).toEqual(["CHECKLISTS_MISSED", "LICENCES_EXPIRED"]);
    expect(topScoreFactors(result.components, 5).map((factor) => factor.reason.code)).toEqual([
      "CHECKLISTS_MISSED",
      "LICENCES_EXPIRED",
      "CHECKLISTS_LATE",
    ]);
    expect(topScoreFactors(calculateScore(clean).components)).toEqual([]);
  });
});
