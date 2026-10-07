// Notifications: each person's list, who is told about what, and reminders.
// Runs against the local database with the sample seed loaded and local object
// storage running. Works at the Spice Route, Jubilee Hills outlet, which has an
// Owner, a Manager and a Head Chef, and removes what it creates, including
// every notification written while it ran.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { NotificationsService } from './../src/notifications/notifications.service.js';
import { NotifyService } from './../src/notifications/notify.service.js';
import { RemindersService } from './../src/notifications/reminders.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { jubilee: 'SPICE-JH2K7M', kukatpally: 'DECCA-KP6R3T' };
const PINS = { owner: '2580', manager: '4821', chef: '7306', otherOwner: '3917' };
const PHONES = { superAdmin: '+919000000001', admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-notifications';
const MARK = 'e2e notifications';
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e notification photo bytes')]);

type Note = {
  id: string;
  type: string | null;
  title: string;
  body: string;
  params: Record<string, unknown>;
  link: { kind: string; visitId?: string; issueId?: string; runId?: string; outletId?: string } | null;
  createdAt: string;
  readAt: string | null;
};
type Page = { items: Note[]; nextCursor: string | null; unreadCount: number };
type Visit = { id: string; status: string; reportNumber: string | null; tasks: { itemId: string }[] };

const daysAhead = (days: number) => indiaDate(new Date(Date.now() + days * 86_400_000));

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let reminders: RemindersService;
  let startedAt: Date;
  let outletId: string;
  let outletName: string;
  let chefName: string;
  let serviceCode: string;

  // Session tokens, and the same people's ids.
  let owner: string;
  let manager: string;
  let chef: string;
  let otherOwner: string;
  let superAdmin: string;
  let admin: string;
  let supervisor: string;
  let ownerId: string;
  let managerId: string;
  let chefId: string;
  let supervisorId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanUp() {
    const db = prisma.client;
    const jobs = { OR: [{ notes: MARK }, { booking: { notes: MARK } }] };
    await db.document.deleteMany({ where: { attachment: { job: jobs } } });
    await db.attachment.deleteMany({ where: { job: jobs } });
    await db.serviceReport.deleteMany({ where: { job: jobs } });
    await db.certificate.deleteMany({ where: { job: jobs } });
    await db.signOff.deleteMany({ where: { job: jobs } });
    await db.jobTaskResponse.deleteMany({ where: { job: jobs } });
    await db.job.deleteMany({ where: jobs });
    await db.booking.deleteMany({ where: { notes: MARK } });
    await db.issue.deleteMany({ where: { description: { contains: MARK } } });
    await db.licence.deleteMany({ where: { name: MARK } });
    // The checklists this suite makes are the only ones with this name.
    const lists = await db.outletChecklist.findMany({
      where: { template: { outletId: { not: null }, title: { path: ['en'], string_starts_with: MARK } } },
      select: { id: true, templateId: true },
    });
    await db.checklistRun.deleteMany({ where: { outletChecklistId: { in: lists.map((list) => list.id) } } });
    await db.checklistItem.deleteMany({ where: { templateId: { in: lists.map((list) => list.templateId) } } });
    await db.outletChecklist.deleteMany({ where: { id: { in: lists.map((list) => list.id) } } });
    await db.checklistTemplate.deleteMany({ where: { id: { in: lists.map((list) => list.templateId) } } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
    // Everything written to anyone's list while this suite ran.
    if (startedAt) await db.notification.deleteMany({ where: { createdAt: { gte: startedAt } } });
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

  const idOf = async (token: string): Promise<string> => (await http().get('/auth/me').set(bearer(token)).expect(200)).body.id;

  const page = async (token: string, query: Record<string, string | number> = { limit: 100 }): Promise<Page> =>
    (await http().get('/notifications').query(query).set(bearer(token)).expect(200)).body;

  /** The person's notifications of one kind that are about one thing (a visit, an issue, a checklist). */
  async function told(token: string, type: string, about: string): Promise<Note[]> {
    const { items } = await page(token);
    return items.filter(
      (note) => note.type === type && [note.link?.visitId, note.link?.issueId, note.link?.runId].includes(about),
    );
  }

  /** Checks who was told and who was not. */
  async function expectTold(type: string, about: string, people: { yes: string[]; no: string[] }) {
    for (const token of people.yes) expect(await told(token, type, about)).toHaveLength(1);
    for (const token of people.no) expect(await told(token, type, about)).toHaveLength(0);
  }

  /** ECCS puts a visit in the diary for the outlet, given to the Supervisor. */
  async function addVisit(date: string): Promise<string> {
    const created = await http()
      .post('/visits')
      .set(bearer(admin))
      .send({ outletId, serviceCode, date, slot: '1000', supervisorId })
      .expect(201);
    const id = (created.body as Visit).id;
    await prisma.client.job.update({ where: { id }, data: { notes: MARK } });
    return id;
  }

  /** The Supervisor does a visit from check-in to finish. */
  async function doVisit(visitId: string) {
    const started = (await http().post(`/visits/${visitId}/check-in`).set(bearer(supervisor)).send({}).expect(200)).body as Visit;
    for (const task of started.tasks) {
      await http().put(`/visits/${visitId}/tasks/${task.itemId}`).set(bearer(supervisor)).send({ done: true }).expect(200);
    }
    await http()
      .post(`/visits/${visitId}/photos`)
      .set(bearer(supervisor))
      .field('kind', 'AFTER')
      .attach('file', PHOTO, { filename: 'visit.jpg', contentType: 'image/jpeg' })
      .expect(200);
    await http().post(`/visits/${visitId}/complete`).set(bearer(supervisor)).expect(200);
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    reminders = app.get(RemindersService);
    // Notifications are switched off for the other suites, so they leave the sample people's lists alone.
    app.get(NotifyService).enabled = true;

    await cleanUp();
    startedAt = new Date();
    ({ id: outletId, name: outletName } = await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.jubilee } }));

    owner = await pinLogin(CODES.jubilee, PINS.owner);
    manager = await pinLogin(CODES.jubilee, PINS.manager);
    chef = await pinLogin(CODES.jubilee, PINS.chef);
    otherOwner = await pinLogin(CODES.kukatpally, PINS.otherOwner);
    superAdmin = await otpLogin(PHONES.superAdmin);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    [ownerId, managerId, chefId, supervisorId] = await Promise.all([owner, manager, chef, supervisor].map(idOf));

    chefName = (await http().get('/auth/me').set(bearer(chef)).expect(200)).body.name;

    const types = (await http().get('/services/types').set(bearer(admin)).expect(200)).body as { code: string }[];
    serviceCode = types.find((type) => type.code === 'PEST')?.code ?? types[0]!.code;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('a person’s own list', () => {
    let first: Note;

    it('needs a login', async () => {
      await http().get('/notifications').expect(401);
      await http().get('/notifications/unread-count').expect(401);
      await http().post('/notifications/read-all').expect(401);
    });

    it('lists the newest first, a page at a time, with the wording and its values', async () => {
      for (const reference of ['ECCS-9001', 'ECCS-9002', 'ECCS-9003']) {
        await notifications.send([chefId], 'ISSUE_RESOLVED', { outlet: 'Test outlet', reference }, { kind: 'issue', issueId: reference });
        // A moment apart, so that their order is certain.
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const newest = await page(chef, { limit: 2 });
      expect(newest.items.map((note) => note.params.reference)).toEqual(['ECCS-9003', 'ECCS-9002']);
      expect(newest.items[0]).toMatchObject({
        type: 'ISSUE_RESOLVED',
        title: 'Issue resolved',
        body: 'ECCS marked ECCS-9003 as resolved.',
        link: { kind: 'issue', issueId: 'ECCS-9003' },
        readAt: null,
      });
      expect(newest.nextCursor).toBe(newest.items[1]!.id);

      const older = await page(chef, { limit: 2, before: newest.nextCursor! });
      expect(older.items[0]!.params.reference).toBe('ECCS-9001');
      expect(older.items.some((note) => newest.items.some((shown) => shown.id === note.id))).toBe(false);
      first = newest.items[0]!;
    });

    it('counts the unread ones and marks one, then all, as read', async () => {
      const count = async () => (await http().get('/notifications/unread-count').set(bearer(chef)).expect(200)).body.unreadCount as number;
      const before = await count();
      expect(before).toBeGreaterThanOrEqual(3);
      expect((await page(chef)).unreadCount).toBe(before);

      const one = await http().post(`/notifications/${first.id}/read`).set(bearer(chef)).expect(200);
      expect(one.body).toEqual({ unreadCount: before - 1 });
      // Marking it again changes nothing.
      await http().post(`/notifications/${first.id}/read`).set(bearer(chef)).expect(200);
      expect(await count()).toBe(before - 1);
      expect((await page(chef)).items.find((note) => note.id === first.id)!.readAt).not.toBeNull();

      expect((await http().post('/notifications/read-all').set(bearer(chef)).expect(200)).body).toEqual({ unreadCount: 0 });
      expect((await page(chef)).items.every((note) => note.readAt !== null)).toBe(true);
    });

    it('keeps one person’s notifications from everyone else', async () => {
      await http().post(`/notifications/${first.id}/read`).set(bearer(manager)).expect(404);
      await http().post(`/notifications/${first.id}/read`).set(bearer(otherOwner)).expect(404);
      expect((await page(manager)).items.some((note) => note.id === first.id)).toBe(false);
      // Someone else's notification cannot be used as a place to continue from either.
      const sneaky = await page(otherOwner, { limit: 100, before: first.id });
      expect(sneaky.items.some((note) => note.params.reference === 'ECCS-9001')).toBe(false);
    });

    it('tells the Owner and Manager when a phone is linked with the restaurant code', async () => {
      // Logging in for this suite linked several phones to the outlet.
      for (const token of [owner, manager]) {
        const linked = (await page(token)).items.filter((note) => note.type === 'DEVICE_LINKED');
        expect(linked.length).toBeGreaterThanOrEqual(3);
        expect(linked[0]!.link).toEqual({ kind: 'staff' });
      }
      expect((await page(chef)).items.some((note) => note.type === 'DEVICE_LINKED')).toBe(false);
    });
  });

  describe('a booked visit, from request to report', () => {
    let bookingId: string;
    let visitId: string;

    it('S2: tells ECCS’s admins about a request, and not the person who made it', async () => {
      const catalog = (await http().get('/services/catalog').set(bearer(owner)).expect(200)).body as { id: string; serviceCode: string }[];
      const booked = await http()
        .post('/bookings')
        .set(bearer(owner))
        .send({ outletId, catalogItemId: catalog.find((item) => item.serviceCode === 'PEST')!.id, preferredDate: daysAhead(3), preferredSlot: '1000', notes: MARK })
        .expect(201);
      bookingId = booked.body.id;

      for (const token of [admin, superAdmin]) {
        const requests = (await page(token)).items.filter((note) => note.type === 'BOOKING_REQUESTED' && note.params.date === daysAhead(3));
        expect(requests).toHaveLength(1);
        expect(requests[0]!.body).toContain(`${outletName} asked for`);
      }
      for (const token of [owner, manager, supervisor]) {
        expect((await page(token)).items.some((note) => note.type === 'BOOKING_REQUESTED')).toBe(false);
      }
    });

    it('S3 and S7: tells the Owner and Manager it is confirmed, and the Supervisor it is theirs', async () => {
      const confirmed = await http()
        .post(`/bookings/${bookingId}/confirm`)
        .set(bearer(admin))
        .send({ date: daysAhead(3), slot: '1000', supervisorId })
        .expect(200);
      visitId = confirmed.body.visitId;

      await expectTold('BOOKING_CONFIRMED', visitId, { yes: [owner, manager], no: [chef, admin, superAdmin, supervisor, otherOwner] });
      await expectTold('VISIT_ASSIGNED', visitId, { yes: [supervisor], no: [owner, manager, admin] });
      const [note] = await told(manager, 'BOOKING_CONFIRMED', visitId);
      // Values are stored as they are, so the app can word them in the reader's language.
      expect(note!.params).toMatchObject({ date: daysAhead(3), slot: '1000', outlet: outletName });
      expect((note!.params.service as Record<string, string>).en).toBeTruthy();
      expect(note!.body).toMatch(/^ECCS confirmed .+ for \d+ \w+ \d{4}, 10:00 am – 12:00 pm\.$/);
    });

    it('S5: tells the restaurant and the Supervisor when ECCS moves the visit to today', async () => {
      await http().patch(`/visits/${visitId}`).set(bearer(admin)).send({ date: daysAhead(0) }).expect(200);
      await expectTold('VISIT_MOVED', visitId, { yes: [owner, manager, supervisor], no: [chef, admin] });
    });

    it('S10 and S11: tells the Owner and Manager when the team arrives and when it finishes', async () => {
      await doVisit(visitId);
      await expectTold('VISIT_STARTED', visitId, { yes: [owner, manager], no: [chef, supervisor, admin] });
      await expectTold('VISIT_FINISHED', visitId, { yes: [owner, manager], no: [chef, supervisor, admin, superAdmin, otherOwner] });
    });

    it('S13: tells ECCS’s admins and the Supervisor about the sign-off, and not whoever signed', async () => {
      await http().post(`/visits/${visitId}/sign-off`).set(bearer(manager)).send({ rating: 5 }).expect(200);
      await expectTold('VISIT_SIGNED_OFF', visitId, { yes: [admin, superAdmin, supervisor], no: [manager, owner, chef] });
      await expectTold('VISIT_LOW_RATING', visitId, { yes: [], no: [admin, superAdmin] });
      expect((await told(admin, 'VISIT_SIGNED_OFF', visitId))[0]!.params.stars).toBe(5);
    });

    it('S15: tells the Supervisor when ECCS sends the report back', async () => {
      await http().post(`/visits/${visitId}/return-report`).set(bearer(admin)).send({ note: 'Add a photo of the store room' }).expect(200);
      await expectTold('REPORT_RETURNED', visitId, { yes: [supervisor], no: [owner, manager, admin] });
      expect((await told(supervisor, 'REPORT_RETURNED', visitId))[0]!.body).toContain('Add a photo of the store room');
      // Finishing again returns it to ECCS; the restaurant, which has already signed, is not asked a second time.
      await http().post(`/visits/${visitId}/complete`).set(bearer(supervisor)).expect(200);
      await expectTold('VISIT_FINISHED', visitId, { yes: [owner, manager], no: [] });
    });

    it('S1: tells the Owner and Manager the report is ready once ECCS approves it', async () => {
      const approved = (await http().post(`/visits/${visitId}/approve-report`).set(bearer(admin)).expect(200)).body as Visit;
      await expectTold('REPORT_READY', visitId, { yes: [owner, manager], no: [chef, admin, superAdmin, supervisor, otherOwner] });
      const [note] = await told(owner, 'REPORT_READY', visitId);
      expect(note).toMatchObject({ title: 'Service report ready', link: { kind: 'visit', visitId }, readAt: null });
      expect(note!.body).toContain(approved.reportNumber!);
      // Lets the PDF, which is made in the background, finish before the suite tidies up.
      await http().post(`/visits/${visitId}/report-pdf`).set(bearer(owner));
    });

    it('never shows another restaurant any of it', async () => {
      const elsewhere = (await page(otherOwner)).items;
      expect(elsewhere.some((note) => note.link?.visitId === visitId)).toBe(false);
      expect(elsewhere.some((note) => JSON.stringify(note).includes(outletName))).toBe(false);
    });
  });

  describe('a low rating', () => {
    it('S14: sends ECCS’s admins the low-rating notification in place of the ordinary one', async () => {
      const visitId = await addVisit(daysAhead(0));
      // S7 for a visit ECCS added itself.
      await expectTold('VISIT_ASSIGNED', visitId, { yes: [supervisor], no: [admin, owner] });
      await doVisit(visitId);
      await http().post(`/visits/${visitId}/sign-off`).set(bearer(owner)).send({ rating: 2, comment: 'Floor left wet' }).expect(200);

      await expectTold('VISIT_LOW_RATING', visitId, { yes: [admin, superAdmin], no: [supervisor, owner, manager] });
      await expectTold('VISIT_SIGNED_OFF', visitId, { yes: [supervisor], no: [admin, superAdmin, owner] });
      const [note] = await told(admin, 'VISIT_LOW_RATING', visitId);
      expect(note!.body).toContain('2 out of 5 stars. "Floor left wet"');
    });
  });

  describe('issues', () => {
    let issueId: string;

    it('I1: tells ECCS’s admins when a restaurant raises an issue', async () => {
      const raised = await http()
        .post('/issues')
        .set(bearer(chef))
        .send({ outletId, category: 'PEST_SIGHTING', description: `Cockroach near the sink (${MARK})`, attachmentIds: [] })
        .expect(201);
      issueId = raised.body.id;
      await expectTold('ISSUE_RAISED', issueId, { yes: [admin, superAdmin], no: [chef, manager, owner, otherOwner] });
      expect((await told(admin, 'ISSUE_RAISED', issueId))[0]!.body).toMatch(
        /raised ECCS-\d{4}: Pest sighting\. "Cockroach near the sink/,
      );
    });

    it('I2: tells whoever raised it, the Manager and the Owner when ECCS replies', async () => {
      await http().post(`/issues/${issueId}/comments`).set(bearer(admin)).send({ body: 'We will send someone tomorrow.' }).expect(200);
      await expectTold('ISSUE_REPLY_ECCS', issueId, { yes: [chef, manager, owner], no: [admin, superAdmin, otherOwner] });
      expect((await told(chef, 'ISSUE_REPLY_ECCS', issueId))[0]!.params.excerpt).toBe('We will send someone tomorrow.');
    });

    it('I3: tells ECCS when the restaurant replies, and not the restaurant itself', async () => {
      await http().post(`/issues/${issueId}/comments`).set(bearer(manager)).send({ body: 'Thank you.' }).expect(200);
      await expectTold('ISSUE_REPLY_RESTAURANT', issueId, { yes: [admin, superAdmin], no: [manager, owner, chef] });
    });

    it('I4 and I5: tells the restaurant when ECCS resolves it, and ECCS when the restaurant reopens it', async () => {
      const setStatus = (token: string, status: string) =>
        http().patch(`/issues/${issueId}`).set(bearer(token)).send({ status }).expect(200);
      await setStatus(admin, 'RESOLVED');
      await expectTold('ISSUE_RESOLVED', issueId, { yes: [chef, manager, owner], no: [admin, superAdmin] });
      // Saying the same again is not news.
      await setStatus(admin, 'RESOLVED');
      expect(await told(chef, 'ISSUE_RESOLVED', issueId)).toHaveLength(1);

      await setStatus(manager, 'OPEN');
      await expectTold('ISSUE_REOPENED', issueId, { yes: [admin, superAdmin], no: [manager, owner, chef] });
    });
  });

  describe('checklists and reminders', () => {
    // Midday in India today: past the checklist's due time whenever the suite runs.
    const midday = () => new Date(`${indiaDate()}T12:00:00+05:30`);
    let listId: string;
    let runId: string;

    it('C2: reminds the Head Chef and Manager once that a checklist is overdue', async () => {
      // The checklist's name is stored under the language of whoever typed it; the sample Manager's may be changed by hand.
      const lists = await http()
        .post('/checklists/setup')
        .set({ ...bearer(manager), 'X-App-Language': 'EN' })
        .send({ outletId, title: MARK, dueTime: '00:01' })
        .expect(201);
      listId = (lists.body as { id: string; title: Record<string, string> }[]).find((list) => list.title.en === MARK)!.id;
      await http().post(`/checklists/setup/${listId}/items`).set(bearer(manager)).send({ label: 'E2E fridge temperature', photoRequired: false }).expect(201);

      const overdue = async (token: string) =>
        (await page(token)).items.filter((note) => note.type === 'CHECKLIST_OVERDUE' && (note.params.checklist as Record<string, string>).en === MARK);
      expect((await reminders.run(midday(), outletId)).sent).toBeGreaterThanOrEqual(2);
      expect(await overdue(chef)).toHaveLength(1);
      expect(await overdue(manager)).toHaveLength(1);
      expect(await overdue(owner)).toHaveLength(0);
      expect((await overdue(chef))[0]!.link).toEqual({ kind: 'checklist', outletId });

      // The same check again, later the same day, sends nothing more.
      await reminders.run(new Date(midday().getTime() + 3_600_000), outletId);
      expect(await overdue(chef)).toHaveLength(1);
    });

    it('C3: tells the Manager and Owner when a checklist is handed in with a problem', async () => {
      const runs = (await http().get('/checklists/today').query({ outletId }).set(bearer(chef)).expect(200)).body as {
        id: string;
        outletChecklistId: string;
        items: { id: string }[];
      }[];
      const run = runs.find((entry) => entry.outletChecklistId === listId)!;
      runId = run.id;
      const itemId = run.items[0]!.id;
      await http().put(`/checklists/runs/${runId}/items/${itemId}`).set(bearer(chef)).send({ passed: false, note: 'Fridge at 9°C' }).expect(200);
      await http().post(`/checklists/runs/${runId}/submit`).set(bearer(chef)).expect(200);

      await expectTold('CHECKLIST_PROBLEM', runId, { yes: [manager, owner], no: [chef, admin, superAdmin, otherOwner] });
      const [note] = await told(manager, 'CHECKLIST_PROBLEM', runId);
      expect(note!.params).toMatchObject({ name: chefName, outlet: outletName });
      expect(note!.body).toContain('E2E fridge temperature');
    });

    it('L1: reminds the Owner and Manager once that a licence is about to expire', async () => {
      const licence = await prisma.client.licence.create({
        data: { outletId, type: 'OTHER', name: MARK, expiresOn: new Date(`${daysAhead(7)}T00:00:00.000Z`) },
      });
      const expiring = async (token: string) =>
        (await page(token)).items.filter((note) => note.type === 'LICENCE_EXPIRING' && note.params.licence === MARK);

      await reminders.run(midday(), outletId);
      for (const token of [owner, manager]) {
        expect(await expiring(token)).toEqual([
          expect.objectContaining({ params: expect.objectContaining({ days: 7, date: daysAhead(7) }), link: { kind: 'documents', outletId } }),
        ]);
      }
      expect(await expiring(chef)).toHaveLength(0);
      expect(await expiring(otherOwner)).toHaveLength(0);

      // Run again the same day and the next: still the one reminder for this stage.
      await reminders.run(midday(), outletId);
      await reminders.run(new Date(midday().getTime() + 86_400_000), outletId);
      expect(await expiring(owner)).toHaveLength(1);
      // With one day left there is a new reminder, once.
      const lastDay = new Date(midday().getTime() + 6 * 86_400_000);
      await reminders.run(lastDay, outletId);
      await reminders.run(lastDay, outletId);
      expect((await expiring(owner)).map((note) => Number(note.params.days)).sort((a, b) => a - b)).toEqual([1, 7]);

      // Once it has expired the reminder changes, and is repeated a week later but not before.
      const expired = async () => (await page(owner)).items.filter((note) => note.type === 'LICENCE_EXPIRED' && note.params.licence === MARK);
      const after = (days: number) => new Date(midday().getTime() + (7 + days) * 86_400_000);
      await reminders.run(after(1), outletId);
      await reminders.run(after(3), outletId);
      expect(await expired()).toHaveLength(1);
      await reminders.run(after(8), outletId);
      expect(await expired()).toHaveLength(2);
      await prisma.client.licence.delete({ where: { id: licence.id } });
    });

    it('S8: reminds the restaurant and the Supervisor once, the day before a visit', async () => {
      const visitId = await addVisit(daysAhead(1));
      await reminders.run(midday(), outletId);
      await reminders.run(midday(), outletId);
      await expectTold('VISIT_TOMORROW', visitId, { yes: [owner, manager, supervisor], no: [chef, admin, otherOwner] });
    });

    it('S16: tells ECCS’s admins and the Supervisor once when a visit’s day passes without it being started', async () => {
      const visitId = await addVisit(daysAhead(1));
      const twoDaysOn = new Date(midday().getTime() + 2 * 86_400_000);
      await reminders.run(twoDaysOn, outletId);
      await reminders.run(twoDaysOn, outletId);
      await expectTold('VISIT_NOT_DONE', visitId, { yes: [admin, superAdmin, supervisor], no: [owner, manager, chef] });
    });

    it('C4: tells the Manager and Owner once about a checklist missed the day before', async () => {
      // Seen from tomorrow, a checklist made today and not handed in was missed. This one was handed in above, so make another.
      const title = `${MARK} two`;
      const lists = await http()
        .post('/checklists/setup')
        .set({ ...bearer(manager), 'X-App-Language': 'EN' })
        .send({ outletId, title })
        .expect(201);
      const secondId = (lists.body as { id: string; title: Record<string, string> }[]).find((list) => list.title.en === title)!.id;
      await http().post(`/checklists/setup/${secondId}/items`).set(bearer(manager)).send({ label: 'E2E bins emptied', photoRequired: false }).expect(201);

      const missed = async (token: string) =>
        (await page(token)).items.filter(
          (note) =>
            note.type === 'CHECKLIST_MISSED' &&
            // The checks above that looked ahead in time found later days missed as well; this is about today.
            note.params.date === indiaDate() &&
            (note.params.checklist as Record<string, string>).en?.startsWith(MARK),
        );
      const tomorrow = new Date(midday().getTime() + 86_400_000);
      await reminders.run(tomorrow, outletId);
      await reminders.run(tomorrow, outletId);
      for (const token of [manager, owner]) {
        // Only the one that was not handed in.
        expect((await missed(token)).map((note) => (note.params.checklist as Record<string, string>).en)).toEqual([title]);
      }
      expect(await missed(chef)).toHaveLength(0);
    });
  });

  it('carries on with the action when a notification cannot be sent', async () => {
    const original = notifications.send.bind(notifications);
    notifications.send = () => Promise.reject(new Error('the notifications table is on fire'));
    try {
      const raised = await http()
        .post('/issues')
        .set(bearer(chef))
        .send({ outletId, category: 'OTHER', description: `Raised while notifications were failing (${MARK})`, attachmentIds: [] })
        .expect(201);
      expect(raised.body.status).toBe('OPEN');
    } finally {
      notifications.send = original;
    }
  });

  it('leaves out anyone whose access has been removed, and never tells a person twice', async () => {
    // The same person named twice, the person who did it, and nobody at all.
    expect(await notifications.send([ownerId, ownerId, managerId, null], 'PIN_LOCKED', { outlet: MARK }, null, { except: managerId })).toBe(1);
    expect((await page(owner)).items.filter((note) => note.type === 'PIN_LOCKED' && note.params.outlet === MARK)).toHaveLength(1);
    expect((await page(manager)).items.some((note) => note.type === 'PIN_LOCKED' && note.params.outlet === MARK)).toBe(false);
    const everyone = await notifications.restaurantPeople(outletId, ['OWNER', 'MANAGER', 'HEAD_CHEF']);
    expect(everyone).toEqual(expect.arrayContaining([ownerId, managerId, chefId]));
    const inactive = await prisma.client.user.findMany({ where: { isActive: false }, select: { id: true } });
    expect(inactive.some((person) => everyone.includes(person.id))).toBe(false);
  });
});
