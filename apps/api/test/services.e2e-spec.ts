// The service loop: booking, scheduling, the visit, sign-off and the report.
// Runs against the local database with the sample seed loaded and local object
// storage running. Uses the Deccan Biryani outlet and removes what it creates.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-services';
const MARK = 'e2e services';
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e visit photo bytes')]);

type Booking = { id: string; status: string; visitId: string | null; visitDate: string | null; [key: string]: unknown };
type Visit = {
  id: string;
  status: string;
  date: string;
  slot: string | null;
  supervisorId: string | null;
  reportNumber: string | null;
  booked: boolean;
  outletAddress: string | null;
  tasks: { itemId: string; done: boolean | null; note: string | null }[];
  photos: { id: string; kind: string; path: string }[];
  signOff: { name: string; role: string | null; signedAt: string; rating: number | null; comment: string | null } | null;
  technicianNames: string[];
  notes: string | null;
  checkInAt: string | null;
  canRecord: boolean;
  canSignOff: boolean;
  canManage: boolean;
  canReview: boolean;
  correctionNote: string | null;
  [key: string]: unknown;
};

const daysAhead = (days: number) => indiaDate(new Date(Date.now() + days * 86_400_000));

describe('Service loop (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let chef: string;
  let owner: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  let pestItemId: string;
  let bookingId: string;
  let visitId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanUp() {
    const db = prisma.client;
    const jobs = { OR: [{ notes: MARK }, { booking: { notes: MARK } }] };
    await db.document.deleteMany({ where: { attachment: { job: jobs } } });
    await db.attachment.deleteMany({ where: { job: jobs } });
    await db.serviceReport.deleteMany({ where: { job: jobs } });
    await db.job.deleteMany({ where: jobs });
    await db.booking.deleteMany({ where: { notes: MARK } });
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

  const book = (token: string, body: Record<string, unknown> = {}) =>
    http()
      .post('/bookings')
      .set(bearer(token))
      .send({ outletId, catalogItemId: pestItemId, preferredDate: daysAhead(3), preferredSlot: '1000', notes: MARK, ...body });
  const visits = async (token: string, query: Record<string, string> = {}): Promise<Visit[]> =>
    (await http().get('/visits').query(query).set(bearer(token)).expect(200)).body;
  const visit = async (token: string, id = visitId): Promise<Visit> =>
    (await http().get(`/visits/${id}`).set(bearer(token)).expect(200)).body;
  const addPhoto = (token: string, kind: string, id = visitId) =>
    http()
      .post(`/visits/${id}/photos`)
      .set(bearer(token))
      .field('kind', kind)
      .attach('file', PHOTO, { filename: 'visit.jpg', contentType: 'image/jpeg' });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    outletId = (await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } })).id;
    await cleanUp();

    chef = await pinLogin(CODES.kukatpally, PINS.chef);
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

  describe('booking', () => {
    it('shows the Owner the priced catalogue, and keeps it from the Head Chef', async () => {
      const catalog = await http().get('/services/catalog').set(bearer(owner)).expect(200);
      const items = catalog.body as { id: string; serviceCode: string; name: Record<string, string>; pricePaise: number }[];
      expect(items.length).toBeGreaterThanOrEqual(4);
      const pest = items.find((item) => item.serviceCode === 'PEST')!;
      expect(pest.name.en).toBe('Pest control, single visit');
      expect(pest.pricePaise).toBeGreaterThan(0);
      pestItemId = pest.id;

      await http().get('/services/catalog').set(bearer(chef)).expect(403);
      await http().get('/services/catalog').expect(401);
    });

    it('lets the Owner request a service for a day and time', async () => {
      const created = await book(owner).expect(201);
      const booking = created.body as Booking;
      expect(booking).toMatchObject({
        status: 'REQUESTED',
        outletId,
        preferredDate: daysAhead(3),
        preferredSlot: '1000',
        visitId: null,
      });
      expect((booking.serviceName as Record<string, string>).en).toBe('Pest control, single visit');
      bookingId = booking.id;
    });

    it('refuses a request from the wrong person or with a bad date', async () => {
      await book(chef).expect(403);
      await book(otherManager).expect(403);
      await book(owner, { preferredDate: daysAhead(-1) }).expect(400);
      await book(owner, { preferredDate: daysAhead(200) }).expect(400);
      await book(owner, { preferredDate: '2026-02-31x' }).expect(400);
      await book(owner, { preferredSlot: 'MIDNIGHT' }).expect(400);
      await book(owner, { catalogItemId: 'nope' }).expect(400);
    });

    it('lists requests for the restaurant and for ECCS, but not for another restaurant', async () => {
      const mine = (await http().get('/bookings').query({ outletId }).set(bearer(owner)).expect(200)).body as Booking[];
      expect(mine.map((b) => b.id)).toContain(bookingId);
      const waiting = (await http().get('/bookings').query({ status: 'requested' }).set(bearer(admin)).expect(200)).body as Booking[];
      expect(waiting.map((b) => b.id)).toContain(bookingId);
      expect(waiting.every((b) => b.status === 'REQUESTED')).toBe(true);
      const theirs = (await http().get('/bookings').set(bearer(otherManager)).expect(200)).body as Booking[];
      expect(theirs.map((b) => b.id)).not.toContain(bookingId);
    });

    it('lets the restaurant withdraw a request ECCS has not confirmed yet', async () => {
      const extra = (await book(owner).expect(201)).body as Booking;
      await http().post(`/bookings/${extra.id}/cancel`).set(bearer(otherManager)).expect(404);
      const cancelled = await http().post(`/bookings/${extra.id}/cancel`).set(bearer(owner)).expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      await http().post(`/bookings/${extra.id}/cancel`).set(bearer(owner)).expect(409);
    });
  });

  describe('scheduling', () => {
    it('lets ECCS confirm a request, which puts a visit in the diary', async () => {
      const confirm = (token: string, body: Record<string, unknown>) =>
        http().post(`/bookings/${bookingId}/confirm`).set(bearer(token)).send(body);
      const body = { date: daysAhead(4), slot: 'AFTER_CLOSING', supervisorId };

      await confirm(owner, body).expect(403);
      await confirm(supervisor, body).expect(403);
      await confirm(admin, { ...body, date: daysAhead(-2) }).expect(400);
      const me = (await http().get('/auth/me').set(bearer(owner)).expect(200)).body.id as string;
      await confirm(admin, { ...body, supervisorId: me }).expect(400);

      const confirmed = (await confirm(admin, body).expect(200)).body as Booking;
      expect(confirmed).toMatchObject({ status: 'CONFIRMED', visitDate: daysAhead(4), visitSlot: 'AFTER_CLOSING' });
      visitId = confirmed.visitId!;
      expect(visitId).toBeTruthy();
      await confirm(admin, body).expect(409);
    });

    it('stops the restaurant cancelling once ECCS has confirmed', async () => {
      await http().post(`/bookings/${bookingId}/cancel`).set(bearer(owner)).expect(409);
    });

    it('shows the visit to the restaurant, ECCS and the Supervisor it was given to', async () => {
      for (const token of [owner, admin, supervisor]) {
        const found = (await visits(token, { outletId })).find((entry) => entry.id === visitId)!;
        expect(found).toMatchObject({ status: 'ASSIGNED', date: daysAhead(4), slot: 'AFTER_CLOSING', supervisorId, booked: true });
        // The list carries the address, so the Supervisor sees where to go without opening the visit.
        expect(found.outletAddress).toEqual(expect.any(String));
        expect(found.outletAddress).toBe((await visit(token)).outletAddress);
      }
      expect((await visits(otherManager)).map((entry) => entry.id)).not.toContain(visitId);
      await http().get(`/visits/${visitId}`).set(bearer(otherManager)).expect(404);
      await http().get('/visits').set(bearer(chef)).expect(403);

      expect(await visit(owner)).toMatchObject({ canRecord: false, canSignOff: false, canManage: false });
      expect(await visit(supervisor)).toMatchObject({ canRecord: true, canSignOff: false, canManage: false });
      expect(await visit(admin)).toMatchObject({ canRecord: true, canSignOff: false, canManage: true });
    });

    it('lets ECCS move the visit and change who does it', async () => {
      const change = (token: string, body: Record<string, unknown>) =>
        http().patch(`/visits/${visitId}`).set(bearer(token)).send(body);
      await change(owner, { date: daysAhead(5) }).expect(403);
      await change(supervisor, { date: daysAhead(5) }).expect(403);

      const moved = (await change(admin, { date: daysAhead(5), slot: '1800' }).expect(200)).body as Visit;
      expect(moved).toMatchObject({ date: daysAhead(5), slot: '1800', status: 'ASSIGNED', supervisorId });

      const unassigned = (await change(admin, { supervisorId: null }).expect(200)).body as Visit;
      expect(unassigned).toMatchObject({ status: 'SCHEDULED', supervisorId: null });
      // Off the Supervisor's list once it is no longer theirs.
      await http().get(`/visits/${visitId}`).set(bearer(supervisor)).expect(404);

      const back = (await change(admin, { supervisorId }).expect(200)).body as Visit;
      expect(back).toMatchObject({ status: 'ASSIGNED', supervisorId, date: daysAhead(5) });

      const people = (await http().get('/services/supervisors').set(bearer(admin)).expect(200)).body as { id: string }[];
      expect(people.map((person) => person.id)).toContain(supervisorId);
      await http().get('/services/supervisors').set(bearer(owner)).expect(403);
    });
  });

  describe('the visit', () => {
    it('needs a check-in before anything is recorded', async () => {
      const [task] = (await visit(supervisor)).tasks;
      expect(task).toBeDefined();
      await http().put(`/visits/${visitId}/tasks/${task!.itemId}`).set(bearer(supervisor)).send({ done: true }).expect(409);
      await addPhoto(supervisor, 'AFTER').expect(409);
      await http().post(`/visits/${visitId}/complete`).set(bearer(supervisor)).expect(409);

      await http().post(`/visits/${visitId}/check-in`).set(bearer(owner)).send({}).expect(403);
      const started = (await http().post(`/visits/${visitId}/check-in`).set(bearer(supervisor)).send({}).expect(200)).body as Visit;
      expect(started.status).toBe('IN_PROGRESS');
      expect(started.checkInAt).toBeTruthy();
      await http().post(`/visits/${visitId}/check-in`).set(bearer(supervisor)).send({}).expect(409);
      // Once started, ECCS can no longer move or cancel it.
      await http().patch(`/visits/${visitId}`).set(bearer(admin)).send({ date: daysAhead(6) }).expect(409);
      await http().post(`/visits/${visitId}/cancel`).set(bearer(admin)).expect(409);
    });

    it('records the tasks, the team, notes and photos', async () => {
      const tasks = (await visit(supervisor)).tasks;
      const answer = (itemId: string, body: Record<string, unknown>) =>
        http().put(`/visits/${visitId}/tasks/${itemId}`).set(bearer(supervisor)).send(body);

      await answer('not-a-task', { done: true }).expect(404);
      // A task left undone needs a reason.
      await answer(tasks[0]!.itemId, { done: false }).expect(400);
      await answer(tasks[0]!.itemId, { done: false, note: 'Store room was locked' }).expect(200);
      for (const task of tasks.slice(1, -1)) await answer(task.itemId, { done: true }).expect(200);

      // One task is still unanswered.
      await http().post(`/visits/${visitId}/complete`).set(bearer(supervisor)).expect(400);
      const last = tasks.at(-1)!;
      const answered = (await answer(last.itemId, { done: true }).expect(200)).body as Visit;
      expect(answered.tasks[0]).toMatchObject({ done: false, note: 'Store room was locked' });
      expect(answered.tasks.every((task) => task.done !== null)).toBe(true);

      // No photo of the finished work yet.
      await http().post(`/visits/${visitId}/complete`).set(bearer(supervisor)).expect(400);
      await addPhoto(supervisor, 'SELFIE').expect(400);
      await addPhoto(owner, 'AFTER').expect(403);
      const before = (await addPhoto(supervisor, 'BEFORE').expect(200)).body as Visit;
      expect(before.photos).toHaveLength(1);
      const both = (await addPhoto(supervisor, 'AFTER').expect(200)).body as Visit;
      expect(both.photos.map((photo) => photo.kind).sort()).toEqual(['AFTER', 'BEFORE']);
      await http().get(both.photos[0]!.path).expect(200).expect('Content-Type', /image\/jpeg/);

      const extra = (await addPhoto(supervisor, 'BEFORE').expect(200)).body as Visit;
      const removed = (
        await http().delete(`/visits/${visitId}/photos/${extra.photos.at(-1)!.id}`).set(bearer(supervisor)).expect(200)
      ).body as Visit;
      expect(removed.photos).toHaveLength(2);

      const record = await http()
        .patch(`/visits/${visitId}/record`)
        .set(bearer(supervisor))
        .send({ technicianNames: ['Ravi', 'Suresh', 'Ravi'], notes: 'Gel bait applied under the sinks.' })
        .expect(200);
      expect(record.body).toMatchObject({ technicianNames: ['Ravi', 'Suresh'], notes: 'Gel bait applied under the sinks.' });
    });

    it('finishes with a report number and goes to ECCS to be checked', async () => {
      const done = (await http().post(`/visits/${visitId}/complete`).set(bearer(supervisor)).expect(200)).body as Visit;
      expect(done.status).toBe('IN_REVIEW');
      expect(done.reportNumber).toMatch(/^SR-\d{4}-\d{5}$/);
      expect(done).toMatchObject({ canRecord: false, canSignOff: false });

      // Nothing can be changed afterwards.
      await http().put(`/visits/${visitId}/tasks/${done.tasks[0]!.itemId}`).set(bearer(supervisor)).send({ done: true }).expect(409);
      await addPhoto(supervisor, 'AFTER').expect(409);
      await http().post(`/visits/${visitId}/complete`).set(bearer(supervisor)).expect(409);

      const bookings = (await http().get('/bookings').query({ outletId }).set(bearer(owner)).expect(200)).body as Booking[];
      expect(bookings.find((b) => b.id === bookingId)!.status).toBe('COMPLETED');
    });
  });

  describe('ECCS checks the report', () => {
    const approve = (token: string) => http().post(`/visits/${visitId}/approve-report`).set(bearer(token));
    const sendBack = (token: string, note: unknown = 'The after photo is of the wrong area.') =>
      http().post(`/visits/${visitId}/return-report`).set(bearer(token)).send({ note });

    it('keeps the report from the restaurant until ECCS approves it', async () => {
      const theirs = await visit(owner);
      expect(theirs).toMatchObject({ status: 'IN_REVIEW', canSignOff: false, canReview: false });
      expect(theirs.photos).toEqual([]);
      expect(theirs.tasks).toEqual([]);
      expect(theirs.notes).toBeNull();
      expect(theirs.technicianNames).toEqual([]);
      await http().post(`/visits/${visitId}/sign-off`).set(bearer(owner)).send({ rating: 5 }).expect(409);

      // ECCS and the Supervisor still see everything.
      expect((await visit(supervisor)).photos).toHaveLength(2);
      expect(await visit(admin)).toMatchObject({ status: 'IN_REVIEW', canReview: true });
    });

    it('lets ECCS send it back to the Supervisor, who finishes again under the same number', async () => {
      await sendBack(owner).expect(403);
      await sendBack(supervisor).expect(403);
      const number = (await visit(admin)).reportNumber;

      // ECCS must say what to correct.
      await sendBack(admin, '').expect(400);
      await sendBack(admin, null).expect(400);
      await sendBack(admin, 'x').expect(400);

      const reopened = (await sendBack(admin).expect(200)).body as Visit;
      expect(reopened).toMatchObject({ status: 'IN_PROGRESS', canReview: false });
      // The Supervisor is told; the restaurant is not.
      expect((await visit(supervisor)).correctionNote).toBe('The after photo is of the wrong area.');
      expect((await visit(owner)).correctionNote).toBeNull();
      await sendBack(admin).expect(409);
      await approve(admin).expect(409);

      await http().patch(`/visits/${visitId}/record`).set(bearer(supervisor)).send({ notes: 'Gel bait applied under the sinks.' }).expect(200);
      const again = (await http().post(`/visits/${visitId}/complete`).set(bearer(supervisor)).expect(200)).body as Visit;
      expect(again).toMatchObject({ status: 'IN_REVIEW', reportNumber: number });
    });

    it('lets ECCS approve it, which releases it to the restaurant', async () => {
      await approve(owner).expect(403);
      await approve(supervisor).expect(403);
      const approved = (await approve(admin).expect(200)).body as Visit;
      expect(approved).toMatchObject({ status: 'COMPLETED', canReview: false, correctionNote: null });
      await approve(admin).expect(409);

      const theirs = await visit(owner);
      expect(theirs).toMatchObject({ status: 'COMPLETED', canSignOff: true });
      expect(theirs.photos).toHaveLength(2);
      expect(theirs.tasks.length).toBeGreaterThan(0);
    });
  });

  describe('sign-off and the report', () => {
    it('is for the restaurant’s Owner or Manager only', async () => {
      expect((await visit(owner)).canSignOff).toBe(true);
      const signOff = (token: string, body: Record<string, unknown> = { rating: 4, comment: '  Clean and on time.  ' }) =>
        http().post(`/visits/${visitId}/sign-off`).set(bearer(token)).send(body);
      await signOff(chef).expect(403);
      await signOff(supervisor).expect(403);
      await signOff(admin).expect(403);
      await signOff(otherManager).expect(404);

      // A rating out of five is part of signing off; the comment is optional.
      await signOff(owner, {}).expect(400);
      await signOff(owner, { rating: 0 }).expect(400);
      await signOff(owner, { rating: 6 }).expect(400);
      await signOff(owner, { rating: 4.5 }).expect(400);

      const signed = (await signOff(owner).expect(200)).body as Visit;
      expect(signed.signOff).toMatchObject({ rating: 4, comment: 'Clean and on time.' });
      expect(signed.status).toBe('APPROVED');
      expect(signed.signOff).toMatchObject({ role: 'OWNER', name: expect.any(String), signedAt: expect.any(String) });
      expect(signed.canSignOff).toBe(false);
      await signOff(owner).expect(409);
    });

    it('keeps the finished visit as a report the restaurant and ECCS can open', async () => {
      expect((await visits(owner, { outletId })).map((entry) => entry.id)).not.toContain(visitId);
      const closed = (await visits(owner, { outletId, state: 'closed' })).find((entry) => entry.id === visitId)!;
      expect(closed.status).toBe('APPROVED');
      expect(closed.reportNumber).toMatch(/^SR-/);

      for (const token of [owner, admin, supervisor]) {
        const report = await visit(token);
        expect(report.photos).toHaveLength(2);
        expect(report.technicianNames).toEqual(['Ravi', 'Suresh']);
        // ECCS and the Supervisor see what the restaurant thought of the visit.
        expect(report.signOff).toMatchObject({ rating: 4, comment: 'Clean and on time.' });
      }
    });
  });

  describe('the report as a PDF', () => {
    const pdf = (token: string, id = visitId) => http().post(`/visits/${id}/report-pdf`).set(bearer(token));

    it('is made once the visit is signed off, for the restaurant, ECCS and the Supervisor', async () => {
      await pdf(chef).expect(403);
      await pdf(otherManager).expect(404);

      const link = (await pdf(owner).expect(200)).body as { path: string };
      const file = await http().get(link.path).buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      }).expect(200).expect('Content-Type', /application\/pdf/);
      expect((file.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect((file.body as Buffer).length).toBeGreaterThan(5000);

      // Asking again gives the same file, not a second copy.
      const again = (await pdf(admin).expect(200)).body as { path: string };
      expect(again.path.split('?')[0]).toBe(link.path.split('?')[0]);
      await pdf(supervisor).expect(200);
    }, 60_000);

    it('is filed in the outlet\u2019s documents', async () => {
      const documents = (await http().get('/documents').query({ outletId }).set(bearer(owner)).expect(200)).body as {
        title: string;
        category: string;
      }[];
      const filed = documents.filter((document) => document.title.startsWith('Service report SR-') && document.category === 'report');
      expect(filed.length).toBeGreaterThanOrEqual(1);
    });

    it('does not exist before sign-off', async () => {
      const other = (await visits(owner, { outletId }))[0];
      if (other) await pdf(owner, other.id).expect(409);
    });
  });

  describe('visits ECCS adds itself', () => {
    it('can be scheduled without a request, and cancelled before they start', async () => {
      const create = (token: string, body: Record<string, unknown>) => http().post('/visits').set(bearer(token)).send(body);
      const body = { outletId, serviceCode: 'SAFETY_INSPECTION', date: daysAhead(7), slot: '1400' };
      await create(owner, body).expect(403);
      await create(supervisor, body).expect(403);
      await create(admin, { ...body, serviceCode: 'NOPE' }).expect(400);

      const created = (await create(admin, body).expect(201)).body as Visit;
      await prisma.client.job.update({ where: { id: created.id }, data: { notes: MARK } });
      expect(created).toMatchObject({ status: 'SCHEDULED', booked: false, supervisorId: null, slot: '1400' });
      // Nobody's yet, so not on the Supervisor's list.
      expect((await visits(supervisor)).map((entry) => entry.id)).not.toContain(created.id);
      expect((await visits(owner, { outletId })).map((entry) => entry.id)).toContain(created.id);

      const cancelled = (await http().post(`/visits/${created.id}/cancel`).set(bearer(admin)).expect(200)).body as Visit;
      expect(cancelled.status).toBe('CANCELLED');
      await http().post(`/visits/${created.id}/check-in`).set(bearer(admin)).send({}).expect(409);
      expect((await visits(owner, { outletId })).map((entry) => entry.id)).not.toContain(created.id);
    });

    it('cancels the booking with the visit', async () => {
      const booking = (await book(owner).expect(201)).body as Booking;
      const confirmed = (
        await http().post(`/bookings/${booking.id}/confirm`).set(bearer(admin)).send({ date: daysAhead(8), slot: '1000' }).expect(200)
      ).body as Booking;
      expect(confirmed.status).toBe('CONFIRMED');
      await http().post(`/visits/${confirmed.visitId}/cancel`).set(bearer(admin)).expect(200);
      const after = (await http().get('/bookings').query({ outletId }).set(bearer(owner)).expect(200)).body as Booking[];
      expect(after.find((b) => b.id === booking.id)).toMatchObject({ status: 'CANCELLED', visitId: null });
    });
  });
});
