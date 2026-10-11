import { z } from "zod";
import type { AttendanceDayCellDto, AttendanceDayFactsDto } from "./attendance.js";
import { daysInMonth, shiftMonth } from "./calendar.js";
import { isCalendarDate } from "./licences.js";

// The restaurant's own staff: who works there, their attendance, and a salary tracker.
//
// This is a record book for the Owner and Manager, not payroll. It works out
// what a month's pay comes to from the attendance marked, lets every figure be
// replaced by the Owner's own, and keeps advances and payments one by one. It
// knows nothing of PF, ESI, professional tax or minimum wages, and pays nobody.
//
// ECCS staff have no access to any of it (see permissions.ts).
//
// Since face attendance (11 Oct 2026) nobody marks attendance by hand. A day's
// status is worked out from the clock-ins and clock-outs (attendance-rules.ts,
// attendance.ts) and stored in the same place as before, so the pay arithmetic
// below is unchanged. Only the Owner can set or correct a day, with a reason.

// ───────────────────────── The rules, in one place ─────────────────────────

/** How a day can be marked. LEAVE is leave with pay (also used for a paid holiday); ABSENT is without pay. */
export const ATTENDANCE_STATUSES = ["PRESENT", "HALF_DAY", "ABSENT", "LEAVE", "WEEKLY_OFF"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const STAFF_PAY_TYPES = ["MONTHLY", "DAILY"] as const;
export type StaffPayType = (typeof STAFF_PAY_TYPES)[number];

export const STAFF_PAY_ENTRY_KINDS = ["ADVANCE", "PAYMENT"] as const;
export type StaffPayEntryKind = (typeof STAFF_PAY_ENTRY_KINDS)[number];

/** Jobs offered as one-tap suggestions when adding a person; anything else can be typed. */
export const STAFF_JOB_SUGGESTIONS = ["cook", "helper", "cleaner", "dishwasher", "waiter", "cashier", "delivery"] as const;
export type StaffJobSuggestion = (typeof STAFF_JOB_SUGGESTIONS)[number];

export const STAFF_RULES = {
  /**
   * How far back the Owner can correct attendance (a day's status, or a punch): this month
   * and this many months before it. Last month's pay is usually settled in the
   * first days of this one, so last month stays open; anything older is closed so
   * that a month already settled does not quietly change.
   */
  correctionMonthsBack: 1,
  /** What a half day counts as, in days. */
  halfDay: 0.5,
} as const;

// ───────────────────────── Dates ─────────────────────────

const pad = (value: number) => String(value).padStart(2, "0");

/** True for a month written as YYYY-MM. */
export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** The month ("2026-10") a date ("2026-10-09") falls in. */
export const monthOfDate = (date: string) => date.slice(0, 7);

/** The first and last day of a month. */
export const monthBounds = (month: string) => ({ first: `${month}-01`, last: `${month}-${pad(daysInMonth(month))}` });

/** The day of the week of a date: 0 Sunday to 6 Saturday. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The earliest day whose attendance the Owner may still correct. */
export const earliestCorrectableDate = (today: string) =>
  `${shiftMonth(monthOfDate(today), -STAFF_RULES.correctionMonthsBack)}-01`;

export type AttendanceDateVerdict = "OK" | "FUTURE" | "TOO_OLD" | "TODAY_ONLY";

/**
 * Whether a day may be opened or corrected. Nobody touches a day that has not
 * come. Someone who may correct (the Owner) goes back as far as the rule above;
 * for someone who may not, `mayCorrect` false keeps them to today (the Head
 * Chef's view of who is in).
 */
export function attendanceDateVerdict(date: string, today: string, mayCorrect: boolean): AttendanceDateVerdict {
  if (date > today) return "FUTURE";
  if (date === today) return "OK";
  if (!mayCorrect) return "TODAY_ONLY";
  return date < earliestCorrectableDate(today) ? "TOO_OLD" : "OK";
}

/** True if the person was on the staff that day: on or after joining, and not after their last day. */
export const worksOn = (person: { joinedOn: string | null; leftOn: string | null }, date: string) =>
  (person.joinedOn === null || person.joinedOn <= date) && (person.leftOn === null || person.leftOn >= date);

// ───────────────────────── A month's attendance ─────────────────────────

export interface AttendanceTotals {
  /** Days in the whole calendar month. */
  daysInMonth: number;
  /**
   * The days that count for this person: from the 1st (or the day they joined)
   * to the end of the month (or their last day, or today if the month is still running).
   */
  countedDays: number;
  /** The last day counted, YYYY-MM-DD; null when no day counts. */
  upTo: string | null;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  /** Days marked as the weekly off, plus the person's usual day off where nothing was marked. */
  weeklyOff: number;
  /** Counted days with no mark at all. */
  notMarked: number;
}

export interface AttendanceMonthInput {
  /** YYYY-MM */
  month: string;
  /** Today in India; days after it are not counted. */
  today: string;
  joinedOn: string | null;
  leftOn: string | null;
  /** 0 Sunday to 6 Saturday, or null. */
  weeklyOffDay: number | null;
  /** The marks made, by date. Dates outside the month are ignored. */
  marks: Readonly<Record<string, AttendanceStatus>>;
}

/**
 * Adds up one person's month. A day with no mark that falls on the person's
 * usual day off is counted as their weekly off; any other day with no mark is
 * "not marked". Days before joining, after leaving or still to come are left out.
 */
export function attendanceTotals(input: AttendanceMonthInput): AttendanceTotals {
  const { first, last } = monthBounds(input.month);
  const from = input.joinedOn && input.joinedOn > first ? input.joinedOn : first;
  let to = last;
  if (input.today < to) to = input.today;
  if (input.leftOn && input.leftOn < to) to = input.leftOn;

  const totals: AttendanceTotals = {
    daysInMonth: daysInMonth(input.month),
    countedDays: 0,
    upTo: null,
    present: 0,
    halfDay: 0,
    absent: 0,
    leave: 0,
    weeklyOff: 0,
    notMarked: 0,
  };
  if (from > to) return totals;

  const firstDay = Number(from.slice(8));
  const lastDay = Number(to.slice(8));
  for (let day = firstDay; day <= lastDay; day += 1) {
    const date = `${input.month}-${pad(day)}`;
    const status = input.marks[date];
    totals.countedDays += 1;
    if (status === "PRESENT") totals.present += 1;
    else if (status === "HALF_DAY") totals.halfDay += 1;
    else if (status === "ABSENT") totals.absent += 1;
    else if (status === "LEAVE") totals.leave += 1;
    else if (status === "WEEKLY_OFF" || weekdayOf(date) === input.weeklyOffDay) totals.weeklyOff += 1;
    else totals.notMarked += 1;
  }
  totals.upTo = to;
  return totals;
}

// ───────────────────────── A month's pay ─────────────────────────

export interface MonthPay {
  /** The days paid for. Halves are possible (12.5). */
  paidDays: number;
  /** For monthly pay: the days the month's salary is divided by. Null for daily pay. */
  divisor: number | null;
  /** What the month's pay comes to, in paise, before overtime, bonus, advances and deductions. */
  duePaise: number;
}

/**
 * What a month's pay comes to from the attendance.
 *
 * Paid by the month: the salary is divided by the calendar days in the month.
 * Every counted day is paid except an absence (a full day lost) and a half day
 * (half a day lost). So a weekly off, leave and a day nobody marked are all paid:
 * a monthly salary is fixed unless an absence is recorded.
 *
 * Paid by the day: the wage is paid for each day present, half for a half day,
 * and for a day of leave (leave here means leave with pay). The weekly off, an
 * absence and a day nobody marked are not paid.
 *
 * These are this app's own plain rules, not the law's. The Owner can replace the
 * result with their own figure.
 */
export function monthPay(payType: StaffPayType, ratePaise: number, totals: AttendanceTotals): MonthPay {
  if (payType === "DAILY") {
    const paidDays = totals.present + totals.halfDay * STAFF_RULES.halfDay + totals.leave;
    return { paidDays, divisor: null, duePaise: Math.round(ratePaise * paidDays) };
  }
  const paidDays = totals.countedDays - totals.absent - totals.halfDay * STAFF_RULES.halfDay;
  return {
    paidDays,
    divisor: totals.daysInMonth,
    duePaise: Math.round((ratePaise * paidDays) / totals.daysInMonth),
  };
}

/** Where a month's pay stands. */
export type SalaryState = "DUE" | "PART_PAID" | "SETTLED" | "OVERPAID";

/** What the Owner typed for a month, where anything was. */
export interface SalaryMonthEntryInput {
  /** The rate of pay kept for that month; null means the person's pay as it is now. */
  payType: StaffPayType | null;
  ratePaise: number | null;
  dueOverridePaise: number | null;
  carriedOverridePaise: number | null;
  overtimePaise: number;
  bonusPaise: number;
  deductionsPaise: number;
}

export interface SalaryFigures {
  month: string;
  /** True for a month before any record was kept for this person: nothing is worked out for it. */
  beforeRecords: boolean;
  payType: StaffPayType;
  ratePaise: number;
  totals: AttendanceTotals;
  paidDays: number;
  divisor: number | null;
  /** The month's pay as the app works it out from attendance. */
  computedDuePaise: number;
  /** The Owner's own figure, when they replaced the app's. */
  dueOverridePaise: number | null;
  /** The one that is used: the Owner's if there is one, otherwise the app's. */
  duePaise: number;
  overtimePaise: number;
  bonusPaise: number;
  advancesPaise: number;
  deductionsPaise: number;
  /** due + overtime + bonus − advances − deductions. Negative when advances were more than the pay. */
  netPaise: number;
  /** Owed (positive) or overpaid (negative) at the end of the month before, as the app works it out. */
  carriedComputedPaise: number;
  carriedOverridePaise: number | null;
  carriedPaise: number;
  /** net + carried: what there is to pay. */
  payablePaise: number;
  paidPaise: number;
  /** payable − paid. Positive: still owed. Negative: overpaid, carried to next month. */
  balancePaise: number;
  state: SalaryState;
}

export interface StaffSalaryInput {
  person: {
    payType: StaffPayType;
    /** The monthly salary or the daily wage as it is now, in paise. */
    ratePaise: number;
    joinedOn: string | null;
    leftOn: string | null;
    weeklyOffDay: number | null;
  };
  today: string;
  /** Every attendance mark of the person, by date. */
  marks: Readonly<Record<string, AttendanceStatus>>;
  /** What was typed for each month, by YYYY-MM. */
  records: Readonly<Record<string, SalaryMonthEntryInput>>;
  /** Every advance and payment, with the month it counts against. */
  entries: readonly { month: string; kind: StaffPayEntryKind; amountPaise: number }[];
  /** The month wanted, YYYY-MM. Not after this month. */
  month: string;
}

function stateOf(balancePaise: number, paidPaise: number): SalaryState {
  if (balancePaise < 0) return "OVERPAID";
  if (balancePaise === 0) return "SETTLED";
  return paidPaise > 0 ? "PART_PAID" : "DUE";
}

/**
 * One person's pay for a month, with what was carried in from the months before.
 *
 * Records begin with the first month that has any attendance mark, advance,
 * payment or typed figure (or this month, if there is none yet). From there each
 * month is worked out in turn and its balance, owed or overpaid, is carried into
 * the next, unless the Owner typed their own carried figure for a month, which is
 * then used from that month on. A month before the records began is all zeros.
 */
export function staffSalaryMonth(input: StaffSalaryInput): SalaryFigures {
  const thisMonth = monthOfDate(input.today);
  const dataMonths = [
    ...Object.keys(input.marks).map(monthOfDate),
    ...Object.keys(input.records),
    ...input.entries.map((entry) => entry.month),
  ];
  const start = dataMonths.reduce((earliest, month) => (month < earliest ? month : earliest), thisMonth);

  let carried = 0;
  let figures: SalaryFigures | null = null;
  // An empty loop (the month wanted is before the records began) falls through to the zeros below.
  for (let month = start; month <= input.month; month = shiftMonth(month, 1)) {
    const record = input.records[month];
    const payType = record?.payType ?? input.person.payType;
    const ratePaise = record?.ratePaise ?? input.person.ratePaise;
    const totals = attendanceTotals({ ...input.person, month, today: input.today, marks: input.marks });
    const pay = monthPay(payType, ratePaise, totals);
    const sum = (kind: StaffPayEntryKind) =>
      input.entries.reduce((total, entry) => (entry.month === month && entry.kind === kind ? total + entry.amountPaise : total), 0);

    const dueOverridePaise = record?.dueOverridePaise ?? null;
    const carriedOverridePaise = record?.carriedOverridePaise ?? null;
    const duePaise = dueOverridePaise ?? pay.duePaise;
    const overtimePaise = record?.overtimePaise ?? 0;
    const bonusPaise = record?.bonusPaise ?? 0;
    const deductionsPaise = record?.deductionsPaise ?? 0;
    const advancesPaise = sum("ADVANCE");
    const paidPaise = sum("PAYMENT");
    const netPaise = duePaise + overtimePaise + bonusPaise - advancesPaise - deductionsPaise;
    const carriedPaise = carriedOverridePaise ?? carried;
    const payablePaise = netPaise + carriedPaise;
    const balancePaise = payablePaise - paidPaise;

    figures = {
      month,
      beforeRecords: false,
      payType,
      ratePaise,
      totals,
      paidDays: pay.paidDays,
      divisor: pay.divisor,
      computedDuePaise: pay.duePaise,
      dueOverridePaise,
      duePaise,
      overtimePaise,
      bonusPaise,
      advancesPaise,
      deductionsPaise,
      netPaise,
      carriedComputedPaise: carried,
      carriedOverridePaise,
      carriedPaise,
      payablePaise,
      paidPaise,
      balancePaise,
      state: stateOf(balancePaise, paidPaise),
    };
    carried = balancePaise;
  }
  if (figures) return figures;

  const totals = attendanceTotals({ ...input.person, month: input.month, today: input.today, marks: {} });
  return {
    month: input.month,
    beforeRecords: true,
    payType: input.person.payType,
    ratePaise: input.person.ratePaise,
    totals,
    paidDays: 0,
    divisor: input.person.payType === "MONTHLY" ? totals.daysInMonth : null,
    computedDuePaise: 0,
    dueOverridePaise: null,
    duePaise: 0,
    overtimePaise: 0,
    bonusPaise: 0,
    advancesPaise: 0,
    deductionsPaise: 0,
    netPaise: 0,
    carriedComputedPaise: 0,
    carriedOverridePaise: null,
    carriedPaise: 0,
    payablePaise: 0,
    paidPaise: 0,
    balancePaise: 0,
    state: "SETTLED",
  };
}

// ───────────────────────── What the apps send ─────────────────────────

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine(isCalendarDate, "That date does not exist");

export const staffMonthSchema = z.string().refine(isMonth, "Give the month as YYYY-MM");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** Whole paise. One crore rupees is far above any figure this book will hold. */
const paise = z.number().int().min(0).max(1_000_000_000);

const staffFields = {
  name: z.string().trim().min(2, "Type the person's name").max(80),
  /** The job, in the person's own words: "Tandoor cook". */
  jobTitle: optionalText(60),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,15}$/, "Type the phone number in digits")
    .nullish()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  joinedOn: dateSchema.nullish().transform((value) => value ?? null),
  payType: z.enum(STAFF_PAY_TYPES),
  /** The monthly salary or the daily wage, in paise. */
  payPaise: paise,
  /** 0 Sunday to 6 Saturday; null when the person has no fixed day off. */
  weeklyOffDay: z.number().int().min(0).max(6).nullish().transform((value) => value ?? null),
  /** The person's app login, where they have one. */
  userId: z.string().min(1).nullish().transform((value) => value ?? null),
};

export const createStaffMemberSchema = z.object({ outletId: z.string().min(1), ...staffFields });
export type CreateStaffMemberInput = z.input<typeof createStaffMemberSchema>;

export const updateStaffMemberSchema = z.object({
  name: staffFields.name.optional(),
  jobTitle: z.string().trim().max(60).nullable().optional(),
  phone: z.union([z.string().trim().regex(/^\+?[0-9 ]{7,15}$/, "Type the phone number in digits"), z.literal(""), z.null()]).optional(),
  joinedOn: dateSchema.nullable().optional(),
  payType: z.enum(STAFF_PAY_TYPES).optional(),
  payPaise: paise.optional(),
  weeklyOffDay: z.number().int().min(0).max(6).nullable().optional(),
  userId: z.string().min(1).nullable().optional(),
  /** The last day the person worked: marks them as having left. Null brings them back. */
  leftOn: dateSchema.nullable().optional(),
});
export type UpdateStaffMemberInput = z.input<typeof updateStaffMemberSchema>;

/**
 * The Owner's correction of a day for several people at once (the older shape;
 * `correctDaySchema` in attendance.ts does one person). Since face attendance
 * only the Owner may send it, and `reason` is required: it is optional in this
 * schema only so that apps built before the change still compile, and the
 * server refuses the request without it.
 */
export const markAttendanceSchema = z.object({
  outletId: z.string().min(1),
  date: dateSchema,
  /** One entry per person. A null status takes the Owner's entry away again, and the day goes back to what the punches say. */
  marks: z
    .array(z.object({ staffId: z.string().min(1), status: z.enum(ATTENDANCE_STATUSES).nullable() }))
    .min(1)
    .max(300),
  /** Why. At least five characters. */
  reason: z.string().trim().max(300).optional(),
});
export type MarkAttendanceInput = z.input<typeof markAttendanceSchema>;

export const saveSalarySchema = z.object({
  overtimeHours: z.number().min(0).max(744),
  overtimePaise: paise,
  bonusPaise: paise,
  deductionsPaise: paise,
  /** The Owner's own figure for the month's pay; null goes back to the app's. */
  dueOverridePaise: paise.nullable(),
  /** The Owner's own figure for what was carried in; negative means overpaid. Null goes back to the app's. */
  carriedOverridePaise: z.number().int().min(-1_000_000_000).max(1_000_000_000).nullable(),
  note: optionalText(300),
});
export type SaveSalaryInput = z.input<typeof saveSalarySchema>;

export const addPayEntrySchema = z.object({
  kind: z.enum(STAFF_PAY_ENTRY_KINDS),
  /** The month whose pay it counts against, YYYY-MM. */
  month: staffMonthSchema,
  /** The day the money was handed over. */
  date: dateSchema,
  amountPaise: z.number().int().min(1, "Type the amount").max(1_000_000_000),
  note: optionalText(120),
});
export type AddPayEntryInput = z.input<typeof addPayEntrySchema>;

// ───────────────────────── What the server answers ─────────────────────────

export interface StaffMemberDto {
  id: string;
  outletId: string;
  name: string;
  jobTitle: string | null;
  phone: string | null;
  /** YYYY-MM-DD */
  joinedOn: string | null;
  /** The last day they worked, once they have left. */
  leftOn: string | null;
  isActive: boolean;
  weeklyOffDay: number | null;
  /** Their app login, where they have one, and its name. */
  userId: string | null;
  userName: string | null;
  /** How they are paid. Null for a reader who may not see pay (the Head Chef). */
  pay: { payType: StaffPayType; payPaise: number } | null;
  /** True once any attendance, advance, payment or pay figure exists: the person can then only be marked as left. */
  hasRecords: boolean;
}

export interface AttendanceDayPersonDto extends AttendanceDayFactsDto {
  staffId: string;
  name: string;
  jobTitle: string | null;
  status: AttendanceStatus | null;
  /** True when this is the person's usual day off. */
  usualDayOff: boolean;
  /** The Owner who set the status, when it was set by hand. */
  markedByName: string | null;
  /** True when the person's face is enrolled, so the camera can recognise them. */
  enrolled: boolean;
}

export interface AttendanceDayDto {
  outletId: string;
  /** YYYY-MM-DD */
  date: string;
  today: string;
  /** The earliest day this reader may open: today for the Head Chef. */
  earliestDate: string;
  /** Whether this reader may correct this day: the Owner only, within the correction window. */
  editable: boolean;
  people: AttendanceDayPersonDto[];
}

export interface AttendanceMonthDto {
  outletId: string;
  /** YYYY-MM */
  month: string;
  today: string;
  people: {
    staffId: string;
    name: string;
    jobTitle: string | null;
    isActive: boolean;
    totals: AttendanceTotals;
    /** Each day of the month that has a status or a punch, by date: first in, last out, minutes worked, what to look at. */
    days: Record<string, AttendanceDayCellDto>;
  }[];
}

export interface StaffMonthDto {
  staff: StaffMemberDto;
  month: string;
  today: string;
  /** The earliest day the reader may correct. */
  earliestDate: string;
  /** The status of each day this month that has one, by date. */
  marks: Record<string, AttendanceStatus>;
  /** The same days, and any other day with a punch, with first in, last out, minutes worked and what to look at. */
  days: Record<string, AttendanceDayCellDto>;
  totals: AttendanceTotals;
  /**
   * How many daily checklists the person handed in this month under their own app
   * login. Null when they have no login linked.
   */
  checklistsHandedIn: number | null;
}

export interface StaffPayEntryDto {
  id: string;
  kind: StaffPayEntryKind;
  /** YYYY-MM-DD */
  date: string;
  amountPaise: number;
  note: string | null;
}

export interface SalaryMonthDto extends SalaryFigures {
  staffId: string;
  name: string;
  jobTitle: string | null;
  isActive: boolean;
  outletId: string;
  outletName: string;
  organizationName: string;
  overtimeHours: number;
  note: string | null;
  /** The advances and payments counted against this month, oldest first. */
  entries: StaffPayEntryDto[];
  /** The date of the latest payment for this month. */
  lastPaidOn: string | null;
}

export interface SalaryOutletMonthDto {
  outletId: string;
  month: string;
  today: string;
  people: SalaryMonthDto[];
}
