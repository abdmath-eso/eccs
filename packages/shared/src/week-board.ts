import { z } from "zod";
import type { LocalizedText } from "./checklists.js";
import { addDays } from "./finance.js";
import { weekStartOf } from "./sales.js";
import type { VisitSlot, VisitStatus } from "./services.js";

// The Visits week board (20 Oct 2026, the console plan section 4.2; the founder's
// Dispatch design). The same visits as the diary, laid out Monday to Saturday, with how
// many the crew can take each day ("4 of 5"), the free checks Sales has booked (which use
// no slot), and a capacity box: the week's use, how many weeks in a row have run at 80% or
// more (the founder's rule of thumb for hiring a second crew), and one suggestion when a
// day is over. Patterns: Jobber's week view (one schedule, drag a visit to another day)
// and ServiceTitan's capacity (booked against what the crew can take, per day).

/** The board's six days, Monday first. ECCS does not plan Sundays; a visit put on one is listed under the board. */
export const BOARD_WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type BoardWeekday = (typeof BOARD_WEEKDAYS)[number];

export const BOARD_WEEKDAY_NAMES: Record<BoardWeekday, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
};

/** How many visits a day the crew can take, Monday to Saturday. */
export type VisitCapacity = Record<BoardWeekday, number>;

export const WEEK_BOARD_RULES = {
  /** One crew: five visits a weekday and four on Saturday, 29 a week, until the Super Admin changes it. */
  defaultCapacity: { MON: 5, TUE: 5, WED: 5, THU: 5, FRI: 5, SAT: 4 } as VisitCapacity,
  /** The most a day can be set to. */
  capacityMax: 20,
  /** A week this full or more counts towards the streak. */
  busyPercent: 80,
  /** The streak is counted back at most this many weeks (half a year), so the number stays cheap and readable. */
  streakWeeksMax: 26,
} as const;

/** The capacity setting as the Super Admin changes it: each day 0 (closed) to 20. */
export const visitCapacitySchema = z.object(
  Object.fromEntries(BOARD_WEEKDAYS.map((day) => [day, z.number().int().min(0).max(WEEK_BOARD_RULES.capacityMax)])) as Record<
    BoardWeekday,
    z.ZodNumber
  >,
);
export type VisitCapacityInput = z.input<typeof visitCapacitySchema>;

/** The Monday of the week a date is in. */
export const boardMonday = (date: string) => weekStartOf(date);

/** The six dates of the board, Monday to Saturday. */
export const boardDates = (monday: string) => BOARD_WEEKDAYS.map((_, index) => addDays(monday, index));

/** Which board day a date is, or null for a Sunday. */
export function boardWeekday(date: string): BoardWeekday | null {
  const weekday = new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay(); // Sunday is 0
  return weekday === 0 ? null : (BOARD_WEEKDAYS[weekday - 1] ?? null);
}

/** How many visits the crew can take on a date: none on a Sunday. */
export const capacityOn = (capacity: VisitCapacity, date: string) => {
  const day = boardWeekday(date);
  return day ? capacity[day] : 0;
};

/** A week's capacity in all. */
export const weekCapacity = (capacity: VisitCapacity) => BOARD_WEEKDAYS.reduce((sum, day) => sum + capacity[day], 0);

/** A visit uses a slot unless it was called off. Free checks never do (they are Sales', and short). */
export const usesSlot = (status: VisitStatus) => status !== "CANCELLED";

/** What the rules need to know about a visit on the board. */
export interface BoardVisitFacts {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  status: VisitStatus;
  /** When it was put in the diary: the latest booked is the one suggested to move. */
  createdAt: string;
  /** Whether it can still be moved (not started, and the person may move it). */
  canMove: boolean;
}

export interface DayLoad {
  date: string;
  booked: number;
  capacity: number;
  /** More booked than the crew can take. */
  over: boolean;
}

/** Each board day's booked visits against its capacity, from a count per date. */
export function dayLoadsFrom(monday: string, capacity: VisitCapacity, bookedOn: (date: string) => number): DayLoad[] {
  return boardDates(monday).map((date) => {
    const booked = bookedOn(date);
    const dayCapacity = capacityOn(capacity, date);
    return { date, booked, capacity: dayCapacity, over: booked > dayCapacity };
  });
}

/** Each board day's visits against its capacity. */
export const dayLoads = (monday: string, capacity: VisitCapacity, visits: readonly Pick<BoardVisitFacts, "date" | "status">[]) =>
  dayLoadsFrom(monday, capacity, (date) => visits.filter((visit) => visit.date === date && usesSlot(visit.status)).length);

/** A share in whole per cent, or null when there is nothing to divide by. */
export const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** The week's visits against its capacity. */
export function weekUse(loads: readonly DayLoad[]): { booked: number; capacity: number; percent: number | null } {
  const booked = loads.reduce((sum, day) => sum + day.booked, 0);
  const capacity = loads.reduce((sum, day) => sum + day.capacity, 0);
  return { booked, capacity, percent: percentOf(booked, capacity) };
}

/**
 * How many weeks in a row, counted back from the latest, were 80% full or more. `weeks`
 * runs newest first. A week with no capacity ends the streak (nothing to be full of), and
 * it stops at WEEK_BOARD_RULES.streakWeeksMax.
 */
export function busyStreak(weeks: readonly { booked: number; capacity: number }[]): number {
  let streak = 0;
  for (const week of weeks.slice(0, WEEK_BOARD_RULES.streakWeeksMax)) {
    const percent = percentOf(week.booked, week.capacity);
    if (percent === null || percent < WEEK_BOARD_RULES.busyPercent) break;
    streak += 1;
  }
  return streak;
}

/** A move that would bring an over-full day back within capacity. */
export interface BoardSuggestion {
  visitId: string;
  fromDate: string;
  toDate: string;
}

/**
 * One suggestion when a day is over: on the first over-full day, the visit put in the
 * diary last that can still move, to the lightest later day of the same week with room
 * (the earliest of equally light days). Days before `today` are never offered, because a
 * visit cannot be put on a day that has gone. None when nothing fits.
 */
export function suggestMove(loads: readonly DayLoad[], visits: readonly BoardVisitFacts[], today: string): BoardSuggestion | null {
  for (const [index, day] of loads.entries()) {
    if (!day.over) continue;
    const movable = visits
      .filter((visit) => visit.date === day.date && visit.canMove && usesSlot(visit.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const candidate = movable[0];
    if (!candidate) continue;
    const target = loads
      .slice(index + 1)
      .filter((later) => later.date >= today && later.booked < later.capacity)
      .sort((a, b) => a.booked / a.capacity - b.booked / b.capacity || a.date.localeCompare(b.date))[0];
    if (target) return { visitId: candidate.id, fromDate: day.date, toDate: target.date };
  }
  return null;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (count: number) => NUMBER_WORDS[count] ?? String(count);

/** "Thursday", or "Thursday and Friday", or "Monday, Thursday and Friday". */
function dayList(dates: readonly string[]): string {
  const names = dates.map((date) => {
    const day = boardWeekday(date);
    return day ? BOARD_WEEKDAY_NAMES[day] : date;
  });
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The board's headline: "24 of 26 slots booked. Thursday is one over." */
export function weekHeadline(loads: readonly DayLoad[]): string {
  const { booked, capacity } = weekUse(loads);
  const first = `${booked} of ${capacity} ${capacity === 1 ? "slot" : "slots"} booked.`;
  const over = loads.filter((day) => day.over);
  if (over.length === 0) return first;
  if (over.length === 1) {
    const day = over[0]!;
    return `${first} ${dayList([day.date])} is ${numberWord(day.booked - day.capacity)} over.`;
  }
  return `${first} ${dayList(over.map((day) => day.date))} are over.`;
}

// ───────────────────────── Areas ─────────────────────────

/** How many edge colours the board has. Fixed, so an area keeps its colour from week to week. */
export const AREA_COLOURS = 8;

/** An area's name compared without capitals or extra spaces: "Jubilee  hills" is "Jubilee Hills". */
export const normaliseArea = (area: string | null | undefined) => (area ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Which of the board's colours an area's visits are edged with: chosen from the name
 * alone (a small hash), so it never changes with what else is on the board. Null for an
 * outlet with no area, which gets a plain grey edge.
 */
export function areaColour(area: string | null | undefined): number | null {
  const name = normaliseArea(area);
  if (!name) return null;
  let hash = 2166136261; // FNV-1a
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % AREA_COLOURS;
}

/**
 * The colours of the areas on one board. Each area keeps its own colour (`areaColour`)
 * unless an area earlier in the alphabet on the same board has the same one; it then takes
 * the next colour nobody on the board has. So up to AREA_COLOURS areas on a board never
 * share an edge colour, and an area keeps its colour from week to week unless a clash moves
 * it. With more areas than colours they repeat; the legend and the card's words still tell
 * them apart.
 */
export function areaColours(areas: readonly (string | null | undefined)[]): Map<string, number> {
  const names = [...new Set(areas.map(normaliseArea).filter(Boolean))].sort();
  const colours = new Map<string, number>();
  const taken = new Set<number>();
  // First every area whose own colour is still free keeps it, then the others take what is left.
  const moved: string[] = [];
  for (const name of names) {
    const own = areaColour(name) ?? 0;
    if (taken.has(own)) moved.push(name);
    else {
      taken.add(own);
      colours.set(name, own);
    }
  }
  for (const name of moved) {
    let index = areaColour(name) ?? 0;
    if (taken.size < AREA_COLOURS) while (taken.has(index)) index = (index + 1) % AREA_COLOURS;
    taken.add(index);
    colours.set(name, index);
  }
  return new Map([...colours].sort((a, b) => a[0].localeCompare(b[0])));
}

// ───────────────────────── What the API returns ─────────────────────────

/** One visit on the board. */
export interface WeekBoardVisitDto {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  slot: VisitSlot | null;
  status: VisitStatus;
  outletId: string;
  outletName: string;
  organizationName: string;
  /** The outlet's area, which colours the card's edge; null when not set. */
  area: string | null;
  serviceCode: string;
  serviceName: LocalizedText;
  supervisorId: string | null;
  supervisorName: string | null;
  /** How many tasks the kind of service has (from Catalogue); null when it has none. */
  taskCount: number | null;
  /** How many people did it, once recorded; null before. */
  crewSize: number | null;
  booked: boolean;
  fromPlan: boolean;
  createdAt: string;
  /** True when the person asking may move it now: not started, and theirs to change. */
  canMove: boolean;
}

/** A free check Sales has booked: shown dashed, uses no slot, read-only here. */
export interface WeekBoardCheckDto {
  leadId: string;
  businessName: string;
  area: string | null;
  /** YYYY-MM-DD, India date */
  date: string;
  /** "16:30", India time */
  time: string;
  /** Who from ECCS goes, as Sales typed it. */
  checkWith: string | null;
}

export interface WeekBoardDayDto extends DayLoad {
  visits: WeekBoardVisitDto[];
  checks: WeekBoardCheckDto[];
}

export interface WeekBoardDto {
  /** The Monday and the Saturday of the week shown. */
  start: string;
  end: string;
  today: string;
  headline: string;
  days: WeekBoardDayDto[];
  /** Visits and checks on the week's Sunday, which the board has no column for. */
  sunday: { date: string; visits: WeekBoardVisitDto[]; checks: WeekBoardCheckDto[] };
  week: { booked: number; capacity: number; percent: number | null };
  /** Weeks in a row at 80% or more, counted back from this week (today's), at most `max`. */
  streak: { weeks: number; max: number; busyPercent: number };
  suggestion: (BoardSuggestion & { outletName: string; serviceName: LocalizedText }) | null;
  capacity: VisitCapacity;
  /** The person may move visits (Super Admin and Ops Manager). */
  canMove: boolean;
  /** The person may change the capacity (the Super Admin). */
  canChangeCapacity: boolean;
  /** Free checks are shown only to people who can read Sales. */
  showsChecks: boolean;
}

export interface VisitSettingsDto {
  capacity: VisitCapacity;
  /** When it was last changed; null while it is the defaults. */
  updatedAt: string | null;
  canChange: boolean;
}
