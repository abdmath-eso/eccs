// Plans and the visits created from them. Runs against the local database with
// the sample seed loaded. Works on a throwaway outlet of its own and removes it.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { PlansService } from './../src/services/plans.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-plans';
const OUTLET_CODE = 'E2EPL-AN0001';

type Visit = { id: string; serviceCode: string; date: string; status: string; fromPlan: boolean; supervisorId: string | null };
type OutletPlan = {
  plan: { code: string; services: { serviceCode: string; intervalDays: number }[] } | null;
  since: string | null;
  services: { serviceCode: string; intervalDays: number; nextDate: string }[];
};

const daysAhead = (days: number) => indiaDate(new Date(Date.now() + days * 86_400_000));

describe('Plans and their visits (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let plans: PlansService;
  let outletId: string;
  let seededOutletId: string;
  let owner: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanUp() {
    const db = prisma.client;
    const outlet = await db.outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    if (outlet) {
      await db.job.deleteMany({ where: { outletId: outlet.id } });
      await db.serviceSchedule.deleteMany({ where: { outletId: outlet.id } });
      await db.subscription.deleteMany({ where: { outletId: outlet.id } });
      await db.outlet.delete({ where: { id: outlet.id } });
    }
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
    const session = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE })
      .expect(200);
    return session.body.token as string;
  }

  /** This outlet's visits that are still to do, soonest first. */
  const diary = async (): Promise<Visit[]> =>
    ((await http().get('/visits').query({ outletId }).set(bearer(admin)).expect(200)).body as Visit[]).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  const setPlan = (token: string, body: Record<string, unknown>, forOutlet = outletId) =>
    http().put(`/outlets/${forOutlet}/plan`).set(bearer(token)).send(body);
  const getPlan = (token: string, forOutlet = outletId) => http().get(`/outlets/${forOutlet}/plan`).set(bearer(token));

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(PlansService);
    await cleanUp();

    const seeded = await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    seededOutletId = seeded.id;
    // A second outlet of the same sample restaurant, with no plan and no visits.
    outletId = (
      await prisma.client.outlet.create({
        data: { organizationId: seeded.organizationId, name: 'E2E plan outlet', code: OUTLET_CODE, address: 'Test Road' },
      })
    ).id;

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    supervisorId = (await http().get('/auth/me').set(bearer(supervisor)).expect(200)).body.id;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('lists the plans with their services and how often each is done', async () => {
    const list = (await http().get('/plans').set(bearer(admin)).expect(200)).body as OutletPlan['plan'][];
    const essential = list.find((plan) => plan!.code === 'ESSENTIAL')!;
    expect(essential.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serviceCode: 'PEST', intervalDays: 15 }),
        expect.objectContaining({ serviceCode: 'CHIMNEY', intervalDays: 90 }),
      ]),
    );
    await http().get('/plans').expect(401);
  });

  it('shows an outlet with no plan as having none', async () => {
    expect((await getPlan(admin).expect(200)).body).toEqual({ outletId, plan: null, since: null, services: [] });
    expect((await diary()).length).toBe(0);
  });

  it('lets only ECCS put an outlet on a plan', async () => {
    const body = { planCode: 'ESSENTIAL', startDate: daysAhead(2) };
    await setPlan(owner, body).expect(403);
    await setPlan(supervisor, body).expect(403);
    await setPlan(otherManager, body).expect(403);
    await setPlan(admin, { ...body, planCode: 'NOPE' }).expect(400);
    await setPlan(admin, { ...body, startDate: daysAhead(-1) }).expect(400);
  });

  it('fills the diary for the coming 30 days when a plan starts', async () => {
    const plan = (await setPlan(admin, { planCode: 'ESSENTIAL', startDate: daysAhead(2) }).expect(200)).body as OutletPlan;
    expect(plan.plan!.code).toBe('ESSENTIAL');
    expect(plan.since).toBe(daysAhead(2));

    // Pest control every 15 days: on days 2 and 17 (32 is beyond 30 days). Chimney every 90: day 2 only.
    const visits = await diary();
    expect(visits.map((visit) => `${visit.serviceCode} ${visit.date}`).sort()).toEqual(
      [`CHIMNEY ${daysAhead(2)}`, `PEST ${daysAhead(2)}`, `PEST ${daysAhead(17)}`].sort(),
    );
    expect(visits.every((visit) => visit.fromPlan && visit.status === 'SCHEDULED' && visit.supervisorId === null)).toBe(true);
    expect(plan.services.find((service) => service.serviceCode === 'PEST')!.nextDate).toBe(daysAhead(2));
  });

  it('lets the restaurant see its plan but not another restaurant’s', async () => {
    const theirs = (await getPlan(owner).expect(200)).body as OutletPlan;
    expect(theirs.plan!.code).toBe('ESSENTIAL');
    await getPlan(otherManager).expect(404);
    // The seeded outlet has had a plan from the start.
    expect(((await getPlan(owner, seededOutletId).expect(200)).body as OutletPlan).plan).not.toBeNull();
  });

  it('adds nothing when run again, even after a visit has been moved or cancelled', async () => {
    expect(await plans.generateAll(indiaDate(), outletId)).toEqual({ created: 0 });
    expect((await http().post('/visits/from-plans').set(bearer(owner)).expect(403)).body.created).toBeUndefined();

    const [first, second] = (await diary()).filter((visit) => visit.serviceCode === 'PEST');
    // ECCS moves one visit and cancels another: neither due date is filled a second time.
    await http().patch(`/visits/${first!.id}`).set(bearer(admin)).send({ date: daysAhead(4), supervisorId }).expect(200);
    await http().post(`/visits/${second!.id}/cancel`).set(bearer(admin)).expect(200);
    expect(await plans.generateAll(indiaDate(), outletId)).toEqual({ created: 0 });

    const pest = (await diary()).filter((visit) => visit.serviceCode === 'PEST');
    expect(pest.map((visit) => visit.date)).toEqual([daysAhead(4)]);
  });

  it('adds the next visits as time passes, with the same Supervisor as last time', async () => {
    // Twenty days on, the window reaches day 50: pest control on days 32 and 47 has come into range.
    expect(await plans.generateAll(daysAhead(20), outletId)).toEqual({ created: 2 });
    const added = (await diary()).filter((visit) => visit.serviceCode === 'PEST' && visit.date > daysAhead(20));
    expect(added.map((visit) => visit.date)).toEqual([daysAhead(32), daysAhead(47)]);
    expect(added.every((visit) => visit.status === 'ASSIGNED' && visit.supervisorId === supervisorId)).toBe(true);
    // The Supervisor finds them on their own list.
    const mine = (await http().get('/visits').set(bearer(supervisor)).expect(200)).body as Visit[];
    expect(mine.map((visit) => visit.id)).toEqual(expect.arrayContaining(added.map((visit) => visit.id)));
  });

  it('does not go back and fill days that have already passed', async () => {
    // Far in the future the rhythm is kept (every 15 days from day 2) but only upcoming dates are created.
    const { created } = await plans.generateAll(daysAhead(200), outletId);
    const visits = (await diary()).filter((visit) => visit.serviceCode === 'PEST' && visit.date > daysAhead(47));
    expect(visits.every((visit) => visit.date >= daysAhead(200) && visit.date <= daysAhead(230))).toBe(true);
    // Day 2 plus a multiple of 15 that falls in the window: days 212 and 227.
    expect(visits.map((visit) => visit.date)).toEqual([daysAhead(212), daysAhead(227)]);
    expect(created).toBeGreaterThanOrEqual(2);
  });

  it('changes plan by stopping the old one, and stops a plan by cancelling what has not started', async () => {
    const changed = (await setPlan(admin, { planCode: 'COMPLETE', startDate: daysAhead(1) }).expect(200)).body as OutletPlan;
    expect(changed.plan!.code).toBe('COMPLETE');
    expect(changed.services.map((service) => service.serviceCode).sort()).toEqual(['CHIMNEY', 'DEEP_CLEAN', 'PEST', 'SAFETY_INSPECTION']);
    // Only the new plan's visits are left to do.
    const visits = await diary();
    expect(visits.every((visit) => visit.date <= daysAhead(31))).toBe(true);
    expect(visits.filter((visit) => visit.serviceCode === 'PEST').map((visit) => visit.date)).toEqual([daysAhead(1), daysAhead(16)]);

    await http().delete(`/outlets/${outletId}/plan`).set(bearer(owner)).expect(403);
    const stopped = (await http().delete(`/outlets/${outletId}/plan`).set(bearer(admin)).expect(200)).body as OutletPlan;
    expect(stopped.plan).toBeNull();
    expect(await diary()).toEqual([]);
    expect(await plans.generateAll(indiaDate(), outletId)).toEqual({ created: 0 });
  });
});
