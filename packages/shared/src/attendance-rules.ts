import type { AttendanceStatus } from "./staff.js";

// Attendance by face: the rules that turn clock-ins and clock-outs ("punches")
// into a day's status, and the rule that decides whether a face is a match.
//
// Everything here is plain arithmetic with no database and no clock of its own,
// so the server, the app and the tests all get the same answer from the same
// facts. Salary is worked out from the result, so each rule is written down
// beside the code and tested in attendance-rules.test.ts.

// ───────────────────────── The rules, in one place ─────────────────────────

export const ATTENDANCE_DAY_RULES = {
  /**
   * An "attendance day" starts at this hour, India time, and runs to the same
   * hour the next morning. A dinner shift that ends at 1 am therefore belongs
   * to the day it started on, not to the next one. (The usual way attendance
   * products handle shifts that cross midnight: a cut-off hour, not midnight.)
   */
  dayStartsAtHour: 4,
  /** Hours worked for a full day, in minutes, unless the Owner sets another figure for the outlet. */
  fullDayMinutes: 480,
  /** Hours worked for a half day, in minutes, unless the Owner sets another figure for the outlet. */
  halfDayMinutes: 240,
} as const;

/** India has one time zone and no summer time: always 5 hours 30 minutes ahead of UTC. */
const INDIA_OFFSET_MS = 330 * 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const FACE_RULES = {
  /**
   * How alike two faces must be (cosine similarity of their templates, from
   * -1 to 1) before they can be the same person at all. 0.363 is the figure
   * OpenCV publishes for the SFace model. Below it: no match.
   */
  matchThreshold: 0.363,
  /**
   * How alike they must be for the server to be sure without asking. Between
   * the two figures the answer is "unsure": the person is asked "is this you?"
   * and the punch is marked for the Owner to look at.
   */
  confidentThreshold: 0.5,
  /**
   * The best match must also beat the next most alike person at the outlet by
   * this much. Two people who both look like the photo is "unsure", however
   * high the best score: this is the guard against paying a look-alike.
   */
  marginOverSecond: 0.1,
  /** A second scan by the same person within this many minutes records nothing: "already clocked in". */
  repeatGuardMinutes: 5,
  /** A ticket from "identify" must be confirmed within this many seconds, and once only. */
  ticketSeconds: 120,
  /** The photo taken at a punch is deleted after this many days. */
  punchPhotoDays: 35,
  /** How many photos an enrolment needs, least and most. */
  enrolMinPhotos: 3,
  enrolMaxPhotos: 5,
  /** The largest photo accepted, in bytes. The phone shrinks photos well below this. */
  maxPhotoBytes: 1_500_000,
  /** The face must be at least this many pixels wide in the photo as the server reads it. */
  minFacePixels: 80,
  /**
   * When a second "turn your head" photo is sent, the head must have turned by
   * at least this much between the two (a share of the distance between the
   * eyes). A printed photo held up twice does not turn.
   */
  livenessMinTurn: 0.12,
  /** How many faces one linked phone may send for matching in a minute. */
  identifyPerMinute: 30,
} as const;

/** The Owner must say why, in at least this many characters, for every correction. */
export const CORRECTION_REASON_MIN = 5;

export const PUNCH_KINDS = ["IN", "OUT"] as const;
export type PunchKind = (typeof PUNCH_KINDS)[number];

/** FACE: recognised by the camera. ASSISTED: the Owner or Manager vouched with their PIN. CORRECTION: added afterwards by the Owner. */
export const PUNCH_METHODS = ["FACE", "ASSISTED", "CORRECTION"] as const;
export type PunchMethod = (typeof PUNCH_METHODS)[number];

export const PUNCH_FLAGS = ["UNSURE_MATCH", "ASSISTED", "NO_CLOCK_OUT", "POSSIBLE_SPOOF", "OFFLINE"] as const;
export type PunchFlag = (typeof PUNCH_FLAGS)[number];

/**
 * What can be marked on a day for the Owner to look at: any flag of one of its
 * punches, plus SHORT_DAY (clocked in and out, but for less than half a day)
 * and NO_CLOCK_IN (a clock-out with no clock-in before it).
 */
export const DAY_FLAGS = [...PUNCH_FLAGS, "SHORT_DAY", "NO_CLOCK_IN"] as const;
export type DayFlag = (typeof DAY_FLAGS)[number];

/** Day flags that mean the day's status is a stand-in until the Owner settles it. */
export const DAY_FLAGS_NEEDING_OWNER: readonly DayFlag[] = ["NO_CLOCK_OUT", "NO_CLOCK_IN", "SHORT_DAY"];

// ───────────────────────── The attendance day ─────────────────────────

const toMs = (at: Date | number) => (typeof at === "number" ? at : at.getTime());

/** The attendance day (YYYY-MM-DD) a moment belongs to: 1:30 am on the 10th belongs to the 9th. */
export function attendanceDayOf(at: Date | number, dayStartsAtHour: number = ATTENDANCE_DAY_RULES.dayStartsAtHour): string {
  return new Date(toMs(at) + INDIA_OFFSET_MS - dayStartsAtHour * HOUR_MS).toISOString().slice(0, 10);
}

/** The moment an attendance day begins: 4:00 am India time on that date. */
export function attendanceDayStart(day: string, dayStartsAtHour: number = ATTENDANCE_DAY_RULES.dayStartsAtHour): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - INDIA_OFFSET_MS + dayStartsAtHour * HOUR_MS);
}

/** The moment an attendance day ends, which is the moment the next one begins. */
export function attendanceDayEnd(day: string, dayStartsAtHour: number = ATTENDANCE_DAY_RULES.dayStartsAtHour): Date {
  return new Date(attendanceDayStart(day, dayStartsAtHour).getTime() + DAY_MS);
}

/** True once the whole attendance day is over. */
export const attendanceDayEnded = (day: string, now: Date | number) => toMs(now) >= attendanceDayEnd(day).getTime();

/** The date one day after (or `by` days from) a YYYY-MM-DD date. */
export const shiftDate = (date: string, by: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + by * DAY_MS).toISOString().slice(0, 10);

// ───────────────────────── Punches ─────────────────────────

/** A punch as the rules see it. Voided punches must be left out before calling. */
export interface RulePunch {
  /** When, as milliseconds since 1970 (the server's own clock, never the phone's). */
  at: number;
  kind: PunchKind;
  flag?: PunchFlag | null;
}

const inOrder = (punches: readonly RulePunch[]) => [...punches].sort((a, b) => a.at - b.at);

/**
 * Whether the person's next scan clocks them in or out: out if the last punch
 * of this attendance day was a clock-in, in otherwise. A clock-in left open
 * yesterday does not carry over; a new day always starts with a clock-in.
 */
export function nextPunchKind(punchesOfDay: readonly RulePunch[]): PunchKind {
  const last = inOrder(punchesOfDay).at(-1);
  return last?.kind === "IN" ? "OUT" : "IN";
}

/** True when a scan comes so soon after the person's last punch that it is taken as the same one. */
export const withinRepeatGuard = (lastPunchAt: number, now: number) =>
  now - lastPunchAt < FACE_RULES.repeatGuardMinutes * 60_000 && now >= lastPunchAt;

export interface PunchPair {
  inAt: number;
  /** Null while the person has not clocked out. */
  outAt: number | null;
}

/**
 * Pairs each clock-in with the clock-out that follows it. Split shifts give
 * several pairs. A clock-in followed by another clock-in is left open (no
 * clock-out was recorded for it); a clock-out with no clock-in before it is
 * counted as stray. Neither can happen through the camera, which always
 * alternates, but both can after the Owner voids or adds a punch.
 */
export function pairPunches(punches: readonly RulePunch[]): { pairs: PunchPair[]; strayOuts: number } {
  const pairs: PunchPair[] = [];
  let strayOuts = 0;
  let open: PunchPair | null = null;
  for (const punch of inOrder(punches)) {
    if (punch.kind === "IN") {
      open = { inAt: punch.at, outAt: null };
      pairs.push(open);
    } else if (open) {
      open.outAt = punch.at;
      open = null;
    } else {
      strayOuts += 1;
    }
  }
  return { pairs, strayOuts };
}

// ───────────────────────── From punches to a day ─────────────────────────

export interface DaySummaryInput {
  /** The attendance day, YYYY-MM-DD. */
  day: string;
  /** The moment the question is asked. */
  now: Date | number;
  /** The person's un-voided punches of that attendance day, in any order. */
  punches: readonly RulePunch[];
  fullDayMinutes: number;
  halfDayMinutes: number;
  /** True when this weekday is the person's usual day off. */
  usualDayOff: boolean;
}

export interface DaySummary {
  /** Null means "nothing to say yet": today, with no punch so far. */
  status: AttendanceStatus | null;
  /**
   * True when the status is a stand-in: the day is still running, or a punch
   * is missing and the Owner has to settle it.
   */
  provisional: boolean;
  /** Minutes between each clock-in and its clock-out, added up. Null when a punch is missing, so the time is not known. */
  workedMinutes: number | null;
  flags: DayFlag[];
  firstInAt: number | null;
  lastOutAt: number | null;
  /** True when the person is clocked in right now (only possible while the day is running). */
  onDuty: boolean;
  /** True once the attendance day is over. */
  ended: boolean;
}

/**
 * One person's attendance day, from their punches.
 *
 * No punches: nothing while the day is running; once it has ended, the weekly
 * off if this is the person's usual day off, otherwise absent. (Leave is not
 * decided here: the Owner records it, and the Owner's entry is never replaced
 * by this function's answer.)
 *
 * With punches, while the day is running: present, provisionally. The person
 * came to work; how long for is judged when the day is over.
 *
 * With punches, once the day has ended:
 * - a clock-in with no clock-out (or a clock-out with no clock-in): the time
 *   worked is unknown. The day is marked NO_CLOCK_OUT (or NO_CLOCK_IN) and
 *   counted present, provisionally: the benefit of the doubt goes to the worker
 *   until the Owner corrects it. Forgetting to clock out is the commonest
 *   mistake there is, and it must not cost a day's pay by itself.
 * - otherwise by the minutes worked: the full-day figure or more is present;
 *   the half-day figure or more is a half day; less is absent and marked
 *   SHORT_DAY so the Owner sees it rather than it passing silently.
 */
export function summariseDay(input: DaySummaryInput): DaySummary {
  const now = toMs(input.now);
  const ended = attendanceDayEnded(input.day, now);
  const punches = inOrder(input.punches);
  const flags = new Set<DayFlag>();
  for (const punch of punches) if (punch.flag) flags.add(punch.flag);

  if (punches.length === 0) {
    const status = ended ? (input.usualDayOff ? "WEEKLY_OFF" : "ABSENT") : null;
    return { status, provisional: false, workedMinutes: ended ? 0 : null, flags: [], firstInAt: null, lastOutAt: null, onDuty: false, ended };
  }

  const { pairs, strayOuts } = pairPunches(punches);
  const openPairs = pairs.filter((pair) => pair.outAt === null);
  const closedMs = pairs.reduce((total, pair) => (pair.outAt === null ? total : total + (pair.outAt - pair.inAt)), 0);
  const firstInAt = pairs[0]?.inAt ?? null;
  const lastOutAt = punches.filter((punch) => punch.kind === "OUT").at(-1)?.at ?? null;
  // Only the last clock-in can still be running; an earlier one left open was simply never closed.
  const lastPair = pairs.at(-1);
  const onDuty = !ended && lastPair !== undefined && lastPair.outAt === null && punches.at(-1)?.kind === "IN";
  const sorted = (found: Set<DayFlag>) => DAY_FLAGS.filter((flag) => found.has(flag));

  if (!ended) {
    // Still running: time so far counts the shift in progress up to now.
    const runningMs = onDuty && lastPair ? Math.max(0, now - lastPair.inAt) : 0;
    return {
      status: "PRESENT",
      provisional: true,
      workedMinutes: Math.floor((closedMs + runningMs) / 60_000),
      flags: sorted(flags),
      firstInAt,
      lastOutAt,
      onDuty,
      ended,
    };
  }

  if (openPairs.length > 0) flags.add("NO_CLOCK_OUT");
  if (strayOuts > 0) flags.add("NO_CLOCK_IN");
  if (openPairs.length > 0 || strayOuts > 0) {
    return { status: "PRESENT", provisional: true, workedMinutes: null, flags: sorted(flags), firstInAt, lastOutAt, onDuty: false, ended };
  }

  const workedMinutes = Math.floor(closedMs / 60_000);
  let status: AttendanceStatus;
  if (workedMinutes >= input.fullDayMinutes) status = "PRESENT";
  else if (workedMinutes >= input.halfDayMinutes) status = "HALF_DAY";
  else {
    status = "ABSENT";
    flags.add("SHORT_DAY");
  }
  return { status, provisional: false, workedMinutes, flags: sorted(flags), firstInAt, lastOutAt, onDuty: false, ended };
}

// ───────────────────────── Is this face a match? ─────────────────────────

export const MATCH_RESULTS = ["MATCH", "UNSURE", "NO_MATCH"] as const;
export type MatchResult = (typeof MATCH_RESULTS)[number];

export interface MatchDecision<T> {
  result: MatchResult;
  /** The most alike person, when anyone reached the match threshold. */
  best: { who: T; score: number } | null;
  /** How alike the next most alike person was; null when the outlet has only one enrolled person. */
  secondScore: number | null;
}

/**
 * Decides who a face is, from how alike it is to each enrolled person of the
 * outlet (one score per person: their best template).
 *
 * - Nobody reaches the match threshold: NO_MATCH.
 * - The best reaches the stricter "confident" threshold and beats the next
 *   person by the margin: MATCH.
 * - Anything in between: UNSURE. The person is asked to confirm, and the punch
 *   is marked for the Owner.
 *
 * A wrong match pays the wrong person, while a missed match costs twenty
 * seconds and the assisted route, so the rule leans towards "unsure".
 */
export function decideMatch<T>(
  scores: readonly { who: T; score: number }[],
  rules: { matchThreshold: number; confidentThreshold: number; marginOverSecond: number } = FACE_RULES,
): MatchDecision<T> {
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const secondScore = ranked[1]?.score ?? null;
  if (!best || best.score < rules.matchThreshold) return { result: "NO_MATCH", best: null, secondScore };
  const clear = secondScore === null || best.score - secondScore >= rules.marginOverSecond;
  const result: MatchResult = best.score >= rules.confidentThreshold && clear ? "MATCH" : "UNSURE";
  return { result, best, secondScore };
}
