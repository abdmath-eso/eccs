import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_DAY_RULES,
  FACE_RULES,
  attendanceDayEnd,
  attendanceDayEnded,
  attendanceDayOf,
  attendanceDayStart,
  decideMatch,
  nextPunchKind,
  pairPunches,
  shiftDate,
  summariseDay,
  withinRepeatGuard,
  type RulePunch,
} from "./attendance-rules.js";

/** A moment in India time, written as it reads on a kitchen clock. */
const ist = (date: string, time: string) => Date.parse(`${date}T${time}:00+05:30`);
const punch = (date: string, time: string, kind: "IN" | "OUT", flag?: RulePunch["flag"]): RulePunch => ({ at: ist(date, time), kind, flag: flag ?? null });

const DAY = "2026-10-09"; // a Friday
const rules = { fullDayMinutes: ATTENDANCE_DAY_RULES.fullDayMinutes, halfDayMinutes: ATTENDANCE_DAY_RULES.halfDayMinutes };
const day = (punches: RulePunch[], now: number, extra: Partial<{ usualDayOff: boolean; fullDayMinutes: number; halfDayMinutes: number }> = {}) =>
  summariseDay({ day: DAY, now, punches, usualDayOff: false, ...rules, ...extra });
/** Any moment after the attendance day has ended. */
const after = ist("2026-10-10", "09:00");
/** A moment while it is still running. */
const during = ist(DAY, "21:00");

describe("the attendance day", () => {
  it("runs from 4 am to 4 am India time", () => {
    expect(attendanceDayOf(ist("2026-10-09", "04:00"))).toBe("2026-10-09");
    expect(attendanceDayOf(ist("2026-10-09", "03:59"))).toBe("2026-10-08");
    expect(attendanceDayOf(ist("2026-10-09", "12:00"))).toBe("2026-10-09");
    expect(attendanceDayOf(ist("2026-10-09", "23:59"))).toBe("2026-10-09");
  });

  it("gives a shift that ends after midnight to the day it started", () => {
    expect(attendanceDayOf(ist("2026-10-10", "00:30"))).toBe("2026-10-09");
    expect(attendanceDayOf(ist("2026-10-10", "03:59"))).toBe("2026-10-09");
    expect(attendanceDayOf(ist("2026-10-10", "04:00"))).toBe("2026-10-10");
  });

  it("accepts a Date as well as milliseconds, and works across a month and a year end", () => {
    expect(attendanceDayOf(new Date(ist("2026-11-01", "02:00")))).toBe("2026-10-31");
    expect(attendanceDayOf(ist("2027-01-01", "01:00"))).toBe("2026-12-31");
  });

  it("starts and ends at the right moments", () => {
    expect(attendanceDayStart(DAY).getTime()).toBe(ist("2026-10-09", "04:00"));
    expect(attendanceDayEnd(DAY).getTime()).toBe(ist("2026-10-10", "04:00"));
    // 4 am in India is 22:30 the evening before in UTC.
    expect(attendanceDayStart(DAY).toISOString()).toBe("2026-10-08T22:30:00.000Z");
  });

  it("is over only once the next one has begun", () => {
    expect(attendanceDayEnded(DAY, ist("2026-10-10", "03:59"))).toBe(false);
    expect(attendanceDayEnded(DAY, ist("2026-10-10", "04:00"))).toBe(true);
  });

  it("puts every moment of a day inside its own start and end", () => {
    for (const time of ["04:00", "09:30", "15:45", "23:59"]) {
      const at = ist(DAY, time);
      const of = attendanceDayOf(at);
      expect(attendanceDayStart(of).getTime()).toBeLessThanOrEqual(at);
      expect(attendanceDayEnd(of).getTime()).toBeGreaterThan(at);
    }
  });

  it("shifts a date by whole days", () => {
    expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("in or out", () => {
  it("starts the day with a clock-in and then alternates", () => {
    expect(nextPunchKind([])).toBe("IN");
    expect(nextPunchKind([punch(DAY, "09:00", "IN")])).toBe("OUT");
    expect(nextPunchKind([punch(DAY, "09:00", "IN"), punch(DAY, "14:00", "OUT")])).toBe("IN");
  });

  it("goes by the latest punch whatever order they are given in", () => {
    expect(nextPunchKind([punch(DAY, "14:00", "OUT"), punch(DAY, "09:00", "IN")])).toBe("IN");
  });

  it("treats a scan within a few seconds of the last punch as the same one, and a later one as the next", () => {
    const last = ist(DAY, "09:00");
    expect(withinRepeatGuard(last, last + 2_000)).toBe(true);
    expect(withinRepeatGuard(last, last + FACE_RULES.repeatGuardSeconds * 1000 - 1)).toBe(true);
    expect(withinRepeatGuard(last, last + FACE_RULES.repeatGuardSeconds * 1000)).toBe(false);
    expect(withinRepeatGuard(last, last + 60_000)).toBe(false);
    expect(withinRepeatGuard(last, last + 60 * 60_000)).toBe(false);
  });
});

describe("pairing punches", () => {
  it("pairs each clock-in with the clock-out after it", () => {
    const { pairs, strayOuts } = pairPunches([punch(DAY, "09:00", "IN"), punch(DAY, "13:00", "OUT"), punch(DAY, "18:00", "IN"), punch(DAY, "23:00", "OUT")]);
    expect(pairs).toEqual([
      { inAt: ist(DAY, "09:00"), outAt: ist(DAY, "13:00") },
      { inAt: ist(DAY, "18:00"), outAt: ist(DAY, "23:00") },
    ]);
    expect(strayOuts).toBe(0);
  });

  it("leaves a clock-in open when no clock-out follows, and counts a clock-out with nothing before it as stray", () => {
    expect(pairPunches([punch(DAY, "09:00", "IN")]).pairs).toEqual([{ inAt: ist(DAY, "09:00"), outAt: null }]);
    expect(pairPunches([punch(DAY, "13:00", "OUT")])).toEqual({ pairs: [], strayOuts: 1 });
  });

  it("leaves the first of two clock-ins in a row open", () => {
    const { pairs } = pairPunches([punch(DAY, "09:00", "IN"), punch(DAY, "10:00", "IN"), punch(DAY, "18:00", "OUT")]);
    expect(pairs).toEqual([
      { inAt: ist(DAY, "09:00"), outAt: null },
      { inAt: ist(DAY, "10:00"), outAt: ist(DAY, "18:00") },
    ]);
  });
});

describe("a day with no punches", () => {
  it("has no status while the day is still running", () => {
    const summary = day([], during);
    expect(summary).toMatchObject({ status: null, provisional: false, workedMinutes: null, flags: [], onDuty: false, ended: false });
  });

  it("is absent once the day has ended", () => {
    expect(day([], after)).toMatchObject({ status: "ABSENT", provisional: false, workedMinutes: 0, flags: [], ended: true });
  });

  it("is the weekly off once the day has ended, on the person's usual day off", () => {
    expect(day([], after, { usualDayOff: true })).toMatchObject({ status: "WEEKLY_OFF", flags: [] });
  });

  it("has no status on the usual day off either, until the day has ended", () => {
    expect(day([], during, { usualDayOff: true }).status).toBeNull();
  });
});

describe("a day that has ended, by the minutes worked", () => {
  const worked = (minutes: number) => [punch(DAY, "09:00", "IN"), { at: ist(DAY, "09:00") + minutes * 60_000, kind: "OUT" as const }];

  it("is present at eight hours or more", () => {
    expect(day(worked(480), after)).toMatchObject({ status: "PRESENT", provisional: false, workedMinutes: 480, flags: [] });
    expect(day(worked(600), after)).toMatchObject({ status: "PRESENT", workedMinutes: 600 });
  });

  it("is a half day from four hours up to just under eight", () => {
    expect(day(worked(479), after)).toMatchObject({ status: "HALF_DAY", workedMinutes: 479, flags: [] });
    expect(day(worked(240), after)).toMatchObject({ status: "HALF_DAY", workedMinutes: 240, flags: [] });
  });

  it("is absent and marked SHORT_DAY under four hours", () => {
    expect(day(worked(239), after)).toMatchObject({ status: "ABSENT", provisional: false, workedMinutes: 239, flags: ["SHORT_DAY"] });
    expect(day(worked(5), after)).toMatchObject({ status: "ABSENT", flags: ["SHORT_DAY"] });
  });

  it("adds up a split shift", () => {
    const split = [punch(DAY, "11:00", "IN"), punch(DAY, "15:00", "OUT"), punch(DAY, "18:30", "IN"), punch(DAY, "23:00", "OUT")];
    const summary = day(split, after);
    expect(summary).toMatchObject({ status: "PRESENT", workedMinutes: 510, flags: [] });
    expect(summary.firstInAt).toBe(ist(DAY, "11:00"));
    expect(summary.lastOutAt).toBe(ist(DAY, "23:00"));
  });

  it("counts a dinner shift that ends after midnight in full", () => {
    const late = [punch(DAY, "16:00", "IN"), punch("2026-10-10", "01:30", "OUT")];
    expect(day(late, after)).toMatchObject({ status: "PRESENT", workedMinutes: 570 });
  });

  it("drops the odd seconds rather than rounding up", () => {
    const punches = [
      { at: ist(DAY, "09:00"), kind: "IN" as const },
      { at: ist(DAY, "09:00") + 479 * 60_000 + 59_000, kind: "OUT" as const },
    ];
    expect(day(punches, after)).toMatchObject({ status: "HALF_DAY", workedMinutes: 479 });
  });

  it("uses the outlet's own hours when the Owner has set them", () => {
    const sixHours = worked(360);
    expect(day(sixHours, after).status).toBe("HALF_DAY");
    expect(day(sixHours, after, { fullDayMinutes: 360, halfDayMinutes: 180 }).status).toBe("PRESENT");
    expect(day(worked(200), after, { fullDayMinutes: 360, halfDayMinutes: 180 })).toMatchObject({ status: "HALF_DAY", flags: [] });
  });

  it("goes by the punches even on the person's usual day off", () => {
    expect(day(worked(500), after, { usualDayOff: true }).status).toBe("PRESENT");
  });
});

describe("a missing punch", () => {
  it("gives the worker the benefit of the doubt when they never clocked out: present for now, marked NO_CLOCK_OUT, time unknown", () => {
    const summary = day([punch(DAY, "09:00", "IN")], after);
    expect(summary).toMatchObject({ status: "PRESENT", provisional: true, workedMinutes: null, flags: ["NO_CLOCK_OUT"], onDuty: false, ended: true });
    expect(summary.firstInAt).toBe(ist(DAY, "09:00"));
    expect(summary.lastOutAt).toBeNull();
  });

  it("does the same when the second half of a split shift was left open, however long the first half was", () => {
    const summary = day([punch(DAY, "11:00", "IN"), punch(DAY, "12:00", "OUT"), punch(DAY, "18:00", "IN")], after);
    expect(summary).toMatchObject({ status: "PRESENT", provisional: true, workedMinutes: null, flags: ["NO_CLOCK_OUT"] });
    expect(summary.lastOutAt).toBe(ist(DAY, "12:00"));
  });

  it("marks a clock-out with no clock-in as NO_CLOCK_IN, present for now", () => {
    expect(day([punch(DAY, "18:00", "OUT")], after)).toMatchObject({ status: "PRESENT", provisional: true, workedMinutes: null, flags: ["NO_CLOCK_IN"] });
  });

  it("is settled once the Owner adds the missing clock-out", () => {
    const fixed = [punch(DAY, "09:00", "IN"), punch(DAY, "17:30", "OUT")];
    expect(day(fixed, after)).toMatchObject({ status: "PRESENT", provisional: false, workedMinutes: 510, flags: [] });
  });
});

describe("a day still running", () => {
  it("is present for now as soon as the person has clocked in, with the time so far", () => {
    const summary = day([punch(DAY, "09:00", "IN")], ist(DAY, "12:30"));
    expect(summary).toMatchObject({ status: "PRESENT", provisional: true, workedMinutes: 210, flags: [], onDuty: true, ended: false });
  });

  it("does not judge a short first shift before the day is over", () => {
    const summary = day([punch(DAY, "11:00", "IN"), punch(DAY, "12:00", "OUT")], during);
    expect(summary).toMatchObject({ status: "PRESENT", provisional: true, workedMinutes: 60, flags: [], onDuty: false });
  });

  it("counts finished shifts plus the one in progress", () => {
    const summary = day([punch(DAY, "11:00", "IN"), punch(DAY, "15:00", "OUT"), punch(DAY, "18:00", "IN")], ist(DAY, "20:00"));
    expect(summary).toMatchObject({ workedMinutes: 360, onDuty: true });
  });

  it("is still running after midnight until 4 am", () => {
    const summary = day([punch(DAY, "17:00", "IN")], ist("2026-10-10", "02:00"));
    expect(summary).toMatchObject({ status: "PRESENT", provisional: true, workedMinutes: 540, onDuty: true, ended: false });
  });
});

describe("flags carried up from the punches", () => {
  it("shows each kind once, in a fixed order, beside the day's own", () => {
    const punches = [punch(DAY, "09:00", "IN", "ASSISTED"), punch(DAY, "10:00", "OUT", "UNSURE_MATCH"), punch(DAY, "11:00", "IN", "ASSISTED"), punch(DAY, "12:00", "OUT", "POSSIBLE_SPOOF")];
    expect(day(punches, after).flags).toEqual(["UNSURE_MATCH", "ASSISTED", "POSSIBLE_SPOOF", "SHORT_DAY"]);
  });

  it("shows them on a running day too", () => {
    expect(day([punch(DAY, "09:00", "IN", "UNSURE_MATCH")], during).flags).toEqual(["UNSURE_MATCH"]);
  });
});

describe("deciding who a face is", () => {
  const score = (who: string, value: number) => ({ who, score: value });

  it("is no match when nobody reaches the match threshold, or nobody is enrolled", () => {
    expect(decideMatch([])).toEqual({ result: "NO_MATCH", best: null, secondScore: null });
    expect(decideMatch([score("a", 0.2), score("b", 0.36)])).toMatchObject({ result: "NO_MATCH", best: null, secondScore: 0.2 });
  });

  it("is a match when the best is confident and well clear of the next person", () => {
    const decision = decideMatch([score("a", 0.1), score("b", 0.72), score("c", 0.3)]);
    expect(decision).toEqual({ result: "MATCH", best: score("b", 0.72), secondScore: 0.3 });
  });

  it("is a match for the only enrolled person when confident", () => {
    expect(decideMatch([score("a", 0.6)])).toMatchObject({ result: "MATCH", secondScore: null });
  });

  it("is unsure between the match and the confident thresholds", () => {
    expect(decideMatch([score("a", 0.4), score("b", 0.05)])).toMatchObject({ result: "UNSURE", best: score("a", 0.4) });
    expect(decideMatch([score("a", FACE_RULES.matchThreshold)]).result).toBe("UNSURE");
    expect(decideMatch([score("a", FACE_RULES.confidentThreshold)]).result).toBe("MATCH");
  });

  it("is unsure when two people both look like the photo, however high the best score", () => {
    expect(decideMatch([score("a", 0.8), score("b", 0.75)])).toMatchObject({ result: "UNSURE", best: score("a", 0.8), secondScore: 0.75 });
    expect(decideMatch([score("a", 0.8), score("b", 0.69)]).result).toBe("MATCH");
  });

  it("takes other thresholds when given them", () => {
    const strict = { matchThreshold: 0.5, confidentThreshold: 0.7, marginOverSecond: 0.2 };
    expect(decideMatch([score("a", 0.45)], strict).result).toBe("NO_MATCH");
    expect(decideMatch([score("a", 0.6)], strict).result).toBe("UNSURE");
    expect(decideMatch([score("a", 0.75), score("b", 0.6)], strict).result).toBe("UNSURE");
    expect(decideMatch([score("a", 0.75), score("b", 0.5)], strict).result).toBe("MATCH");
  });
});
