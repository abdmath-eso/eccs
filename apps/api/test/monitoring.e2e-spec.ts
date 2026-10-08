// The ECCS monitoring board: who may see it, which outlets each person gets, and
// whether the numbers and the "needs attention" judgements are right. Runs against
// the local database with the sample seed loaded. Works on two throwaway outlets of
// its own, with data arranged straight in the database, and removes them.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import {
  checklistLevel,
  inspectionLevel,
  issueLevel,
  licenceLevel,
  overallLevel,
  scoreLevel,
  visitLevel,
  type MonitoringBoardDto,
  type MonitoringOutletDto,
} from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate, indiaTime } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T' };
const PINS = { owner: '3917', chef: '8264' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-monitoring';
/** One outlet with something wrong in every area, and one with nothing recorded at all. */
const BUSY_CODE = 'E2EMO-N00001';
const QUIET_CODE = 'E2EMO-N00002';

const DAY_MS = 86_400_000;
const day = (offset: number) => indiaDate(new Date(Date.now() + offset * DAY_MS));
const dbDate = (offset: number) => new Date(`${day(offset)}T00:00:00.000Z`);
/** A moment on an India calendar day, at the given India time. */
const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00.000+05:30`);

describe('The rules of the monitoring board', () => {
  it('judges checklists by the share handed in, and watches late ones', () => {
    const facts = { due: 10, submitted: 10, missed: 0, late: 0, withProblems: 3, overdueNow: 0 };
    // Problems reported on a checklist are the restaurant's own business and do not change the level.
    expect(checklistLevel(facts)).toBe('OK');
    expect(checklistLevel({ ...facts, late: 1 })).toBe('WATCH');
    expect(checklistLevel({ ...facts, submitted: 8, missed: 2 })).toBe('WATCH');
    expect(checklistLevel({ ...facts, submitted: 5, missed: 5 })).toBe('ATTENTION');
    expect(checklistLevel({ ...facts, due: 0, submitted: 0 })).toBe('NONE');
  });

  it('judges issues by how long they have waited', () => {
    const none = { unresolved: 0, notStarted: 0, oldestNotStartedDays: null, oldestUnresolvedDays: null };
    expect(issueLevel(none)).toBe('OK');
    expect(issueLevel({ unresolved: 1, notStarted: 1, oldestNotStartedDays: 2, oldestUnresolvedDays: 2 })).toBe('WATCH');
    expect(issueLevel({ unresolved: 1, notStarted: 1, oldestNotStartedDays: 3, oldestUnresolvedDays: 3 })).toBe('ATTENTION');
    // Picked up by ECCS, so it may take longer, but not for ever.
    expect(issueLevel({ unresolved: 1, notStarted: 0, oldestNotStartedDays: null, oldestUnresolvedDays: 7 })).toBe('WATCH');
    expect(issueLevel({ unresolved: 1, notStarted: 0, oldestNotStartedDays: null, oldestUnresolvedDays: 8 })).toBe('ATTENTION');
  });

  it('judges licences, visits, inspections and the score', () => {
    expect(licenceLevel({ total: 0, expired: 0, expiring: 0 })).toBe('NONE');
    expect(licenceLevel({ total: 2, expired: 0, expiring: 0 })).toBe('OK');
    expect(licenceLevel({ total: 2, expired: 0, expiring: 1 })).toBe('WATCH');
    expect(licenceLevel({ total: 2, expired: 1, expiring: 1 })).toBe('ATTENTION');

    const calm = {
      overdue: 0,
      unassigned: 0,
      unassignedSoon: 0,
      awaitingSignOff: 0,
      oldestSignOffDays: null,
      reportsToApprove: 0,
      oldestApprovalDays: null,
      reportsReturned: 0,
      ratingCount: 0,
      ratingAverage: null,
      lowRatings: 0,
    };
    expect(visitLevel(calm)).toBe('OK');
    expect(visitLevel({ ...calm, unassigned: 1 })).toBe('WATCH');
    expect(visitLevel({ ...calm, unassigned: 1, unassignedSoon: 1 })).toBe('ATTENTION');
    expect(visitLevel({ ...calm, awaitingSignOff: 1, oldestSignOffDays: 3 })).toBe('WATCH');
    expect(visitLevel({ ...calm, awaitingSignOff: 1, oldestSignOffDays: 4 })).toBe('ATTENTION');
    expect(visitLevel({ ...calm, reportsToApprove: 1, oldestApprovalDays: 3 })).toBe('ATTENTION');
    expect(visitLevel({ ...calm, ratingCount: 2, ratingAverage: 3.5 })).toBe('WATCH');
    expect(visitLevel({ ...calm, ratingCount: 2, ratingAverage: 3.5, lowRatings: 1 })).toBe('ATTENTION');
    expect(visitLevel({ ...calm, overdue: 1 })).toBe('ATTENTION');

    const never = { latestGrade: null, actionsOverdue: 0, toApprove: 0, oldestApprovalDays: null, overduePlanned: 0 };
    expect(inspectionLevel(never)).toBe('NONE');
    expect(inspectionLevel({ ...never, latestGrade: 'A' })).toBe('OK');
    expect(inspectionLevel({ ...never, latestGrade: 'B' })).toBe('WATCH');
    expect(inspectionLevel({ ...never, latestGrade: 'NON_COMPLIANT' })).toBe('ATTENTION');
    // A corrective action past its date is not held against the outlet: nothing could clear it.
    expect(inspectionLevel({ ...never, latestGrade: 'A_PLUS', actionsOverdue: 1 })).toBe('OK');
    expect(inspectionLevel({ ...never, toApprove: 1, oldestApprovalDays: 0 })).toBe('WATCH');

    expect(scoreLevel({ score: null, previous: null })).toBe('NONE');
    expect(scoreLevel({ score: 90, previous: null })).toBe('OK');
    expect(scoreLevel({ score: 70, previous: 72 })).toBe('WATCH');
    expect(scoreLevel({ score: 85, previous: 91 })).toBe('WATCH');
    expect(scoreLevel({ score: 80, previous: 90 })).toBe('ATTENTION');
    expect(scoreLevel({ score: 59, previous: 59 })).toBe('ATTENTION');

    expect(overallLevel(['OK', 'NONE', 'WATCH'])).toBe('WATCH');
    expect(overallLevel(['OK', 'ATTENTION', 'WATCH'])).toBe('ATTENTION');
    expect(overallLevel(['NONE', 'NONE'])).toBe('NONE');
  });
});

describe('Monitoring board (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let busyId: string;
  let quietId: string;
  let owner: string;
  let chef: string;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  let visitIds: { overdue: string; waiting: string; toApprove: string };
  let inspectionId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const board = async (token: string, days?: number): Promise<MonitoringBoardDto> =>
    (await http().get('/monitoring').query(days ? { days } : {}).set(bearer(token)).expect(200)).body as MonitoringBoardDto;
  const find = (from: MonitoringBoardDto, outletId: string): MonitoringOutletDto | undefined =>
    from.outlets.find((outlet) => outlet.outletId === outletId);

  async function cleanUp() {
    const db = prisma.client;
    const outlets = await db.outlet.findMany({ where: { code: { in: [BUSY_CODE, QUIET_CODE] } }, select: { id: true } });
    const outletId = { in: outlets.map((outlet) => outlet.id) };
    // Answers go with their checklist, sign-offs with their visit and findings with their inspection.
    await db.checklistRun.deleteMany({ where: { outletId } });
    await db.outletChecklist.deleteMany({ where: { outletId } });
    await db.issue.deleteMany({ where: { outletId } });
    await db.licence.deleteMany({ where: { outletId } });
    await db.job.deleteMany({ where: { outletId } });
    await db.inspection.deleteMany({ where: { outletId } });
    await db.hygieneScoreSnapshot.deleteMany({ where: { outletId } });
    await db.outlet.deleteMany({ where: { id: outletId } });
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
    await cleanUp();
    const db = prisma.client;

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    chef = await pinLogin(CODES.kukatpally, PINS.chef);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    supervisorId = (await http().get('/auth/me').set(bearer(supervisor)).expect(200)).body.id;
    const adminId = (await http().get('/auth/me').set(bearer(admin)).expect(200)).body.id as string;

    const seeded = await db.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    const outlet = (name: string, code: string) =>
      db.outlet.create({ data: { organizationId: seeded.organizationId, name, code, address: 'Test Road' } });
    busyId = (await outlet('E2E monitoring busy outlet', BUSY_CODE)).id;
    quietId = (await outlet('E2E monitoring quiet outlet', QUIET_CODE)).id;

    // ── Checklists: two daily checklists. The first has existed for three days and has no due time:
    // yesterday handed in on time, the day before handed in a day late with a problem, three days ago missed.
    // The second has existed since yesterday and is due at 9 am: yesterday it was handed in at noon, so late.
    const template = await db.checklistTemplate.findFirstOrThrow({
      where: { kind: 'DAILY', outletId: null, isActive: true, items: { some: { isActive: true, outletId: null } } },
      include: { items: { where: { isActive: true, outletId: null }, take: 1 } },
    });
    const first = await db.outletChecklist.create({
      data: { outletId: busyId, templateId: template.id, dueTime: null, createdAt: new Date(Date.now() - 3 * DAY_MS) },
    });
    const second = await db.outletChecklist.create({
      data: { outletId: busyId, templateId: template.id, dueTime: '09:00', createdAt: new Date(Date.now() - DAY_MS) },
    });
    const run = (outletChecklistId: string, offset: number, submittedAt: Date) =>
      db.checklistRun.create({
        data: { outletChecklistId, outletId: busyId, date: dbDate(offset), status: 'SUBMITTED', submittedAt },
      });
    await run(first.id, -1, at(-1, '11:30'));
    const lateRun = await run(first.id, -2, at(-1, '08:00'));
    await db.checklistResponse.create({
      data: { runId: lateRun.id, itemId: template.items[0]!.id, passed: false, valueBool: false, note: 'e2e', capturedAt: at(-1, '08:00') },
    });
    await run(second.id, -1, at(-1, '12:00'));

    // ── An issue nobody has picked up for three days.
    await db.issue.create({
      data: {
        outletId: busyId,
        category: 'PEST_SIGHTING',
        title: 'e2e monitoring issue',
        description: 'e2e monitoring issue',
        raisedById: adminId,
        createdAt: at(-3, '10:00'),
      },
    });

    // ── Licences: one expired yesterday, one expiring in 30 days, one valid for a long time.
    await db.licence.createMany({
      data: [
        { outletId: busyId, type: 'FSSAI', expiresOn: dbDate(-1) },
        { outletId: busyId, type: 'FIRE_NOC', expiresOn: dbDate(30) },
        { outletId: busyId, type: 'TRADE_LICENCE', expiresOn: dbDate(200) },
      ],
    });

    // ── Visits: one overdue with no Supervisor; one the Supervisor finished five days ago, not signed off;
    // one signed off today with two stars, waiting for ECCS's approval; and one tomorrow, all in order.
    const pest = await db.serviceType.findUniqueOrThrow({ where: { code: 'PEST' } });
    const job = (data: Record<string, unknown>) =>
      db.job.create({ data: { outletId: busyId, serviceTypeId: pest.id, scheduledDate: dbDate(0), ...data } as never });
    visitIds = {
      overdue: (await job({ scheduledDate: dbDate(-1), status: 'SCHEDULED' })).id,
      waiting: (await job({ scheduledDate: dbDate(-5), status: 'COMPLETED', supervisorId, completedAt: at(-5, '15:00') })).id,
      toApprove: (
        await job({
          scheduledDate: dbDate(-1),
          status: 'APPROVED',
          supervisorId,
          completedAt: at(-1, '15:00'),
          approvedAt: new Date(),
          signOff: { create: { signerName: 'E2E Owner', signerRole: 'OWNER', signedAt: new Date(), rating: 2 } },
        })
      ).id,
    };
    await job({ scheduledDate: dbDate(1), status: 'ASSIGNED', supervisorId });

    // ── An approved inspection graded B, with one corrective action past its date and one not yet due.
    const inspectionTemplate = await db.checklistTemplate.findFirstOrThrow({ where: { kind: 'INSPECTION' } });
    inspectionId = (
      await db.inspection.create({
        data: {
          outletId: busyId,
          templateId: inspectionTemplate.id,
          supervisorId,
          status: 'APPROVED',
          conductedAt: at(-10, '11:00'),
          plannedDate: dbDate(-10),
          completedAt: at(-10, '13:00'),
          approvedAt: at(-9, '10:00'),
          overallScore: 70,
          grade: 'B',
          findings: {
            create: [
              { description: 'e2e overdue action', severity: 'HIGH', correctiveAction: 'Fix it', dueDate: dbDate(-1) },
              { description: 'e2e action not yet due', severity: 'LOW', correctiveAction: 'Fix it', dueDate: dbDate(5) },
            ],
          },
        },
      })
    ).id;

    // ── Hygiene score: 55 today, 70 eight days ago.
    await db.hygieneScoreSnapshot.createMany({
      data: [
        { outletId: busyId, date: dbDate(0), score: 55, breakdown: {} },
        { outletId: busyId, date: dbDate(-3), score: 60, breakdown: {} },
        { outletId: busyId, date: dbDate(-8), score: 70, breakdown: {} },
      ],
    });
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('is for ECCS staff only', async () => {
    await http().get('/monitoring').expect(401);
    await http().get('/monitoring').set(bearer(owner)).expect(403);
    await http().get('/monitoring').set(bearer(chef)).expect(403);
    await http().get('/monitoring').set(bearer(admin)).expect(200);
    await http().get('/monitoring').set(bearer(supervisor)).expect(200);
  });

  it('shows an ECCS admin every active outlet, worst first, with totals that add up', async () => {
    const all = await board(admin);
    const active = await prisma.client.outlet.findMany({ where: { isActive: true }, select: { id: true } });
    expect(all.outlets.map((outlet) => outlet.outletId).sort()).toEqual(active.map((outlet) => outlet.id).sort());

    expect(all).toMatchObject({ date: day(0), from: day(-6), to: day(0), days: 7 });
    const order = { ATTENTION: 0, WATCH: 1, OK: 2, NONE: 3 };
    const ranks = all.outlets.map((outlet) => order[outlet.level]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    const counted = (level: string) => all.outlets.filter((outlet) => outlet.level === level).length;
    expect(all.totals).toMatchObject({
      outlets: all.outlets.length,
      attention: counted('ATTENTION'),
      watch: counted('WATCH'),
      ok: counted('OK'),
    });
    expect(all.totals.areas.licences.attention).toBe(all.outlets.filter((outlet) => outlet.attention.includes('licences')).length);
    expect(all.totals.areas.checklists.watch).toBe(all.outlets.filter((outlet) => outlet.watch.includes('checklists')).length);
  });

  it('reports the numbers and what needs attention for an outlet that is behind on everything', async () => {
    const outlet = find(await board(admin), busyId)!;
    // After 9 am the second checklist is overdue today as well; before that, today does not count yet.
    const overdueToday = indiaTime() > '09:00' ? 1 : 0;

    expect(outlet).toMatchObject({ outletName: 'E2E monitoring busy outlet', plan: null, level: 'ATTENTION' });
    expect(outlet.attention).toEqual(['issues', 'licences', 'visits', 'score']);
    expect(outlet.watch).toEqual(['checklists', 'inspections']);

    expect(outlet.checklists).toEqual({
      due: 4 + overdueToday,
      submitted: 3,
      missed: 1 + overdueToday,
      late: 2,
      withProblems: 1,
      overdueNow: overdueToday,
      percent: overdueToday ? 60 : 75,
      level: 'WATCH',
    });

    expect(outlet.issues).toMatchObject({ unresolved: 1, notStarted: 1, oldestNotStartedDays: 3, oldestUnresolvedDays: 3, level: 'ATTENTION' });
    expect(outlet.issues.items).toEqual([
      expect.objectContaining({ status: 'OPEN', category: 'PEST_SIGHTING', ageDays: 3, reference: expect.stringMatching(/^ECCS-\d{4,}$/) }),
    ]);

    expect(outlet.licences).toMatchObject({ total: 3, expired: 1, expiring: 1, level: 'ATTENTION' });
    expect(outlet.licences.items.map((licence) => [licence.type, licence.state, licence.daysLeft])).toEqual([
      ['FSSAI', 'EXPIRED', -1],
      ['FIRE_NOC', 'EXPIRING', 30],
    ]);

    expect(outlet.visits).toMatchObject({
      overdue: 1,
      unassigned: 1,
      unassignedSoon: 1,
      awaitingSignOff: 1,
      oldestSignOffDays: 5,
      reportsToApprove: 1,
      oldestApprovalDays: 0,
      reportsReturned: 0,
      ratingCount: 1,
      ratingAverage: 2,
      lowRatings: 1,
      nextDate: day(1),
      level: 'ATTENTION',
    });
    const visit = (id: string) => outlet.visits.items.find((item) => item.id === id)!;
    expect(visit(visitIds.overdue)).toMatchObject({ problems: ['OVERDUE', 'UNASSIGNED'], waitingDays: 1, date: day(-1) });
    expect(visit(visitIds.waiting)).toMatchObject({ problems: ['AWAITING_SIGN_OFF'], waitingDays: 5 });
    expect(visit(visitIds.toApprove)).toMatchObject({ problems: ['REPORT_TO_APPROVE', 'LOW_RATING'], rating: 2 });
    // The longest-waiting visit leads; the visit that is in order is not listed.
    expect(outlet.visits.items.map((item) => item.id)).toEqual([visitIds.waiting, visitIds.overdue, visitIds.toApprove]);

    expect(outlet.inspections).toMatchObject({
      latestGrade: 'B',
      actionsOverdue: 1,
      actionsOpen: 2,
      toApprove: 0,
      overduePlanned: 0,
      latest: { id: inspectionId, score: 70, grade: 'B', date: day(-10) },
      // Grade B is worth watching; the action past its date is counted but flags nothing.
      level: 'WATCH',
    });
    expect(outlet.inspections.items).toEqual([]);

    // Compared with the latest score that is at least a week older, not with the one from three days ago.
    expect(outlet.score).toEqual({ score: 55, previous: 70, change: -15, date: day(0), previousDate: day(-8), level: 'ATTENTION' });
  });

  it('looks back only as far as asked', async () => {
    // One day back is today alone: nothing was handed in today, and only the 9 am checklist can be due yet.
    const overdueToday = indiaTime() > '09:00' ? 1 : 0;
    const outlet = find(await board(admin, 1), busyId)!;
    expect(outlet.checklists).toMatchObject({ due: overdueToday, submitted: 0, late: 0, level: overdueToday ? 'ATTENTION' : 'NONE' });
    // What is waiting now does not depend on the period.
    expect(outlet.visits.overdue).toBe(1);
    expect((await board(admin, 500)).days).toBe(31);
  });

  it('shows an outlet with nothing recorded as having nothing to do, with the score not yet given', async () => {
    const outlet = find(await board(admin), quietId)!;
    expect(outlet).toMatchObject({ level: 'OK', attention: [], watch: [] });
    expect(outlet.checklists).toMatchObject({ due: 0, percent: null, level: 'NONE' });
    expect(outlet.issues).toMatchObject({ unresolved: 0, level: 'OK', items: [] });
    expect(outlet.licences).toMatchObject({ total: 0, level: 'NONE' });
    expect(outlet.visits).toMatchObject({ overdue: 0, nextDate: null, ratingAverage: null, level: 'OK', items: [] });
    expect(outlet.inspections).toMatchObject({ latest: null, level: 'NONE' });
    expect(outlet.score).toEqual({ score: null, previous: null, change: null, date: null, previousDate: null, level: 'NONE' });
  });

  it('shows a Supervisor only the outlets they work at, and only their own visits there', async () => {
    const theirs = await board(supervisor);
    const worked = await prisma.client.outlet.findMany({
      where: { isActive: true, OR: [{ jobs: { some: { supervisorId } } }, { inspections: { some: { supervisorId } } }] },
      select: { id: true },
    });
    expect(theirs.outlets.map((outlet) => outlet.outletId).sort()).toEqual(worked.map((outlet) => outlet.id).sort());
    expect(theirs.totals.outlets).toBe(worked.length);
    expect(find(theirs, quietId)).toBeUndefined();

    // The overdue visit has no Supervisor, so it is not theirs; the two they did are.
    const outlet = find(theirs, busyId)!;
    expect(outlet.visits).toMatchObject({ overdue: 0, unassigned: 0, awaitingSignOff: 1, reportsToApprove: 1, lowRatings: 1 });
    expect(outlet.visits.items.map((item) => item.id).sort()).toEqual([visitIds.waiting, visitIds.toApprove].sort());
    expect(outlet.inspections.latest?.id).toBe(inspectionId);
  });
});
