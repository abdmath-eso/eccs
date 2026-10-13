import { describe, expect, it } from "vitest";
import {
  checkPhotoWindow,
  inspectionShownUntil,
  isLocalOnlyAddress,
  oldestPhotoShown,
  photoShownUntil,
  pickRecentServices,
  pickScoreDay,
  PUBLIC_PAGE_RULES,
  PUBLIC_PAGE_STATES,
  publicCheckResult,
  publicInspectionState,
  publicPageState,
  publicPageUrl,
  publicPhotoBy,
  publicScoreInspection,
  readStoredScore,
  selfCheckSummary,
  selfCheckWindow,
} from "./public-page.js";
import { calculateScore, SCORE_RULE_VERSION, type ScoreInput, type ScoreSnapshotBreakdown } from "./scores.js";

const TODAY = "2026-10-09";

describe("inspection validity", () => {
  it("shows an inspection for 180 days, the last day counted", () => {
    expect(PUBLIC_PAGE_RULES.inspectionValidDays).toBe(180);
    expect(inspectionShownUntil("2026-04-12")).toBe("2026-10-09");
    expect(publicInspectionState("2026-04-12", TODAY)).toBe("CURRENT");
    expect(publicInspectionState("2026-04-11", TODAY)).toBe("EXPIRED");
    expect(publicInspectionState(TODAY, TODAY)).toBe("CURRENT");
  });

  it("has no inspection to show without one, or for one dated in the future", () => {
    expect(publicInspectionState(null, TODAY)).toBe("NONE");
    expect(publicInspectionState("2026-10-10", TODAY)).toBe("EXPIRED");
  });
});

describe("publicPageState", () => {
  const live = { clientActive: true, takenDown: false, enabled: true };

  it("is live when the client is active, the page is not taken down and the Owner has switched it on", () => {
    expect(publicPageState(live)).toBe("LIVE");
  });

  it("no longer waits for an inspection", () => {
    // Until 13 Oct 2026 a page with no current inspection showed nothing.
    expect(PUBLIC_PAGE_STATES).toEqual(["LIVE", "INACTIVE", "TAKEN_DOWN", "OFF"]);
  });

  it("is off when the restaurant switched it off or ECCS took it down", () => {
    expect(publicPageState({ ...live, enabled: false })).toBe("OFF");
    expect(publicPageState({ ...live, takenDown: true })).toBe("TAKEN_DOWN");
  });

  it("reports ECCS's take-down ahead of the restaurant's switch, and a client that left ahead of both", () => {
    // The restaurant's switch being on does not bring a taken-down page back.
    expect(publicPageState({ ...live, takenDown: true, enabled: true })).toBe("TAKEN_DOWN");
    expect(publicPageState({ ...live, takenDown: true, enabled: false })).toBe("TAKEN_DOWN");
    expect(publicPageState({ ...live, clientActive: false, takenDown: true })).toBe("INACTIVE");
    expect(publicPageState({ ...live, clientActive: false })).toBe("INACTIVE");
  });
});

describe("the score shown", () => {
  it("is yesterday's when there is one", () => {
    expect(pickScoreDay(["2026-10-06", "2026-10-08", "2026-10-07"], TODAY)).toBe("2026-10-08");
  });

  it("is never today's, which is not final", () => {
    expect(pickScoreDay([TODAY, "2026-10-08"], TODAY)).toBe("2026-10-08");
    expect(pickScoreDay([TODAY], TODAY)).toBeNull();
  });

  it("falls back to the most recent day of the last week, and no further", () => {
    expect(PUBLIC_PAGE_RULES.scoreWithinDays).toBe(7);
    expect(pickScoreDay(["2026-10-02", "2026-10-05"], TODAY)).toBe("2026-10-05");
    expect(pickScoreDay(["2026-10-02"], TODAY)).toBe("2026-10-02");
    expect(pickScoreDay(["2026-10-01"], TODAY)).toBeNull();
    expect(pickScoreDay([], TODAY)).toBeNull();
  });

  /** What the scorer stores for a day, from the numbers it counted. */
  const stored = (input: ScoreInput): { score: number; breakdown: ScoreSnapshotBreakdown } => {
    const result = calculateScore(input);
    return {
      score: result.score!,
      breakdown: { version: SCORE_RULE_VERSION, band: result.band!, earned: result.earned, possible: result.possible, components: result.components },
    };
  };
  const licences = { valid: 1, withoutCopy: 0, expired: 0, expiringSoon: 0, fssaiMissing: false };

  it("is read from the stored day with its three parts, in order", () => {
    const row = stored({ checklists: { day: "TODAY", due: 2, onTime: 1, late: 1 }, licences, inspection: { score: 86.4, nonCompliant: 3 } });
    // 51.8 of 60 for the inspection, 10 of 10 for licences, 22.5 of 30 for the checklists: 84.3 of 100.
    expect(readStoredScore(row.score, row.breakdown)).toEqual({
      score: 84,
      band: "GOOD",
      provisional: false,
      parts: [
        { key: "inspection", measured: true, earned: 51.8, max: 60 },
        { key: "licences", measured: true, earned: 10, max: 10 },
        { key: "checklists", measured: true, earned: 22.5, max: 30 },
      ],
    });
  });

  it("is provisional when there is no inspection in it", () => {
    const row = stored({ checklists: { day: "TODAY", due: 2, onTime: 1, late: 0 }, licences, inspection: null });
    // 10 of 10 and 15 of 30: 25 of the 40 points that could be earned.
    expect(readStoredScore(row.score, row.breakdown)).toEqual({
      score: 63,
      band: "NEEDS_ATTENTION",
      provisional: true,
      parts: [
        { key: "inspection", measured: false, earned: 0, max: 60 },
        { key: "licences", measured: true, earned: 10, max: 10 },
        { key: "checklists", measured: true, earned: 15, max: 30 },
      ],
    });
  });

  it("is not read from a row of an older rule or one that does not read as expected", () => {
    const row = stored({ checklists: { day: "TODAY", due: 1, onTime: 1, late: 0 }, licences, inspection: null });
    expect(readStoredScore(row.score, { ...row.breakdown, version: 1 })).toBeNull();
    expect(readStoredScore(row.score, { ...row.breakdown, band: "SUPERB" })).toBeNull();
    expect(readStoredScore(row.score, { ...row.breakdown, components: row.breakdown.components.slice(1) })).toBeNull();
    expect(readStoredScore(row.score, { ...row.breakdown, components: [null, "x"] })).toBeNull();
    expect(readStoredScore(row.score, null)).toBeNull();
    expect(readStoredScore(row.score, "84")).toBeNull();
  });

  it("says why the inspection is not in the score, and never more than is true", () => {
    expect(publicScoreInspection({ counted: true, inspection: "CURRENT", everInspected: true })).toBe("COUNTED");
    // Never inspected: the plain sentence.
    expect(publicScoreInspection({ counted: false, inspection: "NONE", everInspected: false })).toBe("NOT_INSPECTED");
    // Inspected, but the report is not approved yet, or the last approved one is too old.
    expect(publicScoreInspection({ counted: false, inspection: "NONE", everInspected: true })).toBe("NO_CURRENT_RESULT");
    expect(publicScoreInspection({ counted: false, inspection: "EXPIRED", everInspected: true })).toBe("NO_CURRENT_RESULT");
    // The page shows an inspection carried out after the day the score is for.
    expect(publicScoreInspection({ counted: false, inspection: "CURRENT", everInspected: true })).toBe("NOT_IN_THIS_SCORE");
  });
});

describe("selfCheckSummary", () => {
  it("counts the 30 days ending yesterday", () => {
    expect(selfCheckWindow(TODAY)).toEqual({ from: "2026-09-09", to: "2026-10-08" });
  });

  it("counts a day only when every checklist due that day was handed in", () => {
    const summary = selfCheckSummary(
      [
        { date: "2026-10-08", handedIn: true },
        { date: "2026-10-08", handedIn: true },
        { date: "2026-10-07", handedIn: true },
        { date: "2026-10-07", handedIn: false },
        { date: "2026-10-06", handedIn: false },
      ],
      TODAY,
    );
    expect(summary).toEqual({ handedIn: 1, days: 3 });
  });

  it("leaves out today, days before the window and days with nothing due", () => {
    const summary = selfCheckSummary(
      [
        { date: TODAY, handedIn: true },
        { date: "2026-09-08", handedIn: true },
        { date: "2026-09-09", handedIn: true },
      ],
      TODAY,
    );
    expect(summary).toEqual({ handedIn: 1, days: 1 });
  });

  it("is null when there is nothing to count", () => {
    expect(selfCheckSummary([], TODAY)).toBeNull();
    expect(selfCheckSummary([{ date: TODAY, handedIn: true }], TODAY)).toBeNull();
  });
});

describe("yesterday's result for a checklist", () => {
  it("is one of four", () => {
    expect(publicCheckResult({ handedIn: true, onTime: true })).toBe("ON_TIME");
    expect(publicCheckResult({ handedIn: true, onTime: false })).toBe("LATE");
    expect(publicCheckResult({ handedIn: false, onTime: false })).toBe("NOT_DONE");
    // A checklist that did not exist yet that day has no record for it.
    expect(publicCheckResult(null)).toBe("NOT_DUE");
  });
});

describe("photos", () => {
  it("are shown for 90 days from the day they were taken, the last day counted", () => {
    expect(PUBLIC_PAGE_RULES.photoShownDays).toBe(90);
    expect(photoShownUntil("2026-07-11")).toBe(TODAY);
    // Taken on 11 July: still shown today. Taken on 10 July: dropped off.
    expect(oldestPhotoShown(TODAY)).toBe("2026-07-11");
  });

  it("can be put forward from the daily checks of the last 14 days", () => {
    expect(checkPhotoWindow(TODAY)).toEqual({ from: "2026-09-25", to: TODAY });
  });

  it("are said to be by the restaurant's staff or by ECCS", () => {
    expect(publicPhotoBy("DAILY_CHECK")).toBe("RESTAURANT");
    expect(publicPhotoBy("ECCS_VISIT")).toBe("ECCS");
    expect(publicPhotoBy("ECCS_INSPECTION")).toBe("ECCS");
    expect(publicPhotoBy("ECCS_FOR_PAGE")).toBe("ECCS");
  });
});

describe("pickRecentServices", () => {
  it("keeps the latest of each kind, newest first", () => {
    const picked = pickRecentServices(
      [
        { code: "PEST", date: "2026-09-01" },
        { code: "PEST", date: "2026-09-20" },
        { code: "DEEP_CLEAN", date: "2026-10-01" },
        { code: "CHIMNEY", date: "2026-08-15" },
      ],
      TODAY,
    );
    expect(picked).toEqual([
      { code: "DEEP_CLEAN", date: "2026-10-01" },
      { code: "PEST", date: "2026-09-20" },
      { code: "CHIMNEY", date: "2026-08-15" },
    ]);
  });

  it("drops services older than a year or dated in the future, and lists at most six", () => {
    expect(pickRecentServices([{ code: "PEST", date: "2025-10-08" }, { code: "HOOD", date: "2026-10-10" }], TODAY)).toEqual([]);
    expect(pickRecentServices([{ code: "PEST", date: "2025-10-09" }], TODAY)).toHaveLength(1);
    const many = Array.from({ length: 9 }, (_, index) => ({ code: `K${index}`, date: `2026-09-0${index + 1}` }));
    const picked = pickRecentServices(many, TODAY);
    expect(picked).toHaveLength(PUBLIC_PAGE_RULES.maxServices);
    expect(picked[0]).toEqual({ code: "K8", date: "2026-09-09" });
  });
});

describe("the page's address", () => {
  it("is the base address, /k/ and the token", () => {
    expect(publicPageUrl("https://eccs.example.in", "abc")).toBe("https://eccs.example.in/k/abc");
    expect(publicPageUrl("https://eccs.example.in/", "abc")).toBe("https://eccs.example.in/k/abc");
  });

  it("knows an address that only works inside the office", () => {
    for (const address of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://192.168.1.40:3000",
      "http://10.0.0.5",
      "http://172.16.4.2",
      "http://172.31.255.1",
      "http://169.254.1.1",
      "http://office-pc:3000",
      "http://eccs.local",
      "http://[::1]:3000",
      "not an address",
    ]) {
      expect(isLocalOnlyAddress(address), address).toBe(true);
    }
    for (const address of ["https://eccs.example.in", "https://clean.eccs.co.in/", "http://172.32.0.1", "http://8.8.8.8", "http://192.169.1.1"]) {
      expect(isLocalOnlyAddress(address), address).toBe(false);
    }
  });
});
