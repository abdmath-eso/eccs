import type { PrismaClient } from "../generated/prisma/client.js";

// Sample books for the console's Finance page (15 Oct 2026), so the page can be seen
// before the founder enters real figures: about 80 expenses over the last six weeks
// (Hyderabad vendors, each marked "(sample)"), two wage advances, the two budgets of
// the founder's design (Lean ₹3,01,000 and Full ₹4,94,000 a month), the founders'
// money of the design (₹3,50,000 and ₹2,50,000) and an opening cash balance.
//
// Nothing is wiped. Every row is marked `isSample` and has its own `sampleKey`, so
// loading again adds only what is missing and never doubles a row, and
// `removeFinanceSample` takes every sample row out in one go before real use.
// Invoices and payments are never made here: they are billing's, and the page reads
// the real ones.
//
// The budget line and type keys are those of FINANCE_LINES and EXPENSE_TYPES in
// packages/shared/src/finance.ts (this package does not depend on that one).

type Db = Pick<PrismaClient, "expense" | "budget" | "founderMoney" | "cashOpening" | "job">;

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const addDays = (date: string, days: number) => new Date(toTime(date) + days * DAY_MS).toISOString().slice(0, 10);
const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDb = (date: Date) => date.toISOString().slice(0, 10);
const monthOf = (date: string) => date.slice(0, 7);
const addMonths = (month: string, count: number) => {
  const at = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + count, 1));
  return at.toISOString().slice(0, 7);
};
const monthEnd = (month: string) => {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return last.toISOString().slice(0, 10);
};
const monthName = (month: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long" }).format(new Date(`${month}-01T00:00:00Z`));
const indiaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const rupees = (amount: number) => Math.round(amount * 100);
/** Sunday is 0. */
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The same "random" amounts every time, so the sample reads the same on every machine. */
function numbers(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SampleExpense {
  sampleKey: string;
  kind?: "EXPENSE" | "WAGE_ADVANCE";
  date: string;
  category: string | null;
  type?: string | null;
  vendor: string;
  description: string;
  amountPaise: number;
  gstPaise?: number;
  paidVia?: string | null;
  paidOn?: string | null;
  dueDate?: string | null;
  recoveredOn?: string | null;
  visitId?: string | null;
}

/** GST at 18% inside an amount that includes it. */
const gstInside = (amountPaise: number) => Math.round((amountPaise * 18) / 118);

/** The sample expenses for the six weeks up to `today`. Exported for the test that checks them. */
export function sampleExpenses(today: string, visitIds: readonly { id: string; date: string }[]): SampleExpense[] {
  const month = monthOf(today);
  const previous = addMonths(month, -1);
  const start = addDays(today, -41);
  const random = numbers(2710);
  const pick = (low: number, high: number, step = 10) => rupees(Math.round((low + random() * (high - low)) / step) * step);
  const rows: SampleExpense[] = [];
  const add = (row: SampleExpense) => {
    if (row.date >= start && row.date <= today) rows.push(row);
  };
  const paid = (date: string, via = "upi") => ({ paidVia: via, paidOn: date });

  // ── Monthly bills ──
  // Last month's salaries, paid on its last day (a set-up month: the team joined part-way through).
  add({
    sampleKey: `sample-salaries-${previous}`,
    date: monthEnd(previous),
    category: "SALARIES",
    vendor: "ECCS team payroll (sample)",
    description: `Staff salaries, ${monthName(previous)}`,
    amountPaise: rupees(92_000),
    ...paid(monthEnd(previous), "bank-transfer"),
  });
  // This month's salaries, entered on the first and paid on the last day: owed until then.
  add({
    sampleKey: `sample-salaries-${month}`,
    date: `${month}-01`,
    category: "SALARIES",
    vendor: "ECCS team payroll (sample)",
    description: `Staff salaries, ${monthName(month)}`,
    amountPaise: rupees(162_000),
    dueDate: monthEnd(month),
  });

  const bills: [offsetFromStart: number, line: string, vendor: string, what: string, amount: number, via: string][] = [
    [1, "INSURANCE", "Deccan Shield Insurance (sample)", "Public liability insurance, one year", 14_500, "bank-transfer"],
    [4, "INSURANCE", "Rao and Associates, CAs (sample)", "Company set-up and GST registration", 7_500, "bank-transfer"],
    [0, "SOFTWARE", "Office email service (sample)", "Email for 3 people", 1_380, "card"],
    [0, "SOFTWARE", "Hyderabad Web Hosting (sample)", "Domain and hosting, one year", 2_950, "card"],
    [2, "EQUIPMENT", "Ameerpet Hardware (sample)", "Pressure washer, 150 bar", 38_500, "bank-transfer"],
    [3, "EQUIPMENT", "Ameerpet Hardware (sample)", "Ladders, buckets and squeegees", 4_200, "upi"],
    [3, "EQUIPMENT", "Safe Hands Supplies (sample)", "Safety kit: gloves, goggles, boots", 6_800, "upi"],
    [5, "MARKETING", "Sai Printers (sample)", "QR posters and pamphlets", 6_500, "upi"],
    [6, "MARKETING", "Sai Printers (sample)", "Visiting cards", 1_200, "cash"],
    [8, "CHEMICALS", "Deccan Clean Chemicals (sample)", "Opening stock: degreaser, sanitiser, descaler", 9_800, "bank-transfer"],
    [29, "SOFTWARE", "Office email service (sample)", "Email for 3 people", 1_380, "card"],
    [31, "INSURANCE", "Rao and Associates, CAs (sample)", "Monthly accounts and GST return", 5_000, "bank-transfer"],
    [33, "MARKETING", "Sai Printers (sample)", "Flex banners for the van", 3_400, "upi"],
  ];
  bills.forEach(([offset, line, vendor, what, amount, via], index) => {
    const date = addDays(start, offset);
    add({
      sampleKey: `sample-bill-${date}-${index}`,
      date,
      category: line,
      vendor,
      description: what,
      amountPaise: rupees(amount),
      gstPaise: line === "SOFTWARE" || line === "INSURANCE" || line === "EQUIPMENT" || line === "MARKETING" ? gstInside(rupees(amount)) : 0,
      ...paid(date, via),
    });
  });

  // ── Day-to-day spend ──
  for (let offset = 0; offset < 42; offset += 1) {
    const date = addDays(start, offset);
    const sunday = weekday(date) === 0;
    if (!sunday && offset % 3 === 1) {
      const amount = pick(1_200, 3_200);
      add({ sampleKey: `sample-chem-${date}`, date, category: "CHEMICALS", type: "CHEMICALS", vendor: "Deccan Clean Chemicals (sample)", description: "Degreaser and sanitiser refills", amountPaise: amount, gstPaise: gstInside(amount), ...paid(date) });
    }
    if (!sunday && offset % 2 === 0) {
      add({ sampleKey: `sample-fuel-${date}`, date, category: "VEHICLE", type: "FUEL", vendor: "Madhapur fuel station (sample)", description: "Petrol for the van", amountPaise: pick(600, 1_600), ...paid(date) });
    }
    if (offset % 4 === 3) {
      add({ sampleKey: `sample-office-${date}`, date, category: "EQUIPMENT", type: "OFFICE", vendor: "Office petty cash (sample)", description: "Tea, parking, misc", amountPaise: pick(150, 600), ...paid(date, "cash") });
    }
    if (!sunday && offset % 7 === 5) {
      const amount = pick(800, 2_800);
      add({ sampleKey: `sample-spares-${date}`, date, category: "EQUIPMENT", type: "EQUIPMENT", vendor: "Ameerpet Hardware (sample)", description: "Scrubber pads, nozzles and spares", amountPaise: amount, gstPaise: gstInside(amount), ...paid(date) });
    }
    if (!sunday && offset % 10 === 7) {
      const amount = pick(700, 1_900);
      add({ sampleKey: `sample-print-${date}`, date, category: "MARKETING", type: "PRINTING", vendor: "Sai Printers (sample)", description: "Service report pads and stickers", amountPaise: amount, gstPaise: gstInside(amount), ...paid(date) });
    }
  }

  // ── Subcontractors and partners ──
  // Pest control at three recent visits, each put on that visit's margin: one paid, two still owed.
  visitIds.slice(0, 3).forEach((visit, index) => {
    const date = visit.date > today ? today : visit.date < start ? start : visit.date;
    add({
      sampleKey: `sample-pest-${visit.id}`,
      date,
      category: "SUBCONTRACTOR",
      type: "SUBCONTRACTOR",
      vendor: "Sri Sai Pest Control (sample)",
      description: "Pest treatment at the visit",
      amountPaise: rupees(3_500),
      gstPaise: gstInside(rupees(3_500)),
      visitId: visit.id,
      ...(index === 0 ? paid(date) : { dueDate: addDays(today, 5) }),
    });
  });
  add({ sampleKey: `sample-grease-${month}`, date: addDays(today, -2), category: "SUBCONTRACTOR", vendor: "Green Route Grease Disposal (sample)", description: "Grease-trap waste taken away, GHMC route", amountPaise: rupees(3_200), dueDate: addDays(today, 10) });
  for (let index = 0; index < 3; index += 1) {
    const date = addDays(today, -6 + index * 2);
    add({ sampleKey: `sample-referral-${date}`, date, category: "MARKETING", vendor: "Chef referral payouts (sample)", description: "₹500 to a chef for a first job won", amountPaise: rupees(500), dueDate: addDays(today, 3) });
  }

  // ── Wage advances: cash out, not expenses ──
  const firstAdvance = addDays(monthEnd(previous), -6);
  add({ sampleKey: `sample-advance-${firstAdvance}`, kind: "WAGE_ADVANCE", date: firstAdvance, category: null, vendor: "Latha (sample)", description: "Advance on pay", amountPaise: rupees(2_000), ...paid(firstAdvance, "cash"), recoveredOn: monthEnd(previous) });
  const secondAdvance = addDays(today, -4);
  add({ sampleKey: `sample-advance-${secondAdvance}`, kind: "WAGE_ADVANCE", date: secondAdvance, category: null, vendor: "Ramesh (sample)", description: "Advance on pay", amountPaise: rupees(1_500), ...paid(secondAdvance, "cash") });

  return rows;
}

const LEAN = { SALARIES: 170_000, SUBCONTRACTOR: 18_000, CHEMICALS: 20_000, INSURANCE: 22_000, VEHICLE: 15_000, MARKETING: 14_000, SOFTWARE: 12_000, EQUIPMENT: 30_000 };
const FULL = { SALARIES: 280_000, SUBCONTRACTOR: 30_000, CHEMICALS: 35_000, INSURANCE: 30_000, VEHICLE: 25_000, MARKETING: 30_000, SOFTWARE: 14_000, EQUIPMENT: 50_000 };
const inPaise = (lines: Record<string, number>) => Object.fromEntries(Object.entries(lines).map(([line, amount]) => [line, rupees(amount)]));

/**
 * Adds the sample books for the six weeks up to `today` (India's today unless given),
 * leaving everything else alone. Rows already loaded are kept as they are.
 */
export async function loadFinanceSample(db: Db, options: { today?: string } = {}) {
  const today = options.today ?? indiaToday();
  const month = monthOf(today);
  const previous = addMonths(month, -1);
  const booksStart = `${previous}-01`;

  // The three latest visits signed off and approved in the window, to put pest control on.
  const visits = await db.job.findMany({
    where: { status: "APPROVED", scheduledDate: { gte: toDb(addDays(today, -41)), lte: toDb(today) } },
    orderBy: { scheduledDate: "desc" },
    select: { id: true, scheduledDate: true },
    take: 3,
  });
  const expenses = sampleExpenses(
    today,
    visits.map((visit) => ({ id: visit.id, date: fromDb(visit.scheduledDate) })),
  );

  const added = { expenses: 0, budgets: 0, founderMoney: 0, openings: 0 };
  added.expenses = (
    await db.expense.createMany({
      data: expenses.map((row) => ({
        sampleKey: row.sampleKey,
        isSample: true,
        kind: row.kind ?? "EXPENSE",
        date: toDb(row.date),
        category: row.category,
        type: row.type ?? null,
        vendor: row.vendor,
        description: row.description,
        amountPaise: row.amountPaise,
        gstPaise: row.gstPaise ?? 0,
        paidVia: row.paidVia ?? null,
        paidOn: row.paidOn ? toDb(row.paidOn) : null,
        dueDate: row.dueDate ? toDb(row.dueDate) : null,
        recoveredOn: row.recoveredOn ? toDb(row.recoveredOn) : null,
        visitId: row.visitId ?? null,
      })),
      skipDuplicates: true,
    })
  ).count;

  const planned = (steps: number[]) => steps.map((amount, index) => ({ month: addMonths(previous, index), paise: rupees(amount) }));
  added.budgets = (
    await db.budget.createMany({
      data: [
        {
          sampleKey: "sample-budget-lean",
          isSample: true,
          name: "Lean",
          lines: inPaise(LEAN),
          // The set-up month, then month one (the design's "plan said −₹1,71,000 for month one"), and on.
          plannedNet: planned([-160_000, -171_000, -140_000, -100_000, -60_000, -20_000, 10_000]),
          isDefault: true,
          sortOrder: 0,
        },
        {
          sampleKey: "sample-budget-full",
          isSample: true,
          name: "Full",
          lines: inPaise(FULL),
          plannedNet: planned([-220_000, -330_000, -290_000, -240_000, -180_000, -120_000, -60_000]),
          isDefault: false,
          sortOrder: 1,
        },
      ],
      skipDuplicates: true,
    })
  ).count;

  added.founderMoney = (
    await db.founderMoney.createMany({
      data: [
        { sampleKey: "sample-founder-1", isSample: true, founder: "Abdul", date: toDb(booksStart), amountPaise: rupees(350_000), direction: "IN", label: "Starting capital" },
        { sampleKey: "sample-founder-2", isSample: true, founder: "Founder B", date: toDb(addDays(booksStart, 4)), amountPaise: rupees(250_000), direction: "IN", label: "Starting capital" },
      ],
      skipDuplicates: true,
    })
  ).count;

  // The company's bank account and cash box start empty on the first day of the books; the founders' money is what fills them.
  added.openings = (
    await db.cashOpening.createMany({
      data: [{ sampleKey: "sample-opening", isSample: true, asOf: toDb(booksStart), bankPaise: 0, cashPaise: 0 }],
      skipDuplicates: true,
    })
  ).count;

  return added;
}

/** Takes every sample row out of the books. Real entries are never touched. */
export async function removeFinanceSample(db: Db) {
  const [expenses, budgets, founderMoney, openings] = [
    (await db.expense.deleteMany({ where: { isSample: true } })).count,
    (await db.budget.deleteMany({ where: { isSample: true } })).count,
    (await db.founderMoney.deleteMany({ where: { isSample: true } })).count,
    (await db.cashOpening.deleteMany({ where: { isSample: true } })).count,
  ];
  return { expenses, budgets, founderMoney, openings };
}
