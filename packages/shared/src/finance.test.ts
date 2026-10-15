import { describe, expect, it } from "vitest";
import {
  ageCollections,
  ageingBucket,
  aiCostPaise,
  budgetMonths,
  budgetTotal,
  budgetUse,
  cashBalanceByDay,
  cashBalanceOn,
  chartBuckets,
  EXPENSE_TYPE_LINE,
  EXPENSE_TYPES,
  expenseSchema,
  FINANCE_LINES,
  financePeriod,
  founderShares,
  invoiceReminderText,
  lastFullMonth,
  monthEnd,
  monthlyPlanPaise,
  monthsBetween,
  periodGonePercent,
  readBudgetLines,
  runway,
  spreadOverMonth,
  sumIntoBuckets,
  typesForLine,
  whatsappReminderUrl,
} from "./finance.js";

describe("dates and periods", () => {
  it("knows the ends of months, leap years included", () => {
    expect(monthEnd("2026-10")).toBe("2026-10-31");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthsBetween("2026-11-20", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("works out this month, the financial year from 1 April, and a custom period", () => {
    expect(financePeriod("month", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(financePeriod("fy", "2026-10-15")).toEqual({ from: "2026-04-01", to: "2026-10-15" });
    // January to March belong to the year that began the April before.
    expect(financePeriod("fy", "2027-02-10")).toEqual({ from: "2026-04-01", to: "2027-02-10" });
    expect(financePeriod("custom", "2026-10-15", { from: "2026-10-12", to: "2026-09-01" })).toEqual({ from: "2026-09-01", to: "2026-10-12" });
  });

  it("holds a period against whole months, from the month the books started", () => {
    expect(budgetMonths("2026-04-01", "2026-10-15", "2026-09-01")).toEqual(["2026-09", "2026-10"]);
    expect(budgetMonths("2026-10-01", "2026-10-15", null)).toEqual(["2026-10"]);
    expect(budgetMonths("2026-04-01", "2026-06-30", "2026-09-01")).toEqual([]);
    expect(periodGonePercent(["2026-10"], "2026-10-15")).toBe(48); // 15 of 31 days
    expect(periodGonePercent(["2026-09", "2026-10"], "2026-10-15")).toBe(74); // 45 of 61 days
    expect(periodGonePercent(["2026-09"], "2026-10-15")).toBe(100);
  });
});

describe("the monthly price of a plan", () => {
  it("divides a quarterly price by 3 and an annual one by 12", () => {
    expect(monthlyPlanPaise(600_000, "MONTHLY")).toBe(600_000);
    expect(monthlyPlanPaise(1_800_000, "QUARTERLY")).toBe(600_000);
    expect(monthlyPlanPaise(1_000_000, "QUARTERLY")).toBe(333_333);
    expect(monthlyPlanPaise(7_200_000, "ANNUAL")).toBe(600_000);
  });
});

describe("budget use", () => {
  it("gives the percent used and how much over", () => {
    expect(budgetUse(2_200_000, 1_800_000)).toEqual({ percent: 122, overByPaise: 400_000 });
    expect(budgetUse(1_840_000, 2_000_000)).toEqual({ percent: 92, overByPaise: 0 });
    expect(budgetUse(500, null)).toEqual({ percent: null, overByPaise: 0 });
    // Anything spent on a line budgeted at nothing is over by all of it.
    expect(budgetUse(500, 0)).toEqual({ percent: null, overByPaise: 500 });
  });

  it("reads stored lines, a missing line as nothing, and adds them up", () => {
    const lines = readBudgetLines({ SALARIES: 17_000_000, CHEMICALS: 2_000_000, NOT_A_LINE: 5 });
    expect(Object.keys(lines)).toEqual([...FINANCE_LINES]);
    expect(lines.SUBCONTRACTOR).toBe(0);
    expect(budgetTotal(lines)).toBe(19_000_000);
  });

  it("maps every kind of daily spend to a budget line", () => {
    for (const type of EXPENSE_TYPES) expect(FINANCE_LINES).toContain(EXPENSE_TYPE_LINE[type]);
    expect(typesForLine("EQUIPMENT")).toEqual(["EQUIPMENT", "OFFICE"]);
    expect(typesForLine("SALARIES")).toEqual([]);
  });
});

describe("collections ageing", () => {
  it("puts an invoice in its bucket, and not overdue on the due date itself", () => {
    expect(ageingBucket("2026-10-15", "2026-10-15")).toBe("NOT_DUE");
    expect(ageingBucket("2026-10-20", "2026-10-15")).toBe("NOT_DUE");
    expect(ageingBucket("2026-10-14", "2026-10-15")).toBe("DAYS_1_7");
    expect(ageingBucket("2026-10-08", "2026-10-15")).toBe("DAYS_1_7");
    expect(ageingBucket("2026-10-07", "2026-10-15")).toBe("DAYS_8_30");
    expect(ageingBucket("2026-09-15", "2026-10-15")).toBe("DAYS_8_30");
    expect(ageingBucket("2026-09-14", "2026-10-15")).toBe("OVER_30");
  });

  it("adds up what is owed by bucket, leaving out invoices with nothing owed", () => {
    const aged = ageCollections(
      [
        { dueDate: "2026-10-20", duePaise: 100 },
        { dueDate: "2026-10-10", duePaise: 200 },
        { dueDate: "2026-10-01", duePaise: 300 },
        { dueDate: "2026-08-01", duePaise: 400 },
        { dueDate: "2026-08-01", duePaise: 0 },
      ],
      "2026-10-15",
    );
    expect(aged.totalPaise).toBe(1000);
    expect(aged.count).toBe(4);
    expect(aged.buckets).toEqual({
      NOT_DUE: { paise: 100, count: 1 },
      DAYS_1_7: { paise: 200, count: 1 },
      DAYS_8_30: { paise: 300, count: 1 },
      OVER_30: { paise: 400, count: 1 },
    });
  });
});

describe("cash balance, day by day", () => {
  const movements = [
    { date: "2026-08-30", paise: 999 }, // before the opening day: already in the opening balance
    { date: "2026-09-01", paise: 600_000 },
    { date: "2026-09-03", paise: -50_000 },
    { date: "2026-09-03", paise: 2_000 },
    { date: "2026-09-05", paise: -1_000 },
  ];

  it("counts from the opening balance and its day", () => {
    const opening = { date: "2026-09-01", paise: 10_000 };
    expect(cashBalanceByDay(opening, movements, "2026-08-31", "2026-09-05")).toEqual([
      { date: "2026-08-31", paise: null },
      { date: "2026-09-01", paise: 610_000 },
      { date: "2026-09-02", paise: 610_000 },
      { date: "2026-09-03", paise: 562_000 },
      { date: "2026-09-04", paise: 562_000 },
      { date: "2026-09-05", paise: 561_000 },
    ]);
    expect(cashBalanceOn(opening, movements, "2026-09-04")).toBe(562_000);
  });

  it("starts from nothing without an opening balance, and includes days before the window", () => {
    expect(cashBalanceByDay(null, movements, "2026-09-04", "2026-09-05")).toEqual([
      { date: "2026-09-04", paise: 552_999 },
      { date: "2026-09-05", paise: 551_999 },
    ]);
  });
});

describe("collected against expenses, by week", () => {
  it("draws 7-day weeks up to today, and months for a long period", () => {
    const weeks = chartBuckets("2026-10-01", "2026-10-31", "2026-10-15");
    expect(weeks.kind).toBe("week");
    expect(weeks.buckets).toEqual([
      { from: "2026-10-01", to: "2026-10-07", label: "Week 1" },
      { from: "2026-10-08", to: "2026-10-14", label: "Week 2" },
      { from: "2026-10-15", to: "2026-10-15", label: "Week 3" },
    ]);
    const months = chartBuckets("2026-04-01", "2026-10-15", "2026-10-15");
    expect(months.kind).toBe("month");
    expect(months.buckets).toHaveLength(7);
    expect(months.buckets[6]).toEqual({ from: "2026-10-01", to: "2026-10-15", label: "Oct" });
  });

  it("spreads a month's salaries over its days in range, keeping every paisa", () => {
    const spread = spreadOverMonth(1_000_001, "2026-10-01", "2026-10-01", "2026-10-15");
    expect(spread).toHaveLength(15);
    expect(spread.reduce((total, day) => total + day.paise, 0)).toBe(1_000_001);
    expect(spreadOverMonth(3100, "2026-09-30", "2026-10-01", "2026-10-15")).toEqual([]);
    const buckets = chartBuckets("2026-10-01", "2026-10-31", "2026-10-15").buckets;
    // 66,666 a day for 14 days and the odd paise on the 15th (66,677).
    expect(sumIntoBuckets(buckets, spread)).toEqual([466_662, 466_662, 66_677]);
  });
});

describe("founders' money", () => {
  it("works out each founder's share from what they put in, adding up to 100", () => {
    const rows = founderShares([
      { founder: "Founder B", date: "2026-10-24", amountPaise: 25_000_000, direction: "IN" },
      { founder: "Abdul", date: "2026-10-20", amountPaise: 35_000_000, direction: "IN" },
      { founder: "Abdul", date: "2026-11-02", amountPaise: 1_000_000, direction: "OUT" },
    ]);
    expect(rows).toEqual([
      { founder: "Abdul", firstDate: "2026-10-20", putInPaise: 35_000_000, takenOutPaise: 1_000_000, sharePercent: 58 },
      { founder: "Founder B", firstDate: "2026-10-24", putInPaise: 25_000_000, takenOutPaise: 0, sharePercent: 42 },
    ]);
    const thirds = founderShares(["A", "B", "C"].map((founder) => ({ founder, date: "2026-10-01", amountPaise: 100, direction: "IN" as const })));
    expect(thirds.reduce((total, row) => total + row.sharePercent, 0)).toBe(100);
  });
});

describe("runway", () => {
  it("needs a full month of books", () => {
    expect(lastFullMonth("2026-10-15", "2026-09-01")).toBe("2026-09");
    expect(lastFullMonth("2026-10-15", "2026-09-03")).toBeNull();
    expect(lastFullMonth("2026-10-15", null)).toBeNull();
  });

  it("divides what is left by the month's net outflow, in plain words", () => {
    expect(runway(30_950_000, 15_230_000)).toEqual({ kind: "MONTHS", months: 2, words: "about 2 months" });
    expect(runway(10_000_000, 15_000_000)).toEqual({ kind: "MONTHS", months: 0.7, words: "less than a month" });
    expect(runway(14_000_000, 15_000_000).words).toBe("about 1 month");
    expect(runway(10_000_000, null).kind).toBe("NO_HISTORY");
    expect(runway(0, 5_000_000).kind).toBe("NOTHING_LEFT");
    expect(runway(10_000_000, -2_000_000).kind).toBe("NOT_BURNING");
  });
});

describe("the AI line and reminders", () => {
  it("turns the AI's dollar cost into paise at the rate set", () => {
    expect(aiCostPaise(1_000_000, 8800)).toBe(8800); // $1 at ₹88
    expect(aiCostPaise(593_775, 8800)).toBe(5225);
  });

  it("words a polite reminder and links it to WhatsApp", () => {
    const text = invoiceReminderText({ clientName: "Spice Route", invoiceNumber: "ECCS/26-27/00014", duePaise: 708_000, dueDate: "2026-10-08" });
    expect(text).toContain("ECCS/26-27/00014");
    expect(text).toContain("₹7,080");
    expect(text).toContain("8 Oct 2026");
    expect(whatsappReminderUrl("+91 91000 00001", "Hi there")).toBe("https://wa.me/919100000001?text=Hi%20there");
    expect(whatsappReminderUrl("9100000001", "Hi")).toBe("https://wa.me/919100000001?text=Hi");
    expect(whatsappReminderUrl(null, "Hi")).toBe("https://wa.me/?text=Hi");
  });
});

describe("what an expense must have", () => {
  const base = { date: "2026-10-10", vendor: "Sri Sai Pest Control", amountPaise: 350_000 };

  it("takes a paid bill and an unpaid one with a due date", () => {
    expect(expenseSchema.safeParse({ ...base, category: "SUBCONTRACTOR", type: "SUBCONTRACTOR", paidVia: "upi", paidOn: "2026-10-10" }).success).toBe(true);
    expect(expenseSchema.safeParse({ ...base, category: "SUBCONTRACTOR", dueDate: "2026-10-30" }).success).toBe(true);
  });

  it("refuses an unpaid bill with no due date, a type from another line, and GST above the amount", () => {
    const message = (input: object) => (expenseSchema.safeParse(input).error?.issues ?? []).map((issue) => issue.path.join("."));
    expect(message({ ...base, category: "SUBCONTRACTOR" })).toEqual(["dueDate"]);
    expect(message({ ...base, category: "CHEMICALS", type: "FUEL", dueDate: "2026-10-30" })).toEqual(["type"]);
    expect(message({ ...base, category: "CHEMICALS", gstPaise: 400_000, dueDate: "2026-10-30" })).toEqual(["gstPaise"]);
    expect(message({ ...base, category: "CHEMICALS", paidVia: "cash" })).toEqual(["paidOn"]);
  });

  it("keeps a wage advance off the budget: no line, always paid, recovered after it was given", () => {
    const advance = { ...base, kind: "WAGE_ADVANCE", vendor: "Latha", paidVia: "cash", paidOn: "2026-10-10" };
    expect(expenseSchema.safeParse(advance).success).toBe(true);
    expect(expenseSchema.safeParse({ ...advance, category: "SALARIES" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...advance, paidVia: null, paidOn: null }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...advance, recoveredOn: "2026-10-01" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...advance, recoveredOn: "2026-10-31" }).success).toBe(true);
  });
});
