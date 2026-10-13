import { describe, expect, it } from "vitest";
import {
  attendanceDateVerdict,
  attendanceTotals,
  countedFromOf,
  divisorFor,
  earliestCorrectableDate,
  isSalaryDivisor,
  monthPay,
  ownRecordLocked,
  staffSalaryMonth,
  worksOn,
  type AttendanceStatus,
  type SalaryMonthEntryInput,
  type StaffSalaryInput,
} from "./staff.js";

const rupees = (amount: number) => amount * 100;

/** Marks the same status on a run of days of one month: days(“2026-10”, 1, 5, "PRESENT"). */
function days(month: string, from: number, to: number, status: AttendanceStatus): Record<string, AttendanceStatus> {
  const marks: Record<string, AttendanceStatus> = {};
  for (let day = from; day <= to; day += 1) marks[`${month}-${String(day).padStart(2, "0")}`] = status;
  return marks;
}

const noOne = { joinedOn: null, leftOn: null, weeklyOffDay: null };
const typed = (values: Partial<SalaryMonthEntryInput>): SalaryMonthEntryInput => ({
  payType: null,
  ratePaise: null,
  dueOverridePaise: null,
  carriedOverridePaise: null,
  overtimePaise: 0,
  bonusPaise: 0,
  deductionsPaise: 0,
  ...values,
});

describe("ownRecordLocked", () => {
  const manager = { userId: "user-manager", isOwner: false };

  it("locks a person's own record to them, and nobody else's", () => {
    expect(ownRecordLocked(manager, { userId: "user-manager" })).toBe(true);
    expect(ownRecordLocked(manager, { userId: "user-chef" })).toBe(false);
  });

  it("cannot tell whose a record is until it is linked to a login", () => {
    expect(ownRecordLocked(manager, { userId: null })).toBe(false);
  });

  it("never locks the Owner, who has nobody above to make the change for them", () => {
    expect(ownRecordLocked({ userId: "user-owner", isOwner: true }, { userId: "user-owner" })).toBe(false);
  });
});

describe("attendanceDateVerdict", () => {
  const today = "2026-10-09";

  it("never allows a day that has not come", () => {
    expect(attendanceDateVerdict("2026-10-10", today, true)).toBe("FUTURE");
    expect(attendanceDateVerdict("2026-10-10", today, false)).toBe("FUTURE");
  });

  it("lets someone who may only mark do today and nothing else", () => {
    expect(attendanceDateVerdict(today, today, false)).toBe("OK");
    expect(attendanceDateVerdict("2026-10-08", today, false)).toBe("TODAY_ONLY");
  });

  it("lets a corrector go back to the first day of last month and no further", () => {
    expect(earliestCorrectableDate(today)).toBe("2026-09-01");
    expect(attendanceDateVerdict("2026-09-01", today, true)).toBe("OK");
    expect(attendanceDateVerdict("2026-08-31", today, true)).toBe("TOO_OLD");
    // January reaches back into December of the year before.
    expect(earliestCorrectableDate("2027-01-03")).toBe("2026-12-01");
  });
});

describe("worksOn", () => {
  it("is true from the joining day to the last day, both included", () => {
    const person = { joinedOn: "2026-10-05", leftOn: "2026-10-20" };
    expect(worksOn(person, "2026-10-04")).toBe(false);
    expect(worksOn(person, "2026-10-05")).toBe(true);
    expect(worksOn(person, "2026-10-20")).toBe(true);
    expect(worksOn(person, "2026-10-21")).toBe(false);
    expect(worksOn({ joinedOn: null, leftOn: null }, "2020-01-01")).toBe(true);
  });
});

describe("attendanceTotals", () => {
  it("counts each kind of day in a finished month", () => {
    const totals = attendanceTotals({
      ...noOne,
      month: "2026-09",
      today: "2026-10-09",
      marks: {
        ...days("2026-09", 1, 20, "PRESENT"),
        ...days("2026-09", 21, 22, "HALF_DAY"),
        ...days("2026-09", 23, 25, "ABSENT"),
        ...days("2026-09", 26, 26, "LEAVE"),
        ...days("2026-09", 27, 27, "WEEKLY_OFF"),
      },
    });
    expect(totals).toEqual({
      daysInMonth: 30,
      countedDays: 30,
      upTo: "2026-09-30",
      present: 20,
      halfDay: 2,
      absent: 3,
      leave: 1,
      weeklyOff: 1,
      notMarked: 3,
    });
  });

  it("knows the length of each month, leap years included", () => {
    const length = (month: string) => attendanceTotals({ ...noOne, month, today: "2030-01-01", marks: {} }).daysInMonth;
    expect(length("2026-02")).toBe(28);
    expect(length("2028-02")).toBe(29);
    expect(length("2026-04")).toBe(30);
    expect(length("2026-12")).toBe(31);
  });

  it("stops at today while the month is still running", () => {
    const totals = attendanceTotals({ ...noOne, month: "2026-10", today: "2026-10-09", marks: days("2026-10", 1, 9, "PRESENT") });
    expect(totals).toMatchObject({ daysInMonth: 31, countedDays: 9, upTo: "2026-10-09", present: 9, notMarked: 0 });
  });

  it("leaves out the days before joining and after leaving", () => {
    const totals = attendanceTotals({
      joinedOn: "2026-09-11",
      leftOn: "2026-09-20",
      weeklyOffDay: null,
      month: "2026-09",
      today: "2026-10-09",
      // Marks outside the ten days worked are ignored.
      marks: days("2026-09", 1, 30, "PRESENT"),
    });
    expect(totals).toMatchObject({ countedDays: 10, upTo: "2026-09-20", present: 10 });
  });

  it("counts nothing in a month wholly before joining, after leaving, or still to come", () => {
    const base = { weeklyOffDay: null, marks: {}, today: "2026-10-09" };
    expect(attendanceTotals({ ...base, joinedOn: "2026-10-01", leftOn: null, month: "2026-09" })).toMatchObject({ countedDays: 0, upTo: null });
    expect(attendanceTotals({ ...base, joinedOn: null, leftOn: "2026-08-31", month: "2026-09" })).toMatchObject({ countedDays: 0, upTo: null });
    expect(attendanceTotals({ ...base, joinedOn: null, leftOn: null, month: "2026-11" })).toMatchObject({ countedDays: 0, upTo: null });
  });

  it("counts an unmarked usual day off as the weekly off, and a mark on that day as marked", () => {
    // September 2026 has four Sundays: 6, 13, 20 and 27.
    const totals = attendanceTotals({
      joinedOn: null,
      leftOn: null,
      weeklyOffDay: 0,
      month: "2026-09",
      today: "2026-10-09",
      marks: { "2026-09-13": "PRESENT" },
    });
    expect(totals).toMatchObject({ weeklyOff: 3, present: 1, notMarked: 26 });
  });
});

describe("monthPay", () => {
  const september = (marks: Record<string, AttendanceStatus>, extra: { joinedOn?: string | null; leftOn?: string | null } = {}) =>
    attendanceTotals({ ...noOne, ...extra, month: "2026-09", today: "2026-10-09", marks });

  it("pays a monthly salary in full when nothing is marked absent", () => {
    expect(monthPay("MONTHLY", rupees(30000), september({}))).toMatchObject({ paidDays: 30, divisor: 30, duePaise: rupees(30000) });
    // Leave and the weekly off are paid too.
    const marks = { ...days("2026-09", 1, 2, "LEAVE"), ...days("2026-09", 6, 6, "WEEKLY_OFF") };
    expect(monthPay("MONTHLY", rupees(30000), september(marks)).duePaise).toBe(rupees(30000));
  });

  it("takes a day's pay for an absence and half for a half day, dividing by the days in the month", () => {
    const marks = { ...days("2026-09", 1, 2, "ABSENT"), ...days("2026-09", 3, 3, "HALF_DAY") };
    expect(monthPay("MONTHLY", rupees(30000), september(marks))).toMatchObject({ paidDays: 27.5, divisor: 30, duePaise: rupees(27500) });
  });

  it("divides by 31, 30, 29 or 28 as the month has", () => {
    const oneAbsence = (month: string) =>
      monthPay("MONTHLY", rupees(31000), attendanceTotals({ ...noOne, month, today: "2030-01-01", marks: { [`${month}-01`]: "ABSENT" } }));
    expect(oneAbsence("2026-10")).toMatchObject({ paidDays: 30, divisor: 31, duePaise: rupees(30000) });
    expect(oneAbsence("2026-02").divisor).toBe(28);
    expect(oneAbsence("2028-02").divisor).toBe(29);
    // 31,000 × 27 ÷ 28 = 29,892.857…, kept to the nearest paisa.
    expect(oneAbsence("2026-02").duePaise).toBe(2_989_286);
  });

  it("pays a monthly worker who joined or left mid-month only for the days on the staff", () => {
    // Joined on the 16th of a 30-day month: 15 days, half the salary.
    expect(monthPay("MONTHLY", rupees(30000), september({}, { joinedOn: "2026-09-16" })).duePaise).toBe(rupees(15000));
    // Left on the 10th, with one absence in those ten days: 9 of 30.
    const left = attendanceTotals({ joinedOn: null, leftOn: "2026-09-10", weeklyOffDay: null, month: "2026-09", today: "2026-10-09", marks: { "2026-09-05": "ABSENT" } });
    expect(monthPay("MONTHLY", rupees(30000), left)).toMatchObject({ paidDays: 9, divisor: 30, duePaise: rupees(9000) });
  });

  it("pays a daily wage for days present, half for a half day, and for leave; nothing else", () => {
    const marks = {
      ...days("2026-09", 1, 10, "PRESENT"),
      ...days("2026-09", 11, 11, "HALF_DAY"),
      ...days("2026-09", 12, 12, "LEAVE"),
      ...days("2026-09", 13, 13, "WEEKLY_OFF"),
      ...days("2026-09", 14, 15, "ABSENT"),
    };
    expect(monthPay("DAILY", rupees(600), september(marks))).toMatchObject({ paidDays: 11.5, divisor: null, duePaise: rupees(6900) });
    // Nothing marked, nothing due.
    expect(monthPay("DAILY", rupees(600), september({})).duePaise).toBe(0);
  });
});

describe("countedFromOf", () => {
  it("is the joining date, or the day the person was added when they have none", () => {
    expect(countedFromOf({ joinedOn: "2026-10-12", addedOn: "2026-10-20" })).toBe("2026-10-12");
    expect(countedFromOf({ joinedOn: null, addedOn: "2026-10-20" })).toBe("2026-10-20");
  });
});

describe("pay starts on the day the person joined", () => {
  it("counts a 31-day month from the 12th only: Rs 31,000 with calendar days", () => {
    const person = { joinedOn: "2026-10-12", leftOn: null, weeklyOffDay: null };
    // Looked at on the 20th, the month still running: the 12th to the 20th is 9 days of 31.
    const soFar = attendanceTotals({ ...person, month: "2026-10", today: "2026-10-20", marks: {} });
    expect(soFar).toMatchObject({ countedDays: 9, upTo: "2026-10-20" });
    expect(monthPay("MONTHLY", rupees(31000), soFar)).toMatchObject({ paidDays: 9, divisor: 31, dayRatePaise: rupees(1000), duePaise: rupees(9000) });
    // Once the month is over: the 12th to the 31st is 20 days, Rs 20,000, never the whole Rs 31,000.
    const whole = attendanceTotals({ ...person, month: "2026-10", today: "2026-11-05", marks: {} });
    expect(monthPay("MONTHLY", rupees(31000), whole)).toMatchObject({ paidDays: 20, duePaise: rupees(20000) });
    // And nothing for the month before they joined.
    const earlier = attendanceTotals({ ...person, month: "2026-09", today: "2026-11-05", marks: {} });
    expect(monthPay("MONTHLY", rupees(31000), earlier).duePaise).toBe(0);
  });

  it("follows the person through staffSalaryMonth", () => {
    const figures = staffSalaryMonth({
      person: { payType: "MONTHLY", ratePaise: rupees(31000), joinedOn: "2026-10-12", leftOn: null, weeklyOffDay: null },
      today: "2026-10-20",
      marks: { "2026-10-12": "PRESENT" },
      records: {},
      entries: [],
      month: "2026-10",
    });
    expect(figures).toMatchObject({ paidDays: 9, divisor: 31, computedDuePaise: rupees(9000), carriedPaise: 0 });
  });
});

describe("the days a month's salary is divided by", () => {
  const MONTHS = { "2026-02": 28, "2028-02": 29, "2026-04": 30, "2026-10": 31 } as const;
  // Calendar days (null), always 30, always 26, and the Owner's own numbers.
  const OPTIONS = [null, 30, 26, 28, 20, 31] as const;
  const SALARY = rupees(31000);
  const totalsOf = (month: string, more: Partial<Parameters<typeof attendanceTotals>[0]> = {}) =>
    attendanceTotals({ ...noOne, month, today: "2030-01-01", marks: {}, ...more });
  /** The rule written out a second way, to check the function against: salary × (counted ÷ month − lost ÷ divisor). */
  const byHand = (counted: number, monthDays: number, lost: number, divisor: number) =>
    counted - lost <= 0 ? 0 : Math.round(SALARY * Math.max(0, counted / monthDays - lost / divisor));

  it("knows a divisor the Owner may choose, and the number in force for a month", () => {
    expect([19, 20, 26, 30, 31, 32, 26.5].map(isSalaryDivisor)).toEqual([false, true, true, true, true, false, false]);
    expect(divisorFor("2026-02", null)).toBe(28);
    expect(divisorFor("2028-02", null)).toBe(29);
    expect(divisorFor("2026-10", null)).toBe(31);
    expect(divisorFor("2026-02", 30)).toBe(30);
    expect(divisorFor("2026-10", 26)).toBe(26);
  });

  for (const option of OPTIONS) {
    for (const [month, monthDays] of Object.entries(MONTHS)) {
      const divisor = option ?? monthDays;
      const name = `${option === null ? "calendar days" : `always ${option}`}, ${monthDays}-day month`;
      const on = (day: number) => `${month}-${String(day).padStart(2, "0")}`;

      it(`${name}: a full month with no absence pays exactly the salary`, () => {
        const pay = monthPay("MONTHLY", SALARY, totalsOf(month), option);
        expect(pay).toMatchObject({ divisor, paidDays: divisor, lostDays: 0, duePaise: SALARY, dayRatePaise: Math.round(SALARY / divisor) });
        // Leave, weekly offs and days with no record are paid too.
        const marks = { [on(2)]: "LEAVE", [on(3)]: "WEEKLY_OFF", [on(4)]: "PRESENT" } as const;
        expect(monthPay("MONTHLY", SALARY, totalsOf(month, { marks }), option).duePaise).toBe(SALARY);
      });

      it(`${name}: one absence costs one day's pay, a half day half of one`, () => {
        const absent = monthPay("MONTHLY", SALARY, totalsOf(month, { marks: { [on(5)]: "ABSENT" } }), option);
        expect(absent).toMatchObject({ lostDays: 1, paidDays: divisor - 1 });
        expect(absent.duePaise).toBe(Math.round((SALARY * (divisor - 1)) / divisor));
        expect(absent.duePaise).toBe(byHand(monthDays, monthDays, 1, divisor));

        const half = monthPay("MONTHLY", SALARY, totalsOf(month, { marks: { [on(5)]: "HALF_DAY" } }), option);
        expect(half).toMatchObject({ lostDays: 0.5, paidDays: divisor - 0.5 });
        expect(half.duePaise).toBe(Math.round((SALARY * (divisor - 0.5)) / divisor));
        // Half a day costs half of what a day costs (to the paisa).
        expect(Math.abs(SALARY - half.duePaise - (SALARY - absent.duePaise) / 2)).toBeLessThanOrEqual(1);
      });

      it(`${name}: joined mid-month, paid only from that day`, () => {
        // Joined on the 12th: the days from the 12th to the end, as a share of the month.
        const counted = monthDays - 11;
        const joined = totalsOf(month, { joinedOn: on(12) });
        expect(joined.countedDays).toBe(counted);
        const pay = monthPay("MONTHLY", SALARY, joined, option);
        expect(pay.duePaise).toBe(Math.round((SALARY * counted) / monthDays));
        expect(pay.paidDays).toBeCloseTo((divisor * counted) / monthDays, 2);
        expect(pay.duePaise).toBeLessThan(SALARY);
        // With an absence after joining.
        const withAbsence = monthPay("MONTHLY", SALARY, totalsOf(month, { joinedOn: on(12), marks: { [on(15)]: "ABSENT" } }), option);
        expect(withAbsence.duePaise).toBe(byHand(counted, monthDays, 1, divisor));
        // An absence marked before they joined is not theirs.
        expect(monthPay("MONTHLY", SALARY, totalsOf(month, { joinedOn: on(12), marks: { [on(3)]: "ABSENT" } }), option).duePaise).toBe(pay.duePaise);
      });

      it(`${name}: left mid-month, paid only up to the last day`, () => {
        const left = totalsOf(month, { leftOn: on(10), marks: { [on(4)]: "HALF_DAY" } });
        expect(left.countedDays).toBe(10);
        const pay = monthPay("MONTHLY", SALARY, left, option);
        expect(pay.duePaise).toBe(byHand(10, monthDays, 0.5, divisor));
        expect(pay.duePaise).toBeLessThan(SALARY);
      });

      it(`${name}: a month still running grows day by day to exactly the salary, with no jump`, () => {
        let last = 0;
        for (let day = 1; day <= monthDays; day += 1) {
          const pay = monthPay("MONTHLY", SALARY, totalsOf(month, { today: on(day) }), option);
          expect(pay.duePaise).toBe(Math.round((SALARY * day) / monthDays));
          expect(pay.duePaise).toBeGreaterThan(last);
          expect(pay.duePaise).toBeLessThanOrEqual(SALARY);
          last = pay.duePaise;
        }
        expect(last).toBe(SALARY);
        // Part-way through with an absence so far.
        const soFar = monthPay("MONTHLY", SALARY, totalsOf(month, { today: on(9), marks: { [on(2)]: "ABSENT" } }), option);
        expect(soFar.duePaise).toBe(byHand(9, monthDays, 1, divisor));
      });

      it(`${name}: pay is never above the salary and never below zero`, () => {
        for (let absences = 0; absences <= monthDays; absences += 1) {
          const marks: Record<string, AttendanceStatus> = {};
          for (let day = 1; day <= absences; day += 1) marks[on(day)] = "ABSENT";
          const pay = monthPay("MONTHLY", SALARY, totalsOf(month, { marks }), option);
          expect(pay.duePaise).toBeGreaterThanOrEqual(0);
          expect(pay.duePaise).toBeLessThanOrEqual(SALARY);
          expect(pay.paidDays).toBeGreaterThanOrEqual(0);
        }
        // Absent every day: nothing, even where the divisor is longer than the month (30 in February).
        const all: Record<string, AttendanceStatus> = {};
        for (let day = 1; day <= monthDays; day += 1) all[on(day)] = "ABSENT";
        expect(monthPay("MONTHLY", SALARY, totalsOf(month, { marks: all }), option)).toMatchObject({ paidDays: 0, duePaise: 0 });
        // Joined on the last day and absent on it: nothing.
        expect(monthPay("MONTHLY", SALARY, totalsOf(month, { joinedOn: on(monthDays), marks: { [on(monthDays)]: "ABSENT" } }), option).duePaise).toBe(0);
      });

      it(`${name}: daily-wage staff are not touched by the divisor`, () => {
        const marks = { [on(1)]: "PRESENT", [on(2)]: "HALF_DAY", [on(3)]: "LEAVE", [on(4)]: "ABSENT", [on(5)]: "WEEKLY_OFF" } as const;
        expect(monthPay("DAILY", rupees(600), totalsOf(month, { marks }), option)).toEqual({ paidDays: 2.5, divisor: null, dayRatePaise: rupees(600), lostDays: 0, duePaise: rupees(1500) });
      });
    }
  }

  it("works the examples shown to the Owner", () => {
    // Rs 30,000 ÷ 30 = Rs 1,000 a day: one absence costs Rs 1,000 in October (31 days) and in February (28) alike.
    for (const month of ["2026-10", "2026-02"]) {
      expect(monthPay("MONTHLY", rupees(30000), totalsOf(month, { marks: { [`${month}-07`]: "ABSENT" } }), 30)).toMatchObject({ dayRatePaise: rupees(1000), duePaise: rupees(29000) });
    }
    // Calendar days: the same absence costs Rs 30,000 ÷ 31 in October and Rs 30,000 ÷ 28 in February.
    expect(monthPay("MONTHLY", rupees(30000), totalsOf("2026-10", { marks: { "2026-10-07": "ABSENT" } })).duePaise).toBe(rupees(30000) - 96_774);
    expect(monthPay("MONTHLY", rupees(30000), totalsOf("2026-02", { marks: { "2026-02-07": "ABSENT" } })).duePaise).toBe(rupees(30000) - 107_143);
    // Rs 26,000 ÷ 26 = Rs 1,000 a day: an absence and a half day in April cost Rs 1,500.
    const april = totalsOf("2026-04", { marks: { "2026-04-07": "ABSENT", "2026-04-08": "HALF_DAY" } });
    expect(monthPay("MONTHLY", rupees(26000), april, 26)).toMatchObject({ paidDays: 24.5, dayRatePaise: rupees(1000), duePaise: rupees(24500) });
    // Rs 31,000 with "always 30", joined on 12 October, one absence: 20 ÷ 31 of the salary is Rs 20,000,
    // less one day's pay of Rs 1,033.33. In days of pay that is 19.35 − 1 = 18.35 (as Keka shows "20.32 / 30").
    const joiner = totalsOf("2026-10", { joinedOn: "2026-10-12", marks: { "2026-10-20": "ABSENT" } });
    expect(monthPay("MONTHLY", rupees(31000), joiner, 30)).toMatchObject({ paidDays: 18.35, divisor: 30, dayRatePaise: 103_333, lostDays: 1, duePaise: 1_896_667 });
  });
});

describe("a month keeps the divisor it was worked out with", () => {
  const person = { payType: "MONTHLY" as const, ratePaise: rupees(30000), joinedOn: "2026-01-01", leftOn: null, weeklyOffDay: null };
  const base = { person, today: "2026-11-05", marks: { "2026-10-07": "ABSENT" as const }, entries: [] };

  it("follows the outlet's setting while the month is open", () => {
    expect(staffSalaryMonth({ ...base, records: {}, month: "2026-10" })).toMatchObject({ divisor: 31, divisorKept: false, computedDuePaise: rupees(30000) - 96_774 });
    expect(staffSalaryMonth({ ...base, records: {}, month: "2026-10", divisorDays: 30 })).toMatchObject({
      divisor: 30,
      divisorKept: false,
      dayRatePaise: rupees(1000),
      lostDays: 1,
      computedDuePaise: rupees(29000),
    });
    // A record that only holds the month's rate of pay (made when the pay was raised) does not hold a divisor.
    const rateOnly = { "2026-10": typed({ payType: "MONTHLY", ratePaise: rupees(30000) }) };
    expect(staffSalaryMonth({ ...base, records: rateOnly, month: "2026-10", divisorDays: 26 })).toMatchObject({ divisor: 26, divisorKept: false });
  });

  it("keeps its own once one is stored with the month, whatever the setting becomes", () => {
    const records = { "2026-10": typed({ divisorDays: 31 }) };
    for (const setting of [null, 30, 26]) {
      expect(staffSalaryMonth({ ...base, records, month: "2026-10", divisorDays: setting })).toMatchObject({
        divisor: 31,
        divisorKept: true,
        computedDuePaise: rupees(30000) - 96_774,
      });
    }
    // The next month, still open, takes the new setting, and what October left is carried in unchanged.
    const november = staffSalaryMonth({ ...base, records, month: "2026-11", divisorDays: 30 });
    expect(november).toMatchObject({ divisor: 30, divisorKept: false, carriedPaise: rupees(30000) - 96_774 });
    // 5 of November's 30 days so far.
    expect(november.computedDuePaise).toBe(rupees(5000));
  });

  it("says nothing of a divisor for daily pay", () => {
    const daily = staffSalaryMonth({ ...base, person: { ...person, payType: "DAILY", ratePaise: rupees(600) }, records: { "2026-10": typed({ divisorDays: 30 }) }, month: "2026-10", divisorDays: 26 });
    expect(daily).toMatchObject({ divisor: null, divisorKept: false, dayRatePaise: rupees(600) });
  });
});

describe("staffSalaryMonth", () => {
  const monthly = { payType: "MONTHLY" as const, ratePaise: rupees(30000), ...noOne };
  const daily = { payType: "DAILY" as const, ratePaise: rupees(600), ...noOne };
  const ask = (input: Partial<StaffSalaryInput> & Pick<StaffSalaryInput, "month">): StaffSalaryInput => ({
    person: monthly,
    today: "2026-10-09",
    marks: {},
    records: {},
    entries: [],
    ...input,
  });

  it("adds overtime and bonus, and takes off advances and deductions", () => {
    const figures = staffSalaryMonth(
      ask({
        month: "2026-09",
        marks: days("2026-09", 1, 2, "ABSENT"),
        records: { "2026-09": typed({ overtimePaise: rupees(1200), bonusPaise: rupees(500), deductionsPaise: rupees(300) }) },
        entries: [
          { month: "2026-09", kind: "ADVANCE", amountPaise: rupees(2000) },
          { month: "2026-09", kind: "ADVANCE", amountPaise: rupees(3000) },
          { month: "2026-09", kind: "PAYMENT", amountPaise: rupees(10000) },
        ],
      }),
    );
    expect(figures).toMatchObject({
      beforeRecords: false,
      computedDuePaise: rupees(28000),
      duePaise: rupees(28000),
      advancesPaise: rupees(5000),
      netPaise: rupees(28000 + 1200 + 500 - 5000 - 300),
      carriedPaise: 0,
      payablePaise: rupees(24400),
      paidPaise: rupees(10000),
      balancePaise: rupees(14400),
      state: "PART_PAID",
    });
  });

  it("says where the month stands: due, part paid, settled, overpaid", () => {
    const withPaid = (paid: number) =>
      staffSalaryMonth(
        ask({
          month: "2026-09",
          marks: { "2026-09-01": "PRESENT" },
          entries: paid ? [{ month: "2026-09", kind: "PAYMENT", amountPaise: rupees(paid) }] : [],
        }),
      ).state;
    expect(withPaid(0)).toBe("DUE");
    expect(withPaid(100)).toBe("PART_PAID");
    expect(withPaid(30000)).toBe("SETTLED");
    expect(withPaid(30001)).toBe("OVERPAID");
  });

  it("uses the Owner's own figure in place of the app's, and keeps both", () => {
    const figures = staffSalaryMonth(
      ask({ month: "2026-09", marks: days("2026-09", 1, 3, "ABSENT"), records: { "2026-09": typed({ dueOverridePaise: rupees(29000) }) } }),
    );
    expect(figures).toMatchObject({ computedDuePaise: rupees(27000), dueOverridePaise: rupees(29000), duePaise: rupees(29000), balancePaise: rupees(29000) });
    // An override of zero is still an override.
    const zero = staffSalaryMonth(ask({ month: "2026-09", records: { "2026-09": typed({ dueOverridePaise: 0 }) } }));
    expect(zero).toMatchObject({ computedDuePaise: rupees(30000), duePaise: 0 });
  });

  it("carries what is still owed into the next month", () => {
    const figures = staffSalaryMonth(
      ask({
        month: "2026-10",
        marks: { "2026-09-01": "PRESENT" },
        entries: [{ month: "2026-09", kind: "PAYMENT", amountPaise: rupees(25000) }],
      }),
    );
    // September: 30,000 due, 25,000 paid. October so far: 9 of 31 days.
    expect(figures).toMatchObject({
      carriedComputedPaise: rupees(5000),
      carriedPaise: rupees(5000),
      computedDuePaise: Math.round((rupees(30000) * 9) / 31),
      payablePaise: Math.round((rupees(30000) * 9) / 31) + rupees(5000),
    });
    expect(figures.totals.upTo).toBe("2026-10-09");
  });

  it("carries advances that were more than the pay forward as overpaid", () => {
    const input = ask({
      person: daily,
      month: "2026-09",
      marks: days("2026-09", 1, 5, "PRESENT"),
      entries: [{ month: "2026-09", kind: "ADVANCE", amountPaise: rupees(5000) }],
    });
    // Five days at 600 is 3,000; the advance was 5,000.
    expect(staffSalaryMonth(input)).toMatchObject({ duePaise: rupees(3000), netPaise: rupees(-2000), balancePaise: rupees(-2000), state: "OVERPAID" });
    const next = staffSalaryMonth({ ...input, month: "2026-10", marks: { ...input.marks, ...days("2026-10", 1, 9, "PRESENT") } });
    expect(next).toMatchObject({ carriedPaise: rupees(-2000), duePaise: rupees(5400), payablePaise: rupees(3400), state: "DUE" });
  });

  it("uses the Owner's own carried figure from that month on", () => {
    const input = ask({
      month: "2026-10",
      marks: { "2026-08-01": "PRESENT" },
      records: { "2026-09": typed({ carriedOverridePaise: 0 }) },
      entries: [{ month: "2026-09", kind: "PAYMENT", amountPaise: rupees(30000) }],
    });
    // August's unpaid 30,000 would have been carried into September; the Owner said nothing was.
    expect(staffSalaryMonth({ ...input, month: "2026-09" })).toMatchObject({
      carriedComputedPaise: rupees(30000),
      carriedOverridePaise: 0,
      carriedPaise: 0,
      balancePaise: 0,
      state: "SETTLED",
    });
    expect(staffSalaryMonth(input).carriedPaise).toBe(0);
  });

  it("keeps an earlier month at the rate of pay recorded for it", () => {
    const input = ask({
      person: { ...monthly, ratePaise: rupees(33000) },
      month: "2026-09",
      marks: { "2026-09-01": "PRESENT" },
      records: { "2026-09": typed({ payType: "MONTHLY", ratePaise: rupees(30000) }) },
    });
    expect(staffSalaryMonth(input)).toMatchObject({ ratePaise: rupees(30000), duePaise: rupees(30000) });
    // A month with no rate of its own takes the person's pay as it is now.
    expect(staffSalaryMonth({ ...input, records: {} })).toMatchObject({ ratePaise: rupees(33000), duePaise: rupees(33000) });
  });

  it("works nothing out for a month before any record was kept", () => {
    const figures = staffSalaryMonth(ask({ month: "2026-08", marks: { "2026-09-15": "PRESENT" } }));
    expect(figures).toMatchObject({ beforeRecords: true, duePaise: 0, balancePaise: 0, state: "SETTLED" });
    // With no records at all, the records begin this month.
    expect(staffSalaryMonth(ask({ month: "2026-09" })).beforeRecords).toBe(true);
    expect(staffSalaryMonth(ask({ month: "2026-10" }))).toMatchObject({ beforeRecords: false, paidDays: 9 });
  });

  it("pays nothing for months after the person left, but keeps what was owed", () => {
    const figures = staffSalaryMonth(
      ask({ person: { ...monthly, leftOn: "2026-09-15" }, month: "2026-10", marks: { "2026-09-01": "PRESENT" } }),
    );
    expect(figures).toMatchObject({ duePaise: 0, carriedPaise: rupees(15000), balancePaise: rupees(15000), state: "DUE" });
  });
});
