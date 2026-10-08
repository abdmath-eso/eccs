// Plans as ECCS configures them, and an outlet's subscription from start to end.
// Runs against the local database with the sample seed loaded. Works on a
// throwaway outlet and a throwaway plan of its own and removes both; renewals
// are always run for that outlet alone, so the sample subscriptions never move.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { addDaysToDate, cyclePeriod, cyclePeriodContaining, type OutletSubscriptionDto, type PlanOfferDto, type PlansAdminDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { PlansService } from './../src/services/plans.service.js';
import { SubscriptionsService } from './../src/subscriptions/subscriptions.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', headChef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-subscriptions';
const OUTLET_CODE = 'E2ESU-BS0001';
const PLAN_NAME = 'E2E Subs Plan';
const PLAN_CODE = 'E2E_SUBS_PLAN';

const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

describe('Plans and subscriptions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let plans: PlansService;
  let subscriptions: SubscriptionsService;
  let outletId: string;
  let jubileeOutletId: string;
  let planId: string;
  let owner: string;
  let headChef: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;

  const today = indiaDate();
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const path = (action = '', forOutlet = outletId) => `/outlets/${forOutlet}/subscription${action}`;
  const post = (token: string, action: string, body?: Record<string, unknown>) =>
    http().post(path(action)).set(bearer(token)).send(body);
  const read = async (token = owner) => (await http().get(path()).set(bearer(token)).expect(200)).body as OutletSubscriptionDto;
  const current = async () => (await read()).subscription!;

  /** This outlet's plan visits, soonest first, as "CODE date status". */
  async function visits(only?: 'open') {
    const rows = await prisma.client.job.findMany({
      where: { outletId, ...(only && { status: { in: ['SCHEDULED', 'ASSIGNED'] } }) },
      orderBy: [{ scheduledDate: 'asc' }, { serviceType: { code: 'asc' } }],
      select: { scheduledDate: true, status: true, serviceType: { select: { code: true } } },
    });
    return rows.map((row) => ({ code: row.serviceType.code, date: isoDate(row.scheduledDate), status: row.status }));
  }

  async function cleanUp() {
    const db = prisma.client;
    const outlet = await db.outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    if (outlet) {
      // Nothing here raises invoices, but a server running alongside might have: they would block the delete.
      const invoices = await db.invoice.findMany({ where: { outletId: outlet.id }, select: { id: true } });
      await db.payment.deleteMany({ where: { invoiceId: { in: invoices.map((invoice) => invoice.id) } } });
      await db.invoice.deleteMany({ where: { id: { in: invoices.map((invoice) => invoice.id) } } });
      await db.job.deleteMany({ where: { outletId: outlet.id } });
      // Starting a plan raises its first invoice straight away.
      await db.invoice.deleteMany({ where: { outletId: outlet.id } });
      await db.serviceSchedule.deleteMany({ where: { outletId: outlet.id } });
      await db.subscription.deleteMany({ where: { outletId: outlet.id } });
      await db.outlet.delete({ where: { id: outlet.id } });
    }
    // Plan lines go with their plan.
    await db.plan.deleteMany({ where: { code: { startsWith: PLAN_CODE } } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  }

  async function pinLogin(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return session.body.token as string;
  }

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const session = await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200);
    return session.body.token as string;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(PlansService);
    subscriptions = app.get(SubscriptionsService);
    await cleanUp();

    const seeded = await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    jubileeOutletId = (await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.jubilee } })).id;
    // A second outlet of the same sample restaurant, with no plan and no visits.
    outletId = (
      await prisma.client.outlet.create({
        data: { organizationId: seeded.organizationId, name: 'E2E subscription outlet', code: OUTLET_CODE, address: 'Test Road' },
      })
    ).id;

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    headChef = await pinLogin(CODES.kukatpally, PINS.headChef);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  // ───────────────────────── Plans ─────────────────────────

  it('lets only ECCS admins create a plan, and checks its lines', async () => {
    const plan = {
      name: PLAN_NAME,
      description: 'Made by a test',
      priceRupees: 1000,
      billingCycle: 'MONTHLY',
      lines: [{ serviceCode: 'PEST', intervalDays: 10 }],
    };
    await http().post('/subscription-plans').set(bearer(owner)).send(plan).expect(403);
    await http().post('/subscription-plans').set(bearer(supervisor)).send(plan).expect(403);
    await http().get('/subscription-plans/all').set(bearer(owner)).expect(403);
    await http().post('/subscription-plans').set(bearer(admin)).send({ ...plan, lines: [] }).expect(400);
    await http()
      .post('/subscription-plans')
      .set(bearer(admin))
      .send({ ...plan, lines: [plan.lines[0], plan.lines[0]] })
      .expect(400);
    await http()
      .post('/subscription-plans')
      .set(bearer(admin))
      .send({ ...plan, lines: [{ serviceCode: 'NOPE', intervalDays: 10 }] })
      .expect(400);

    const all = (await http().post('/subscription-plans').set(bearer(admin)).send(plan).expect(201)).body as PlansAdminDto;
    const made = all.plans.find((entry) => entry.code === PLAN_CODE)!;
    planId = made.id;
    expect(made).toMatchObject({
      name: { en: PLAN_NAME },
      pricePaise: 100_000,
      gstPaise: 18_000,
      totalPaise: 118_000,
      billingCycle: 'MONTHLY',
      isActive: true,
      subscriberCount: 0,
      services: [expect.objectContaining({ serviceCode: 'PEST', intervalDays: 10 })],
    });
    expect(all.kinds.map((kind) => kind.code)).toEqual(expect.arrayContaining(['PEST', 'CHIMNEY', 'DEEP_CLEAN']));

    // A second plan of the same name gets its own code.
    const again = (await http().post('/subscription-plans').set(bearer(admin)).send(plan).expect(201)).body as PlansAdminDto;
    expect(again.plans.some((entry) => entry.code === `${PLAN_CODE}_2`)).toBe(true);
  });

  it('shows restaurants the plans on offer with GST worked out, and stops showing one no longer offered', async () => {
    const offered = async (token: string) =>
      (await http().get('/subscription-plans').set(bearer(token)).expect(200)).body as PlanOfferDto[];
    const mine = (await offered(owner)).find((plan) => plan.code === PLAN_CODE)!;
    expect(mine.totalPaise).toBe(mine.pricePaise + mine.gstPaise);
    expect((await offered(otherManager)).some((plan) => plan.code === 'ESSENTIAL')).toBe(true);
    await http().get('/subscription-plans').set(bearer(headChef)).expect(403);
    await http().get('/subscription-plans').expect(401);

    const second = `${PLAN_CODE}_2`;
    const all = (await http().get('/subscription-plans/all').set(bearer(admin)).expect(200)).body as PlansAdminDto;
    const secondId = all.plans.find((plan) => plan.code === second)!.id;
    await http().patch(`/subscription-plans/${secondId}`).set(bearer(admin)).send({ isActive: false }).expect(200);
    expect((await offered(owner)).some((plan) => plan.code === second)).toBe(false);
    // Nobody can start on a plan that is no longer offered.
    await post(owner, '', { planCode: second }).expect(400);
  });

  // ───────────────────────── Starting ─────────────────────────

  it('shows an outlet with no subscription as having none', async () => {
    expect(await read()).toEqual({ outletId, subscription: null, lastEnded: null });
    await http().get(path()).set(bearer(otherManager)).expect(404);
    await http().get(path()).set(bearer(headChef)).expect(403);
    await http().get(path()).set(bearer(supervisor)).expect(403);
    // A Manager reads their own outlet's subscription.
    await http().get(path('', jubileeOutletId)).set(bearer(otherManager)).expect(200);
    await post(owner, '/cancel', { when: 'PERIOD_END' }).expect(404);
  });

  it('lets the Owner subscribe, but not a Manager, a Head Chef or a Supervisor', async () => {
    const body = { planCode: PLAN_CODE };
    await http().post(path('', jubileeOutletId)).set(bearer(otherManager)).send(body).expect(403);
    await post(otherManager, '', body).expect(403);
    await post(headChef, '', body).expect(403);
    await post(supervisor, '', body).expect(403);
    await post(owner, '', { planCode: 'NOPE' }).expect(400);
    // Only ECCS chooses the dates.
    await post(owner, '', { ...body, startDate: addDaysToDate(today, 5) }).expect(400);
    await post(admin, '', { ...body, startDate: addDaysToDate(today, -1) }).expect(400);
    expect((await read()).subscription).toBeNull();
  });

  it('starts with the price and cycle copied from the plan, and puts the first visits in the diary', async () => {
    const started = (await post(owner, '', { planCode: PLAN_CODE }).expect(201)).body as OutletSubscriptionDto;
    const period = cyclePeriod(today, 'MONTHLY');
    expect(started.subscription).toMatchObject({
      status: 'ACTIVE',
      plan: { code: PLAN_CODE },
      pricePaise: 100_000,
      gstPaise: 18_000,
      totalPaise: 118_000,
      billingCycle: 'MONTHLY',
      startDate: today,
      currentPeriodStart: today,
      currentPeriodEnd: period.end,
      renewal: { date: period.nextStart, plan: { code: PLAN_CODE }, totalPaise: 118_000, changes: false },
      pendingPlan: null,
      endsOn: null,
      pausedOn: null,
    });
    // What billing reads.
    const row = await prisma.client.subscription.findFirstOrThrow({ where: { outletId } });
    expect(isoDate(row.nextBillingDate!)).toBe(period.nextStart);

    // The invoice of the first cycle is raised straight away, not left for the timer.
    const invoices = await prisma.client.invoice.findMany({ where: { subscriptionId: row.id } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: 'ISSUED', subtotalPaise: 100_000, totalPaise: 118_000 });
    expect(isoDate(invoices[0]!.periodStart!)).toBe(today);

    // The Owner's first visits are three days on, then every 10 days within the 30-day window.
    const first = addDaysToDate(today, 3);
    expect((await visits()).map((visit) => `${visit.code} ${visit.date}`)).toEqual([
      `PEST ${first}`,
      `PEST ${addDaysToDate(first, 10)}`,
      `PEST ${addDaysToDate(first, 20)}`,
    ]);
    expect(started.subscription!.services).toEqual([expect.objectContaining({ serviceCode: 'PEST', intervalDays: 10, nextDate: first })]);

    // An outlet has one subscription at a time.
    await post(owner, '', { planCode: 'ESSENTIAL' }).expect(409);
    await post(admin, '', { planCode: 'ESSENTIAL' }).expect(409);
    // The older reading of the plan, used by the Services screen, agrees.
    const old = await http().get(`/outlets/${outletId}/plan`).set(bearer(owner)).expect(200);
    expect(old.body.plan.code).toBe(PLAN_CODE);
  });

  // ───────────────────────── Changing plan ─────────────────────────

  it('changes plan from the next cycle only, and lets the change be undone', async () => {
    await post(otherManager, '/change-plan', { planCode: 'ESSENTIAL' }).expect(403);
    await post(owner, '/change-plan', { planCode: PLAN_CODE }).expect(400);
    await post(owner, '/change-plan', { planCode: 'NOPE' }).expect(400);

    const asked = (await post(owner, '/change-plan', { planCode: 'ESSENTIAL' }).expect(200)).body as OutletSubscriptionDto;
    const subscription = asked.subscription!;
    // Nothing about this cycle has changed.
    expect(subscription).toMatchObject({ plan: { code: PLAN_CODE }, pricePaise: 100_000, pendingPlan: { code: 'ESSENTIAL' } });
    expect(subscription.renewal).toMatchObject({ plan: { code: 'ESSENTIAL' }, changes: true, date: addDaysToDate(subscription.currentPeriodEnd, 1) });

    // While a change is waiting, the old plan puts no visits in the diary beyond the end of its cycle.
    expect(await plans.generateAll(addDaysToDate(today, 20), outletId)).toEqual({ created: 0 });

    const undone = (await post(owner, '/undo-change-plan').expect(200)).body as OutletSubscriptionDto;
    expect(undone.subscription).toMatchObject({ pendingPlan: null, renewal: { plan: { code: PLAN_CODE }, changes: false } });
    // And once it is undone the diary fills as before (days 33 and 43 come into a window reaching day 50).
    expect((await plans.generateAll(addDaysToDate(today, 20), outletId)).created).toBe(2);
  });

  // ───────────────────────── Cancelling at the end of the cycle, and undoing it ─────────────────────────

  it('cancels at the end of the cycle for the Owner, who can undo it; only ECCS cancels at once', async () => {
    await post(otherManager, '/cancel', { when: 'PERIOD_END' }).expect(403);
    await post(owner, '/cancel', { when: 'NOW' }).expect(403);
    await post(owner, '/cancel', { when: 'SOMETIME' }).expect(400);

    const before = await visits('open');
    const ending = (await post(owner, '/cancel', { when: 'PERIOD_END' }).expect(200)).body.subscription as OutletSubscriptionDto['subscription'];
    expect(ending).toMatchObject({ status: 'ACTIVE', endsOn: ending!.currentPeriodEnd, renewal: null });
    // Nothing is taken out of the diary yet, and nothing more is added past the last day.
    expect(await visits('open')).toEqual(before);
    expect(await plans.generateAll(addDaysToDate(today, 25), outletId)).toEqual({ created: 0 });
    // A plan that is ending cannot be changed until it is kept.
    await post(owner, '/change-plan', { planCode: 'ESSENTIAL' }).expect(409);

    const kept = (await post(owner, '/keep').expect(200)).body.subscription as OutletSubscriptionDto['subscription'];
    expect(kept).toMatchObject({ endsOn: null, renewal: { date: addDaysToDate(kept!.currentPeriodEnd, 1) } });
    const row = await prisma.client.subscription.findFirstOrThrow({ where: { outletId, status: 'ACTIVE' } });
    expect(row.cancelAtPeriodEnd).toBe(false);
    expect(isoDate(row.nextBillingDate!)).toBe(addDaysToDate(kept!.currentPeriodEnd, 1));
  });

  // ───────────────────────── Pausing ─────────────────────────

  it('lets only ECCS pause: no new visits and no renewal, and visits already in the diary stay', async () => {
    await post(owner, '/pause').expect(403);
    await post(otherManager, '/pause').expect(403);

    const before = await visits('open');
    const paused = (await post(admin, '/pause').expect(200)).body.subscription as OutletSubscriptionDto['subscription'];
    expect(paused).toMatchObject({ status: 'PAUSED', pausedOn: today, renewal: null });
    expect(await visits('open')).toEqual(before);

    // Well past the end of the cycle: nothing is added and it is not renewed.
    const later = addDaysToDate(paused!.currentPeriodEnd, 10);
    expect(await plans.generateAll(later, outletId)).toEqual({ created: 0 });
    expect(await subscriptions.renewDue(later, outletId)).toEqual({ renewed: 0, cancelled: 0 });
    expect((await current()).currentPeriodEnd).toBe(paused!.currentPeriodEnd);

    await post(owner, '/resume').expect(403);
    const resumed = (await post(admin, '/resume').expect(200)).body.subscription as OutletSubscriptionDto['subscription'];
    // Resumed inside the same cycle, it carries on exactly as it was.
    expect(resumed).toMatchObject({
      status: 'ACTIVE',
      pausedOn: null,
      currentPeriodStart: paused!.currentPeriodStart,
      currentPeriodEnd: paused!.currentPeriodEnd,
    });
  });

  it('resumed after its cycle ran out, starts a fresh cycle that day', async () => {
    await post(admin, '/pause').expect(200);
    // As if it had been paused through the end of a cycle that ended last week.
    const live = await prisma.client.subscription.findFirstOrThrow({ where: { outletId, status: 'PAUSED' } });
    const original = { currentPeriodStart: live.currentPeriodStart, currentPeriodEnd: live.currentPeriodEnd, startDate: live.startDate };
    await prisma.client.subscription.update({
      where: { id: live.id },
      data: {
        startDate: dbDate(addDaysToDate(today, -38)),
        currentPeriodStart: dbDate(addDaysToDate(today, -38)),
        currentPeriodEnd: dbDate(addDaysToDate(today, -8)),
      },
    });
    const resumed = (await post(admin, '/resume').expect(200)).body.subscription as OutletSubscriptionDto['subscription'];
    expect(resumed).toMatchObject({ status: 'ACTIVE', currentPeriodStart: today, currentPeriodEnd: cyclePeriod(today, 'MONTHLY').end });
    // Put the dates back as the following tests expect them.
    await prisma.client.subscription.update({ where: { id: live.id }, data: original });
  });

  // ───────────────────────── Editing a plan, and renewal ─────────────────────────

  it('editing a plan changes nothing for a subscriber until their next cycle', async () => {
    const edited = (
      await http()
        .patch(`/subscription-plans/${planId}`)
        .set(bearer(admin))
        .send({
          name: `${PLAN_NAME} renamed`,
          priceRupees: 1200,
          lines: [
            { serviceCode: 'PEST', intervalDays: 15 },
            { serviceCode: 'DEEP_CLEAN', intervalDays: 30 },
          ],
        })
        .expect(200)
    ).body as PlansAdminDto;
    const plan = edited.plans.find((entry) => entry.id === planId)!;
    expect(plan).toMatchObject({ code: PLAN_CODE, name: { en: `${PLAN_NAME} renamed` }, pricePaise: 120_000, subscriberCount: 1 });
    expect(plan.services.map((service) => `${service.serviceCode} ${service.intervalDays}`).sort()).toEqual(['DEEP_CLEAN 30', 'PEST 15']);
    await http().patch(`/subscription-plans/${planId}`).set(bearer(owner)).send({ priceRupees: 1 }).expect(403);

    const subscription = await current();
    // This cycle: the old price and the old services.
    expect(subscription).toMatchObject({ pricePaise: 100_000, totalPaise: 118_000 });
    expect(subscription.services.map((service) => `${service.serviceCode} ${service.intervalDays}`)).toEqual(['PEST 10']);
    // The next cycle is announced with the new price.
    expect(subscription.renewal).toMatchObject({ pricePaise: 120_000, totalPaise: 141_600, changes: true });
  });

  it('renews when the cycle ends, taking the plan as it is then; running it again changes nothing', async () => {
    const before = await current();
    // On the last day of the cycle nothing is due yet.
    expect(await subscriptions.renewDue(before.currentPeriodEnd, outletId)).toEqual({ renewed: 0, cancelled: 0 });

    const nextStart = addDaysToDate(before.currentPeriodEnd, 1);
    expect(await subscriptions.renewDue(nextStart, outletId)).toEqual({ renewed: 1, cancelled: 0 });
    expect(await subscriptions.renewDue(nextStart, outletId)).toEqual({ renewed: 0, cancelled: 0 });

    const renewed = await current();
    const period = cyclePeriod(nextStart, 'MONTHLY', Number(today.slice(8)));
    expect(renewed).toMatchObject({
      pricePaise: 120_000,
      totalPaise: 141_600,
      currentPeriodStart: nextStart,
      currentPeriodEnd: period.end,
      renewal: { date: period.nextStart, changes: false },
    });
    expect(renewed.services.map((service) => `${service.serviceCode} ${service.intervalDays}`).sort()).toEqual(['DEEP_CLEAN 30', 'PEST 15']);
    // The service that joined the plan is first due on the first day of the new cycle.
    expect((await visits()).some((visit) => visit.code === 'DEEP_CLEAN' && visit.date === nextStart)).toBe(true);
  });

  it('applies a change of plan at the renewal: new price, new services, and the dropped service stops', async () => {
    await post(owner, '/change-plan', { planCode: 'ESSENTIAL' }).expect(200);
    const before = await current();
    const essential = ((await http().get('/subscription-plans').set(bearer(owner)).expect(200)).body as PlanOfferDto[]).find(
      (plan) => plan.code === 'ESSENTIAL',
    )!;

    const nextStart = addDaysToDate(before.currentPeriodEnd, 1);
    expect(await subscriptions.renewDue(nextStart, outletId)).toEqual({ renewed: 1, cancelled: 0 });
    const changed = await current();
    expect(changed).toMatchObject({
      plan: { code: 'ESSENTIAL' },
      pendingPlan: null,
      pricePaise: essential.pricePaise,
      billingCycle: essential.billingCycle,
      currentPeriodStart: nextStart,
    });
    expect(changed.services.map((service) => service.serviceCode).sort()).toEqual(essential.services.map((service) => service.serviceCode).sort());
    // Deep cleaning is not in the new plan: none of its visits from the new cycle on is left to do.
    expect((await visits('open')).filter((visit) => visit.code === 'DEEP_CLEAN' && visit.date >= nextStart)).toEqual([]);
  });

  it('steps through every cycle it missed when it has not run for a long time', async () => {
    const before = await current();
    // 400 days past the end of the cycle now running: more than a cycle even for an annual plan.
    const asOf = addDaysToDate(before.currentPeriodEnd, 400);
    const { renewed } = await subscriptions.renewDue(asOf, outletId);
    expect(renewed).toBeGreaterThanOrEqual(2);
    const after = await current();
    expect(after.currentPeriodStart <= asOf && after.currentPeriodEnd >= asOf).toBe(true);
    expect(await subscriptions.renewDue(asOf, outletId)).toEqual({ renewed: 0, cancelled: 0 });
  });

  // ───────────────────────── Ending ─────────────────────────

  it('lets ECCS cancel at once: the plan ends today and its visits that have not started are cancelled', async () => {
    const ended = (await post(admin, '/cancel', { when: 'NOW' }).expect(200)).body as OutletSubscriptionDto;
    expect(ended.subscription).toBeNull();
    expect(ended.lastEnded).toMatchObject({ plan: { code: 'ESSENTIAL' }, endedOn: today });
    expect(await visits('open')).toEqual([]);
    expect(await plans.generateAll(today, outletId)).toEqual({ created: 0 });
    expect(await subscriptions.renewDue(addDaysToDate(today, 400), outletId)).toEqual({ renewed: 0, cancelled: 0 });
    // The plan that was edited now shows nobody on it.
    const all = (await http().get('/subscription-plans/all').set(bearer(admin)).expect(200)).body as PlansAdminDto;
    expect(all.plans.find((plan) => plan.id === planId)!.subscriberCount).toBe(0);
  });

  it('lets ECCS start a plan on dates it chooses, and ends a cancelled plan when its cycle is over', async () => {
    const firstVisit = addDaysToDate(today, 1);
    const started = (await post(admin, '', { planCode: PLAN_CODE, startDate: today, firstVisitDate: firstVisit }).expect(201))
      .body as OutletSubscriptionDto;
    const subscription = started.subscription!;
    expect(subscription).toMatchObject({ plan: { code: PLAN_CODE }, pricePaise: 120_000, currentPeriodStart: today });
    expect(subscription.services.find((service) => service.serviceCode === 'PEST')!.nextDate).toBe(firstVisit);

    await post(owner, '/cancel', { when: 'PERIOD_END' }).expect(200);
    const lastDay = subscription.currentPeriodEnd;
    // Still running on its last day.
    expect(await subscriptions.renewDue(lastDay, outletId)).toEqual({ renewed: 0, cancelled: 0 });
    expect((await current()).endsOn).toBe(lastDay);

    expect(await subscriptions.renewDue(addDaysToDate(lastDay, 1), outletId)).toEqual({ renewed: 0, cancelled: 1 });
    const ended = await read();
    expect(ended.subscription).toBeNull();
    expect(ended.lastEnded).toMatchObject({ plan: { code: PLAN_CODE }, endedOn: lastDay });
    // Visits inside the cycle it paid for stay; none is left after it.
    const open = await visits('open');
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((visit) => visit.date <= lastDay)).toBe(true);
    expect(await subscriptions.renewDue(addDaysToDate(lastDay, 1), outletId)).toEqual({ renewed: 0, cancelled: 0 });
  });

  it('cancelling before the first cycle has begun ends the plan straight away', async () => {
    const startDate = addDaysToDate(today, 10);
    await post(admin, '', { planCode: PLAN_CODE, startDate }).expect(201);
    expect((await current()).currentPeriodStart).toBe(startDate);
    const ended = (await post(owner, '/cancel', { when: 'PERIOD_END' }).expect(200)).body as OutletSubscriptionDto;
    expect(ended.subscription).toBeNull();
  });

  // ───────────────────────── Subscriptions from before prices were recorded ─────────────────────────

  it('fills in the price and the cycle of a subscription made before they were recorded', async () => {
    const startDate = addDaysToDate(today, -70);
    await prisma.client.subscription.create({ data: { outletId, planId, startDate: dbDate(startDate) } });
    const period = cyclePeriodContaining(startDate, 'MONTHLY', today);
    expect(await current()).toMatchObject({
      status: 'ACTIVE',
      pricePaise: 120_000,
      billingCycle: 'MONTHLY',
      startDate,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      renewal: { date: period.nextStart },
    });
    const row = await prisma.client.subscription.findFirstOrThrow({ where: { outletId, status: 'ACTIVE' } });
    expect(row.pricePaise).toBe(120_000);
    expect(isoDate(row.nextBillingDate!)).toBe(period.nextStart);
  });
});
