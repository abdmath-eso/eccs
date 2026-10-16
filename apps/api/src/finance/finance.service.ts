import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  AGEING_BUCKETS,
  AGEING_LABELS,
  ageCollections,
  aiCostPaise,
  addDays,
  budgetMonths,
  budgetTotal,
  budgetUse,
  daysFrom,
  cashBalanceByDay,
  cashBalanceOn,
  chartBuckets,
  EXPENSE_TYPE_LABELS,
  FINANCE_LINE_LABELS,
  FINANCE_LINE_SHORT,
  FINANCE_LINES,
  FINANCE_RULES,
  founderShares,
  invoiceOverdueDays,
  invoiceReminderText,
  lastFullMonth,
  monthEnd,
  monthlyPlanPaise,
  monthName,
  monthOf,
  monthStart,
  periodGonePercent,
  readBudgetLines,
  runway,
  spreadOverMonth,
  sumIntoBuckets,
  whatsappReminderUrl,
  type BillingCycle,
  type BudgetDto,
  type BudgetValues,
  type CashDayDetailDto,
  type CashMovement,
  type CashOpeningDto,
  type ExpenseDto,
  type ExpenseKind,
  type ExpenseListDto,
  type ExpenseListQuery,
  type ExpenseType,
  type ExpenseValues,
  type ExportRegister,
  type FinanceLine,
  type FinanceOverviewDto,
  type FinanceQuery,
  type FinanceSettingsDto,
  type FinanceVisitOptionDto,
  type FounderMoneyDirection,
  type FounderMoneyDto,
  type FounderMoneyValues,
  type LocalizedText,
  type OpeningCash,
  type PaidVia,
  type PayoutGroupDto,
} from '@eccs/shared';
import { csvCell } from '../activity-log/activity-log-reader.service.js';
import { noteActivity } from '../activity-log/activity-context.js';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { StorageService } from '../storage/storage.service.js';
import { TeamSalaryService } from '../team/team-salary.service.js';

// The Finance page (15 Oct 2026): ECCS's own money in, money out and the budget, for
// the founders (the Super Admin; the "finance" grant in permissions.ts).
//
// Money in is read from billing and never entered here: invoices issued, payments
// received, plans and the AI's cost (AiRequest). Money out is the expense book kept
// here: expenses (each paid, or owed until a due date), wage advances, the founders'
// money, budgets and the opening cash balance. The arithmetic itself is in
// packages/shared/src/finance.ts, tested on its own; this service gathers the rows and
// hands them to it.
//
// The books are small (a few thousand rows a year), so each answer reads what it needs
// in full and works the figures out in memory. Move the sums into the database before
// the expense book reaches tens of thousands of rows.

const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDb = (date: Date) => date.toISOString().slice(0, 10);
const optionalDate = (date: Date | null) => (date ? fromDb(date) : null);
const english = (text: unknown) => {
  const localized = (text ?? {}) as LocalizedText;
  return localized.en ?? Object.values(localized)[0] ?? '';
};
const sum = <T>(items: readonly T[], pick: (item: T) => number) => items.reduce((total, item) => total + pick(item), 0);
const within = (date: string, from: string, to: string) => date >= from && date <= to;
/** Two decimals for a CSV, e.g. 2360.00: a chartered accountant's spreadsheet reads it as a number. */
const csvRupees = (paise: number) => (paise / 100).toFixed(2);

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  cash: 'Cash',
  'bank-transfer': 'Bank transfer',
  cheque: 'Cheque',
};
const methodLabel = (method: string) => PAYMENT_METHOD_LABELS[method] ?? method;

/**
 * Why the expense book takes no salaries by hand since 16 Oct 2026: the Team page makes them,
 * a row a person a month, so typing them in as well would count them twice.
 */
const SALARIES_FROM_TEAM = 'Salaries come from the Team page: add the person and their salary there.';
const TEAM_ROW = 'This salary comes from the Team page. Change it there; here it can only be marked paid.';

/** The AI line's name in the expense book and the CA's register. */
const AI_VENDOR = 'Anthropic API';

const expenseInclude = {
  receipt: { select: { id: true, mimeType: true } },
  visit: { select: { id: true, scheduledDate: true, outlet: { select: { name: true } }, serviceReport: { select: { number: true } } } },
  teamMember: { select: { userId: true } },
} as const satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

/** One amount of spending in the books: an expense, or a day's AI cost. Wage advances are not spending. */
interface Spend {
  date: string;
  line: FinanceLine;
  paise: number;
}

/** A payment received, as the books read it. */
interface Received {
  date: string;
  paise: number;
  method: string;
  clientName: string;
}

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly team: TeamSalaryService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Reading the books ─────────────────────────

  async settings(): Promise<FinanceSettingsDto> {
    const row = await this.db.financeSettings.findUnique({ where: { id: 'default' } });
    return {
      collectedTargetPercent: row?.collectedTargetPercent ?? FINANCE_RULES.collectedTargetPercent,
      usdToInrPaise: row?.usdToInrPaise ?? FINANCE_RULES.usdToInrPaise,
    };
  }

  private async budgets(): Promise<BudgetDto[]> {
    const rows = await this.db.budget.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((row) => {
      const lines = readBudgetLines(row.lines);
      const planned = Array.isArray(row.plannedNet) ? (row.plannedNet as { month?: unknown; paise?: unknown }[]) : [];
      return {
        id: row.id,
        name: row.name,
        lines,
        totalPaise: budgetTotal(lines),
        plannedNet: planned
          .filter((entry) => typeof entry.month === 'string' && typeof entry.paise === 'number')
          .map((entry) => ({ month: entry.month as string, paise: entry.paise as number }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        isDefault: row.isDefault,
        isSample: row.isSample,
      };
    });
  }

  /** The opening balance in use: the one with the latest day. */
  private async opening(): Promise<CashOpeningDto | null> {
    const row = await this.db.cashOpening.findFirst({ orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
    return row && { id: row.id, asOf: fromDb(row.asOf), bankPaise: row.bankPaise, cashPaise: row.cashPaise, isSample: row.isSample };
  }

  private async expenseRows(where: Prisma.ExpenseWhereInput = {}, take?: number): Promise<ExpenseRow[]> {
    return this.db.expense.findMany({ where, include: expenseInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], ...(take && { take }) });
  }

  /** Every payment received, dated by the India day the money came in. */
  private async received(): Promise<Received[]> {
    const rows = await this.db.payment.findMany({
      where: { status: 'SUCCEEDED', paidAt: { not: null } },
      select: { amountPaise: true, method: true, paidAt: true, invoice: { select: { organization: { select: { name: true } } } } },
    });
    return rows.map((row) => ({ date: indiaDate(row.paidAt!), paise: row.amountPaise, method: row.method, clientName: row.invoice.organization.name }));
  }

  /** The AI's cost by India day, in paise at the rate set. */
  private async aiByDay(usdToInrPaise: number): Promise<Map<string, number>> {
    const rows = await this.db.$queryRaw<{ day: string; cost: bigint | number | null }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
             SUM("costMicroUsd")::bigint AS cost
      FROM "AiRequest"
      GROUP BY 1`;
    const days = new Map<string, number>();
    for (const row of rows) {
      const paise = aiCostPaise(Number(row.cost ?? 0), usdToInrPaise);
      if (paise > 0) days.set(row.day, paise);
    }
    return days;
  }

  /** Spending: every expense by its line, and each day's AI cost on "Software and AI". */
  private spends(expenses: readonly ExpenseRow[], ai: Map<string, number>): Spend[] {
    const spends: Spend[] = expenses
      .filter((row) => row.kind === 'EXPENSE' && row.category)
      .map((row) => ({ date: fromDb(row.date), line: row.category as FinanceLine, paise: row.amountPaise }));
    for (const [date, paise] of ai) spends.push({ date, line: 'SOFTWARE', paise });
    return spends;
  }

  /**
   * Money into and out of the bank and cash box, by day: payments received and
   * founders' money in; bills and wage advances paid and founders' money taken out; a
   * wage advance comes back on the day it is recovered from pay (the salary paid that
   * day is the full amount, less what the advance already paid). The AI's cost is not
   * here: it is paid by card outside these books.
   */
  private movements(expenses: readonly ExpenseRow[], founders: readonly { date: Date; amountPaise: number; direction: string }[], received: readonly Received[]): CashMovement[] {
    const moves: CashMovement[] = received.map((payment) => ({ date: payment.date, paise: payment.paise }));
    for (const entry of founders) moves.push({ date: fromDb(entry.date), paise: entry.direction === 'IN' ? entry.amountPaise : -entry.amountPaise });
    for (const row of expenses) {
      if (row.paidOn) moves.push({ date: fromDb(row.paidOn), paise: -row.amountPaise });
      if (row.kind === 'WAGE_ADVANCE' && row.recoveredOn) moves.push({ date: fromDb(row.recoveredOn), paise: row.amountPaise });
    }
    return moves;
  }

  /** Everything on the Finance page for a period, against one budget. */
  async overview(query: FinanceQuery): Promise<FinanceOverviewDto> {
    const today = indiaDate();
    // The month's salaries from the Team page, brought in before anything is read.
    await this.team.sync(today);
    const { from, to } = query;
    const settings = await this.settings();
    const [budgets, opening, expenses, founderRows, received, ai, unpaidInvoices, invoicesInPeriod, active, cancelledAt] = await Promise.all([
      this.budgets(),
      this.opening(),
      this.expenseRows(),
      this.db.founderMoney.findMany({ orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      this.received(),
      this.aiByDay(settings.usdToInrPaise),
      this.db.invoice.findMany({
        where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
        select: { id: true, number: true, dueDate: true, totalPaise: true, paidPaise: true, organization: { select: { name: true } }, outlet: { select: { name: true } } },
      }),
      this.db.invoice.findMany({
        where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] }, issueDate: { gte: toDb(from), lte: toDb(to) } },
        select: { totalPaise: true, subscriptionId: true },
      }),
      this.db.subscription.findMany({
        where: { status: 'ACTIVE' },
        select: { pricePaise: true, billingCycle: true, plan: { select: { pricePaise: true, billingCycle: true } } },
      }),
      this.db.subscription.findMany({ where: { cancelledAt: { not: null } }, select: { cancelledAt: true } }),
    ]);

    const spends = this.spends(expenses, ai);
    const founders = founderRows.map((row) => ({ ...row, day: fromDb(row.date) }));
    const firstEntry = [...expenses.map((row) => fromDb(row.date)), ...founders.map((row) => row.day)].sort()[0] ?? null;
    const booksStart = opening?.asOf ?? firstEntry;
    // With an opening balance, everything before its day is already inside it.
    const counted = (date: string) => !opening || date >= opening.asOf;
    const inPeriod = (date: string) => within(date, from, to);

    const budget = budgets.find((entry) => entry.id === query.budgetId) ?? budgets.find((entry) => entry.isDefault) ?? budgets[0] ?? null;
    const months = budgetMonths(from, to, booksStart);

    // ── The six cards ──
    const invoicedPaise = sum(invoicesInPeriod, (invoice) => invoice.totalPaise);
    const plans = invoicesInPeriod.filter((invoice) => invoice.subscriptionId).length;
    const collectedPaise = sum(received.filter((payment) => inPeriod(payment.date)), (payment) => payment.paise);
    const owed = unpaidInvoices
      .map((invoice) => {
        const duePaise = Math.max(0, invoice.totalPaise - invoice.paidPaise);
        const dueDate = fromDb(invoice.dueDate);
        return { ...invoice, duePaise, dueDate, overdueDays: invoiceOverdueDays(dueDate, today, duePaise) };
      })
      .filter((invoice) => invoice.duePaise > 0);
    const overdue = owed.filter((invoice) => invoice.overdueDays > 0);
    const spentInPeriod = spends.filter((spend) => inPeriod(spend.date));
    const expensesPaise = sum(spentInPeriod, (spend) => spend.paise);
    const budgetPaise = budget ? budget.totalPaise * months.length : null;
    const plannedMonths = budget ? budget.plannedNet.filter((entry) => months.includes(entry.month)) : [];
    const cycleOf = (subscription: (typeof active)[number]) => (subscription.billingCycle ?? subscription.plan.billingCycle) as BillingCycle;

    const cards: FinanceOverviewDto['cards'] = {
      invoiced: { totalPaise: invoicedPaise, count: invoicesInPeriod.length, plans, oneOff: invoicesInPeriod.length - plans },
      collected: {
        paise: collectedPaise,
        percentOfInvoiced: invoicedPaise > 0 ? Math.round((collectedPaise / invoicedPaise) * 100) : null,
        targetPercent: settings.collectedTargetPercent,
      },
      outstanding: { paise: sum(owed, (invoice) => invoice.duePaise), count: owed.length, overduePaise: sum(overdue, (invoice) => invoice.duePaise), overdueCount: overdue.length },
      expenses: {
        paise: expensesPaise,
        budgetPaise,
        percentOfBudget: budgetUse(expensesPaise, budgetPaise).percent,
        percentOfPeriodGone: periodGonePercent(months.length > 0 ? months : [monthOf(from)], today),
      },
      netCash: {
        paise: collectedPaise - expensesPaise,
        plannedPaise: plannedMonths.length > 0 ? sum(plannedMonths, (entry) => entry.paise) : null,
        plannedMonths: plannedMonths.map((entry) => entry.month),
      },
      planRevenue: {
        monthlyPaise: sum(active, (subscription) => monthlyPlanPaise(subscription.pricePaise ?? subscription.plan.pricePaise, cycleOf(subscription))),
        active: active.length,
        cancelled: cancelledAt.filter((subscription) => inPeriod(indiaDate(subscription.cancelledAt!))).length,
      },
    };

    // ── Collected against expenses, by week (or month) ──
    // A long period (drawn by month) starts at the first month with anything in it, so a
    // financial year begun before the books does not open with empty months.
    const chartEnd = to < today ? to : today;
    const firstActivity = [...spentInPeriod.map((spend) => spend.date), ...received.filter((payment) => inPeriod(payment.date)).map((payment) => payment.date)].sort()[0];
    const long = daysFrom(from, chartEnd) + 1 > FINANCE_RULES.weeklyUpToDays;
    const chart = chartBuckets(long && firstActivity && monthStart(monthOf(firstActivity)) > from ? monthStart(monthOf(firstActivity)) : from, to, today);
    const chartSpends = spentInPeriod.flatMap((spend) =>
      // "Expenses include salaries accrued": a month's salaries are spread over its days.
      spend.line === 'SALARIES' ? spreadOverMonth(spend.paise, spend.date, from, chartEnd) : [spend],
    );
    const collectedByBucket = sumIntoBuckets(chart.buckets, received);
    const spentByBucket = sumIntoBuckets(chart.buckets, chartSpends);
    const buckets = chart.buckets.map((bucket, index) => ({ ...bucket, collectedPaise: collectedByBucket[index]!, expensesPaise: spentByBucket[index]! }));

    // ── Expenses against the budget, line by line ──
    const lines = FINANCE_LINES.map((line) => {
      const actualPaise = sum(spentInPeriod.filter((spend) => spend.line === line), (spend) => spend.paise);
      const linePaise = budget ? budget.lines[line] * months.length : null;
      const use = budgetUse(actualPaise, linePaise);
      return { line, label: FINANCE_LINE_LABELS[line], actualPaise, budgetPaise: linePaise, percent: use.percent, overByPaise: linePaise === null ? 0 : use.overByPaise };
    });

    // ── Founders' money and runway ──
    const thisMonth = monthOf(today);
    const countedSpends = spends.filter((spend) => counted(spend.date));
    const countedFounders = founders.filter((entry) => counted(entry.day));
    const openingPaise = opening ? opening.bankPaise + opening.cashPaise : 0;
    const putInPaise = sum(countedFounders.filter((entry) => entry.direction === 'IN'), (entry) => entry.amountPaise);
    const takenOutPaise = sum(countedFounders.filter((entry) => entry.direction === 'OUT'), (entry) => entry.amountPaise);
    const collectedAll = sum(received.filter((payment) => counted(payment.date)), (payment) => payment.paise);
    const spentBeforePaise = sum(countedSpends.filter((spend) => spend.date < monthStart(thisMonth)), (spend) => spend.paise);
    const spentThisMonthPaise = sum(countedSpends.filter((spend) => spend.date >= monthStart(thisMonth)), (spend) => spend.paise);
    const leftPaise = openingPaise + putInPaise - takenOutPaise + collectedAll - spentBeforePaise - spentThisMonthPaise;
    const unpaid = expenses.filter((row) => row.kind === 'EXPENSE' && !row.paidOn);
    const fullMonth = lastFullMonth(today, booksStart);
    const lastFull = fullMonth
      ? {
          month: fullMonth,
          netOutflowPaise:
            sum(spends.filter((spend) => monthOf(spend.date) === fullMonth), (spend) => spend.paise) -
            sum(received.filter((payment) => monthOf(payment.date) === fullMonth), (payment) => payment.paise),
        }
      : null;

    // ── Cash: the last 14 days ──
    const movements = this.movements(expenses, founderRows, received);
    const openingCash: OpeningCash | null = opening ? { date: opening.asOf, paise: openingPaise } : null;
    const windowFrom = addDays(today, -(FINANCE_RULES.recentDays - 1));
    const balances = cashBalanceByDay(openingCash, movements, windowFrom, today);
    // Day-to-day cash out: everything paid except salaries (they go once a month), and wage advances given.
    const dailyOut = expenses.flatMap((row) =>
      row.paidOn && row.category !== 'SALARIES' && within(fromDb(row.paidOn), windowFrom, today)
        ? [{ date: fromDb(row.paidOn), paise: row.amountPaise, key: row.kind === 'WAGE_ADVANCE' ? 'WAGE_ADVANCE' : (row.type ?? 'OTHER') }]
        : [],
    );
    const days = balances.map(({ date, paise }) => ({
      date,
      inPaise: sum(received.filter((payment) => payment.date === date), (payment) => payment.paise),
      outPaise: sum(dailyOut.filter((item) => item.date === date), (item) => item.paise),
      balancePaise: paise,
    }));
    const unpaidSalaries = unpaid.filter((row) => row.category === 'SALARIES');
    const firstDue = unpaid.map((row) => optionalDate(row.dueDate)).filter((date): date is string => !!date).sort()[0] ?? null;

    // ── Daily spend by kind ──
    const kinds = new Map<string, number>();
    for (const item of dailyOut) kinds.set(item.key, (kinds.get(item.key) ?? 0) + item.paise);
    const spendTotal = sum(dailyOut, (item) => item.paise);
    const ranked = [...days].sort((a, b) => b.outPaise - a.outPaise || a.date.localeCompare(b.date));

    // ── The expense book's latest entries, the month's AI line among them ──
    const aiLines = this.aiLines(ai);
    const latestRows = expenses.slice(0, FINANCE_RULES.latestEntries);
    const people = await this.names(latestRows);
    const latest = [...latestRows.map((row) => this.toDto(row, people)), ...aiLines.filter((line) => monthOf(line.date) === thisMonth)]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, FINANCE_RULES.latestEntries);

    // ── Collections ageing ──
    const aged = ageCollections(owed, today);

    const sample =
      expenses.some((row) => row.isSample) || budgets.some((entry) => entry.isSample) || founderRows.some((row) => row.isSample) || Boolean(opening?.isSample);

    return {
      today,
      from,
      to,
      sample,
      settings,
      opening,
      booksStart,
      budgets,
      budgetId: budget?.id ?? null,
      budgetMonths: months,
      cards,
      bucketKind: chart.kind,
      buckets,
      lines,
      founders: {
        openingPaise,
        putInPaise,
        takenOutPaise,
        collectedPaise: collectedAll,
        spentBeforePaise,
        spentThisMonthPaise,
        thisMonth,
        leftPaise,
        unpaidPaise: sum(unpaid, (row) => row.amountPaise),
        people: founderShares(founders.map((row) => ({ founder: row.founder, date: row.day, amountPaise: row.amountPaise, direction: row.direction as FounderMoneyDirection }))),
        entries: [...founderRows].reverse().map(toFounderDto),
        lastFullMonth: lastFull,
        runway: runway(leftPaise, lastFull?.netOutflowPaise ?? null),
      },
      cashFlow: {
        days,
        inPaise: sum(days, (day) => day.inPaise),
        outPaise: sum(days, (day) => day.outPaise),
        dueOut: {
          salariesPaise: sum(unpaidSalaries, (row) => row.amountPaise),
          payoutsPaise: sum(unpaid, (row) => row.amountPaise) - sum(unpaidSalaries, (row) => row.amountPaise),
          firstDueDate: firstDue,
        },
      },
      dailySpend: {
        types: [...kinds.entries()]
          .map(([key, paise]) => ({ key, paise, label: key === 'WAGE_ADVANCE' ? 'Wage advances' : key === 'OTHER' ? 'Other bills' : EXPENSE_TYPE_LABELS[key as ExpenseType] }))
          .sort((a, b) => b.paise - a.paise),
        totalPaise: spendTotal,
        perDayPaise: Math.round(spendTotal / FINANCE_RULES.recentDays),
        highest: spendTotal > 0 ? { date: ranked[0]!.date, paise: ranked[0]!.outPaise } : null,
        lowest: spendTotal > 0 ? { date: ranked[ranked.length - 1]!.date, paise: ranked[ranked.length - 1]!.outPaise } : null,
        advancesToRecoverPaise: sum(expenses.filter((row) => row.kind === 'WAGE_ADVANCE' && !row.recoveredOn), (row) => row.amountPaise),
        days: FINANCE_RULES.recentDays,
      },
      latest,
      entryCount: expenses.length,
      ageing: {
        totalPaise: aged.totalPaise,
        count: aged.count,
        buckets: AGEING_BUCKETS.map((bucket) => ({ bucket, label: AGEING_LABELS[bucket], ...aged.buckets[bucket] })),
        overdue: overdue
          .sort((a, b) => b.overdueDays - a.overdueDays || b.duePaise - a.duePaise)
          .map((invoice) => ({
            id: invoice.id,
            number: invoice.number,
            organizationName: invoice.organization.name,
            outletName: invoice.outlet?.name ?? null,
            duePaise: invoice.duePaise,
            dueDate: invoice.dueDate,
            overdueDays: invoice.overdueDays,
          })),
      },
      payouts: payoutGroups(unpaid),
    };
  }

  /** One day's cash, as the office closes it. Any day can be asked for. */
  async day(date: string): Promise<CashDayDetailDto> {
    await this.team.sync();
    const [opening, expenses, founders, received] = await Promise.all([
      this.opening(),
      this.expenseRows(),
      this.db.founderMoney.findMany(),
      this.received(),
    ]);
    const openingCash: OpeningCash | null = opening ? { date: opening.asOf, paise: opening.bankPaise + opening.cashPaise } : null;
    const movements = this.movements(expenses, founders, received);
    const openingPaise = openingCash && date === openingCash.date ? openingCash.paise : cashBalanceOn(openingCash, movements, addDays(date, -1));

    const cashIn: { label: string; paise: number }[] = [];
    // Collections, one line per way of paying, naming who paid.
    const byMethod = new Map<string, Received[]>();
    for (const payment of received.filter((entry) => entry.date === date)) byMethod.set(payment.method, [...(byMethod.get(payment.method) ?? []), payment]);
    for (const [method, payments] of byMethod) {
      const clients = [...new Set(payments.map((payment) => payment.clientName))];
      cashIn.push({ label: `${methodLabel(method)}, ${joinNames(clients)}`, paise: sum(payments, (payment) => payment.paise) });
    }
    for (const entry of founders.filter((row) => row.direction === 'IN' && fromDb(row.date) === date)) cashIn.push({ label: `Founders' money, ${entry.founder}`, paise: entry.amountPaise });
    for (const row of expenses.filter((entry) => entry.kind === 'WAGE_ADVANCE' && entry.recoveredOn && fromDb(entry.recoveredOn) === date)) {
      cashIn.push({ label: `Wage advance recovered from pay, ${row.vendor}`, paise: row.amountPaise });
    }

    const cashOut: { label: string; paise: number }[] = [];
    for (const row of expenses.filter((entry) => entry.paidOn && fromDb(entry.paidOn) === date)) {
      const what = row.kind === 'WAGE_ADVANCE' ? 'Wage advance' : row.type ? EXPENSE_TYPE_LABELS[row.type as ExpenseType] : FINANCE_LINE_SHORT[row.category as FinanceLine];
      cashOut.push({ label: [what, row.vendor, row.visit ? `${row.visit.outlet.name} visit` : null].filter(Boolean).join(', '), paise: row.amountPaise });
    }
    for (const entry of founders.filter((row) => row.direction === 'OUT' && fromDb(row.date) === date)) cashOut.push({ label: `Taken out by ${entry.founder}`, paise: entry.amountPaise });

    const inPaise = sum(cashIn, (line) => line.paise);
    const outPaise = sum(cashOut, (line) => line.paise);
    return {
      date,
      openingPaise,
      in: cashIn.sort((a, b) => b.paise - a.paise),
      out: cashOut.sort((a, b) => b.paise - a.paise),
      inPaise,
      outPaise,
      closingPaise: openingPaise === null ? null : openingPaise + inPaise - outPaise,
    };
  }

  /** "All entries": the expense book, newest first, with its filters; the AI lines of the months shown are included. */
  async list(filter: ExpenseListQuery): Promise<ExpenseListDto> {
    const where: Prisma.ExpenseWhereInput = {
      ...(filter.month && { date: { gte: toDb(monthStart(filter.month)), lte: toDb(monthEnd(filter.month)) } }),
      ...(filter.category === 'WAGE_ADVANCE' ? { kind: 'WAGE_ADVANCE' } : filter.category ? { category: filter.category } : {}),
      ...(filter.paid === 'yes' && { paidOn: { not: null } }),
      ...(filter.paid === 'no' && { paidOn: null, kind: 'EXPENSE' }),
      ...(filter.visit === 'yes' && { visitId: { not: null } }),
      ...(filter.visit === 'no' && { visitId: null }),
    };
    await this.team.sync();
    const settings = await this.settings();
    const [rows, all, ai] = await Promise.all([
      this.expenseRows(where, FINANCE_RULES.maxListed),
      this.db.expense.findMany({ select: { date: true } }),
      this.aiByDay(settings.usdToInrPaise),
    ]);
    const people = await this.names(rows);
    const aiLines = this.aiLines(ai);
    // The AI line is always paid-for spending on software with no visit; it shows unless a filter rules that out.
    const showAi = !filter.paid && !filter.visit && (!filter.category || filter.category === 'SOFTWARE');
    const entries = [...rows.map((row) => this.toDto(row, people)), ...(showAi ? aiLines.filter((line) => !filter.month || monthOf(line.date) === filter.month) : [])].sort(
      (a, b) => b.date.localeCompare(a.date),
    );
    const months = [...new Set([...all.map((row) => monthOf(fromDb(row.date))), ...aiLines.map((line) => monthOf(line.date))])].sort().reverse();
    return { entries, months };
  }

  /** Visits an expense can be put against: the last 90 days and the next 14, newest first. */
  async visitOptions(): Promise<FinanceVisitOptionDto[]> {
    const today = indiaDate();
    const visits = await this.db.job.findMany({
      where: { status: { not: 'CANCELLED' }, scheduledDate: { gte: toDb(addDays(today, -90)), lte: toDb(addDays(today, 14)) } },
      orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      select: { id: true, scheduledDate: true, outlet: { select: { name: true } }, serviceType: { select: { name: true } }, serviceReport: { select: { number: true } } },
    });
    return visits.map((visit) => ({
      id: visit.id,
      date: fromDb(visit.scheduledDate),
      outletName: visit.outlet.name,
      serviceName: english(visit.serviceType.name),
      reference: visit.serviceReport?.number ?? null,
    }));
  }

  // ───────────────────────── The expense book ─────────────────────────

  /** Adds an expense or wage advance. The id the console chose makes pressing Save twice add one. */
  async createExpense(user: AuthUser, input: ExpenseValues): Promise<ExpenseDto> {
    const id = input.id ?? randomUUID();
    const existing = await this.db.expense.findUnique({ where: { id }, include: expenseInclude });
    if (existing) return this.toDto(existing, await this.names([existing]));
    if (input.category === 'SALARIES') throw new BadRequestException(SALARIES_FROM_TEAM);
    await this.check(input);
    const row = await this.db.expense.create({ data: { id, ...expenseData(input), enteredById: user.id }, include: expenseInclude });
    return this.toDto(row, await this.names([row]));
  }

  async updateExpense(id: string, input: ExpenseValues): Promise<ExpenseDto> {
    const current = await this.db.expense.findUnique({ where: { id }, select: { receiptId: true, category: true, teamMemberId: true } });
    if (!current) throw new NotFoundException('That entry is no longer in the expense book');
    if (current.teamMemberId) throw new ConflictException(TEAM_ROW);
    // A salary typed in before Team made them can still be corrected; no other entry becomes one.
    if (input.category === 'SALARIES' && current.category !== 'SALARIES') throw new BadRequestException(SALARIES_FROM_TEAM);
    await this.check(input);
    const row = await this.db.expense.update({ where: { id }, data: expenseData(input), include: expenseInclude });
    if (current.receiptId && current.receiptId !== row.receiptId) await this.dropReceipt(current.receiptId);
    return this.toDto(row, await this.names([row]));
  }

  async removeExpense(id: string): Promise<void> {
    const current = await this.db.expense.findUnique({ where: { id }, select: { receiptId: true, teamMemberId: true } });
    if (!current) throw new NotFoundException('That entry is no longer in the expense book');
    if (current.teamMemberId) throw new ConflictException(TEAM_ROW);
    await this.db.expense.delete({ where: { id } });
    if (current.receiptId) await this.dropReceipt(current.receiptId);
  }

  /** Pays unpaid bills together (a payout's "Mark paid"). Bills already paid are left as they are. */
  async markPaid(input: { ids: string[]; paidVia: PaidVia; paidOn: string }): Promise<{ updated: number }> {
    if (input.paidOn > indiaDate()) throw new BadRequestException('The day it was paid cannot be in the future');
    const { count } = await this.db.expense.updateMany({
      where: { id: { in: input.ids }, kind: 'EXPENSE', paidOn: null },
      data: { paidVia: input.paidVia, paidOn: toDb(input.paidOn) },
    });
    return { updated: count };
  }

  /** Files a receipt (a photo or a PDF) before the expense it belongs to is saved. */
  async uploadReceipt(user: AuthUser, file: { buffer: Buffer; size: number } | undefined): Promise<{ id: string; path: string; pdf: boolean }> {
    if (!file) throw new BadRequestException('Choose a photo or PDF of the receipt');
    const kind = sniffFile(file.buffer, true);
    if (!kind) throw new BadRequestException('Only PDF, JPEG, PNG or WebP files are accepted');
    if (file.size > FINANCE_RULES.maxReceiptBytes) throw new BadRequestException('That file is too large (10 MB at most)');
    const id = randomUUID();
    const now = new Date();
    const storageKey = `finance/receipts/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${kind.extension}`;
    await this.storage.put(storageKey, file.buffer, kind.mimeType);
    // A document of ECCS's own, so it belongs to no outlet.
    await this.db.attachment.create({ data: { id, kind: 'DOCUMENT', storageKey, mimeType: kind.mimeType, sizeBytes: file.size, capturedAt: now, uploadedById: user.id } });
    return { id, path: this.storage.signedPath(id), pdf: kind.mimeType === 'application/pdf' };
  }

  // ───────────────────────── Budgets, founders' money, opening balance, settings ─────────────────────────

  async createBudget(input: BudgetValues): Promise<BudgetDto> {
    const last = await this.db.budget.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const count = await this.db.budget.count();
    const row = await this.db.$transaction(async (tx) => {
      // The first budget is the one compared with, until another is chosen.
      const isDefault = input.isDefault || count === 0;
      if (isDefault) await tx.budget.updateMany({ data: { isDefault: false } });
      return tx.budget.create({
        data: { name: input.name, lines: input.lines, plannedNet: input.plannedNet, isDefault, sortOrder: (last?.sortOrder ?? -1) + 1 },
        select: { id: true },
      });
    });
    return this.budgetDto(row.id);
  }

  async updateBudget(id: string, input: BudgetValues): Promise<BudgetDto> {
    const current = await this.db.budget.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new NotFoundException('That budget no longer exists');
    await this.db.$transaction(async (tx) => {
      if (input.isDefault) await tx.budget.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
      await tx.budget.update({ where: { id }, data: { name: input.name, lines: input.lines, plannedNet: input.plannedNet, isDefault: input.isDefault } });
    });
    return this.budgetDto(id);
  }

  async removeBudget(id: string): Promise<void> {
    const current = await this.db.budget.findUnique({ where: { id }, select: { isDefault: true } });
    if (!current) throw new NotFoundException('That budget no longer exists');
    await this.db.budget.delete({ where: { id } });
    // Another budget takes over as the one compared with.
    if (current.isDefault) {
      const next = await this.db.budget.findFirst({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
      if (next) await this.db.budget.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }

  private async budgetDto(id: string): Promise<BudgetDto> {
    const budget = (await this.budgets()).find((entry) => entry.id === id);
    if (!budget) throw new NotFoundException('That budget no longer exists');
    return budget;
  }

  async addFounderMoney(user: AuthUser, input: FounderMoneyValues): Promise<FounderMoneyDto> {
    if (input.date > indiaDate()) throw new BadRequestException('The date cannot be in the future');
    const id = input.id ?? randomUUID();
    const existing = await this.db.founderMoney.findUnique({ where: { id } });
    if (existing) return toFounderDto(existing);
    const row = await this.db.founderMoney.create({
      data: { id, founder: input.founder, date: toDb(input.date), amountPaise: input.amountPaise, direction: input.direction, label: input.label, enteredById: user.id },
    });
    return toFounderDto(row);
  }

  async removeFounderMoney(id: string): Promise<void> {
    const { count } = await this.db.founderMoney.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('That entry no longer exists');
  }

  /**
   * Sets the bank plus cash box on a day, from which the daily balance is counted. The
   * latest day is the one used; saving the same day again corrects it.
   */
  async saveOpening(user: AuthUser, input: { asOf: string; bankPaise: number; cashPaise: number }): Promise<CashOpeningDto> {
    if (input.asOf > indiaDate()) throw new BadRequestException('The day cannot be in the future');
    const same = await this.db.cashOpening.findFirst({ where: { asOf: toDb(input.asOf), isSample: false }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    const data = { asOf: toDb(input.asOf), bankPaise: input.bankPaise, cashPaise: input.cashPaise, enteredById: user.id };
    const row = same ? await this.db.cashOpening.update({ where: { id: same.id }, data }) : await this.db.cashOpening.create({ data });
    return { id: row.id, asOf: fromDb(row.asOf), bankPaise: row.bankPaise, cashPaise: row.cashPaise, isSample: row.isSample };
  }

  async saveSettings(input: FinanceSettingsDto): Promise<FinanceSettingsDto> {
    await this.db.financeSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...input }, update: input });
    return this.settings();
  }

  // ───────────────────────── Reminders and the CA's export ─────────────────────────

  /**
   * A WhatsApp link with a short, polite reminder typed in, to the client's contact
   * phone (WhatsApp asks whom to send it to when there is none). ECCS sends it from its
   * own WhatsApp; the server sends nothing (the founder's rule: notifications are listed,
   * not built). The request itself is the activity log's record that it was opened.
   */
  async remind(invoiceId: string): Promise<{ url: string; hasPhone: boolean }> {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
      select: { number: true, status: true, dueDate: true, totalPaise: true, paidPaise: true, organization: { select: { name: true, contactPhone: true } } },
    });
    if (!invoice || invoice.status === 'DRAFT') throw new NotFoundException('Invoice not found');
    const duePaise = invoice.totalPaise - invoice.paidPaise;
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status) || duePaise <= 0) throw new ConflictException('Nothing is owed on this invoice');
    const text = invoiceReminderText({ clientName: invoice.organization.name, invoiceNumber: invoice.number, duePaise, dueDate: fromDb(invoice.dueDate) });
    noteActivity({ details: { duePaise, hasPhone: Boolean(invoice.organization.contactPhone) } });
    return { url: whatsappReminderUrl(invoice.organization.contactPhone, text), hasPhone: Boolean(invoice.organization.contactPhone) };
  }

  /**
   * One of the three files a chartered accountant works from, for a period: the expense
   * register, the sales register (invoices with their GST) or the receipts (payments).
   * Every cell goes through the Logs export's guard against spreadsheet formulas.
   */
  async exportCsv(register: ExportRegister, from: string, to: string): Promise<{ csv: string; rows: number; fileName: string }> {
    let table: (string | number | null)[][];
    await this.team.sync();
    if (register === 'expenses') table = await this.expenseRegister(from, to);
    else if (register === 'sales') table = await this.salesRegister(from, to);
    else table = await this.receiptsRegister(from, to);
    // A byte-order mark so Excel reads ₹ and Indian names correctly; Windows line ends.
    const csv = `﻿${table.map((cells) => cells.map((cell) => csvCell(cell)).join(',')).join('\r\n')}\r\n`;
    return { csv, rows: table.length - 1, fileName: `eccs-${register}-${from}-to-${to}.csv` };
  }

  private async expenseRegister(from: string, to: string) {
    const settings = await this.settings();
    const [rows, ai] = await Promise.all([
      this.db.expense.findMany({ where: { date: { gte: toDb(from), lte: toDb(to) } }, include: expenseInclude, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      this.aiByDay(settings.usdToInrPaise),
    ]);
    const table: (string | number | null)[][] = [
      ['Date', 'Vendor', 'Category', 'Type', 'Description', 'Amount (Rs)', 'GST (Rs)', 'Taxable value (Rs)', 'Paid via', 'Paid on', 'Due date', 'Linked visit', 'Receipt filed', 'Entry id'],
    ];
    for (const row of rows) {
      const advance = row.kind === 'WAGE_ADVANCE';
      table.push([
        fromDb(row.date),
        row.vendor,
        advance ? 'Wage advance (recovered from pay, not an expense)' : FINANCE_LINE_LABELS[row.category as FinanceLine] ?? row.category,
        row.type ? EXPENSE_TYPE_LABELS[row.type as ExpenseType] : '',
        row.description,
        csvRupees(row.amountPaise),
        csvRupees(row.gstPaise),
        csvRupees(row.amountPaise - row.gstPaise),
        row.paidVia ? methodLabel(row.paidVia) : 'Not yet paid',
        optionalDate(row.paidOn),
        optionalDate(row.dueDate),
        row.visit ? visitLabel(row.visit) : '',
        row.receipt ? 'Yes' : 'No',
        row.id,
      ]);
    }
    // The AI's cost, a month at a time, as the expense book shows it.
    for (const line of this.aiLines(ai, from, to)) {
      table.push([line.date, AI_VENDOR, FINANCE_LINE_LABELS.SOFTWARE, '', line.description, csvRupees(line.amountPaise), '0.00', csvRupees(line.amountPaise), 'Card', '', '', '', 'No', '']);
    }
    return table;
  }

  private async salesRegister(from: string, to: string) {
    const invoices = await this.db.invoice.findMany({
      where: { status: { not: 'DRAFT' }, issueDate: { gte: toDb(from), lte: toDb(to) } },
      orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
      select: {
        number: true,
        issueDate: true,
        status: true,
        billTo: true,
        placeOfSupply: true,
        subtotalPaise: true,
        cgstPaise: true,
        sgstPaise: true,
        igstPaise: true,
        totalPaise: true,
        organization: { select: { name: true, gstin: true } },
        outlet: { select: { name: true } },
      },
    });
    const table: (string | number | null)[][] = [
      ['Invoice number', 'Invoice date', 'Client', 'GSTIN', 'Place of supply', 'Taxable value (Rs)', 'CGST (Rs)', 'SGST (Rs)', 'IGST (Rs)', 'Total (Rs)', 'Status', 'Outlet'],
    ];
    for (const invoice of invoices) {
      // The buyer as printed on the invoice, not as the client's details stand today.
      const billTo = (invoice.billTo ?? {}) as { name?: string; legalName?: string | null; gstin?: string | null };
      table.push([
        invoice.number,
        fromDb(invoice.issueDate),
        billTo.legalName || billTo.name || invoice.organization.name,
        billTo.gstin ?? invoice.organization.gstin ?? '',
        invoice.placeOfSupply ?? '',
        csvRupees(invoice.subtotalPaise),
        csvRupees(invoice.cgstPaise),
        csvRupees(invoice.sgstPaise),
        csvRupees(invoice.igstPaise),
        csvRupees(invoice.totalPaise),
        invoice.status === 'VOID' ? 'Void' : invoice.status === 'PAID' ? 'Paid' : invoice.status === 'PARTIALLY_PAID' ? 'Part paid' : 'Unpaid',
        invoice.outlet?.name ?? '',
      ]);
    }
    return table;
  }

  private async receiptsRegister(from: string, to: string) {
    // India days, from the start of the first to the end of the last.
    const payments = await this.db.payment.findMany({
      where: { status: 'SUCCEEDED', paidAt: { gte: new Date(`${from}T00:00:00+05:30`), lt: new Date(`${addDays(to, 1)}T00:00:00+05:30`) } },
      orderBy: { paidAt: 'asc' },
      select: { paidAt: true, method: true, reference: true, amountPaise: true, invoice: { select: { number: true, organization: { select: { name: true } } } } },
    });
    const table: (string | number | null)[][] = [['Date', 'Invoice number', 'Client', 'Method', 'Reference', 'Amount (Rs)']];
    for (const payment of payments) {
      table.push([indiaDate(payment.paidAt!), payment.invoice.number, payment.invoice.organization.name, methodLabel(payment.method), payment.reference ?? '', csvRupees(payment.amountPaise)]);
    }
    return table;
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** A form's dates and links make sense: nothing in the future, the visit and receipt exist. */
  private async check(input: ExpenseValues) {
    const today = indiaDate();
    if (input.date > today) throw new BadRequestException('The date cannot be in the future');
    if (input.paidOn && input.paidOn > today) throw new BadRequestException('The day it was paid cannot be in the future');
    if (input.recoveredOn && input.recoveredOn > today) throw new BadRequestException('The day it was recovered cannot be in the future');
    if (input.visitId && !(await this.db.job.count({ where: { id: input.visitId } }))) throw new BadRequestException('That visit no longer exists');
    if (input.receiptId) {
      const receipt = await this.db.attachment.count({ where: { id: input.receiptId, kind: 'DOCUMENT', outletId: null } });
      if (!receipt) throw new BadRequestException('That receipt was not found. Add it again.');
    }
  }

  /** Removes a receipt nothing points at any more: its row and its file. A failure only warns. */
  private async dropReceipt(attachmentId: string) {
    try {
      if (await this.db.expense.count({ where: { receiptId: attachmentId } })) return;
      const attachment = await this.db.attachment.findUnique({ where: { id: attachmentId }, select: { storageKey: true, outletId: true } });
      if (!attachment || attachment.outletId) return;
      await this.db.attachment.delete({ where: { id: attachmentId } });
      await this.storage.remove(attachment.storageKey);
    } catch (error) {
      this.logger.warn(`Could not remove the old receipt ${attachmentId}: ${String(error)}`);
    }
  }

  /** The names of who entered each row, for the expense book. */
  private async names(rows: readonly ExpenseRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.enteredById).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const users = await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  /**
   * The AI's cost as automatic lines of the expense book, one per month ("month to
   * date"), dated on the last day it had a cost. Within `from` and `to` when given.
   */
  private aiLines(ai: Map<string, number>, from?: string, to?: string): ExpenseDto[] {
    const months = new Map<string, { paise: number; last: string }>();
    for (const [date, paise] of ai) {
      if ((from && date < from) || (to && date > to)) continue;
      const month = monthOf(date);
      const entry = months.get(month) ?? { paise: 0, last: date };
      entry.paise += paise;
      if (date > entry.last) entry.last = date;
      months.set(month, entry);
    }
    const thisMonth = monthOf(indiaDate());
    return [...months.entries()].map(([month, entry]) => ({
      id: `ai-${month}`,
      kind: 'EXPENSE' as ExpenseKind,
      date: entry.last,
      category: 'SOFTWARE' as FinanceLine,
      type: null,
      vendor: AI_VENDOR,
      description: month === thisMonth ? 'Month to date, from AI requests' : `${monthName(month)}, from AI requests`,
      amountPaise: entry.paise,
      gstPaise: 0,
      paidVia: null,
      paidOn: null,
      dueDate: null,
      recoveredOn: null,
      receipt: null,
      visit: null,
      isSample: false,
      automatic: true,
      team: null,
      enteredByName: null,
    }));
  }

  private toDto(row: ExpenseRow, people: Map<string, string>): ExpenseDto {
    return {
      id: row.id,
      kind: row.kind as ExpenseKind,
      date: fromDb(row.date),
      category: (row.category as FinanceLine | null) ?? null,
      type: (row.type as ExpenseType | null) ?? null,
      vendor: row.vendor,
      description: row.description,
      amountPaise: row.amountPaise,
      gstPaise: row.gstPaise,
      paidVia: (row.paidVia as PaidVia | null) ?? null,
      paidOn: optionalDate(row.paidOn),
      dueDate: optionalDate(row.dueDate),
      recoveredOn: optionalDate(row.recoveredOn),
      receipt: row.receipt ? { id: row.receipt.id, path: this.storage.signedPath(row.receipt.id), pdf: row.receipt.mimeType === 'application/pdf' } : null,
      visit: row.visit
        ? { id: row.visit.id, date: fromDb(row.visit.scheduledDate), outletName: row.visit.outlet.name, reference: row.visit.serviceReport?.number ?? null }
        : null,
      isSample: row.isSample,
      automatic: false,
      team: row.teamMember && row.salaryMonth ? { userId: row.teamMember.userId, month: row.salaryMonth } : null,
      enteredByName: row.enteredById ? (people.get(row.enteredById) ?? null) : null,
    };
  }
}

/** The columns an expense form fills. A wage advance never has a line, a type or a visit. */
function expenseData(input: ExpenseValues): Omit<Prisma.ExpenseUncheckedCreateInput, 'id' | 'enteredById'> {
  const advance = input.kind === 'WAGE_ADVANCE';
  return {
    kind: input.kind,
    date: toDb(input.date),
    category: advance ? null : (input.category ?? null),
    type: advance ? null : (input.type ?? null),
    vendor: input.vendor,
    description: input.description,
    amountPaise: input.amountPaise,
    gstPaise: advance ? 0 : input.gstPaise,
    paidVia: input.paidVia ?? null,
    paidOn: input.paidOn ? toDb(input.paidOn) : null,
    // A paid bill keeps no due date.
    dueDate: input.paidOn ? null : input.dueDate ? toDb(input.dueDate) : null,
    recoveredOn: advance && input.recoveredOn ? toDb(input.recoveredOn) : null,
    receiptId: input.receiptId ?? null,
    visitId: advance ? null : (input.visitId ?? null),
  };
}

function toFounderDto(row: { id: string; founder: string; date: Date; amountPaise: number; direction: string; label: string | null; isSample: boolean }): FounderMoneyDto {
  return {
    id: row.id,
    founder: row.founder,
    date: fromDb(row.date),
    amountPaise: row.amountPaise,
    direction: row.direction as FounderMoneyDirection,
    label: row.label,
    isSample: row.isSample,
  };
}

/** Unpaid bills, one group per payee and budget line, soonest due first. */
function payoutGroups(unpaid: readonly ExpenseRow[]): PayoutGroupDto[] {
  const groups = new Map<string, PayoutGroupDto>();
  for (const row of unpaid) {
    // A month's salaries from Team are paid together: one group for the whole team that month.
    const month = row.teamMemberId ? row.salaryMonth : null;
    const key = month ? `team|${month}` : `${row.vendor.trim().toLowerCase()}|${row.category}`;
    const vendor = month ? `Team, ${monthName(month)}` : row.vendor;
    const group = groups.get(key) ?? { key, vendor, category: row.category as FinanceLine, count: 0, visitCount: 0, totalPaise: 0, dueDate: null, ids: [] };
    group.count += 1;
    if (row.visitId) group.visitCount += 1;
    group.totalPaise += row.amountPaise;
    const due = optionalDate(row.dueDate);
    if (due && (!group.dueDate || due < group.dueDate)) group.dueDate = due;
    group.ids.push(row.id);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.totalPaise - a.totalPaise);
}

/** "SR-2026-00005 · Spice Route, Jubilee Hills, 7 Oct". */
function visitLabel(visit: NonNullable<ExpenseRow['visit']>) {
  return [visit.serviceReport?.number, `${visit.outlet.name}, ${fromDb(visit.scheduledDate)}`].filter(Boolean).join(' · ');
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
