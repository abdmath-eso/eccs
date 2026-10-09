import { describe, expect, it } from "vitest";
import {
  attendanceDateVerdict,
  attendanceTotals,
  earliestCorrectableDate,
  monthPay,
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
    expect(monthPay("MONTHLY", rupees(30000), september({}))).toEqual({ paidDays: 30, divisor: 30, duePaise: rupees(30000) });
    // Leave and the weekly off are paid too.
    const marks = { ...days("2026-09", 1, 2, "LEAVE"), ...days("2026-09", 6, 6, "WEEKLY_OFF") };
    expect(monthPay("MONTHLY", rupees(30000), september(marks)).duePaise).toBe(rupees(30000));
  });

  it("takes a day's pay for an absence and half for a half day, dividing by the days in the month", () => {
    const marks = { ...days("2026-09", 1, 2, "ABSENT"), ...days("2026-09", 3, 3, "HALF_DAY") };
    expect(monthPay("MONTHLY", rupees(30000), september(marks))).toEqual({ paidDays: 27.5, divisor: 30, duePaise: rupees(27500) });
  });

  it("divides by 31, 30, 29 or 28 as the month has", () => {
    const oneAbsence = (month: string) =>
      monthPay("MONTHLY", rupees(31000), attendanceTotals({ ...noOne, month, today: "2030-01-01", marks: { [`${month}-01`]: "ABSENT" } }));
    expect(oneAbsence("2026-10")).toEqual({ paidDays: 30, divisor: 31, duePaise: rupees(30000) });
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
    expect(monthPay("MONTHLY", rupees(30000), left)).toEqual({ paidDays: 9, divisor: 30, duePaise: rupees(9000) });
  });

  it("pays a daily wage for days present, half for a half day, and for leave; nothing else", () => {
    const marks = {
      ...days("2026-09", 1, 10, "PRESENT"),
      ...days("2026-09", 11, 11, "HALF_DAY"),
      ...days("2026-09", 12, 12, "LEAVE"),
      ...days("2026-09", 13, 13, "WEEKLY_OFF"),
      ...days("2026-09", 14, 15, "ABSENT"),
    };
    expect(monthPay("DAILY", rupees(600), september(marks))).toEqual({ paidDays: 11.5, divisor: null, duePaise: rupees(6900) });
    // Nothing marked, nothing due.
    expect(monthPay("DAILY", rupees(600), september({})).duePaise).toBe(0);
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
