// The hygiene score. Runs against the local database with the sample seed loaded.
// The numbers are checked on a throwaway outlet of its own, whose checklists, visits,
// licences and inspection are written straight into the database so that the score
// is known in advance; the outlet and everything on it are removed afterwards.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { ScoresService } from './../src/scores/scores.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-scores';
const OUTLET_CODE = 'E2ESC-OR0001';

type Reason = { code: string; count: number; total?: number; lost: number };
type Component = { key: string; measured: boolean; max: number; earned: number; lost: number; reasons: Reason[] };
type Score = {
  outletId: string;
  outletName: string;
  date: string;
  score: number | null;
  band: string | null;
  change: number | null;
  detail: { earned: number; possible: number; components: Component[]; history: { date: string; score: number }[] } | null;
};

const daysAgo = (days: number) => indiaDate(new Date(Date.now() - days * 86_400_000));
const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
/** A moment on an India date: 04:00 UTC is 9:30 am in India, 06:30 UTC is noon. */
const morning = (date: string) => new Date(`${date}T04:00:00.000Z`);
const noon = (date: string) => new Date(`${date}T06:30:00.000Z`);

describe('Hygiene score (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scores: ScoresService;
  let outletId: string;
  let seededOutletId: string;
  let owner: string;
  let chef: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  let finishedVisitId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, forOutlet = outletId) => http().get(`/scores/${forOutlet}`).set(bearer(token));
  const score = async (token: string = owner) => (await get(token).expect(200)).body as Score;
  const part = (body: Score, key: string) => body.detail!.components.find((entry) => entry.key === key)!;
  const snapshots = () =>
    prisma.client.hygieneScoreSnapshot.findMany({ where: { outletId }, orderBy: { date: 'asc' } });

  async function cleanUp() {
    const db = prisma.client;
    const outlet = await db.outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    if (outlet) {
      const lists = await db.outletChecklist.findMany({ where: { outletId: outlet.id }, select: { id: true, templateId: true } });
      await db.hygieneScoreSnapshot.deleteMany({ where: { outletId: outlet.id } });
      await db.inspection.deleteMany({ where: { outletId: outlet.id } });
      // Sign-offs go with their visits.
      await db.job.deleteMany({ where: { outletId: outlet.id } });
      await db.licence.deleteMany({ where: { outletId: outlet.id } });
      // Answers go with their checklists, and items with their template.
      await db.checklistRun.deleteMany({ where: { outletId: outlet.id } });
      await db.outletChecklist.deleteMany({ where: { outletId: outlet.id } });
      await db.checklistTemplate.deleteMany({ where: { id: { in: lists.map((list) => list.templateId) } } });
      await db.session.deleteMany({ where: { deviceName: DEVICE } });
      await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
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

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    scores = app.get(ScoresService);
    await cleanUp();

    const seeded = await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    seededOutletId = seeded.id;
    // A second outlet of the same sample restaurant, with nothing recorded at it.
    outletId = (
      await prisma.client.outlet.create({
        data: { organizationId: seeded.organizationId, name: 'E2E score outlet', code: OUTLET_CODE, address: 'Test Road' },
      })
    ).id;

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    chef = await pinLogin(CODES.kukatpally, PINS.chef);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    supervisorId = (await http().get('/auth/me').set(bearer(supervisor)).expect(200)).body.id;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('gives a new outlet no number, and keeps no snapshot for it', async () => {
    const body = await score();
    expect(body).toMatchObject({ outletId, outletName: 'E2E score outlet', date: indiaDate(), score: null, band: null, change: null });
    // Nothing to measure yet, except that the FSSAI licence every kitchen needs is not on record.
    expect(body.detail!.components.map((entry) => [entry.key, entry.measured])).toEqual([
      ['checklists', false],
      ['onTime', false],
      ['problems', false],
      ['services', false],
      ['licences', true],
      ['inspection', false],
    ]);
    expect(part(body, 'licences').reasons).toEqual([{ code: 'FSSAI_MISSING', count: 1, lost: 10 }]);
    expect(body.detail!.history).toEqual([]);
    expect(await snapshots()).toEqual([]);
  });

  it('is for the outlet’s own restaurant and for ECCS staff who work there', async () => {
    await http().get(`/scores/${outletId}`).expect(401);
    await get(owner).expect(200);
    await get(admin).expect(200);
    // Another restaurant, a Head Chef of a different outlet, and a Supervisor with no work here.
    await get(otherManager).expect(404);
    await get(chef).expect(404);
    await get(supervisor).expect(404);
    await get(owner, 'no-such-outlet').expect(404);
  });

  it('shows the Head Chef the number and band only', async () => {
    const body = (await get(chef, seededOutletId).expect(200)).body as Score;
    expect(body.outletId).toBe(seededOutletId);
    expect(body.detail).toBeNull();
    // Whether the sample outlet has a number today depends on the sample data; the band always goes with it.
    expect(body.band === null).toBe(body.score === null);
    // The Owner of the same outlet gets the breakdown.
    expect(((await get(owner, seededOutletId).expect(200)).body as Score).detail!.components).toHaveLength(6);
  });

  it('works the score out from checklists and licences, leaving out what cannot be measured yet', async () => {
    const db = prisma.client;
    // One checklist, due at 10 am, with one check, in use for the last ten days.
    const list = await db.outletChecklist.create({
      data: {
        outlet: { connect: { id: outletId } },
        frequency: 'DAILY',
        dueTime: '10:00',
        createdAt: morning(daysAgo(10)),
        template: {
          create: { kind: 'DAILY', outletId, title: { en: 'E2E score checklist' }, items: { create: { position: 1, label: { en: 'Floor is clean' }, outletId } } },
        },
      },
      include: { template: { include: { items: true } } },
    });
    const itemId = list.template.items[0]!.id;
    // Yesterday and the day before: handed in on time, with the check reported as a problem both days.
    // Three days ago: handed in at noon, two hours late. Four days ago: on time. Five and six days ago: not done.
    const days: [number, Date, boolean][] = [
      [1, morning(daysAgo(1)), false],
      [2, morning(daysAgo(2)), false],
      [3, noon(daysAgo(3)), true],
      [4, morning(daysAgo(4)), true],
    ];
    for (const [ago, submittedAt, passed] of days) {
      await db.checklistRun.create({
        data: {
          outletChecklistId: list.id,
          outletId,
          date: dbDate(daysAgo(ago)),
          status: 'SUBMITTED',
          submittedAt,
          responses: { create: { itemId, passed, valueBool: passed, capturedAt: submittedAt } },
        },
      });
    }
    // An FSSAI licence in date but with no copy on file, and a trade licence that has expired.
    await db.licence.createMany({
      data: [
        { outletId, type: 'FSSAI', name: 'FSSAI licence', expiresOn: dbDate(daysAgo(-200)) },
        { outletId, type: 'TRADE_LICENCE', name: 'Trade licence', expiresOn: dbDate(daysAgo(5)) },
      ],
    });

    const body = await score();
    // 4 of 6 handed in: 40 × 4/6 = 26.7. 3 of 4 on time: 11.3. One problem on a second day: 20 − 2 = 18.
    // Licences: (½ + 0) ÷ 2 of 10 = 2.5. No visits and no inspection: left out.
    // 58.4 of 85 possible = 69.
    expect(part(body, 'checklists')).toEqual({
      key: 'checklists',
      measured: true,
      max: 40,
      earned: 26.7,
      lost: 13.3,
      reasons: [{ code: 'CHECKLISTS_MISSED', count: 2, total: 6, lost: 13.3 }],
    });
    expect(part(body, 'onTime')).toMatchObject({ earned: 11.3, reasons: [{ code: 'CHECKLISTS_LATE', count: 1, total: 4, lost: 3.8 }] });
    expect(part(body, 'problems')).toMatchObject({ earned: 18, reasons: [{ code: 'PROBLEMS_NOT_FIXED', count: 1, lost: 2 }] });
    expect(part(body, 'licences')).toMatchObject({
      earned: 2.5,
      reasons: [
        { code: 'LICENCES_EXPIRED', count: 1, total: 2, lost: 5 },
        { code: 'LICENCE_COPIES_MISSING', count: 1, total: 2, lost: 2.5 },
      ],
    });
    expect(part(body, 'services')).toMatchObject({ measured: false, earned: 0, reasons: [] });
    expect(part(body, 'inspection').measured).toBe(false);
    expect(body.detail).toMatchObject({ earned: 58.4, possible: 85 });
    expect(body).toMatchObject({ score: 69, band: 'FAIR', change: null });

    // Today's snapshot now exists, with the breakdown the monitoring board reads.
    const rows = await snapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date.toISOString().slice(0, 10)).toBe(indiaDate());
    expect(rows[0]!.score).toBe(69);
    expect(rows[0]!.breakdown).toMatchObject({ version: 1, band: 'FAIR', earned: 58.4, possible: 85 });
    expect((rows[0]!.breakdown as { components: Component[] }).components).toHaveLength(6);
  });

  it('counts a visit left unsigned, but never one that ECCS did not carry out', async () => {
    const db = prisma.client;
    const service = await db.serviceType.findFirstOrThrow({ where: { code: 'PEST' } });
    // Finished five days ago and still not signed off; and one that ECCS never turned up for.
    finishedVisitId = (
      await db.job.create({
        data: {
          outletId,
          serviceTypeId: service.id,
          supervisorId,
          scheduledDate: dbDate(daysAgo(5)),
          status: 'COMPLETED',
          completedAt: morning(daysAgo(5)),
        },
      })
    ).id;
    await db.job.create({
      data: { outletId, serviceTypeId: service.id, supervisorId, scheduledDate: dbDate(daysAgo(2)), status: 'ASSIGNED' },
    });

    // ECCS visits are now measured: 0 of 15. 58.4 of 100 possible = 58.
    const body = await score();
    expect(part(body, 'services')).toEqual({
      key: 'services',
      measured: true,
      max: 15,
      earned: 0,
      lost: 15,
      reasons: [
        { code: 'VISITS_NOT_SIGNED_OFF', count: 1, total: 1, lost: 15 },
        { code: 'VISITS_MISSED_BY_ECCS', count: 1, lost: 0 },
      ],
    });
    expect(body).toMatchObject({ score: 58, band: 'NEEDS_ATTENTION' });

    // Still one snapshot for today, brought up to date.
    const rows = await snapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(58);

    // The Supervisor now has work at this outlet and may see its score.
    expect(((await get(supervisor).expect(200)).body as Score).score).toBe(58);
  });

  it('gives the points back when the visit is signed off, and adds the inspection as a fifth of the score', async () => {
    const db = prisma.client;
    await db.signOff.create({ data: { jobId: finishedVisitId, signerName: 'E2E', signedAt: new Date(), rating: 5 } });
    // 58.4 + 15 = 73.4 of 100.
    expect(await score()).toMatchObject({ score: 73, band: 'FAIR' });

    const template = await db.checklistTemplate.findFirstOrThrow({ where: { kind: 'INSPECTION' } });
    const now = new Date();
    const inspection = await db.inspection.create({
      data: { outletId, templateId: template.id, supervisorId, status: 'SUBMITTED', conductedAt: now, startedAt: now, completedAt: now, overallScore: 80, grade: 'A' },
    });
    // Not approved yet: it does not count.
    expect((await score()).score).toBe(73);

    await db.inspection.update({ where: { id: inspection.id }, data: { status: 'APPROVED', approvedAt: now } });
    // 80 of 100 at the inspection is 20 of 25. 73.4 + 20 = 93.4 of 125 possible = 75.
    const body = await score();
    expect(part(body, 'inspection')).toMatchObject({ measured: true, max: 25, earned: 20, lost: 5 });
    expect(body.detail).toMatchObject({ earned: 93.4, possible: 125 });
    expect(body).toMatchObject({ score: 75, band: 'FAIR' });
    expect(await snapshots()).toHaveLength(1);
  });

  it('keeps one snapshot per day, and shows the trend and the change on last week', async () => {
    await prisma.client.hygieneScoreSnapshot.create({
      data: { outletId, date: dbDate(daysAgo(7)), score: 60, breakdown: {} },
    });
    // Yesterday's score, worked out "as of" yesterday: 4 of 7 checklists (22.9), on time 11.3, problems 18,
    // licences 2.5, the signed-off visit 15; today's inspection had not happened. 69.6 of 100 = 70.
    const yesterday = await scores.snapshot(outletId, daysAgo(1));
    expect(yesterday.score).toBe(70);
    // Working the same day out again replaces its snapshot.
    await scores.snapshot(outletId, daysAgo(1));

    const body = await score();
    expect(body).toMatchObject({ score: 75, change: 15 });
    expect(body.detail!.history).toEqual([
      { date: daysAgo(7), score: 60 },
      { date: daysAgo(1), score: 70 },
      { date: indiaDate(), score: 75 },
    ]);
    expect(await snapshots()).toHaveLength(3);

    // The Supervisor and ECCS get the same picture; another restaurant still gets nothing.
    expect(((await get(admin).expect(200)).body as Score).detail!.history).toHaveLength(3);
    await get(otherManager).expect(404);
  });
});
