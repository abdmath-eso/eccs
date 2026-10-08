import { describe, expect, it } from "vitest";
import {
  addDaysToDate,
  addMonthsToDate,
  createPlanSchema,
  cycleAnchorDay,
  cyclePeriod,
  cyclePeriodContaining,
  daysInCycleMonth,
  subscriptionPrice,
} from "./subscriptions.js";

describe("daysInCycleMonth", () => {
  it("knows the short months and leap years", () => {
    expect(daysInCycleMonth(2026, 2)).toBe(28);
    expect(daysInCycleMonth(2028, 2)).toBe(29);
    // A century is a leap year only when it divides by 400.
    expect(daysInCycleMonth(2100, 2)).toBe(28);
    expect(daysInCycleMonth(2000, 2)).toBe(29);
    expect(daysInCycleMonth(2026, 4)).toBe(30);
    expect(daysInCycleMonth(2026, 12)).toBe(31);
  });
});

describe("addDaysToDate", () => {
  it("crosses months, years and a leap day", () => {
    expect(addDaysToDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToDate("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDaysToDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDate("2027-02-28", 1)).toBe("2027-03-01");
  });
});

describe("addMonthsToDate", () => {
  it("keeps the day of the month", () => {
    expect(addMonthsToDate("2026-10-08", 1)).toBe("2026-11-08");
    expect(addMonthsToDate("2026-10-08", 3)).toBe("2027-01-08");
    expect(addMonthsToDate("2026-10-08", 12)).toBe("2027-10-08");
  });

  it("uses the month's last day when the month is too short", () => {
    expect(addMonthsToDate("2026-10-31", 1)).toBe("2026-11-30");
    expect(addMonthsToDate("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsToDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsToDate("2026-11-30", 3)).toBe("2027-02-28");
    // 29 February a year on is 28 February.
    expect(addMonthsToDate("2028-02-29", 12)).toBe("2029-02-28");
  });

  it("returns to the anchor day after a short month", () => {
    expect(addMonthsToDate("2027-02-28", 1, 31)).toBe("2027-03-31");
    expect(addMonthsToDate("2027-03-31", 1, 31)).toBe("2027-04-30");
    expect(addMonthsToDate("2029-02-28", 12, 29)).toBe("2030-02-28");
    expect(addMonthsToDate("2031-02-28", 12, 29)).toBe("2032-02-29");
  });
});

describe("cyclePeriod", () => {
  it("runs to the day before the same day one, three or twelve months later", () => {
    expect(cyclePeriod("2026-10-08", "MONTHLY")).toEqual({ start: "2026-10-08", end: "2026-11-07", nextStart: "2026-11-08" });
    expect(cyclePeriod("2026-10-08", "QUARTERLY")).toEqual({ start: "2026-10-08", end: "2027-01-07", nextStart: "2027-01-08" });
    expect(cyclePeriod("2026-10-08", "ANNUAL")).toEqual({ start: "2026-10-08", end: "2027-10-07", nextStart: "2027-10-08" });
  });

  it("starting on the first, ends on the month's last day", () => {
    expect(cyclePeriod("2027-02-01", "MONTHLY").end).toBe("2027-02-28");
    expect(cyclePeriod("2028-02-01", "MONTHLY").end).toBe("2028-02-29");
    expect(cyclePeriod("2026-01-01", "ANNUAL").end).toBe("2026-12-31");
  });

  it("a subscription begun on the 31st follows the month ends and comes back to the 31st", () => {
    const anchor = (periodStart: string) => cycleAnchorDay("2027-01-31", periodStart);
    const first = cyclePeriod("2027-01-31", "MONTHLY", anchor("2027-01-31"));
    expect(first).toEqual({ start: "2027-01-31", end: "2027-02-27", nextStart: "2027-02-28" });
    const second = cyclePeriod(first.nextStart, "MONTHLY", anchor(first.nextStart));
    expect(second).toEqual({ start: "2027-02-28", end: "2027-03-30", nextStart: "2027-03-31" });
    const third = cyclePeriod(second.nextStart, "MONTHLY", anchor(second.nextStart));
    expect(third).toEqual({ start: "2027-03-31", end: "2027-04-29", nextStart: "2027-04-30" });
  });

  it("an annual subscription begun on 29 February renews on the 28th, and on the 29th in the next leap year", () => {
    let start = "2028-02-29";
    const starts: string[] = [];
    for (let year = 0; year < 4; year += 1) {
      start = cyclePeriod(start, "ANNUAL", cycleAnchorDay("2028-02-29", start)).nextStart;
      starts.push(start);
    }
    expect(starts).toEqual(["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });
});

describe("cycleAnchorDay", () => {
  it("is the start day while the cycles follow from it", () => {
    expect(cycleAnchorDay("2027-01-31", "2027-02-28")).toBe(31);
    expect(cycleAnchorDay("2026-10-08", "2027-03-08")).toBe(8);
  });

  it("is the cycle's own day once a cycle was restarted on another day", () => {
    // Paused past the end of a cycle and resumed on the 20th: the cycles now follow the 20th.
    expect(cycleAnchorDay("2026-10-08", "2027-03-20")).toBe(20);
  });
});

describe("cyclePeriodContaining", () => {
  it("finds the cycle a day falls in", () => {
    expect(cyclePeriodContaining("2026-06-15", "MONTHLY", "2026-10-08")).toEqual({
      start: "2026-09-15",
      end: "2026-10-14",
      nextStart: "2026-10-15",
    });
    expect(cyclePeriodContaining("2026-06-15", "MONTHLY", "2026-10-15").start).toBe("2026-10-15");
    expect(cyclePeriodContaining("2026-06-15", "QUARTERLY", "2026-10-08").start).toBe("2026-09-15");
    expect(cyclePeriodContaining("2024-06-15", "ANNUAL", "2026-10-08")).toEqual({
      start: "2026-06-15",
      end: "2027-06-14",
      nextStart: "2027-06-15",
    });
  });

  it("is the first cycle on or before the start date", () => {
    expect(cyclePeriodContaining("2026-10-20", "MONTHLY", "2026-10-08").start).toBe("2026-10-20");
    expect(cyclePeriodContaining("2026-10-20", "MONTHLY", "2026-10-20").start).toBe("2026-10-20");
  });

  it("is not shifted by a short month on the way", () => {
    expect(cyclePeriodContaining("2027-01-31", "MONTHLY", "2027-04-10")).toEqual({
      start: "2027-03-31",
      end: "2027-04-29",
      nextStart: "2027-04-30",
    });
  });
});

describe("subscriptionPrice", () => {
  it("adds 18% GST in whole paise", () => {
    expect(subscriptionPrice(600_000)).toEqual({ pricePaise: 600_000, gstPaise: 108_000, totalPaise: 708_000, gstRatePercent: 18 });
    // ₹99.99 → GST ₹17.9982, rounded to the nearest paisa.
    expect(subscriptionPrice(9_999).gstPaise).toBe(1_800);
  });
});

describe("createPlanSchema", () => {
  const plan = { name: "Starter", priceRupees: "4500", billingCycle: "MONTHLY", lines: [{ serviceCode: "PEST", intervalDays: "30" }] };

  it("reads figures typed into form boxes", () => {
    const read = createPlanSchema.parse(plan);
    expect(read.priceRupees).toBe(4500);
    expect(read.lines[0]!.intervalDays).toBe(30);
  });

  it("refuses a plan with no services, or the same kind twice", () => {
    expect(createPlanSchema.safeParse({ ...plan, lines: [] }).success).toBe(false);
    expect(createPlanSchema.safeParse({ ...plan, lines: [plan.lines[0], plan.lines[0]] }).success).toBe(false);
    expect(createPlanSchema.safeParse({ ...plan, lines: [{ serviceCode: "PEST", intervalDays: "0" }] }).success).toBe(false);
  });
});
