// Work done on a phone without signal is sent later, and on a weak signal the
// same request can arrive twice (the first reply was lost, so the phone sends it
// again). These tests prove that every action a Supervisor's phone queues for a
// service visit and for an inspection can be repeated without harm, and that the
// phone's own time for the action is what gets recorded.
// Runs against the local database with the sample seed loaded and local object
// storage running. Uses the Deccan Biryani outlet and removes what it creates.

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { phoneTime, sameMoment } from './../src/services/services.service.js';

const OUTLET_CODE = 'DECCA-KP6R3T';
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-offline-replays';
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e offline photo bytes')]);

type Visit = {
  id: string;
  status: string;
  checkInAt: string | null;
  completedAt: string | null;
  reportNumber: string | null;
  notes: string | null;
  technicianNames: string[];
  tasks: { itemId: string; done: boolean | null; note: string | null }[];
  photos: { id: string; kind: string }[];
};
type Check = { itemId: string; answer: string | null; note: string | null; complete: boolean; photos: { id: string }[] };
type Inspection = {
  id: string;
  status: string;
  date: string;
  answered: number;
  completedAt: string | null;
  reportNumber: string | null;
  overallScore: number | null;
  sections: { checks: Check[] }[];
};

const daysAhead = (days: number) => indiaDate(new Date(Date.now() + days * 86_400_000));
/** A time on the phone some minutes ago, as the phone would send it. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe('The phone’s clock', () => {
  it('is believed unless it is ahead of the server', () => {
    const now = new Date('2026-10-07T10:00:00.000Z');
    expect(phoneTime('2026-10-07T07:30:00.000Z', now).toISOString()).toBe('2026-10-07T07:30:00.000Z');
    expect(phoneTime('2026-10-07T10:04:00.000Z', now).toISOString()).toBe('2026-10-07T10:04:00.000Z');
    expect(phoneTime('2026-10-07T11:00:00.000Z', now)).toBe(now);
    expect(phoneTime(undefined, now)).toBe(now);
    expect(phoneTime('not a time', now)).toBe(now);
  });

  it('recognises the same moment sent again, and nothing else', () => {
    const stored = new Date('2026-10-07T07:30:00.000Z');
    expect(sameMoment(stored, '2026-10-07T07:30:00.000Z')).toBe(true);
    expect(sameMoment(stored, '2026-10-07T07:30:00.001Z')).toBe(false);
    expect(sameMoment(stored, undefined)).toBe(false);
    expect(sameMoment(null, '2026-10-07T07:30:00.000Z')).toBe(false);
  });
});

describe('Replays from a phone that was without signal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  const visitIds: string[] = [];
  const inspectionIds: string[] = [];
  const startedAt = new Date();

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanUp() {
    const db = prisma.client;
    await db.attachment.deleteMany({ where: { jobId: { in: visitIds } } });
    await db.serviceReport.deleteMany({ where: { jobId: { in: visitIds } } });
    await db.job.deleteMany({ where: { id: { in: visitIds } } });
    await db.attachment.deleteMany({ where: { inspectionFinding: { inspectionId: { in: inspectionIds } } } });
    await db.inspection.deleteMany({ where: { id: { in: inspectionIds } } });
    // The notifications these visits caused.
    const recent = await db.notification.findMany({ where: { createdAt: { gte: startedAt } }, select: { id: true, data: true } });
    const mine = recent.filter((row) => visitIds.some((id) => JSON.stringify(row.data ?? '').includes(id)));
    await db.notification.deleteMany({ where: { id: { in: mine.map((row) => row.id) } } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  }

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const session = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE })
      .expect(200);
    return session.body.token as string;
  }

  /** How many notifications mention this visit. */
  async function notificationsAbout(visitId: string): Promise<number> {
    const recent = await prisma.client.notification.findMany({ where: { createdAt: { gte: startedAt } }, select: { data: true } });
    return recent.filter((row) => JSON.stringify(row.data ?? '').includes(visitId)).length;
  }

  async function newVisit(): Promise<Visit> {
    const created = await http()
      .post('/visits')
      .set(bearer(admin))
      .send({ outletId, serviceCode: 'PEST', date: daysAhead(1), slot: '1000', supervisorId })
      .expect(201);
    visitIds.push(created.body.id as string);
    return created.body as Visit;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    outletId = (await prisma.client.outlet.findUniqueOrThrow({ where: { code: OUTLET_CODE } })).id;
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    supervisorId = (await http().get('/auth/me').set(bearer(supervisor)).expect(200)).body.id;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('a service visit', () => {
    let visitId: string;
    let tasks: Visit['tasks'];
    const arrived = minutesAgo(90);
    const finished = minutesAgo(20);
    const afterPhoto = randomUUID();

    const post = (path: string, body?: Record<string, unknown>) => {
      const call = http().post(`/visits/${visitId}/${path}`).set(bearer(supervisor));
      return body === undefined ? call : call.send(body);
    };
    const photo = (kind: string, fields: Record<string, string> = {}, id = visitId) => {
      let call = http().post(`/visits/${id}/photos`).set(bearer(supervisor)).field('kind', kind);
      for (const [name, value] of Object.entries(fields)) call = call.field(name, value);
      return call.attach('file', PHOTO, { filename: 'visit.jpg', contentType: 'image/jpeg' });
    };
    const get = async (): Promise<Visit> => (await http().get(`/visits/${visitId}`).set(bearer(supervisor)).expect(200)).body;

    beforeAll(async () => {
      const created = await newVisit();
      visitId = created.id;
      tasks = created.tasks;
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('takes the check-in once, at the time on the phone, however often it is sent', async () => {
      await post('check-in', { at: 'yesterday' }).expect(400);
      const first = (await post('check-in', { at: arrived }).expect(200)).body as Visit;
      expect(first).toMatchObject({ status: 'IN_PROGRESS', checkInAt: arrived });
      const told = await notificationsAbout(visitId);

      const again = (await post('check-in', { at: arrived }).expect(200)).body as Visit;
      expect(again).toMatchObject({ status: 'IN_PROGRESS', checkInAt: arrived });
      // Nobody is told twice that the visit started.
      expect(await notificationsAbout(visitId)).toBe(told);

      // A different check-in (another phone, another moment, or none given) is still refused.
      await post('check-in', { at: minutesAgo(5) }).expect(409);
      await post('check-in', {}).expect(409);
    });

    it('keeps one answer per task when the same answer arrives twice', async () => {
      const answer = (itemId: string, body: Record<string, unknown>) =>
        http().put(`/visits/${visitId}/tasks/${itemId}`).set(bearer(supervisor)).send(body);
      const notDone = { done: false, note: 'Area locked or blocked' };
      await answer(tasks[0]!.itemId, notDone).expect(200);
      const repeated = (await answer(tasks[0]!.itemId, notDone).expect(200)).body as Visit;
      expect(repeated.tasks[0]).toMatchObject(notDone);
      for (const task of tasks.slice(1)) {
        await answer(task.itemId, { done: true }).expect(200);
        await answer(task.itemId, { done: true }).expect(200);
      }
      const all = await get();
      expect(all.tasks).toHaveLength(tasks.length);
      expect(all.tasks.every((task) => task.done !== null)).toBe(true);
      expect(await prisma.client.jobTaskResponse.count({ where: { jobId: visitId } })).toBe(tasks.length);
    });

    it('keeps the team and notes the same when they are sent twice', async () => {
      const record = { technicianNames: ['Ravi', 'Suresh'], notes: 'Gel bait applied under the sinks.' };
      const send = () => http().patch(`/visits/${visitId}/record`).set(bearer(supervisor)).send(record).expect(200);
      await send();
      expect((await send()).body).toMatchObject(record);
    });

    it('stores a photo once when it is sent twice, with the time it was taken', async () => {
      const taken = minutesAgo(30);
      const fields = { id: afterPhoto, capturedAt: taken };
      await photo('AFTER', { id: 'not-an-id' }).expect(400);
      const first = (await photo('AFTER', fields).expect(200)).body as Visit;
      expect(first.photos.map((entry) => entry.id)).toEqual([afterPhoto]);
      const again = (await photo('AFTER', fields).expect(200)).body as Visit;
      expect(again.photos.map((entry) => entry.id)).toEqual([afterPhoto]);

      const stored = await prisma.client.attachment.findMany({ where: { jobId: visitId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]!.capturedAt?.toISOString()).toBe(taken);

      // The same id cannot be used to put the photo on another visit.
      const other = await newVisit();
      await photo('AFTER', fields, other.id).expect(409);
    });

    it('treats removing a photo twice as removing it once', async () => {
      const extra = randomUUID();
      const added = (await photo('BEFORE', { id: extra }).expect(200)).body as Visit;
      expect(added.photos).toHaveLength(2);
      const remove = () => http().delete(`/visits/${visitId}/photos/${extra}`).set(bearer(supervisor)).expect(200);
      expect(((await remove()).body as Visit).photos.map((entry) => entry.id)).toEqual([afterPhoto]);
      expect(((await remove()).body as Visit).photos.map((entry) => entry.id)).toEqual([afterPhoto]);
    });

    it('finishes once, at the time on the phone, however often Finish is sent', async () => {
      const first = (await post('complete', { at: finished }).expect(200)).body as Visit;
      expect(first).toMatchObject({ status: 'COMPLETED', completedAt: finished });
      expect(first.reportNumber).toMatch(/^SR-\d{4}-\d{5}$/);
      const told = await notificationsAbout(visitId);

      const again = (await post('complete', { at: finished }).expect(200)).body as Visit;
      expect(again).toMatchObject({ status: 'COMPLETED', completedAt: finished, reportNumber: first.reportNumber });
      expect(await prisma.client.serviceReport.count({ where: { jobId: visitId } })).toBe(1);
      expect(await notificationsAbout(visitId)).toBe(told);

      // The photo sent once more after the visit is finished is still recognised, not refused.
      await photo('AFTER', { id: afterPhoto }).expect(200);
      // A Finish from another moment, or with no time, is refused as before; so is any new work.
      await post('complete', { at: minutesAgo(1) }).expect(409);
      await post('complete').expect(409);
      await photo('AFTER', { id: randomUUID() }).expect(409);
      await http().put(`/visits/${visitId}/tasks/${tasks[0]!.itemId}`).set(bearer(supervisor)).send({ done: true }).expect(409);
    });

    it('still finishes without a time, from the console or an older app', async () => {
      const plain = await newVisit();
      visitId = plain.id;
      const started = (await post('check-in', {}).expect(200)).body as Visit;
      expect(Date.now() - Date.parse(started.checkInAt!)).toBeLessThan(60_000);
      for (const task of plain.tasks) {
        await http().put(`/visits/${visitId}/tasks/${task.itemId}`).set(bearer(supervisor)).send({ done: true }).expect(200);
      }
      await photo('AFTER').expect(200);
      const done = (await post('complete').expect(200)).body as Visit;
      expect(done.status).toBe('COMPLETED');
      expect(Date.now() - Date.parse(done.completedAt!)).toBeLessThan(60_000);
    });

    it('refuses work for a visit ECCS cancelled or gave to someone else meanwhile', async () => {
      // The Supervisor checked in without signal; before it could be sent, ECCS cancelled the visit.
      const cancelled = await newVisit();
      await http().post(`/visits/${cancelled.id}/cancel`).set(bearer(admin)).expect(200);
      visitId = cancelled.id;
      await post('check-in', { at: minutesAgo(10) }).expect(409);
      await photo('BEFORE', { id: randomUUID() }).expect(409);

      // Or took it off this Supervisor: to them it is no longer there.
      const moved = await newVisit();
      await http().patch(`/visits/${moved.id}`).set(bearer(admin)).send({ supervisorId: null }).expect(200);
      visitId = moved.id;
      await post('check-in', { at: minutesAgo(10) }).expect(404);
      await http().get(`/visits/${moved.id}`).set(bearer(supervisor)).expect(404);
    });
  });

  describe('an inspection', () => {
    let inspectionId: string;
    let checks: Check[];
    const finished = minutesAgo(15);
    const findingPhoto = randomUUID();

    const answer = (itemId: string, body: Record<string, unknown>) =>
      http().put(`/inspections/${inspectionId}/checks/${itemId}`).set(bearer(supervisor)).send(body);
    const photo = (itemId: string, fields: Record<string, string> = {}) => {
      let call = http().post(`/inspections/${inspectionId}/checks/${itemId}/photos`).set(bearer(supervisor));
      for (const [name, value] of Object.entries(fields)) call = call.field(name, value);
      return call.attach('file', PHOTO, { filename: 'finding.jpg', contentType: 'image/jpeg' });
    };
    const finish = (body?: Record<string, unknown>) => {
      const call = http().post(`/inspections/${inspectionId}/finish`).set(bearer(supervisor));
      return body === undefined ? call : call.send(body);
    };
    const get = async (): Promise<Inspection> =>
      (await http().get(`/inspections/${inspectionId}`).set(bearer(supervisor)).expect(200)).body;

    beforeAll(async () => {
      const created = await http().post('/inspections').set(bearer(admin)).send({ outletId, supervisorId }).expect(201);
      inspectionId = created.body.id as string;
      inspectionIds.push(inspectionId);
      checks = (created.body as Inspection).sections.flatMap((section) => section.checks);
      expect(checks).toHaveLength(92);
    });

    it('dates the inspection by when the first check was answered on the phone', async () => {
      // Answered yesterday evening with no signal; it reaches the server today.
      const yesterday = new Date(Date.now() - 20 * 3_600_000).toISOString();
      await answer(checks[0]!.itemId, { answer: 'COMPLIANT', at: 'yesterday' }).expect(400);
      const first = await answer(checks[0]!.itemId, { answer: 'COMPLIANT', at: yesterday }).expect(200);
      expect(first.body).toMatchObject({ status: 'IN_PROGRESS', answered: 1 });
      const again = await answer(checks[0]!.itemId, { answer: 'COMPLIANT', at: yesterday }).expect(200);
      expect(again.body).toMatchObject({ status: 'IN_PROGRESS', answered: 1 });
      expect((await get()).date).toBe(indiaDate(new Date(yesterday)));
      expect(await prisma.client.inspectionResponse.count({ where: { inspectionId } })).toBe(1);
    });

    it('keeps one non-compliance when its details arrive twice', async () => {
      const details = {
        answer: 'NON_COMPLIANT',
        note: 'Grease on the wall behind the fryer',
        severity: 'MEDIUM',
        correctiveAction: 'Degrease the wall',
        dueDate: daysAhead(7),
        at: minutesAgo(40),
      };
      const { at: _at, ...kept } = details;
      await answer(checks[1]!.itemId, details).expect(200);
      const again = await answer(checks[1]!.itemId, details).expect(200);
      expect(again.body.check).toMatchObject({ ...kept, complete: false, photos: [] });
      expect(await prisma.client.inspectionFinding.count({ where: { inspectionId } })).toBe(1);
    });

    it('stores a photo once when it is sent twice', async () => {
      const taken = minutesAgo(35);
      const fields = { id: findingPhoto, capturedAt: taken };
      await photo(checks[1]!.itemId, { id: 'not-an-id' }).expect(400);
      const first = await photo(checks[1]!.itemId, fields).expect(200);
      expect(first.body.check.photos.map((entry: { id: string }) => entry.id)).toEqual([findingPhoto]);
      const again = await photo(checks[1]!.itemId, fields).expect(200);
      expect(again.body.check).toMatchObject({ complete: true });
      expect(again.body.check.photos.map((entry: { id: string }) => entry.id)).toEqual([findingPhoto]);

      const stored = await prisma.client.attachment.findMany({ where: { inspectionFinding: { inspectionId } } });
      expect(stored).toHaveLength(1);
      expect(stored[0]!.capturedAt?.toISOString()).toBe(taken);
    });

    it('treats removing a photo twice as removing it once, when the phone names the check', async () => {
      const itemId = checks[1]!.itemId;
      const extra = randomUUID();
      expect((await photo(itemId, { id: extra }).expect(200)).body.check.photos).toHaveLength(2);
      const remove = (query: Record<string, string> = { itemId }) =>
        http().delete(`/inspections/${inspectionId}/photos/${extra}`).query(query).set(bearer(supervisor));
      expect((await remove().expect(200)).body.check.photos.map((entry: { id: string }) => entry.id)).toEqual([findingPhoto]);
      expect((await remove().expect(200)).body.check.photos.map((entry: { id: string }) => entry.id)).toEqual([findingPhoto]);
      // Without the check, or with one that is not part of the inspection, an unknown photo is still an error.
      await remove({}).expect(404);
      await remove({ itemId: 'not-a-check' }).expect(404);
    });

    it('finishes once, at the time on the phone, however often Finish is sent', async () => {
      for (const check of checks.slice(2)) await answer(check.itemId, { answer: 'COMPLIANT', at: minutesAgo(30) }).expect(200);

      const first = (await finish({ at: finished }).expect(200)).body as Inspection;
      expect(first).toMatchObject({ status: 'SUBMITTED', completedAt: finished, answered: 92 });
      expect(first.reportNumber).toMatch(/^IR-\d{4}-\d{5}$/);

      const again = (await finish({ at: finished }).expect(200)).body as Inspection;
      expect(again).toMatchObject({
        status: 'SUBMITTED',
        completedAt: finished,
        reportNumber: first.reportNumber,
        overallScore: first.overallScore,
      });

      // The photo sent once more after finishing is still recognised, not refused.
      await photo(checks[1]!.itemId, { id: findingPhoto }).expect(200);
      // A Finish from another moment, or with no time, is refused as before; so is any new work.
      await finish({ at: minutesAgo(1) }).expect(409);
      await finish().expect(409);
      await answer(checks[0]!.itemId, { answer: 'NOT_APPLICABLE' }).expect(409);
      await photo(checks[1]!.itemId, { id: randomUUID() }).expect(409);
    }, 60_000);

    it('still recognises the same Finish after ECCS has approved the report', async () => {
      // Approved straight in the database, so no report PDF is made and filed for a test.
      await prisma.client.inspection.update({ where: { id: inspectionId }, data: { status: 'APPROVED', approvedAt: new Date() } });
      const again = (await finish({ at: finished }).expect(200)).body as Inspection;
      expect(again.status).toBe('APPROVED');
      await answer(checks[0]!.itemId, { answer: 'NOT_APPLICABLE' }).expect(409);
    });

    it('refuses answers for an inspection ECCS removed or gave to someone else meanwhile', async () => {
      const planned = await http().post('/inspections').set(bearer(admin)).send({ outletId, supervisorId }).expect(201);
      const gone = planned.body.id as string;
      inspectionIds.push(gone);
      await http().delete(`/inspections/${gone}`).set(bearer(admin)).expect(204);
      await http()
        .put(`/inspections/${gone}/checks/${checks[0]!.itemId}`)
        .set(bearer(supervisor))
        .send({ answer: 'COMPLIANT', at: minutesAgo(10) })
        .expect(404);
    });
  });
});
