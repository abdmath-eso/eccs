// The hygiene score. Runs against the local database with the sample seed loaded.
// The numbers are checked on a throwaway outlet of its own, whose checklists,
// licences and inspection are written straight into the database so that the score
// is known in advance; the outlet and everything on it are removed afterwards.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { calculateScore } from '@eccs/shared';
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
  provisional: boolean;
  checklistsDay: string | null;
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
    expect(body).toMatchObject({
      outletId,
      outletName: 'E2E score outlet',
      date: indiaDate(),
      score: null,
      band: null,
      provisional: false,
      checklistsDay: null,
      change: null,
    });
    // Nothing to measure yet, except that the FSSAI licence every kitchen needs is not on record.
    expect(body.detail!.components.map((entry) => [entry.key, entry.max, entry.measured])).toEqual([
      ['inspection', 60, false],
      ['licences', 10, true],
      ['checklists', 30, false],
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
    expect(((await get(owner, seededOutletId).expect(200)).body as Score).detail!.components).toHaveLength(3);
  });

  it('scores an outlet not yet inspected on its licences and the day’s checklists, as provisional', async () => {
    const db = prisma.client;
    // One checklist, due at the very end of the day (so today's is never overdue while this runs),
    // with one check, in use for the last ten days.
    const list = await db.outletChecklist.create({
      data: {
        outlet: { connect: { id: outletId } },
        frequency: 'DAILY',
        dueTime: '23:59',
        createdAt: morning(daysAgo(10)),
        template: {
          create: { kind: 'DAILY', outletId, title: { en: 'E2E score checklist' }, items: { create: { position: 1, label: { en: 'Floor is clean' }, outletId } } },
        },
      },
      include: { template: { include: { items: true } } },
    });
    const itemId = list.template.items[0]!.id;
    // Yesterday: handed in at noon, in time. Two days ago: handed in the next morning, late. Three days ago: not done.
    const days: [number, Date][] = [
      [1, noon(daysAgo(1))],
      [2, morning(daysAgo(1))],
    ];
    const handIn = (date: string, submittedAt: Date) =>
      db.checklistRun.create({
        data: {
          outletChecklistId: list.id,
          outletId,
          date: dbDate(date),
          status: 'SUBMITTED',
          submittedAt,
          responses: { create: { itemId, passed: true, valueBool: true, capturedAt: submittedAt } },
        },
      });
    for (const [ago, submittedAt] of days) await handIn(daysAgo(ago), submittedAt);
    // An FSSAI licence in date but with no copy on file, and a trade licence that has expired.
    await db.licence.createMany({
      data: [
        { outletId, type: 'FSSAI', name: 'FSSAI licence', expiresOn: dbDate(daysAgo(-200)) },
        { outletId, type: 'TRADE_LICENCE', name: 'Trade licence', expiresOn: dbDate(daysAgo(5)) },
      ],
    });

    // Nothing of today's has been handed in or fallen due, so yesterday's checklist is the one counted: 30 of 30.
    // Licences: (½ + 0) ÷ 2 of 10 = 2.5. No inspection: left out. 32.5 of 40 possible = 81.
    let body = await score();
    expect(part(body, 'checklists')).toEqual({ key: 'checklists', measured: true, max: 30, earned: 30, lost: 0, reasons: [] });
    expect(part(body, 'licences')).toMatchObject({
      earned: 2.5,
      reasons: [
        { code: 'LICENCES_EXPIRED', count: 1, total: 2, lost: 5 },
        { code: 'LICENCE_COPIES_MISSING', count: 1, total: 2, lost: 2.5 },
      ],
    });
    expect(part(body, 'inspection')).toMatchObject({ measured: false, earned: 0, reasons: [] });
    expect(body.detail).toMatchObject({ earned: 32.5, possible: 40 });
    expect(body).toMatchObject({ score: 81, band: 'GOOD', provisional: true, checklistsDay: 'YESTERDAY', change: null });

    // The day it was handed in late: half the points. 15 + 2.5 of 40 = 44.
    const late = calculateScore(await scores.gather(outletId, daysAgo(2)));
    expect(late.components[2]).toMatchObject({ earned: 15, reasons: [{ code: 'CHECKLISTS_LATE', count: 1, total: 1, lost: 15 }] });
    expect(late).toMatchObject({ score: 44, band: 'NEEDS_ATTENTION', checklistsDay: 'TODAY' });
    // The day it was not done at all: nothing. 2.5 of 40 = 6.
    const missed = calculateScore(await scores.gather(outletId, daysAgo(3)));
    expect(missed.components[2]).toMatchObject({ earned: 0, reasons: [{ code: 'CHECKLISTS_MISSED', count: 1, total: 1, lost: 30 }] });
    expect(missed.score).toBe(6);

    // Today's is handed in: from now on today is the day counted.
    await handIn(indiaDate(), new Date());
    body = await score();
    expect(part(body, 'checklists')).toMatchObject({ earned: 30, reasons: [] });
    expect(body).toMatchObject({ score: 81, band: 'GOOD', provisional: true, checklistsDay: 'TODAY' });

    // Today's snapshot now exists, with the breakdown.
    const rows = await snapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date.toISOString().slice(0, 10)).toBe(indiaDate());
    expect(rows[0]!.score).toBe(81);
    expect(rows[0]!.breakdown).toMatchObject({ version: 2, band: 'GOOD', earned: 32.5, possible: 40 });
    expect((rows[0]!.breakdown as { components: Component[] }).components).toHaveLength(3);
  });

  it('makes the latest approved inspection 60 of the 100 points', async () => {
    const db = prisma.client;
    const template = await db.checklistTemplate.findFirstOrThrow({ where: { kind: 'INSPECTION' } });
    const now = new Date();
    const inspection = await db.inspection.create({
      data: { outletId, templateId: template.id, supervisorId, status: 'SUBMITTED', conductedAt: now, startedAt: now, completedAt: now, overallScore: 72, grade: 'B' },
    });
    // Not approved yet: it does not count.
    expect(await score()).toMatchObject({ score: 81, provisional: true });

    await db.inspection.update({ where: { id: inspection.id }, data: { status: 'APPROVED', approvedAt: now } });
    // 72 of 100 at the inspection is 43.2 of 60. With licences 2.5 and checklists 30: 75.7 of 100 = 76.
    const body = await score();
    expect(part(body, 'inspection')).toMatchObject({ measured: true, max: 60, earned: 43.2, lost: 16.8 });
    expect(part(body, 'inspection').reasons).toMatchObject([{ code: 'INSPECTION_NON_COMPLIANT', lost: 16.8 }]);
    expect(body.detail).toMatchObject({ earned: 75.7, possible: 100 });
    expect(body).toMatchObject({ score: 76, band: 'FAIR', provisional: false });
    expect(await snapshots()).toHaveLength(1);

    // The Supervisor who inspected now has work at this outlet and may see its score.
    expect(((await get(supervisor).expect(200)).body as Score).score).toBe(76);
  });

  it('keeps one snapshot per day, and shows the trend and the change on last week', async () => {
    await prisma.client.hygieneScoreSnapshot.create({
      data: { outletId, date: dbDate(daysAgo(7)), score: 60, breakdown: {} },
    });
    // Yesterday's score, worked out "as of" yesterday: its checklist on time (30), licences 2.5;
    // today's inspection had not happened. 32.5 of 40 = 81, provisional.
    const yesterday = await scores.snapshot(outletId, daysAgo(1));
    expect(yesterday).toMatchObject({ score: 81, provisional: true });
    // Working the same day out again replaces its snapshot.
    await scores.snapshot(outletId, daysAgo(1));

    const body = await score();
    expect(body).toMatchObject({ score: 76, change: 16 });
    expect(body.detail!.history).toEqual([
      { date: daysAgo(7), score: 60 },
      { date: daysAgo(1), score: 81 },
      { date: indiaDate(), score: 76 },
    ]);
    expect(await snapshots()).toHaveLength(3);

    // The Supervisor and ECCS get the same picture; another restaurant still gets nothing.
    expect(((await get(admin).expect(200)).body as Score).detail!.history).toHaveLength(3);
    await get(otherManager).expect(404);
  });
});
