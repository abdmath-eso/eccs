// The Finance page (15 Oct 2026): only the Super Admin reads or writes; every figure on
// the page comes out of known rows (invoiced, collected, outstanding and overdue, plan
// revenue, expenses against the budget, the AI line, the cash balance by day, one day's
// cash, the founders' money and runway); unpaid bills are payouts and leave on Mark
// paid; wage advances are cash out but not expenses; the CA's three CSV files and their
// guard against spreadsheet formulas; Remind gives a WhatsApp link and sends nothing;
// the sample books load once and come out in one go.
//
// Runs against the local database with the sample seed loaded, and the sample books
// (pnpm finance:sample) loaded or not. Figures the founder's own data also feed are
// checked as the difference this suite's rows make, measured before and after adding
// them. Everything is a throwaway it creates itself (a client, an outlet, a visit, two
// subscriptions, four invoices, payments, AI rows, expenses, founders' money, a budget,
// an opening balance) and removes again; the sample loading is tried inside a
// transaction that is rolled back, so the founder's sample books are never changed.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { loadFinanceSample, removeFinanceSample } from '@eccs/db';
import { addDays, aiCostPaise, runway, type CashDayDetailDto, type ExpenseDto, type ExpenseListDto, type FinanceOverviewDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { ActivityLogService } from './../src/activity-log/activity-log.service.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const MARK = 'E2E Finance';
const DEVICE = 'e2e-finance';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003' };
const OWNER = { code: 'SPICE-JH2K7M', pin: '2580' };
const CLIENT_PHONE = '+919199900077';
const OUTLET_CODE = 'E2EFIN-0001';
const FOUNDER = 'E2E Founder';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e finance receipt bytes')]);

class Rollback extends Error {}

describe('Finance (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let ops: string;
  let supervisor: string;
  let owner: string;
  let organizationId: string;
  let outletId: string;
  let visitId: string;
  let budgetId: string;
  const invoices: Record<'plan' | 'notDue' | 'old' | 'void', string> = { plan: '', notDue: '', old: '', void: '' };
  const expenses: Record<string, ExpenseDto> = {};
  const aiIds: string[] = [];
  const openingIds: string[] = [];
  const receiptIds: string[] = [];
  let settingsBefore: { collectedTargetPercent: number; usdToInrPaise: number } | null = null;

  const today = indiaDate();
  const day = (offset: number) => addDays(today, offset);
  const period = { from: day(-20), to: today };

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function otpLogin(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    return (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body.token as string;
  }
  async function pinLogin(code: string, pin: string) {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    return (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200)).body.token as string;
  }

  /** The page for the period, compared with this suite's budget (or the default one, once that is removed). */
  const overview = async (budget: string | null = budgetId): Promise<FinanceOverviewDto> =>
    (await http().get('/finance/overview').query({ ...period, ...(budget && { budgetId: budget }) }).set(bearer(admin)).expect(200)).body;
  const cashOn = async (date: string): Promise<CashDayDetailDto> => (await http().get('/finance/day').query({ date }).set(bearer(admin)).expect(200)).body;
  const addExpense = async (name: string, body: Record<string, unknown>) => {
    expenses[name] = (await http().post('/finance/expenses').set(bearer(admin)).send(body).expect(201)).body as ExpenseDto;
    return expenses[name];
  };
  const csv = async (register: string, from = period.from, to = period.to) => {
    const response = await http().get(`/finance/export/${register}`).query({ from, to }).set(bearer(admin)).expect(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    return response.text;
  };
  const line = (data: FinanceOverviewDto, key: string) => data.lines.find((entry) => entry.line === key)!.actualPaise;
  const bucket = (data: FinanceOverviewDto, key: string) => data.ageing.buckets.find((entry) => entry.bucket === key)!.paise;
  const kind = (data: FinanceOverviewDto, key: string) => data.dailySpend.types.find((entry) => entry.key === key)?.paise ?? 0;
  const flowOn = (data: FinanceOverviewDto, date: string) => data.cashFlow.days.find((entry) => entry.date === date)!;
  const sumBuckets = (data: FinanceOverviewDto, pick: 'collectedPaise' | 'expensesPaise') => data.buckets.reduce((total, entry) => total + entry[pick], 0);

  async function cleanUp() {
    const db = prisma.client;
    const ours = { name: { startsWith: MARK } };
    await db.expense.deleteMany({ where: { OR: [{ vendor: { startsWith: 'E2E ' } }, { vendor: { startsWith: '=E2E' } }] } });
    const receipts = await db.attachment.findMany({ where: { id: { in: receiptIds } }, select: { id: true } });
    await db.attachment.deleteMany({ where: { id: { in: receipts.map((row) => row.id) } } });
    await db.founderMoney.deleteMany({ where: { founder: FOUNDER } });
    await db.cashOpening.deleteMany({ where: { id: { in: openingIds } } });
    await db.budget.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await db.aiRequest.deleteMany({ where: { id: { in: aiIds } } });
    await db.payment.deleteMany({ where: { invoice: { organization: ours } } });
    await db.invoice.deleteMany({ where: { organization: ours } });
    await db.job.deleteMany({ where: { outlet: { organization: ours } } });
    await db.subscription.deleteMany({ where: { outlet: { organization: ours } } });
    await db.outlet.deleteMany({ where: { organization: ours } });
    await db.organization.deleteMany({ where: ours });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();
    const db = prisma.client;

    admin = await otpLogin(PHONES.admin);
    ops = await otpLogin(PHONES.ops);
    supervisor = await otpLogin(PHONES.supervisor);
    owner = await pinLogin(OWNER.code, OWNER.pin);

    const organization = await db.organization.create({ data: { name: `${MARK} Client`, contactPhone: CLIENT_PHONE, gstin: '36AAACE2710B1Z4', stateCode: '36' } });
    organizationId = organization.id;
    outletId = (await db.outlet.create({ data: { organizationId, name: `${MARK} Outlet`, code: OUTLET_CODE, address: 'Finance Road' } })).id;
    const serviceType = await db.serviceType.findFirstOrThrow({ select: { id: true } });
    visitId = (await db.job.create({ data: { outletId, serviceTypeId: serviceType.id, scheduledDate: new Date(`${day(-3)}T00:00:00Z`), status: 'APPROVED' } })).id;

    // A budget of this suite's own, so the budget figures are known; never the default.
    const budget = await http()
      .post('/finance/budgets')
      .set(bearer(admin))
      .send({
        name: 'E2E Budget',
        lines: { SALARIES: 2_000_000, SUBCONTRACTOR: 500_000, CHEMICALS: 100_000, INSURANCE: 0, VEHICLE: 0, MARKETING: 0, SOFTWARE: 50_000, EQUIPMENT: 0 },
        plannedNet: [{ month: today.slice(0, 7), paise: -1_234_500 }],
        isDefault: false,
      })
      .expect(201);
    budgetId = budget.body.id as string;
  }, 60_000);

  afterAll(async () => {
    if (settingsBefore) await prisma.client.financeSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...settingsBefore }, update: settingsBefore });
    await cleanUp();
    await app.close();
  });

  // ───────────────────────── Who may see it ─────────────────────────

  describe('access', () => {
    it('lets only the Super Admin read or write', async () => {
      for (const token of [ops, supervisor, owner]) {
        await http().get('/finance/overview').query(period).set(bearer(token)).expect(403);
        await http().get('/finance/expenses').set(bearer(token)).expect(403);
        await http().get(`/finance/export/expenses`).query(period).set(bearer(token)).expect(403);
        await http()
          .post('/finance/expenses')
          .set(bearer(token))
          .send({ date: today, category: 'CHEMICALS', vendor: 'E2E Refused', amountPaise: 100, paidVia: 'cash', paidOn: today })
          .expect(403);
        await http().put('/finance/opening-balance').set(bearer(token)).send({ asOf: today, bankPaise: 0, cashPaise: 0 }).expect(403);
      }
      await http().get('/finance/overview').query(period).expect(401);
      await http().get('/finance/overview').query(period).set(bearer(admin)).expect(200);
      expect(await prisma.client.expense.count({ where: { vendor: 'E2E Refused' } })).toBe(0);
    });

    it('refuses an expense dated in the future, an unpaid bill with no due date, and an advance on a budget line', async () => {
      const base = { vendor: 'E2E Wrong', amountPaise: 1000 };
      await http().post('/finance/expenses').set(bearer(admin)).send({ ...base, date: day(1), category: 'CHEMICALS', paidVia: 'cash', paidOn: today }).expect(400);
      await http().post('/finance/expenses').set(bearer(admin)).send({ ...base, date: today, category: 'CHEMICALS' }).expect(400);
      await http()
        .post('/finance/expenses')
        .set(bearer(admin))
        .send({ ...base, kind: 'WAGE_ADVANCE', date: today, category: 'SALARIES', paidVia: 'cash', paidOn: today })
        .expect(400);
      await http().post('/finance/expenses').set(bearer(admin)).send({ ...base, date: today, category: 'VEHICLE', type: 'CHEMICALS', paidVia: 'cash', paidOn: today }).expect(400);
      expect(await prisma.client.expense.count({ where: { vendor: 'E2E Wrong' } })).toBe(0);
    });
  });

  // ───────────────────────── Every figure, from known rows ─────────────────────────

  describe('the figures', () => {
    let before: FinanceOverviewDto;
    let after: FinanceOverviewDto;
    let dayBefore: CashDayDetailDto;
    let rate: number;

    beforeAll(async () => {
      before = await overview();
      dayBefore = await cashOn(day(-2));
      rate = before.settings.usdToInrPaise;
      const db = prisma.client;

      // Invoices and payments, as billing would have made them.
      const invoice = (number: string, data: Record<string, unknown>) =>
        db.invoice.create({
          data: {
            organizationId,
            outletId,
            number,
            subtotalPaise: 0,
            billTo: { name: `${MARK} Client`, legalName: `${MARK} Client Pvt Ltd`, gstin: '36AAACE2710B1Z4', address: null, stateCode: '36' },
            placeOfSupply: '36',
            ...data,
          } as Parameters<typeof db.invoice.create>[0]['data'],
          select: { id: true },
        });
      // A quarterly plan at ₹9,000 is ₹3,000 a month; the cancelled one counts as a cancellation in the period.
      const plan = await db.plan.findFirstOrThrow({ select: { id: true } });
      const subscription = await db.subscription.create({
        data: { outletId, planId: plan.id, status: 'ACTIVE', startDate: new Date(`${day(-20)}T00:00:00Z`), pricePaise: 900_000, billingCycle: 'QUARTERLY' },
      });
      await db.subscription.create({
        data: { outletId, planId: plan.id, status: 'CANCELLED', startDate: new Date(`${day(-40)}T00:00:00Z`), pricePaise: 600_000, billingCycle: 'MONTHLY', cancelledAt: new Date() },
      });
      const at = (date: string) => new Date(`${date}T00:00:00Z`);
      invoices.plan = (
        await invoice('E2EFIN/00001', { subscriptionId: subscription.id, issueDate: at(day(-10)), dueDate: at(day(-3)), status: 'PARTIALLY_PAID', subtotalPaise: 1_000_000, cgstPaise: 90_000, sgstPaise: 90_000, totalPaise: 1_180_000, paidPaise: 500_000 })
      ).id;
      invoices.notDue = (await invoice('E2EFIN/00002', { issueDate: at(day(-5)), dueDate: at(day(2)), status: 'ISSUED', subtotalPaise: 200_000, cgstPaise: 18_000, sgstPaise: 18_000, totalPaise: 236_000 })).id;
      invoices.old = (await invoice('E2EFIN/00003', { issueDate: at(day(-40)), dueDate: at(day(-33)), status: 'PARTIALLY_PAID', subtotalPaise: 254_237, cgstPaise: 22_881, sgstPaise: 22_882, totalPaise: 300_000, paidPaise: 100_000 })).id;
      invoices.void = (await invoice('E2EFIN/00004', { issueDate: at(day(-4)), dueDate: at(day(3)), status: 'VOID', subtotalPaise: 999_900, totalPaise: 999_900 })).id;
      const paidAt = (date: string) => new Date(`${date}T12:00:00+05:30`);
      await db.payment.create({ data: { invoiceId: invoices.plan, amountPaise: 500_000, method: 'upi', status: 'SUCCEEDED', gateway: 'manual', reference: 'E2E-UTR-1', paidAt: paidAt(day(-2)) } });
      await db.payment.create({ data: { invoiceId: invoices.old, amountPaise: 100_000, method: 'cash', status: 'SUCCEEDED', gateway: 'manual', paidAt: paidAt(day(-1)) } });

      // The AI's cost: $1 in all on one day, which is exactly the rate in paise.
      for (const cost of [600_000, 400_000]) {
        const row = await db.aiRequest.create({ data: { feature: 'licence-reader', model: 'claude-haiku-5-5', status: 'OK', costMicroUsd: cost, createdAt: paidAt(day(-2)) } });
        aiIds.push(row.id);
      }

      // The expense book, through the API.
      await addExpense('pest', {
        date: day(-3),
        category: 'SUBCONTRACTOR',
        type: 'SUBCONTRACTOR',
        vendor: '=E2E Pest',
        description: 'E2E pest treatment',
        amountPaise: 350_000,
        gstPaise: 53_390,
        paidVia: 'upi',
        paidOn: day(-2),
        visitId,
      });
      // A salary typed in before the Team page made them (16 Oct 2026): it still counts as it was.
      // New salaries come only from Team (team.e2e-spec.ts), so it is written straight in.
      await db.expense.create({
        data: { date: new Date(`${day(-1)}T00:00:00Z`), category: 'SALARIES', vendor: 'E2E Payroll', amountPaise: 3_000_000, dueDate: new Date(`${day(5)}T00:00:00Z`) },
      });
      await addExpense('chemicals', { date: day(-2), category: 'CHEMICALS', type: 'CHEMICALS', vendor: 'E2E Chemicals', amountPaise: 120_000, paidVia: 'cash', paidOn: day(-2) });
      await addExpense('grease', { date: day(-4), category: 'SUBCONTRACTOR', vendor: 'E2E Grease', amountPaise: 320_000, dueDate: day(3) });
      await addExpense('advance', { kind: 'WAGE_ADVANCE', date: day(-2), vendor: 'E2E Staff', amountPaise: 150_000, paidVia: 'cash', paidOn: day(-2) });
      await addExpense('recovered', { kind: 'WAGE_ADVANCE', date: day(-6), vendor: 'E2E Staff Two', amountPaise: 80_000, paidVia: 'cash', paidOn: day(-6), recoveredOn: day(-2) });

      // The founders' money.
      for (const [direction, amountPaise] of [
        ['IN', 1_000_000],
        ['OUT', 200_000],
      ] as const) {
        await http().post('/finance/founders-money').set(bearer(admin)).send({ founder: FOUNDER, date: day(-2), amountPaise, direction, label: 'E2E' }).expect(201);
      }

      after = await overview();
    }, 60_000);

    it('counts invoices issued in the period, not void ones, split into plans and one-off jobs', () => {
      expect(after.cards.invoiced.totalPaise - before.cards.invoiced.totalPaise).toBe(1_180_000 + 236_000);
      expect(after.cards.invoiced.count - before.cards.invoiced.count).toBe(2);
      expect(after.cards.invoiced.plans - before.cards.invoiced.plans).toBe(1);
      expect(after.cards.invoiced.oneOff - before.cards.invoiced.oneOff).toBe(1);
    });

    it('counts payments received in the period, against the target', () => {
      expect(after.cards.collected.paise - before.cards.collected.paise).toBe(600_000);
      expect(after.cards.collected.targetPercent).toBe(after.settings.collectedTargetPercent);
      expect(after.cards.collected.percentOfInvoiced).toBe(Math.round((after.cards.collected.paise / after.cards.invoiced.totalPaise) * 100));
    });

    it('gives what is owed today, overdue apart, and ages it', () => {
      expect(after.cards.outstanding.paise - before.cards.outstanding.paise).toBe(680_000 + 236_000 + 200_000);
      expect(after.cards.outstanding.count - before.cards.outstanding.count).toBe(3);
      expect(after.cards.outstanding.overdueCount - before.cards.outstanding.overdueCount).toBe(2);
      expect(after.cards.outstanding.overduePaise - before.cards.outstanding.overduePaise).toBe(680_000 + 200_000);
      expect(bucket(after, 'NOT_DUE') - bucket(before, 'NOT_DUE')).toBe(236_000);
      expect(bucket(after, 'DAYS_1_7') - bucket(before, 'DAYS_1_7')).toBe(680_000);
      expect(bucket(after, 'OVER_30') - bucket(before, 'OVER_30')).toBe(200_000);
      expect(after.ageing.totalPaise).toBe(after.cards.outstanding.paise);
      const listed = after.ageing.overdue.filter((entry) => entry.number.startsWith('E2EFIN/'));
      expect(listed.map((entry) => [entry.number, entry.overdueDays, entry.duePaise])).toEqual([
        ['E2EFIN/00003', 33, 200_000],
        ['E2EFIN/00001', 3, 680_000],
      ]);
    });

    it('turns active plans into a monthly amount and counts cancellations in the period', () => {
      expect(after.cards.planRevenue.monthlyPaise - before.cards.planRevenue.monthlyPaise).toBe(300_000);
      expect(after.cards.planRevenue.active - before.cards.planRevenue.active).toBe(1);
      expect(after.cards.planRevenue.cancelled - before.cards.planRevenue.cancelled).toBe(1);
    });

    it('holds expenses against the budget: wage advances left out, the AI line in', () => {
      const added = 350_000 + 3_000_000 + 120_000 + 320_000 + rate;
      expect(after.cards.expenses.paise - before.cards.expenses.paise).toBe(added);
      expect(line(after, 'SUBCONTRACTOR') - line(before, 'SUBCONTRACTOR')).toBe(670_000);
      expect(line(after, 'SALARIES') - line(before, 'SALARIES')).toBe(3_000_000);
      expect(line(after, 'CHEMICALS') - line(before, 'CHEMICALS')).toBe(120_000);
      expect(line(after, 'SOFTWARE') - line(before, 'SOFTWARE')).toBe(aiCostPaise(1_000_000, rate));
      // The budget: this suite's own, a month at a time.
      const months = after.budgetMonths.length;
      expect(after.budgetId).toBe(budgetId);
      expect(after.cards.expenses.budgetPaise).toBe(2_650_000 * months);
      const salaries = after.lines.find((entry) => entry.line === 'SALARIES')!;
      expect(salaries.budgetPaise).toBe(2_000_000 * months);
      expect(salaries.overByPaise).toBe(Math.max(0, salaries.actualPaise - salaries.budgetPaise!));
      expect(after.cards.expenses.percentOfBudget).toBe(Math.round((after.cards.expenses.paise / after.cards.expenses.budgetPaise!) * 100));
      // Net cash is collected less spent, against the plan for the same months.
      expect(after.cards.netCash.paise).toBe(after.cards.collected.paise - after.cards.expenses.paise);
      expect(after.cards.netCash.plannedPaise).toBe(-1_234_500);
      // The weekly bars add up to the same money, salaries spread over their month.
      expect(sumBuckets(after, 'collectedPaise') - sumBuckets(before, 'collectedPaise')).toBe(600_000);
      expect(sumBuckets(after, 'expensesPaise') - sumBuckets(before, 'expensesPaise')).toBe(added);
    });

    it('shows the AI cost as an automatic line in the expense book', async () => {
      const book = (await http().get('/finance/expenses').query({ month: today.slice(0, 7) }).set(bearer(admin)).expect(200)).body as ExpenseListDto;
      const aiLine = book.entries.find((entry) => entry.automatic);
      expect(aiLine).toMatchObject({ vendor: 'Anthropic API', category: 'SOFTWARE', automatic: true });
      // The month's AI line includes this suite's dollar.
      expect(aiLine!.amountPaise).toBeGreaterThanOrEqual(rate);
      expect(after.entryCount - before.entryCount).toBe(6);
    });

    it('works out the cash balance day by day from the opening balance', () => {
      const change = (date: string) => (flowOn(after, date).balancePaise ?? 0) - (flowOn(before, date).balancePaise ?? 0);
      expect(change(day(-7))).toBe(0);
      expect(change(day(-6))).toBe(-80_000);
      expect(change(day(-3))).toBe(-80_000);
      // A payment, founders' money in and out, two bills, an advance given and one recovered.
      expect(change(day(-2))).toBe(-80_000 + 500_000 + 1_000_000 - 200_000 - 350_000 - 120_000 - 150_000 + 80_000);
      expect(change(day(-1))).toBe(680_000 + 100_000);
      expect(change(today)).toBe(780_000);
      // The bars: collections in; bills and advances out, salaries and founders' money not.
      expect(flowOn(after, day(-2)).inPaise - flowOn(before, day(-2)).inPaise).toBe(500_000);
      expect(flowOn(after, day(-2)).outPaise - flowOn(before, day(-2)).outPaise).toBe(350_000 + 120_000 + 150_000);
      expect(flowOn(after, day(-6)).outPaise - flowOn(before, day(-6)).outPaise).toBe(80_000);
      expect(after.cashFlow.dueOut.salariesPaise - before.cashFlow.dueOut.salariesPaise).toBe(3_000_000);
      expect(after.cashFlow.dueOut.payoutsPaise - before.cashFlow.dueOut.payoutsPaise).toBe(320_000);
    });

    it('counts wage advances as cash out but not as expenses, and keeps track of those not recovered', () => {
      expect(kind(after, 'WAGE_ADVANCE') - kind(before, 'WAGE_ADVANCE')).toBe(230_000);
      expect(kind(after, 'SUBCONTRACTOR') - kind(before, 'SUBCONTRACTOR')).toBe(350_000);
      expect(kind(after, 'CHEMICALS') - kind(before, 'CHEMICALS')).toBe(120_000);
      expect(after.dailySpend.totalPaise - before.dailySpend.totalPaise).toBe(700_000);
      expect(after.dailySpend.totalPaise).toBe(after.cashFlow.outPaise);
      expect(after.dailySpend.advancesToRecoverPaise - before.dailySpend.advancesToRecoverPaise).toBe(150_000);
    });

    it("gives one day's cash, opening to closing, item by item", async () => {
      const cash = await cashOn(day(-2));
      expect(cash.inPaise - dayBefore.inPaise).toBe(500_000 + 1_000_000 + 80_000);
      expect(cash.outPaise - dayBefore.outPaise).toBe(350_000 + 120_000 + 150_000 + 200_000);
      expect(cash.closingPaise! - cash.openingPaise!).toBe(cash.inPaise - cash.outPaise);
      expect(cash.closingPaise).toBe(flowOn(after, day(-2)).balancePaise);
      const labels = [...cash.in, ...cash.out].map((entry) => entry.label);
      expect(labels).toEqual(
        expect.arrayContaining([
          `UPI, ${MARK} Client`,
          `Founders' money, ${FOUNDER}`,
          'Wage advance recovered from pay, E2E Staff Two',
          'Wage advance, E2E Staff',
          `Subcontractor payouts, =E2E Pest, ${MARK} Outlet visit`,
          'Chemicals and consumables, E2E Chemicals',
          `Taken out by ${FOUNDER}`,
        ]),
      );
    });

    it("adds up the founders' money and what is left, and works out runway from it", () => {
      const f = after.founders;
      const b = before.founders;
      expect(f.putInPaise - b.putInPaise).toBe(1_000_000);
      expect(f.takenOutPaise - b.takenOutPaise).toBe(200_000);
      expect(f.collectedPaise - b.collectedPaise).toBe(600_000);
      expect(f.unpaidPaise - b.unpaidPaise).toBe(3_320_000);
      expect(f.leftPaise - b.leftPaise).toBe(1_000_000 - 200_000 + 600_000 - (3_790_000 + rate));
      expect(f.leftPaise).toBe(f.openingPaise + f.putInPaise - f.takenOutPaise + f.collectedPaise - f.spentBeforePaise - f.spentThisMonthPaise);
      expect(f.people.find((row) => row.founder === FOUNDER)).toMatchObject({ putInPaise: 1_000_000, takenOutPaise: 200_000 });
      expect(f.people.reduce((total, row) => total + row.sharePercent, 0)).toBe(100);
      expect(f.runway).toEqual(runway(f.leftPaise, f.lastFullMonth?.netOutflowPaise ?? null));
    });

    it('lists unpaid bills as payouts, which leave on Mark paid', async () => {
      const grease = after.payouts.find((group) => group.vendor === 'E2E Grease')!;
      expect(grease).toMatchObject({ category: 'SUBCONTRACTOR', count: 1, totalPaise: 320_000, dueDate: day(3), ids: [expenses.grease!.id] });
      expect(after.payouts.find((group) => group.vendor === 'E2E Payroll')).toMatchObject({ category: 'SALARIES', totalPaise: 3_000_000 });
      const paid = await http().post('/finance/expenses/mark-paid').set(bearer(admin)).send({ ids: grease.ids, paidVia: 'bank-transfer', paidOn: today }).expect(200);
      expect(paid.body).toEqual({ updated: 1 });
      // Pressing it again changes nothing.
      expect((await http().post('/finance/expenses/mark-paid').set(bearer(admin)).send({ ids: grease.ids, paidVia: 'upi', paidOn: today }).expect(200)).body).toEqual({ updated: 0 });
      await http().post('/finance/expenses/mark-paid').set(bearer(admin)).send({ ids: grease.ids, paidVia: 'upi', paidOn: day(1) }).expect(400);
      const now = await overview();
      expect(now.payouts.some((group) => group.vendor === 'E2E Grease')).toBe(false);
      expect(flowOn(now, today).outPaise - flowOn(after, today).outPaise).toBe(320_000);
      expect(now.cards.expenses.paise).toBe(after.cards.expenses.paise);
    });

    it('changes and removes an entry, with its receipt', async () => {
      const filed = await http().post('/finance/receipts').set(bearer(admin)).attach('file', JPEG, { filename: 'receipt.jpg', contentType: 'image/jpeg' }).expect(201);
      receiptIds.push(filed.body.id as string);
      expect(filed.body.pdf).toBe(false);
      await http().post('/finance/receipts').set(bearer(admin)).attach('file', Buffer.from('not a picture'), { filename: 'x.txt', contentType: 'text/plain' }).expect(400);
      const chemicals = expenses.chemicals!;
      const changed = (
        await http()
          .patch(`/finance/expenses/${chemicals.id}`)
          .set(bearer(admin))
          .send({ date: chemicals.date, category: 'CHEMICALS', type: 'CHEMICALS', vendor: 'E2E Chemicals', amountPaise: 125_000, gstPaise: 19_068, paidVia: 'cash', paidOn: day(-2), receiptId: filed.body.id })
          .expect(200)
      ).body as ExpenseDto;
      expect(changed).toMatchObject({ amountPaise: 125_000, gstPaise: 19_068, receipt: { id: filed.body.id, pdf: false } });
      await http().delete(`/finance/expenses/${chemicals.id}`).set(bearer(admin)).expect(204);
      await http().delete(`/finance/expenses/${chemicals.id}`).set(bearer(admin)).expect(404);
      // The receipt goes with it.
      expect(await prisma.client.attachment.count({ where: { id: filed.body.id } })).toBe(0);
    });
  });

  // ───────────────────────── The CA's export ─────────────────────────

  describe('export for the CA', () => {
    it('writes the expense register, guarded against spreadsheet formulas', async () => {
      const text = await csv('expenses');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text).toContain('Date,Vendor,Category,Type,Description,Amount (Rs),GST (Rs),Taxable value (Rs),Paid via,Paid on,Due date,Linked visit,Receipt filed,Entry id');
      // A vendor typed as "=E2E Pest" cannot run as a formula when the file is opened.
      // A vendor typed as "=E2E Pest" gets a leading apostrophe; a cell with a comma is quoted.
      expect(text).toContain(`${day(-3)},'=E2E Pest,"Subcontractor (pest, grease trap)",Subcontractor payouts,E2E pest treatment,3500.00,533.90,2966.10,UPI,${day(-2)},`);
      expect(text).toContain('Wage advance (recovered from pay, not an expense)');
      expect(text).toContain('Anthropic API');
    });

    it('writes the sales register with the GST split, and the receipts', async () => {
      const sales = await csv('sales', day(-45), today);
      expect(sales).toContain('Invoice number,Invoice date,Client,GSTIN,Place of supply,Taxable value (Rs),CGST (Rs),SGST (Rs),IGST (Rs),Total (Rs),Status,Outlet');
      expect(sales).toContain(`E2EFIN/00001,${day(-10)},${MARK} Client Pvt Ltd,36AAACE2710B1Z4,36,10000.00,900.00,900.00,0.00,11800.00,Part paid,${MARK} Outlet`);
      expect(sales).toContain('E2EFIN/00004');
      expect(sales).toMatch(/E2EFIN\/00004[^\r\n]*Void/);
      const receipts = await csv('receipts');
      expect(receipts).toContain('Date,Invoice number,Client,Method,Reference,Amount (Rs)');
      expect(receipts).toContain(`${day(-2)},E2EFIN/00001,${MARK} Client,UPI,E2E-UTR-1,5000.00`);
      expect(receipts).toContain(`${day(-1)},E2EFIN/00003,${MARK} Client,Cash,,1000.00`);
      await http().get('/finance/export/ledger').query(period).set(bearer(admin)).expect(400);
    });
  });

  // ───────────────────────── Remind ─────────────────────────

  describe('remind', () => {
    it('gives a WhatsApp link with the reminder typed in, and sends nothing', async () => {
      const notifications = await prisma.client.notification.count();
      const answer = (await http().post(`/finance/invoices/${invoices.plan}/remind`).set(bearer(admin)).expect(200)).body as { url: string; hasPhone: boolean };
      expect(answer.hasPhone).toBe(true);
      expect(answer.url.startsWith('https://wa.me/919199900077?text=')).toBe(true);
      const text = decodeURIComponent(answer.url.split('?text=')[1]!);
      expect(text).toContain('E2EFIN/00001');
      expect(text).toContain('₹6,800');
      expect(await prisma.client.notification.count()).toBe(notifications);
      await http().post(`/finance/invoices/${invoices.void}/remind`).set(bearer(admin)).expect(409);
      await http().post(`/finance/invoices/${invoices.plan}/remind`).set(bearer(ops)).expect(403);
    });
  });

  // ───────────────────────── Budgets, opening balance, settings ─────────────────────────

  describe('the books set-up', () => {
    it('changes and removes a budget', async () => {
      const changed = await http()
        .patch(`/finance/budgets/${budgetId}`)
        .set(bearer(admin))
        .send({
          name: 'E2E Budget Two',
          lines: { SALARIES: 1, SUBCONTRACTOR: 2, CHEMICALS: 3, INSURANCE: 4, VEHICLE: 5, MARKETING: 6, SOFTWARE: 7, EQUIPMENT: 8 },
          plannedNet: [],
          isDefault: false,
        })
        .expect(200);
      expect(changed.body).toMatchObject({ name: 'E2E Budget Two', totalPaise: 36 });
      await http().post('/finance/budgets').set(bearer(admin)).send({ name: '', lines: {} }).expect(400);
      await http().delete(`/finance/budgets/${budgetId}`).set(bearer(admin)).expect(204);
      await http().delete(`/finance/budgets/${budgetId}`).set(bearer(admin)).expect(404);
    });

    it('counts the cash balance from the latest opening balance', async () => {
      const saved = (await http().put('/finance/opening-balance').set(bearer(admin)).send({ asOf: today, bankPaise: 5_000_000, cashPaise: 12_345 }).expect(200)).body as { id: string };
      openingIds.push(saved.id);
      const now = await overview(null);
      expect(now.opening).toMatchObject({ id: saved.id, asOf: today, bankPaise: 5_000_000, cashPaise: 12_345 });
      expect(flowOn(now, day(-1)).balancePaise).toBeNull();
      const cash = await cashOn(today);
      expect(cash.openingPaise).toBe(5_012_345);
      expect(cash.closingPaise).toBe(flowOn(now, today).balancePaise);
      await http().put('/finance/opening-balance').set(bearer(admin)).send({ asOf: day(1), bankPaise: 0, cashPaise: 0 }).expect(400);
      await prisma.client.cashOpening.deleteMany({ where: { id: { in: openingIds } } });
    });

    it('keeps the collection target and the dollar rate as settings', async () => {
      const row = await prisma.client.financeSettings.findUnique({ where: { id: 'default' } });
      settingsBefore = row ? { collectedTargetPercent: row.collectedTargetPercent, usdToInrPaise: row.usdToInrPaise } : null;
      const saved = await http().put('/finance/settings').set(bearer(admin)).send({ collectedTargetPercent: 75, usdToInrPaise: 9000 }).expect(200);
      expect(saved.body).toEqual({ collectedTargetPercent: 75, usdToInrPaise: 9000 });
      const now = await overview(null);
      expect(now.cards.collected.targetPercent).toBe(75);
      await http().put('/finance/settings').set(bearer(admin)).send({ collectedTargetPercent: 0, usdToInrPaise: 9000 }).expect(400);
      // Put back as it was: the row removed again if there was none.
      if (settingsBefore) await http().put('/finance/settings').set(bearer(admin)).send(settingsBefore).expect(200);
      else await prisma.client.financeSettings.deleteMany({ where: { id: 'default' } });
      settingsBefore = null;
    });
  });

  // ───────────────────────── The activity log ─────────────────────────

  describe('activity log', () => {
    it("records finance work with the kind and amount, never who was paid", async () => {
      const activity = app.get(ActivityLogService);
      activity.setForTest({ on: true });
      try {
        const secret = 'E2E Secret Payee Tamarind';
        const added = (
          await http()
            .post('/finance/expenses')
            .set(bearer(admin))
            .send({ kind: 'WAGE_ADVANCE', date: today, vendor: secret, description: 'E2E typed note saffron', amountPaise: 4_321, paidVia: 'cash', paidOn: today })
            .expect(201)
        ).body as ExpenseDto;
        await http().delete(`/finance/expenses/${added.id}`).set(bearer(admin)).expect(204);
        await activity.flush();
        const rows = await prisma.client.activityLog.findMany({ where: { id: { in: activity.recordedForTest() } } });
        const entry = rows.find((row) => row.action === 'finance.expense.added');
        expect(entry).toMatchObject({ category: 'finance', entityType: 'expense', entityId: added.id, entityLabel: 'Wage advance', result: 'SUCCESS' });
        expect(entry!.details).toMatchObject({ kind: 'WAGE_ADVANCE', amountPaise: 4_321 });
        expect(rows.find((row) => row.action === 'finance.expense.removed')).toMatchObject({ entityLabel: 'Wage advance' });
        for (const row of rows) {
          expect(JSON.stringify(row)).not.toContain('Tamarind');
          expect(JSON.stringify(row)).not.toContain('saffron');
        }
        await prisma.client.activityLog.deleteMany({ where: { id: { in: activity.recordedForTest() } } });
      } finally {
        activity.setForTest({ on: false });
      }
    });
  });

  // ───────────────────────── The sample books ─────────────────────────

  describe('sample rows', () => {
    it('load once, never doubling, and come out in one go leaving real entries alone', async () => {
      const db = prisma.client;
      const real = await db.expense.create({ data: { date: new Date(`${today}T00:00:00Z`), category: 'CHEMICALS', vendor: 'E2E Real Entry', amountPaise: 100, paidVia: 'cash', paidOn: new Date(`${today}T00:00:00Z`) } });
      const before = await db.expense.count({ where: { isSample: true } });
      // Inside a transaction that is rolled back, so the founder's sample books are left as they are.
      await expect(
        db.$transaction(
          async (tx) => {
            await removeFinanceSample(tx);
            const first = await loadFinanceSample(tx, { today });
            expect(first.expenses).toBeGreaterThan(60);
            expect(first).toMatchObject({ budgets: 2, founderMoney: 2, openings: 1 });
            // The sample team's salary rows belong to the Team sample, and are left out here.
            const finance = { isSample: true, teamMemberId: null };
            const counts = { expenses: await tx.expense.count({ where: finance }), budgets: await tx.budget.count({ where: { isSample: true } }) };
            const second = await loadFinanceSample(tx, { today });
            expect(second).toEqual({ expenses: 0, budgets: 0, founderMoney: 0, openings: 0 });
            expect(await tx.expense.count({ where: finance })).toBe(counts.expenses);
            expect(await tx.budget.count({ where: { isSample: true } })).toBe(counts.budgets);
            // No salaries: they come from Team now.
            expect(await tx.expense.count({ where: { ...finance, category: 'SALARIES' } })).toBe(0);
            // Every sample vendor says so.
            const vendors = await tx.expense.findMany({ where: finance, select: { vendor: true } });
            for (const row of vendors) expect(row.vendor).toMatch(/\(sample\)$/);
            const lean = await tx.budget.findFirstOrThrow({ where: { sampleKey: 'sample-budget-lean' } });
            expect(Object.values(lean.lines as Record<string, number>).reduce((total, value) => total + value, 0)).toBe(30_100_000);
            const removed = await removeFinanceSample(tx);
            expect(removed.expenses).toBe(counts.expenses);
            expect(await tx.expense.count({ where: finance })).toBe(0);
            expect(await tx.cashOpening.count({ where: { isSample: true } })).toBe(0);
            expect(await tx.expense.count({ where: { id: real.id } })).toBe(1);
            throw new Rollback();
          },
          { timeout: 30_000 },
        ),
      ).rejects.toBeInstanceOf(Rollback);
      expect(await db.expense.count({ where: { isSample: true } })).toBe(before);
      await db.expense.delete({ where: { id: real.id } });
    });
  });
});
