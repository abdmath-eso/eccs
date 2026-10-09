// The customer QR page: what a diner's phone is given without logging in, when it
// is given nothing, the restaurant's switch, ECCS's take-down, the link, and the
// photos proposed, approved, rejected and removed. Runs against the local database
// with the sample seed loaded and local object storage running. Everything is done
// on a throwaway outlet of the Deccan Biryani sample restaurant, with a throwaway
// Manager, and removed afterwards; the sample outlets and people are only read.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { inspectionShownUntil, isLocalOnlyAddress, PUBLIC_PAGE_RULES } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { PublicPageService } from './../src/public-page/public-page.service.js';
import { stripPhotoDetails } from './../src/public-page/strip-photo-details.js';
import { StorageService } from './../src/storage/storage.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-public-page';
const OUTLET_CODE = 'E2EPP-QR0001';
const OUTLET_NAME = 'E2E page outlet';
const TEMP_MANAGER = 'E2E Page Manager';
const REPORT_NUMBER = 'IR-E2E-PAGE-1';
const CERTIFICATE_NUMBER = 'CERT-E2E-PAGE-1';
const FSSAI_NUMBER = '13600000000001';
const SECRET = 'secret-gps-17.4,78.4';

/** A small JPEG-shaped file carrying camera details (an Exif block and a comment) that must not reach a diner. */
function jpegWithDetails(mark: string): Buffer {
  const segment = (marker: number, body: Buffer) => {
    const head = Buffer.alloc(4);
    head[0] = 0xff;
    head[1] = marker;
    head.writeUInt16BE(body.length + 2, 2);
    return Buffer.concat([head, body]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xe1, Buffer.from(`Exif\0\0${SECRET}`, 'latin1')),
    segment(0xfe, Buffer.from(`comment ${SECRET}`, 'latin1')),
    segment(0xda, Buffer.from([0, 1, 2])),
    Buffer.from(`picture data ${mark}`, 'latin1'),
    Buffer.from([0xff, 0xd9]),
  ]);
}

type Settings = {
  outletId: string;
  outletName: string;
  organizationName: string;
  enabled: boolean;
  takenDown: boolean;
  takenDownReason: string | null;
  state: string;
  url: string;
  localOnly: boolean;
  linkChangedAt: string | null;
  inspection: { state: string; date: string | null; shownUntil: string | null };
  preview: Record<string, unknown> | null;
  photos: Photo[];
  photosWaiting: number;
  canSwitch: boolean;
  canTakeDown: boolean;
};
type Photo = {
  id: string;
  outletId: string;
  caption: string;
  status: string;
  path: string;
  proposedByName: string | null;
  rejectReason: string | null;
  removed: boolean;
  shown: boolean;
};

const daysAgo = (days: number) => indiaDate(new Date(Date.now() - days * 86_400_000));
const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
/** A moment on an India date: 06:30 UTC is noon in India. */
const noon = (date: string) => new Date(`${date}T06:30:00.000Z`);

describe('Customer QR page (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let pages: PublicPageService;
  let storage: StorageService;
  let outletId: string;
  let organizationName: string;
  let owner: string;
  let manager: string;
  let chef: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  let supervisorName: string;
  let inspectionId: string;
  /** Photos of the Supervisor's finished visit, one of a visit still under way, and one that belongs to no visit. */
  let visitPhotos: string[];
  let openVisitPhoto: string;
  let loosePhoto: string;
  let token: string;

  const http = () => request(app.getHttpServer());
  const bearer = (session: string) => ({ Authorization: `Bearer ${session}` });
  const tokenOf = (url: string) => url.split('/k/')[1]!;
  const settings = async (session: string): Promise<Settings> =>
    (await http().get(`/public-page/outlets/${outletId}`).set(bearer(session)).expect(200)).body;
  const setEnabled = (session: string, enabled: boolean) =>
    http().patch(`/public-page/outlets/${outletId}`).set(bearer(session)).send({ enabled });
  const publicPage = (forToken: string = token) => http().get(`/public/pages/${forToken}`);
  const publicPhoto = (place: string | number, forToken: string = token) => http().get(`/public/pages/${forToken}/photos/${place}`);
  const propose = (session: string, attachmentId: string, caption = 'GRILL') =>
    http().post('/public-page/photos').set(bearer(session)).send({ attachmentId, caption });
  const photos = async (session: string, query: Record<string, string> = {}): Promise<Photo[]> =>
    (await http().get('/public-page/photos').query(query).set(bearer(session)).expect(200)).body;

  /** What an unknown link answers. Every "nothing to show" case must answer exactly this. */
  let unknown: { status: number; body: unknown; cache: string | undefined };
  async function expectNothing(forToken: string = token) {
    // Records written straight into the database are not known to the service's one-minute memory.
    pages.forget();
    const answer = await publicPage(forToken);
    expect({ status: answer.status, body: answer.body, cache: answer.headers['cache-control'] }).toEqual(unknown);
    await publicPhoto(1, forToken).expect(404);
  }
  async function expectLive() {
    pages.forget();
    return (await publicPage().expect(200)).body as Record<string, unknown>;
  }

  async function cleanUp() {
    const db = prisma.client;
    const outlet = await db.outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    if (outlet) {
      const lists = await db.outletChecklist.findMany({ where: { outletId: outlet.id }, select: { templateId: true } });
      const files = await db.attachment.findMany({ where: { outletId: outlet.id }, select: { storageKey: true } });
      // Proposed photos go with the page's record.
      await db.publicProfile.deleteMany({ where: { outletId: outlet.id } });
      await db.attachment.deleteMany({ where: { outletId: outlet.id } });
      for (const file of files) await storage.remove(file.storageKey).catch(() => undefined);
      await db.certificate.deleteMany({ where: { outletId: outlet.id } });
      await db.job.deleteMany({ where: { outletId: outlet.id } });
      await db.hygieneScoreSnapshot.deleteMany({ where: { outletId: outlet.id } });
      await db.inspection.deleteMany({ where: { outletId: outlet.id } });
      await db.licence.deleteMany({ where: { outletId: outlet.id } });
      await db.checklistRun.deleteMany({ where: { outletId: outlet.id } });
      await db.outletChecklist.deleteMany({ where: { outletId: outlet.id } });
      await db.checklistTemplate.deleteMany({ where: { id: { in: lists.map((list) => list.templateId) } } });
      await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { user: { name: TEMP_MANAGER } }] } });
      await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
      await db.membership.deleteMany({ where: { outletId: outlet.id } });
      await db.user.deleteMany({ where: { name: TEMP_MANAGER } });
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

  /** A photo in storage and on record, as if taken during a visit (or, with no visit, for a checklist). */
  async function photoOf(jobId: string | null, mark: string): Promise<string> {
    const body = jpegWithDetails(mark);
    const created = await prisma.client.attachment.create({
      data: {
        outletId,
        jobId,
        kind: jobId ? 'AFTER' : 'PROOF',
        storageKey: `outlets/${outletId}/e2e/${mark}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: body.length,
        capturedAt: noon(daysAgo(3)),
        uploadedById: supervisorId,
      },
    });
    await storage.put(created.storageKey, body, 'image/jpeg');
    return created.id;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    pages = app.get(PublicPageService);
    storage = app.get(StorageService);
    await cleanUp();
    const db = prisma.client;

    const seeded = await db.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally }, include: { organization: true } });
    organizationName = seeded.organization.name;
    outletId = (
      await db.outlet.create({
        data: { organizationId: seeded.organizationId, name: OUTLET_NAME, code: OUTLET_CODE, address: 'Test Road', city: 'Hyderabad' },
      })
    ).id;

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    chef = await pinLogin(CODES.kukatpally, PINS.chef);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    const me = (await http().get('/auth/me').set(bearer(supervisor)).expect(200)).body as { id: string; name: string };
    supervisorId = me.id;
    supervisorName = me.name;
    // A Manager of the throwaway outlet itself.
    const created = await http()
      .post('/restaurant-users')
      .set(bearer(owner))
      .send({ name: TEMP_MANAGER, role: 'MANAGER', outletId, language: 'EN' })
      .expect(201);
    manager = await pinLogin(OUTLET_CODE, created.body.pin as string);

    // ECCS's approved inspection, ten days ago: 86.4 out of 100, grade A.
    const template = await db.checklistTemplate.findFirstOrThrow({ where: { kind: 'INSPECTION' } });
    const inspected = noon(daysAgo(10));
    inspectionId = (
      await db.inspection.create({
        data: {
          outletId,
          templateId: template.id,
          supervisorId,
          status: 'APPROVED',
          conductedAt: inspected,
          startedAt: inspected,
          completedAt: inspected,
          approvedAt: inspected,
          overallScore: 86.4,
          grade: 'A',
          reportNumber: REPORT_NUMBER,
        },
      })
    ).id;

    // The kitchen's own checklist, set up four days ago: handed in yesterday and the day before, not on the two days before that.
    const list = await db.outletChecklist.create({
      data: {
        outlet: { connect: { id: outletId } },
        frequency: 'DAILY',
        dueTime: '23:59',
        createdAt: noon(daysAgo(4)),
        template: {
          create: { kind: 'DAILY', outletId, title: { en: 'E2E page checklist' }, items: { create: { position: 1, label: { en: 'Secret check wording' }, outletId } } },
        },
      },
      include: { template: { include: { items: true } } },
    });
    for (const ago of [1, 2]) {
      const submittedAt = noon(daysAgo(ago));
      await db.checklistRun.create({
        data: {
          outletChecklistId: list.id,
          outletId,
          date: dbDate(daysAgo(ago)),
          status: 'SUBMITTED',
          submittedAt,
          responses: { create: { itemId: list.template.items[0]!.id, passed: false, note: 'Secret problem note', capturedAt: submittedAt } },
        },
      });
    }
    await db.licence.create({ data: { outletId, type: 'FSSAI', name: 'FSSAI licence', number: FSSAI_NUMBER, expiresOn: dbDate(daysAgo(-200)) } });

    // A pest-control visit three days ago, its report approved, with a certificate still valid; and one still under way.
    const pest = await db.serviceType.findUniqueOrThrow({ where: { code: 'PEST' } });
    const done = noon(daysAgo(3));
    const visit = await db.job.create({
      data: {
        outletId,
        serviceTypeId: pest.id,
        scheduledDate: dbDate(daysAgo(3)),
        status: 'APPROVED',
        supervisorId,
        checkInAt: done,
        completedAt: done,
        reviewedAt: done,
        approvedAt: done,
      },
    });
    await db.certificate.create({
      data: { outletId, serviceTypeId: pest.id, jobId: visit.id, number: CERTIFICATE_NUMBER, validFrom: dbDate(daysAgo(3)), validUntil: dbDate(daysAgo(-12)) },
    });
    const openVisit = await db.job.create({
      data: { outletId, serviceTypeId: pest.id, scheduledDate: dbDate(daysAgo(0)), status: 'IN_PROGRESS', supervisorId, checkInAt: new Date() },
    });
    visitPhotos = [await photoOf(visit.id, 'one'), await photoOf(visit.id, 'two'), await photoOf(visit.id, 'three')];
    openVisitPhoto = await photoOf(openVisit.id, 'open');
    loosePhoto = await photoOf(null, 'loose');

    const answer = await publicPage('no-such-link-0000000000');
    unknown = { status: answer.status, body: answer.body, cache: answer.headers['cache-control'] };
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('the restaurant’s switch', () => {
    it('starts off, with a random link, and shows the Owner what turning it on would publish', async () => {
      const page = await settings(owner);
      expect(page).toMatchObject({
        outletId,
        outletName: OUTLET_NAME,
        organizationName,
        enabled: false,
        takenDown: false,
        takenDownReason: null,
        state: 'OFF',
        linkChangedAt: null,
        inspection: { state: 'CURRENT', date: daysAgo(10), shownUntil: inspectionShownUntil(daysAgo(10)) },
        photos: [],
        photosWaiting: 0,
        canSwitch: true,
        canTakeDown: false,
      });
      token = tokenOf(page.url);
      // 128 random bits, written in 22 letters, digits, "-" and "_".
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(page.url.endsWith(`/k/${token}`)).toBe(true);
      expect(page.localOnly).toBe(isLocalOnlyAddress(page.url));
      expect(page.preview).toMatchObject({ outletName: OUTLET_NAME, inspection: { score: 86, reportNumber: REPORT_NUMBER } });
      // Asking again does not make another link.
      expect((await settings(owner)).url).toBe(page.url);
    });

    it('is unknown to the world while it is off', async () => {
      expect(unknown.status).toBe(404);
      await expectNothing();
    });

    it('can be read by the Manager and ECCS, and by nobody else', async () => {
      expect(await settings(manager)).toMatchObject({ state: 'OFF', canSwitch: false, canTakeDown: false });
      expect(await settings(admin)).toMatchObject({ state: 'OFF', canSwitch: false, canTakeDown: true });
      await http().get(`/public-page/outlets/${outletId}`).set(bearer(chef)).expect(403);
      await http().get(`/public-page/outlets/${outletId}`).set(bearer(otherManager)).expect(404);
      await http().get(`/public-page/outlets/${outletId}`).expect(401);
      await http().get('/public-page/outlets/no-such-outlet').set(bearer(admin)).expect(404);
    });

    it('is turned on by the Owner only', async () => {
      await setEnabled(manager, true).expect(403);
      await setEnabled(chef, true).expect(403);
      await setEnabled(otherManager, true).expect(403);
      await setEnabled(supervisor, true).expect(403);
      // Publishing is the restaurant's decision: ECCS cannot turn a page on either.
      await setEnabled(admin, true).expect(403);
      await setEnabled(owner, 'yes' as unknown as boolean).expect(400);
      expect((await settings(owner)).enabled).toBe(false);
      await expectNothing();

      const on = (await setEnabled(owner, true).expect(200)).body as Settings;
      expect(on).toMatchObject({ enabled: true, state: 'LIVE' });
    });
  });

  describe('what a diner is given', () => {
    it('is exactly the page’s content and nothing else about the outlet', async () => {
      const answer = await publicPage().expect(200);
      expect(answer.headers['cache-control']).toBe(`public, max-age=${PUBLIC_PAGE_RULES.cacheSeconds}`);
      expect(answer.headers['x-robots-tag']).toBe('noindex');
      const pest = await prisma.client.serviceType.findUniqueOrThrow({ where: { code: 'PEST' } });
      // The exact shape: a new field must be added here on purpose.
      expect(answer.body).toEqual({
        restaurantName: organizationName,
        outletName: OUTLET_NAME,
        city: 'Hyderabad',
        inspection: {
          score: 86,
          grade: 'A',
          date: daysAgo(10),
          shownUntil: inspectionShownUntil(daysAgo(10)),
          reportNumber: REPORT_NUMBER,
        },
        // Days four and three ago were missed; the last two were handed in. Today is not counted.
        selfChecks: { handedIn: 2, days: 4 },
        services: [
          { code: 'PEST', name: pest.name, date: daysAgo(3), certificateNumber: CERTIFICATE_NUMBER, certificateValidUntil: daysAgo(-12) },
        ],
        photos: [],
        fssaiNumber: FSSAI_NUMBER,
        eccsPhone: env.SUPPORT_PHONE,
        updatedAt: expect.any(String),
      });

      // No ids, no people, no checklist wording, no problems.
      const text = JSON.stringify(answer.body);
      for (const hidden of [outletId, inspectionId, supervisorId, supervisorName, TEMP_MANAGER, 'Secret', OUTLET_CODE, 'Test Road']) {
        expect(text).not.toContain(hidden);
      }
    });

    it('leaves out an expired certificate and a visit whose report is not approved', async () => {
      const db = prisma.client;
      await db.certificate.updateMany({ where: { number: CERTIFICATE_NUMBER }, data: { validUntil: dbDate(daysAgo(1)) } });
      expect((await expectLive()).services).toMatchObject([{ code: 'PEST', certificateNumber: null, certificateValidUntil: null }]);
      await db.certificate.updateMany({ where: { number: CERTIFICATE_NUMBER }, data: { validUntil: dbDate(daysAgo(-12)) } });

      await db.job.updateMany({ where: { outletId, status: 'APPROVED' }, data: { reviewedAt: null } });
      expect((await expectLive()).services).toEqual([]);
      await db.job.updateMany({ where: { outletId, status: 'APPROVED' }, data: { reviewedAt: noon(daysAgo(3)) } });
    });

    it('remembers an answer for a minute, and forgets it when the page changes', async () => {
      const first = (await publicPage().expect(200)).body as { updatedAt: string };
      expect(((await publicPage().expect(200)).body as { updatedAt: string }).updatedAt).toBe(first.updatedAt);
      await setEnabled(owner, false).expect(200);
      await publicPage().expect(404);
      await setEnabled(owner, true).expect(200);
      await publicPage().expect(200);
    });

    it('answers a malformed link like any unknown one', async () => {
      for (const bad of ['short', 'has.a.dot.in.it.000000', 'x'.repeat(80)]) {
        const answer = await publicPage(bad);
        expect({ status: answer.status, body: answer.body }).toEqual({ status: unknown.status, body: unknown.body });
      }
    });
  });

  describe('nothing current to show', () => {
    const inspection = (data: Record<string, unknown>) => prisma.client.inspection.update({ where: { id: inspectionId }, data });

    it('lapses by itself when the inspection is too old, and comes back with a newer one', async () => {
      const valid = PUBLIC_PAGE_RULES.inspectionValidDays;
      // Still shown on the last day.
      await inspection({ conductedAt: noon(daysAgo(valid)) });
      expect((await expectLive()).inspection).toMatchObject({ date: daysAgo(valid), shownUntil: indiaDate() });
      // Gone the day after, with nothing to tell it from a link that never existed.
      await inspection({ conductedAt: noon(daysAgo(valid + 1)) });
      await expectNothing();
      expect(await settings(owner)).toMatchObject({ enabled: true, state: 'INSPECTION_EXPIRED', preview: null, inspection: { state: 'EXPIRED' } });

      await inspection({ conductedAt: noon(daysAgo(10)) });
      await expectLive();
    });

    it('shows nothing for an inspection ECCS has not approved, or one with no report number', async () => {
      await inspection({ status: 'SUBMITTED' });
      await expectNothing();
      expect(await settings(owner)).toMatchObject({ state: 'NO_INSPECTION', preview: null });
      await inspection({ status: 'APPROVED', reportNumber: null });
      await expectNothing();
      await inspection({ reportNumber: REPORT_NUMBER });
      await expectLive();
    });

    it('shows nothing once the outlet is switched off as a client', async () => {
      await prisma.client.outlet.update({ where: { id: outletId }, data: { isActive: false } });
      await expectNothing();
      expect(await settings(admin)).toMatchObject({ state: 'INACTIVE', preview: null });
      await prisma.client.outlet.update({ where: { id: outletId }, data: { isActive: true } });
      await expectLive();
    });

    it('shows nothing when the restaurant turns its page off', async () => {
      await setEnabled(owner, false).expect(200);
      await expectNothing();
      await setEnabled(owner, true).expect(200);
      await expectLive();
    });
  });

  describe('ECCS’s take-down', () => {
    const takeDown = (session: string, body: unknown = { reason: 'Client asked to leave' }) =>
      http().post(`/public-page/outlets/${outletId}/take-down`).set(bearer(session)).send(body as object);
    const restore = (session: string) => http().post(`/public-page/outlets/${outletId}/restore`).set(bearer(session));

    it('is for ECCS admins only, and needs a reason', async () => {
      for (const session of [owner, manager, chef, supervisor, otherManager]) await takeDown(session).expect(403);
      await takeDown(admin, {}).expect(400);
      await takeDown(admin, { reason: '   ' }).expect(400);
      await expectLive();
    });

    it('overrides the restaurant’s switch, which cannot bring the page back', async () => {
      const down = (await takeDown(admin).expect(200)).body as Settings;
      expect(down).toMatchObject({ enabled: true, takenDown: true, takenDownReason: 'Client asked to leave', state: 'TAKEN_DOWN' });
      await expectNothing();

      // The restaurant is told it is down, not why.
      expect(await settings(owner)).toMatchObject({ enabled: true, takenDown: true, takenDownReason: null, state: 'TAKEN_DOWN', canSwitch: true });
      const refused = await setEnabled(owner, true).expect(409);
      expect(refused.body).toMatchObject({ code: 'PAGE_TAKEN_DOWN' });
      // Turning it off and on again changes nothing either.
      await setEnabled(owner, false).expect(200);
      await setEnabled(owner, true).expect(409);
      await expectNothing();
    });

    it('is lifted by ECCS, after which the restaurant’s own switch decides again', async () => {
      for (const session of [owner, manager, supervisor]) await restore(session).expect(403);
      const restored = (await restore(admin).expect(200)).body as Settings;
      // The Owner had turned it off meanwhile, so it stays off until they turn it on.
      expect(restored).toMatchObject({ enabled: false, takenDown: false, takenDownReason: null, state: 'OFF' });
      await expectNothing();
      await setEnabled(owner, true).expect(200);
      await expectLive();
    });
  });

  describe('a new link', () => {
    const newLink = (session: string) => http().post(`/public-page/outlets/${outletId}/new-link`).set(bearer(session));

    it('is made by the Owner only, and the old link stops working at once', async () => {
      for (const session of [manager, chef, supervisor, admin, otherManager]) await newLink(session).expect(403);
      await publicPage().expect(200);

      const old = token;
      const changed = (await newLink(owner).expect(200)).body as Settings;
      token = tokenOf(changed.url);
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(token).not.toBe(old);
      expect(changed.linkChangedAt).toEqual(expect.any(String));
      expect(changed).toMatchObject({ enabled: true, state: 'LIVE' });

      // The old link is now exactly an unknown one; the new one shows the page.
      const answer = await publicPage(old);
      expect({ status: answer.status, body: answer.body, cache: answer.headers['cache-control'] }).toEqual(unknown);
      await publicPhoto(1, old).expect(404);
      await publicPage().expect(200);
    });
  });

  describe('photos', () => {
    let first: Photo;
    let second: Photo;
    let taken: Photo;

    it('are proposed by the Supervisor from their own finished visit, once each', async () => {
      first = (await propose(supervisor, visitPhotos[0]!, 'GRILL').expect(201)).body as Photo;
      expect(first).toMatchObject({ outletId, caption: 'GRILL', status: 'PROPOSED', removed: false, shown: false });
      second = (await propose(supervisor, visitPhotos[1]!, 'HOOD').expect(201)).body as Photo;

      const again = await propose(supervisor, visitPhotos[0]!).expect(409);
      expect(again.body).toMatchObject({ code: 'PHOTO_ALREADY_PROPOSED' });
      await propose(supervisor, visitPhotos[2]!, 'CEILING').expect(400);
      await propose(supervisor, 'not-an-id').expect(400);
      // A visit still under way, and a photo that belongs to no visit of theirs (a restaurant's checklist photo).
      await propose(supervisor, openVisitPhoto).expect(409);
      await propose(supervisor, loosePhoto).expect(404);
      // Only a Supervisor proposes.
      for (const session of [owner, manager, chef, admin]) await propose(session, visitPhotos[2]!).expect(403);
    });

    it('can also be taken specially for the page', async () => {
      const upload = (session: string, caption: string | null) => {
        const sent = http().post(`/public-page/outlets/${outletId}/photos`).set(bearer(session));
        if (caption) void sent.field('caption', caption);
        return sent.attach('file', jpegWithDetails('taken'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
      };
      await upload(owner, 'WASH_AREA').expect(403);
      await upload(supervisor, null).expect(400);
      await http()
        .post(`/public-page/outlets/${outletId}/photos`)
        .set(bearer(supervisor))
        .field('caption', 'WASH_AREA')
        .attach('file', Buffer.from('not a picture'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .expect(400);
      taken = (await upload(supervisor, 'WASH_AREA').expect(201)).body as Photo;
      expect(taken).toMatchObject({ outletId, caption: 'WASH_AREA', status: 'PROPOSED' });
    });

    it('do not appear, and cannot be fetched, before ECCS approves them', async () => {
      expect((await expectLive()).photos).toEqual([]);
      for (const place of [0, 1, 2, 'abc', '1.jpg']) await publicPhoto(place).expect(404);
      // The Owner sees only that some are waiting.
      expect(await settings(owner)).toMatchObject({ photos: [], photosWaiting: 3 });
    });

    it('wait in ECCS’s queue, the longest-waiting first, with who proposed them', async () => {
      const queue = (await photos(admin)).filter((photo) => photo.outletId === outletId);
      expect(queue.map((photo) => photo.id)).toEqual([first.id, second.id, taken.id]);
      expect(queue[0]).toMatchObject({ status: 'PROPOSED', caption: 'GRILL', proposedByName: supervisorName, sourcePhotoId: visitPhotos[0] });
      expect(queue[0]!.path).toMatch(/^\/attachments\/.+\/content\?exp=\d+&sig=/);
      const waiting = (await http().get('/public-page/photos/waiting').set(bearer(admin)).expect(200)).body as { waiting: number };
      expect(waiting.waiting).toBeGreaterThanOrEqual(3);
      for (const session of [owner, manager, supervisor]) await http().get('/public-page/photos/waiting').set(bearer(session)).expect(403);
      await http().get('/public-page/photos').query({ status: 'NONSENSE' }).set(bearer(admin)).expect(400);
    });

    it('are approved or rejected by ECCS admins only, once, and a rejection needs a reason', async () => {
      const approve = (session: string, id: string) => http().post(`/public-page/photos/${id}/approve`).set(bearer(session));
      const reject = (session: string, id: string, body: object = { reason: 'Shows a person or a face' }) =>
        http().post(`/public-page/photos/${id}/reject`).set(bearer(session)).send(body);
      for (const session of [owner, manager, chef, supervisor]) {
        await approve(session, first.id).expect(403);
        await reject(session, second.id).expect(403);
      }
      await reject(admin, second.id, {}).expect(400);
      await approve(admin, 'no-such-photo').expect(404);

      expect((await approve(admin, first.id).expect(200)).body).toMatchObject({ status: 'APPROVED', shown: true, proposedByName: supervisorName });
      expect((await reject(admin, second.id).expect(200)).body).toMatchObject({ status: 'REJECTED', rejectReason: 'Shows a person or a face', shown: false });
      // A decision is made once.
      await approve(admin, first.id).expect(409);
      await approve(admin, second.id).expect(409);
      await reject(admin, first.id).expect(409);
    });

    it('then appear on the page, served by their place on it with the camera’s details cut out', async () => {
      const page = (await publicPage().expect(200)).body as { photos: unknown[] };
      expect(page.photos).toEqual([{ n: 1, caption: 'GRILL', date: daysAgo(3) }]);

      const answer = await publicPhoto(1).buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
      expect(answer.status).toBe(200);
      expect(answer.headers['content-type']).toBe('image/jpeg');
      const file = answer.body as Buffer;
      expect(file.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(file.toString('latin1')).toContain('picture data one');
      expect(file.toString('latin1')).not.toContain(SECRET);
      expect(file.equals(stripPhotoDetails(jpegWithDetails('one'), 'image/jpeg'))).toBe(true);

      // Only the photos the page lists: not the rejected one, not the waiting one, nothing by id.
      for (const place of [0, 2, 3, first.id, visitPhotos[0]!]) await publicPhoto(place).expect(404);
      // And none at all once the page is not showing.
      await setEnabled(owner, false).expect(200);
      await publicPhoto(1).expect(404);
      await setEnabled(owner, true).expect(200);
      await publicPhoto(1).expect(200);
    });

    it('are listed for each person as far as it concerns them', async () => {
      // The Supervisor: everything they proposed, with ECCS's reason for a rejection.
      const mine = await photos(supervisor, { outletId });
      expect(mine.map((photo) => photo.id).sort()).toEqual([first.id, second.id, taken.id].sort());
      expect(mine.find((photo) => photo.id === second.id)).toMatchObject({ status: 'REJECTED', rejectReason: 'Shows a person or a face' });
      // The restaurant: only what is on its page, without who proposed it.
      for (const session of [owner, manager]) {
        const theirs = await photos(session, { outletId });
        expect(theirs).toMatchObject([{ id: first.id, status: 'APPROVED', proposedByName: null, rejectReason: null, sourcePhotoId: null, shown: true }]);
      }
      expect((await settings(owner)).photos).toMatchObject([{ id: first.id, shown: true }]);
      expect(await photos(otherManager, { outletId })).toEqual([]);
      await http().get('/public-page/photos').set(bearer(chef)).expect(403);
      // ECCS can look back at what was rejected.
      expect((await photos(admin, { status: 'REJECTED' })).map((photo) => photo.id)).toContain(second.id);
    });

    it('can be removed from the page by the Owner at any time, for good', async () => {
      const remove = (session: string, id: string) => http().delete(`/public-page/photos/${id}`).set(bearer(session));
      for (const session of [manager, chef, supervisor, otherManager]) await remove(session, first.id).expect(403);
      // Only a photo that is on the page.
      await remove(owner, taken.id).expect(409);
      await remove(owner, 'no-such-photo').expect(404);

      await remove(owner, first.id).expect(204);
      expect(((await publicPage().expect(200)).body as { photos: unknown[] }).photos).toEqual([]);
      await publicPhoto(1).expect(404);
      expect((await settings(owner)).photos).toEqual([]);
      // Asking twice is harmless, and the photo cannot be proposed again.
      await remove(owner, first.id).expect(204);
      await propose(supervisor, visitPhotos[0]!).expect(409);
      expect((await photos(admin, { status: 'APPROVED' })).find((photo) => photo.id === first.id)).toMatchObject({ removed: true, shown: false });
    });

    it('shows only the newest six', async () => {
      const db = prisma.client;
      const profile = await db.publicProfile.findUniqueOrThrow({ where: { outletId } });
      const captions = ['GRILL', 'HOOD', 'COLD_STORAGE', 'PREP_AREA', 'FLOOR_DRAINS', 'WASH_AREA', 'GRILL'];
      for (const [index, caption] of captions.entries()) {
        const attachmentId = await photoOf(null, `many-${index}`);
        await db.publicPhoto.create({
          data: { profileId: profile.id, attachmentId, captionCode: caption, status: 'APPROVED', decidedAt: new Date(Date.now() - (10 - index) * 60_000) },
        });
      }
      const page = (await expectLive()) as { photos: { n: number; caption: string }[] };
      expect(page.photos).toHaveLength(PUBLIC_PAGE_RULES.maxPhotos);
      // The most recently approved first; the oldest of the seven is left off.
      expect(page.photos.map((photo) => photo.caption)).toEqual(['GRILL', 'WASH_AREA', 'FLOOR_DRAINS', 'PREP_AREA', 'COLD_STORAGE', 'HOOD']);
      await publicPhoto(6).expect(200);
      await publicPhoto(7).expect(404);
      const mine = (await settings(owner)).photos;
      expect(mine).toHaveLength(7);
      expect(mine.filter((photo) => photo.shown)).toHaveLength(6);
    });
  });
});
