import { describe, expect, it } from "vitest";
import {
  areaColour,
  areaColours,
  AREA_COLOURS,
  boardDates,
  boardMonday,
  boardWeekday,
  busyStreak,
  capacityOn,
  dayLoads,
  suggestMove,
  visitCapacitySchema,
  WEEK_BOARD_RULES,
  weekCapacity,
  weekHeadline,
  weekUse,
  type BoardVisitFacts,
} from "./week-board.js";

const capacity = WEEK_BOARD_RULES.defaultCapacity;
// Monday 23 November 2026 to Saturday 28 November.
const monday = "2026-11-23";

let next = 0;
const visit = (date: string, extra: Partial<BoardVisitFacts> = {}): BoardVisitFacts => {
  next += 1;
  return { id: `v${String(next).padStart(3, "0")}`, date, status: "ASSIGNED", createdAt: `2026-11-01T10:${String(next).padStart(2, "0")}:00Z`, canMove: true, ...extra };
};
const many = (date: string, count: number) => Array.from({ length: count }, () => visit(date));

describe("the board's days", () => {
  it("runs Monday to Saturday from any day of the week", () => {
    expect(boardMonday("2026-11-26")).toBe(monday);
    expect(boardMonday("2026-11-29")).toBe(monday); // a Sunday belongs to the week before it
    expect(boardDates(monday)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"]);
    expect(boardWeekday("2026-11-29")).toBeNull();
    expect(boardWeekday("2026-11-28")).toBe("SAT");
  });

  it("gives one crew 29 slots a week, none on Sunday", () => {
    expect(weekCapacity(capacity)).toBe(29);
    expect(capacityOn(capacity, "2026-11-28")).toBe(4);
    expect(capacityOn(capacity, "2026-11-29")).toBe(0);
  });

  it("accepts 0 to 20 a day and nothing else", () => {
    expect(visitCapacitySchema.safeParse({ ...capacity, SAT: 0 }).success).toBe(true);
    expect(visitCapacitySchema.safeParse({ ...capacity, MON: 21 }).success).toBe(false);
    expect(visitCapacitySchema.safeParse({ ...capacity, TUE: 2.5 }).success).toBe(false);
    expect(visitCapacitySchema.safeParse({ MON: 5 }).success).toBe(false);
  });
});

describe("booked of capacity", () => {
  it("counts each day's visits but not cancelled ones", () => {
    const loads = dayLoads(monday, capacity, [...many("2026-11-23", 4), visit("2026-11-23", { status: "CANCELLED" }), visit("2026-11-24", { status: "APPROVED" })]);
    expect(loads[0]).toEqual({ date: "2026-11-23", booked: 4, capacity: 5, over: false });
    expect(loads[1]?.booked).toBe(1);
  });

  it("marks a day over capacity and words the week", () => {
    const loads = dayLoads(monday, capacity, [...many("2026-11-23", 4), ...many("2026-11-26", 7), ...many("2026-11-27", 3)]);
    expect(loads[3]?.over).toBe(true);
    expect(weekUse(loads)).toEqual({ booked: 14, capacity: 29, percent: 48 });
    expect(weekHeadline(loads)).toBe("14 of 29 slots booked. Thursday is two over.");
  });

  it("names several over-full days, and says nothing when none is", () => {
    const over = dayLoads(monday, capacity, [...many("2026-11-23", 6), ...many("2026-11-26", 6), ...many("2026-11-28", 5)]);
    expect(weekHeadline(over)).toBe("17 of 29 slots booked. Monday, Thursday and Saturday are over.");
    expect(weekHeadline(dayLoads(monday, capacity, []))).toBe("0 of 29 slots booked.");
  });
});

describe("weeks at 80% or more", () => {
  it("counts back from the newest week until one is under", () => {
    expect(busyStreak([{ booked: 24, capacity: 26 }, { booked: 21, capacity: 26 }, { booked: 25, capacity: 26 }, { booked: 10, capacity: 26 }, { booked: 26, capacity: 26 }])).toBe(3);
    expect(busyStreak([{ booked: 20, capacity: 26 }])).toBe(0); // 77%
  });

  it("stops at a week with no capacity, and at half a year", () => {
    expect(busyStreak([{ booked: 22, capacity: 26 }, { booked: 0, capacity: 0 }, { booked: 26, capacity: 26 }])).toBe(1);
    expect(busyStreak(Array.from({ length: 40 }, () => ({ booked: 26, capacity: 26 })))).toBe(WEEK_BOARD_RULES.streakWeeksMax);
  });
});

describe("the suggestion when a day is over", () => {
  it("moves the latest-booked visit to the lightest later day with room", () => {
    const thursday = many("2026-11-26", 6);
    const visits = [...many("2026-11-23", 5), ...thursday, ...many("2026-11-27", 3), visit("2026-11-28")];
    const loads = dayLoads(monday, capacity, visits);
    expect(suggestMove(loads, visits, "2026-11-23")).toEqual({ visitId: thursday[5]?.id, fromDate: "2026-11-26", toDate: "2026-11-28" });
  });

  it("skips visits that cannot move, and days already gone", () => {
    const thursday = [...many("2026-11-26", 5), visit("2026-11-26", { canMove: false, createdAt: "2026-11-20T00:00:00Z" })];
    const visits = [...thursday, ...many("2026-11-27", 4), ...many("2026-11-28", 4)];
    const loads = dayLoads(monday, capacity, visits);
    // Friday has one slot left; Saturday is full.
    expect(suggestMove(loads, visits, "2026-11-23")).toEqual({ visitId: thursday[4]?.id, fromDate: "2026-11-26", toDate: "2026-11-27" });
    expect(suggestMove(loads, visits, "2026-11-28")).toBeNull();
  });

  it("offers nothing when no later day has room", () => {
    const visits = [...many("2026-11-27", 6), ...many("2026-11-28", 4)];
    expect(suggestMove(dayLoads(monday, capacity, visits), visits, monday)).toBeNull();
  });
});

describe("area colours", () => {
  it("are chosen from the name alone, the same however it is typed", () => {
    const colour = areaColour("Jubilee Hills");
    expect(colour).not.toBeNull();
    expect(areaColour("  jubilee   HILLS ")).toBe(colour);
    expect(colour).toBeGreaterThanOrEqual(0);
    expect(colour).toBeLessThan(AREA_COLOURS);
  });

  it("leave an outlet with no area uncoloured", () => {
    expect(areaColour(null)).toBeNull();
    expect(areaColour("   ")).toBeNull();
  });
});

describe("areaColours", () => {
  it("gives every area on a board its own colour, keeping each one's own where there is no clash", () => {
    // Abids, Begumpet and Gachibowli share a colour by name alone.
    expect(new Set([areaColour("Abids"), areaColour("Begumpet"), areaColour("Gachibowli")]).size).toBe(1);
    const colours = areaColours(["Gachibowli", "Abids", "Begumpet", "Jubilee Hills", null, "abids "]);
    expect([...colours.keys()]).toEqual(["abids", "begumpet", "gachibowli", "jubilee hills"]);
    expect(new Set(colours.values()).size).toBe(4);
    expect(colours.get("abids")).toBe(areaColour("Abids"));
    expect(colours.get("jubilee hills")).toBe(areaColour("Jubilee Hills"));
  });

  it("repeats colours only when there are more areas than colours", () => {
    const many = Array.from({ length: AREA_COLOURS + 2 }, (_, index) => `Area ${index}`);
    expect(new Set(areaColours(many.slice(0, AREA_COLOURS)).values()).size).toBe(AREA_COLOURS);
    expect(areaColours(many).size).toBe(AREA_COLOURS + 2);
  });
});
