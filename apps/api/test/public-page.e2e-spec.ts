// The customer QR page: what a diner's phone is given without logging in (yesterday's
// hygiene score, the daily checklists, photos, ECCS's inspection when there is one),
// when it is given nothing, the restaurant's switch, ECCS's take-down, the link, and
// the photos proposed by a Supervisor or put forward by the restaurant from its own
// daily checks, then approved, rejected and removed. Runs against the local database
// with the sample seed loaded and local object storage running. Everything is done on
// two throwaway outlets of the Deccan Biryani sample restaurant, with a throwaway
// Manager, and removed afterwards; the sample outlets and people are only read.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { calculateScore, inspectionShownUntil, isLocalOnlyAddress, photoShownUntil, PUBLIC_PAGE_RULES, SCORE_RULE_VERSION } from '@eccs/shared';
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
/** A second throwaway outlet of the same restaurant: it has no score, and its checklist photos are another outlet's. */
const OTHER_CODE = 'E2EPP-QR0002';
const OTHER_NAME = 'E2E page outlet two';
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
  canPropose: boolean;
};
type Photo = {
  id: string;
  outletId: string;
  caption: string;
  status: string;
  source: string;
  takenOn: string;
  shownUntil: string;
  expired: boolean;
  path: string;
  proposedByName: string | null;
  rejectReason: string | null;
  removed: boolean;
  shown: boolean;
};
type CheckPhotos = {
  eligible: { attachmentId: string; path: string; date: string; checklist: Record<string, string>; check: Record<string, string> }[];
  proposed: Photo[];
  canPropose: boolean;
};
type Page = {
  score: Record<string, unknown> | null;
  checklists: unknown[];
  selfChecks: unknown;
  photos: { n: number; caption: string; date: string; by: string }[];
  inspection: Record<string, unknown> | null;
  services: unknown[];
  updatedAt: string;
};

const daysAgo = (days: number) => indiaDate(new Date(Date.now() - days * 86_400_000));
const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
/** A moment on an India date: 06:30 UTC is noon in India. */
const noon = (date: string) => new Date(`${date}T06:30:00.000Z`);

// What the scorer makes of the throwaway outlet's yesterday (see beforeAll): of the three
// checklists due, one was handed in on time, one late and one not at all (15 of 30), and
// the one licence is in date with no copy on file (5 of 10).
const LICENCES = { key: 'licences', measured: true, earned: 5, max: 10 };
const CHECKLISTS = { key: 'checklists', measured: true, earned: 15, max: 30 };
/** With no inspection in it: 20 of the 40 points that could be earned. */
const PROVISIONAL = {
  score: 50,
  band: 'NEEDS_ATTENTION',
  provisional: true,
  parts: [{ key: 'inspection', measured: false, earned: 0, max: 60 }, LICENCES, CHECKLISTS],
};
/** With ECCS's inspection of 86.4 in it: 51.8 + 5 + 15 of 100. */
const INSPECTED = {
  score: 72,
  band: 'FAIR',
  provisional: false,
  inspection: 'COUNTED',
  parts: [{ key: 'inspection', measured: true, earned: 51.8, max: 60 }, LICENCES, CHECKLISTS],
};

describe('Customer QR page (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let pages: PublicPageService;
  let storage: StorageService;
  let outletId: string;
  let otherOutletId: string;
  let organizationName: string;
  let owner: string;
  let ownerName: string;
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
  /** Proof photos of the outlet's own daily checks: the two that may be put forward, and the ones that may not. */
  let goodPhoto: string;
  let earlierGoodPhoto: string;
  let problemPhoto: string;
  let unfinishedPhoto: string;
  let doubtfulPhoto: string;
  let oldPhoto: string;
  let otherOutletPhoto: string;
  let token: string;

  const http = () => request(app.getHttpServer());
  const bearer = (session: string) => ({ Authorization: `Bearer ${session}` });
  const tokenOf = (url: string) => url.split('/k/')[1]!;
  const settings = async (session: string, of: string = outletId): Promise<Settings> =>
    (await http().get(`/public-page/outlets/${of}`).set(bearer(session)).expect(200)).body;
  const setEnabled = (session: string, enabled: boolean, of: string = outletId) =>
    http().patch(`/public-page/outlets/${of}`).set(bearer(session)).send({ enabled });
  const publicPage = (forToken: string = token) => http().get(`/public/pages/${forToken}`);
  const publicPhoto = (place: string | number, forToken: string = token) => http().get(`/public/pages/${forToken}/photos/${place}`);
  const propose = (session: string, attachmentId: string, caption = 'GRILL') =>
    http().post('/public-page/photos').set(bearer(session)).send({ attachmentId, caption });
  const photos = async (session: string, query: Record<string, string> = {}): Promise<Photo[]> =>
    (await http().get('/public-page/photos').query(query).set(bearer(session)).expect(200)).body;
  const checkPhotos = (session: string, of: string = outletId) => http().get(`/public-page/outlets/${of}/check-photos`).set(bearer(session));
  const proposeCheck = (session: string, attachmentId: string, caption = 'PREP_AREA', of: string = outletId) =>
    http().post(`/public-page/outlets/${of}/check-photos`).set(bearer(session)).send({ attachmentId, caption });
  const approve = (session: string, id: string) => http().post(`/public-page/photos/${id}/approve`).set(bearer(session));
  const reject = (session: string, id: string, body: object = { reason: 'Shows a person or a face' }) =>
    http().post(`/public-page/photos/${id}/reject`).set(bearer(session)).send(body);
  const remove = (session: string, id: string) => http().delete(`/public-page/photos/${id}`).set(bearer(session));

  /** What an unknown link answers. Every "nothing to show" case must answer exactly this. */
  let unknown: { status: number; body: unknown; cache: string | undefined };
  /**
   * The names of the people behind the records: the Supervisor, the Owner whose name is on the answers, and the
   * Manager who handed the checklists in. The sample people's names are the founder's to change, so a name
   * that happens to be part of the restaurant's own name (which the page does show) is left out of the check.
   */
  const peopleNames = () => [supervisorName, ownerName, TEMP_MANAGER].filter((name) => name.length > 2 && !organizationName.includes(name));
  async function expectNothing(forToken: string = token) {
    // Records written straight into the database are not known to the service's one-minute memory.
    pages.forget();
    const answer = await publicPage(forToken);
    expect({ status: answer.status, body: answer.body, cache: answer.headers['cache-control'] }).toEqual(unknown);
    await publicPhoto(1, forToken).expect(404);
  }
  async function expectLive(forToken: string = token) {
    pages.forget();
    return (await publicPage(forToken).expect(200)).body as Page;
  }

  async function cleanUp() {
    const db = prisma.client;
    for (const code of [OUTLET_CODE, OTHER_CODE]) {
      const outlet = await db.outlet.findUnique({ where: { code }, select: { id: true } });
      if (!outlet) continue;
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

  const me = async (session: string) => (await http().get('/auth/me').set(bearer(session)).expect(200)).body as { id: string; name: string };

  /** A photo in storage and on record: of a visit, of a daily check's answer, or belonging to nothing. */
  async function photoOf(
    of: { jobId?: string; checklistResponseId?: string; outletId?: string; flags?: object[] },
    mark: string,
    takenOn: string = daysAgo(3),
  ): Promise<string> {
    const body = jpegWithDetails(mark);
    const at = of.outletId ?? outletId;
    const created = await prisma.client.attachment.create({
      data: {
        outletId: at,
        jobId: of.jobId ?? null,
        checklistResponseId: of.checklistResponseId ?? null,
        kind: of.jobId ? 'AFTER' : 'PROOF',
        storageKey: `outlets/${at}/e2e/${mark}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: body.length,
        capturedAt: noon(takenOn),
        uploadedById: supervisorId,
        ...(of.flags && { integrityFlags: of.flags, doubtful: true }),
      },
    });
    await storage.put(created.storageKey, body, 'image/jpeg');
    return created.id;
  }

  /** One of the kitchen's own daily checklists, with its checks, as set up on a given day. */
  async function checklist(title: string, dueTime: string, since: Date, labels: string[], at: string = outletId, isActive = true) {
    return prisma.client.outletChecklist.create({
      data: {
        outlet: { connect: { id: at } },
        frequency: 'DAILY',
        dueTime,
        isActive,
        createdAt: since,
        template: {
          create: {
            kind: 'DAILY',
            outletId: at,
            title: { en: title },
            items: { create: labels.map((label, index) => ({ position: index + 1, label: { en: label }, outletId: at })) },
          },
        },
      },
      include: { template: { include: { items: { orderBy: { position: 'asc' } } } } },
    });
  }

  /** A day's record of a checklist: handed in at noon unless said otherwise, with the given answers. Returns the id of each answer. */
  async function record(
    list: { id: string; outletId: string; template: { items: { id: string }[] } },
    date: string,
    answers: { passed: boolean; note?: string }[],
    people: { submittedById: string; answeredById: string },
    status: 'SUBMITTED' | 'IN_PROGRESS' = 'SUBMITTED',
  ): Promise<string[]> {
    const at = noon(date);
    const made = await prisma.client.checklistRun.create({
      data: {
        outletChecklistId: list.id,
        outletId: list.outletId,
        date: dbDate(date),
        status,
        ...(status === 'SUBMITTED' && { submittedAt: at, submittedById: people.submittedById }),
        responses: {
          create: answers.map((answer, index) => ({
            itemId: list.template.items[index]!.id,
            passed: answer.passed,
            note: answer.note ?? null,
            capturedAt: at,
            answeredById: people.answeredById,
          })),
        },
      },
      include: { responses: true },
    });
    return list.template.items.map((item) => made.responses.find((response) => response.itemId === item.id)?.id ?? '');
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
    otherOutletId = (
      await db.outlet.create({
        data: { organizationId: seeded.organizationId, name: OTHER_NAME, code: OTHER_CODE, address: 'Other Road', city: 'Hyderabad' },
      })
    ).id;

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    chef = await pinLogin(CODES.kukatpally, PINS.chef);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    ({ id: supervisorId, name: supervisorName } = await me(supervisor));
    const ownerIs = await me(owner);
    ownerName = ownerIs.name;
    // A Manager of the throwaway outlet itself.
    const created = await http()
      .post('/restaurant-users')
      .set(bearer(owner))
      .send({ name: TEMP_MANAGER, role: 'MANAGER', outletId, language: 'EN' })
      .expect(201);
    manager = await pinLogin(OUTLET_CODE, created.body.pin as string);
    // The Manager hands the checklists in; the Owner's name is on the answers. Neither may reach a diner.
    const people = { submittedById: (await me(manager)).id, answeredById: ownerIs.id };

    // The kitchen's own daily checklists. There is no ECCS inspection yet.
    const [yesterday, dayBefore] = [daysAgo(1), daysAgo(2)];
    const setUp = noon(daysAgo(4));
    // Handed in at noon yesterday and the day before, in good time for 23:59. One check was fine, one was a problem.
    const main = await checklist('E2E page checklist', '23:59', setUp, ['Secret check wording', 'Secret second check']);
    const [fine, problem] = await record(main, yesterday, [{ passed: true }, { passed: false, note: 'Secret problem note' }], people);
    const [earlierFine] = await record(main, dayBefore, [{ passed: true }, { passed: false, note: 'Secret problem note' }], people);
    // A day long before, outside the 14 days whose photos can be put forward.
    const [longAgo] = await record(main, daysAgo(20), [{ passed: true }, { passed: true }], people);
    // Due at 09:00 and handed in at noon: late.
    const late = await checklist('E2E late checklist', '09:00', setUp, ['Secret late check']);
    const [lateAnswer] = await record(late, yesterday, [{ passed: true }], people);
    await record(late, dayBefore, [{ passed: true }], people);
    // Set up yesterday, begun and never handed in.
    const missed = await checklist('E2E missed checklist', '23:58', noon(yesterday), ['Secret missed check']);
    const [unfinished] = await record(missed, yesterday, [{ passed: true }], people, 'IN_PROGRESS');
    // Set up today: it was not due yesterday. And one with no checks yet, which is not handed out at all.
    await checklist('E2E new checklist', '23:57', new Date(), ['Secret new check']);
    await checklist('E2E empty checklist', '23:56', setUp, []);

    goodPhoto = await photoOf({ checklistResponseId: fine! }, 'check-good', yesterday);
    earlierGoodPhoto = await photoOf({ checklistResponseId: earlierFine! }, 'check-earlier', dayBefore);
    problemPhoto = await photoOf({ checklistResponseId: problem! }, 'check-problem', yesterday);
    oldPhoto = await photoOf({ checklistResponseId: longAgo! }, 'check-old', daysAgo(20));
    unfinishedPhoto = await photoOf({ checklistResponseId: unfinished! }, 'check-unfinished', yesterday);
    // Marked by the photo checks as all but the same picture as an earlier one, so the day it shows is in doubt.
    doubtfulPhoto = await photoOf(
      { checklistResponseId: lateAnswer!, flags: [{ code: 'LOOKS_SAME', certain: false, earlierOn: daysAgo(9) }] },
      'check-doubtful',
      yesterday,
    );
    await db.licence.create({ data: { outletId, type: 'FSSAI', name: 'FSSAI licence', number: FSSAI_NUMBER, expiresOn: dbDate(daysAgo(-200)) } });

    // The other outlet: one checklist, since removed, handed in five days ago. Nothing was due yesterday, so it has no score.
    const elsewhere = await checklist('E2E other checklist', '23:59', noon(daysAgo(6)), ['Secret other check'], otherOutletId, false);
    const [elsewhereFine] = await record(elsewhere, daysAgo(5), [{ passed: true }], people);
    otherOutletPhoto = await photoOf({ checklistResponseId: elsewhereFine!, outletId: otherOutletId }, 'check-elsewhere', daysAgo(5));

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
    visitPhotos = [await photoOf({ jobId: visit.id }, 'one'), await photoOf({ jobId: visit.id }, 'two'), await photoOf({ jobId: visit.id }, 'three')];
    openVisitPhoto = await photoOf({ jobId: openVisit.id }, 'open');
    loosePhoto = await photoOf({}, 'loose');

    const answer = await publicPage('no-such-link-0000000000');
    unknown = { status: answer.status, body: answer.body, cache: answer.headers['cache-control'] };
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  /** ECCS's inspection of the throwaway outlet: 86.4 out of 100, grade A. Made part-way through, to show the page does not wait for it. */
  async function inspect(conductedAt: Date, status: 'SUBMITTED' | 'APPROVED' = 'APPROVED') {
    const template = await prisma.client.checklistTemplate.findFirstOrThrow({ where: { kind: 'INSPECTION' } });
    inspectionId = (
      await prisma.client.inspection.create({
        data: {
          outletId,
          templateId: template.id,
          supervisorId,
          status,
          conductedAt,
          startedAt: conductedAt,
          completedAt: conductedAt,
          approvedAt: status === 'APPROVED' ? conductedAt : null,
          overallScore: 86.4,
          grade: 'A',
          reportNumber: REPORT_NUMBER,
        },
      })
    ).id;
  }
  const inspection = (data: Record<string, unknown>) => prisma.client.inspection.update({ where: { id: inspectionId }, data });

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
        // Told for information only: the page no longer waits for an inspection.
        inspection: { state: 'NONE', date: null, shownUntil: null },
        photos: [],
        photosWaiting: 0,
        canSwitch: true,
        canTakeDown: false,
        canPropose: true,
      });
      token = tokenOf(page.url);
      // 128 random bits, written in 22 letters, digits, "-" and "_".
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(page.url.endsWith(`/k/${token}`)).toBe(true);
      expect(page.localOnly).toBe(isLocalOnlyAddress(page.url));
      expect(page.preview).toMatchObject({ outletName: OUTLET_NAME, inspection: null, score: { score: 50, provisional: true } });
      // Asking again does not make another link.
      expect((await settings(owner)).url).toBe(page.url);
    });

    it('is unknown to the world while it is off', async () => {
      expect(unknown.status).toBe(404);
      await expectNothing();
    });

    it('can be read by the Manager and ECCS, and by nobody else', async () => {
      expect(await settings(manager)).toMatchObject({ state: 'OFF', canSwitch: false, canTakeDown: false, canPropose: true });
      expect(await settings(admin)).toMatchObject({ state: 'OFF', canSwitch: false, canTakeDown: true, canPropose: false });
      await http().get(`/public-page/outlets/${outletId}`).set(bearer(chef)).expect(403);
      await http().get(`/public-page/outlets/${outletId}`).set(bearer(otherManager)).expect(404);
      await http().get(`/public-page/outlets/${outletId}`).expect(401);
      await http().get('/public-page/outlets/no-such-outlet').set(bearer(admin)).expect(404);
    });

    it('is turned on by the Owner only, and needs no ECCS inspection', async () => {
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
      expect(on).toMatchObject({ enabled: true, state: 'LIVE', inspection: { state: 'NONE' } });
    });
  });

  describe('what a diner is given before ECCS has inspected', () => {
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
        yesterday: daysAgo(1),
        // Yesterday's score, said to be without an inspection.
        score: { date: daysAgo(1), isYesterday: true, ...PROVISIONAL, inspection: 'NOT_INSPECTED' },
        // In the order they fall due, with yesterday's result for each. The one with no checks is not listed.
        checklists: [
          { name: { en: 'E2E late checklist' }, checks: 1, result: 'LATE' },
          { name: { en: 'E2E new checklist' }, checks: 1, result: 'NOT_DUE' },
          { name: { en: 'E2E missed checklist' }, checks: 1, result: 'NOT_DONE' },
          { name: { en: 'E2E page checklist' }, checks: 2, result: 'ON_TIME' },
        ],
        // All of a day's checklists were handed in on two days (the day before yesterday, and one long before);
        // yesterday one was not, and nothing was handed in on the two days before that. Today is not counted.
        selfChecks: { handedIn: 2, days: 5 },
        photos: [],
        inspection: null,
        services: [
          { code: 'PEST', name: pest.name, date: daysAgo(3), certificateNumber: CERTIFICATE_NUMBER, certificateValidUntil: daysAgo(-12) },
        ],
        fssaiNumber: FSSAI_NUMBER,
        eccsPhone: env.SUPPORT_PHONE,
        updatedAt: expect.any(String),
      });
    });

    it('carries no ids, no names of people, no times of day and no check or problem wording', async () => {
      const page = (await publicPage().expect(200)).body as Page;
      const text = JSON.stringify(page);
      for (const hidden of [outletId, supervisorId, ...peopleNames(), 'Secret', OUTLET_CODE, 'Test Road']) {
        expect(text).not.toContain(hidden);
      }
      // Every name of a field, at any depth: nothing that could hold a person, an id, a time or a note.
      const keys = new Set<string>();
      const collect = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === 'object') {
          for (const [key, inner] of Object.entries(value)) {
            keys.add(key);
            collect(inner);
          }
        }
      };
      collect(page);
      const expected = new Set([
        // The page itself.
        'restaurantName', 'outletName', 'city', 'yesterday', 'score', 'checklists', 'selfChecks', 'photos', 'inspection', 'services',
        'fssaiNumber', 'eccsPhone', 'updatedAt',
        // The score and its three parts.
        'date', 'isYesterday', 'band', 'provisional', 'parts', 'key', 'measured', 'earned', 'max',
        // A checklist (its name as typed, in English here), the 30-day count, a service.
        'name', 'en', 'checks', 'result', 'handedIn', 'days', 'code', 'certificateNumber', 'certificateValidUntil',
        // The service's name comes in each language it has been translated into.
        ...Object.keys((page.services[0] as { name: Record<string, string> }).name),
      ]);
      expect([...keys].sort()).toEqual([...expected].sort());
      // No id of any record, and no time of day (the checklists' due times, when they were handed in) apart from the page's own.
      const { updatedAt: _updatedAt, ...rest } = page;
      expect(JSON.stringify(rest)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
      expect(JSON.stringify(rest)).not.toMatch(/\d{1,2}:\d{2}/);
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

  describe('the hygiene score when yesterday has none', () => {
    let otherToken: string;
    /** A stored day's score of the other outlet, as the scorer would have written it: no licence on record, its one checklist on time. */
    const store = (date: string) => {
      const result = calculateScore({
        checklists: { day: 'TODAY', due: 1, onTime: 1, late: 0 },
        licences: { valid: 0, withoutCopy: 0, expired: 0, expiringSoon: 0, fssaiMissing: true },
        inspection: null,
      });
      const breakdown = { version: SCORE_RULE_VERSION, band: result.band, earned: result.earned, possible: result.possible, components: result.components };
      return prisma.client.hygieneScoreSnapshot.create({
        // Stored as plain JSON, as the scorer stores it.
        data: { outletId: otherOutletId, date: dbDate(date), score: result.score ?? 0, breakdown: JSON.parse(JSON.stringify(breakdown)) as object },
      });
    };
    const clear = () => prisma.client.hygieneScoreSnapshot.deleteMany({ where: { outletId: otherOutletId } });

    it('says plainly that there is no recent score, and still shows the page', async () => {
      const on = (await setEnabled(owner, true, otherOutletId).expect(200)).body as Settings;
      expect(on).toMatchObject({ state: 'LIVE', outletName: OTHER_NAME });
      otherToken = tokenOf(on.url);
      const page = await expectLive(otherToken);
      // Neither an inspection nor a checklist to count yesterday: no score, and no daily checklist in use now.
      expect(page).toMatchObject({ score: null, checklists: [], selfChecks: { handedIn: 1, days: 1 }, inspection: null, photos: [] });
    });

    it('shows the most recent day’s score of the last week instead, with its own date', async () => {
      await store(daysAgo(5));
      await store(daysAgo(3));
      expect((await expectLive(otherToken)).score).toEqual({
        date: daysAgo(3),
        isYesterday: false,
        // 30 of 30 for the checklist and 0 of 10 for licences: 30 of 40.
        score: 75,
        band: 'FAIR',
        provisional: true,
        inspection: 'NOT_INSPECTED',
        parts: [
          { key: 'inspection', measured: false, earned: 0, max: 60 },
          { key: 'licences', measured: true, earned: 0, max: 10 },
          { key: 'checklists', measured: true, earned: 30, max: 30 },
        ],
      });
    });

    it('never shows today’s unfinished score, or one more than a week old', async () => {
      await clear();
      await store(daysAgo(0));
      await store(daysAgo(PUBLIC_PAGE_RULES.scoreWithinDays + 1));
      expect((await expectLive(otherToken)).score).toBeNull();
      await store(daysAgo(PUBLIC_PAGE_RULES.scoreWithinDays));
      expect((await expectLive(otherToken)).score).toMatchObject({ date: daysAgo(PUBLIC_PAGE_RULES.scoreWithinDays), isYesterday: false });
      await clear();
      await setEnabled(owner, false, otherOutletId).expect(200);
      await expectNothing(otherToken);
    });
  });

  describe('ECCS’s inspection', () => {
    it('is not on the page, and not in the score, until ECCS has approved it', async () => {
      await inspect(noon(daysAgo(10)), 'SUBMITTED');
      const page = await expectLive();
      expect(page.inspection).toBeNull();
      // ECCS has inspected, so the page no longer says it has not; there is just no result yet.
      expect(page.score).toEqual({ date: daysAgo(1), isYesterday: true, ...PROVISIONAL, inspection: 'NO_CURRENT_RESULT' });
      expect(await settings(owner)).toMatchObject({ state: 'LIVE', inspection: { state: 'NONE' } });
    });

    it('appears once approved, with its report number, and counts in yesterday’s score', async () => {
      await inspection({ status: 'APPROVED', approvedAt: new Date() });
      const page = await expectLive();
      expect(page.inspection).toEqual({
        score: 86,
        grade: 'A',
        date: daysAgo(10),
        shownUntil: inspectionShownUntil(daysAgo(10)),
        reportNumber: REPORT_NUMBER,
      });
      expect(page.score).toEqual({ date: daysAgo(1), isYesterday: true, ...INSPECTED });
      expect(await settings(owner)).toMatchObject({
        state: 'LIVE',
        inspection: { state: 'CURRENT', date: daysAgo(10), shownUntil: inspectionShownUntil(daysAgo(10)) },
        preview: { inspection: { score: 86, reportNumber: REPORT_NUMBER }, score: { score: 72, provisional: false } },
      });
      // Still nothing that names the inspection's record or the Supervisor.
      const text = JSON.stringify(page);
      for (const hidden of [inspectionId, supervisorId, ...peopleNames()]) expect(text).not.toContain(hidden);
    });

    it('is shown without being in the score when it was carried out after the day the score is for', async () => {
      await inspection({ conductedAt: new Date(), startedAt: new Date() });
      const page = await expectLive();
      expect(page.inspection).toMatchObject({ date: daysAgo(0), reportNumber: REPORT_NUMBER });
      expect(page.score).toEqual({ date: daysAgo(1), isYesterday: true, ...PROVISIONAL, inspection: 'NOT_IN_THIS_SCORE' });
    });

    it('drops off by itself when it is too old, while the rest of the page stays', async () => {
      const valid = PUBLIC_PAGE_RULES.inspectionValidDays;
      // Still shown on its last day.
      await inspection({ conductedAt: noon(daysAgo(valid)), startedAt: noon(daysAgo(valid)) });
      expect((await expectLive()).inspection).toMatchObject({ date: daysAgo(valid), shownUntil: indiaDate() });
      // Gone the day after; until 13 Oct 2026 the whole page went with it. Yesterday was the inspection's
      // last day, so yesterday's score still has it.
      await inspection({ conductedAt: noon(daysAgo(valid + 1)), startedAt: noon(daysAgo(valid + 1)) });
      let page = await expectLive();
      expect(page.inspection).toBeNull();
      expect(page.score).toEqual({ date: daysAgo(1), isYesterday: true, ...INSPECTED });
      expect(page.checklists).toHaveLength(4);
      expect(await settings(owner)).toMatchObject({ enabled: true, state: 'LIVE', inspection: { state: 'EXPIRED' } });
      // A day later the score no longer has it either, and says there is no current result.
      await inspection({ conductedAt: noon(daysAgo(valid + 2)), startedAt: noon(daysAgo(valid + 2)) });
      page = await expectLive();
      expect(page.inspection).toBeNull();
      expect(page.score).toEqual({ date: daysAgo(1), isYesterday: true, ...PROVISIONAL, inspection: 'NO_CURRENT_RESULT' });

      await inspection({ conductedAt: noon(daysAgo(10)), startedAt: noon(daysAgo(10)) });
      expect((await expectLive()).inspection).toMatchObject({ date: daysAgo(10) });
    });

    it('is not shown without a report number a diner could ask about', async () => {
      await inspection({ reportNumber: null });
      expect((await expectLive()).inspection).toBeNull();
      await inspection({ reportNumber: REPORT_NUMBER });
      expect((await expectLive()).inspection).toMatchObject({ reportNumber: REPORT_NUMBER });
    });
  });

  describe('nothing to show', () => {
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
      // The Owner still sees what turning it on would publish.
      expect(await settings(owner)).toMatchObject({ state: 'OFF', preview: { outletName: OUTLET_NAME } });
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

  describe('photos from ECCS’s visits', () => {
    let first: Photo;
    let second: Photo;
    let taken: Photo;

    it('are proposed by the Supervisor from their own finished visit, once each', async () => {
      first = (await propose(supervisor, visitPhotos[0]!, 'GRILL').expect(201)).body as Photo;
      expect(first).toMatchObject({
        outletId,
        caption: 'GRILL',
        status: 'PROPOSED',
        source: 'ECCS_VISIT',
        takenOn: daysAgo(3),
        shownUntil: photoShownUntil(daysAgo(3)),
        expired: false,
        removed: false,
        shown: false,
      });
      second = (await propose(supervisor, visitPhotos[1]!, 'HOOD').expect(201)).body as Photo;

      const again = await propose(supervisor, visitPhotos[0]!).expect(409);
      expect(again.body).toMatchObject({ code: 'PHOTO_ALREADY_PROPOSED' });
      await propose(supervisor, visitPhotos[2]!, 'CEILING').expect(400);
      await propose(supervisor, 'not-an-id').expect(400);
      // A visit still under way, a photo that belongs to no visit of theirs, and the restaurant's own checklist photo.
      await propose(supervisor, openVisitPhoto).expect(409);
      await propose(supervisor, loosePhoto).expect(404);
      await propose(supervisor, goodPhoto).expect(404);
      // Only a Supervisor proposes from a visit.
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
      expect(taken).toMatchObject({ outletId, caption: 'WASH_AREA', status: 'PROPOSED', source: 'ECCS_FOR_PAGE', takenOn: daysAgo(0) });
    });

    it('do not appear, and cannot be fetched, before ECCS approves them', async () => {
      expect((await expectLive()).photos).toEqual([]);
      for (const place of [0, 1, 2, 'abc', '1.jpg']) await publicPhoto(place).expect(404);
      // The Owner sees only that some are waiting.
      expect(await settings(owner)).toMatchObject({ photos: [], photosWaiting: 3 });
    });

    it('wait in ECCS’s queue, the longest-waiting first, with who proposed them and where they came from', async () => {
      const queue = (await photos(admin)).filter((photo) => photo.outletId === outletId);
      expect(queue.map((photo) => photo.id)).toEqual([first.id, second.id, taken.id]);
      expect(queue[0]).toMatchObject({
        status: 'PROPOSED',
        caption: 'GRILL',
        source: 'ECCS_VISIT',
        proposedByName: supervisorName,
        sourcePhotoId: visitPhotos[0],
      });
      expect(queue[0]!.path).toMatch(/^\/attachments\/.+\/content\?exp=\d+&sig=/);
      const waiting = (await http().get('/public-page/photos/waiting').set(bearer(admin)).expect(200)).body as { waiting: number };
      expect(waiting.waiting).toBeGreaterThanOrEqual(3);
      for (const session of [owner, manager, supervisor]) await http().get('/public-page/photos/waiting').set(bearer(session)).expect(403);
      await http().get('/public-page/photos').query({ status: 'NONSENSE' }).set(bearer(admin)).expect(400);
    });

    it('are approved or rejected by ECCS admins only, once, and a rejection needs a reason', async () => {
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

    it('then appear on the page as taken by ECCS, served by their place on it with the camera’s details cut out', async () => {
      const page = (await publicPage().expect(200)).body as Page;
      expect(page.photos).toEqual([{ n: 1, caption: 'GRILL', date: daysAgo(3), by: 'ECCS' }]);

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
      for (const session of [manager, chef, supervisor, otherManager]) await remove(session, first.id).expect(403);
      // Only a photo that is on the page.
      await remove(owner, taken.id).expect(409);
      await remove(owner, 'no-such-photo').expect(404);

      await remove(owner, first.id).expect(204);
      expect(((await publicPage().expect(200)).body as Page).photos).toEqual([]);
      await publicPhoto(1).expect(404);
      expect((await settings(owner)).photos).toEqual([]);
      // Asking twice is harmless, and the photo cannot be proposed again.
      await remove(owner, first.id).expect(204);
      await propose(supervisor, visitPhotos[0]!).expect(409);
      expect((await photos(admin, { status: 'APPROVED' })).find((photo) => photo.id === first.id)).toMatchObject({ removed: true, shown: false });
    });
  });

  describe('photos from the restaurant’s own daily checks', () => {
    let put: Photo;
    let earlier: Photo;

    it('are offered to the Owner and the Manager: checks marked as fine, in checklists handed in during the last 14 days', async () => {
      for (const session of [owner, manager]) {
        const list = (await checkPhotos(session).expect(200)).body as CheckPhotos;
        // The newest day first. Not the photo of the reported problem, not the one from the checklist that was never
        // handed in, not the one from 20 days ago, not the one the photo checks marked, and nothing of another outlet.
        expect(list.eligible.map((photo) => photo.attachmentId)).toEqual([goodPhoto, earlierGoodPhoto]);
        expect(list.eligible[0]).toMatchObject({ date: daysAgo(1), checklist: { en: 'E2E page checklist' }, check: { en: 'Secret check wording' } });
        expect(list.eligible[0]!.path).toMatch(/^\/attachments\/.+\/content\?exp=\d+&sig=/);
        expect(list).toMatchObject({ proposed: [], canPropose: true });
      }
    });

    it('are not open to the Head Chef, to another restaurant, or to anyone at ECCS', async () => {
      await checkPhotos(chef).expect(403);
      await checkPhotos(otherManager).expect(404);
      // ECCS does not browse a restaurant's checklist photos: it is shown only the ones put forward.
      await checkPhotos(admin).expect(403);
      await checkPhotos(supervisor).expect(403);
      await http().get(`/public-page/outlets/${outletId}/check-photos`).expect(401);

      await proposeCheck(chef, goodPhoto).expect(403);
      await proposeCheck(otherManager, goodPhoto).expect(404);
      await proposeCheck(admin, goodPhoto).expect(403);
      await proposeCheck(supervisor, goodPhoto).expect(403);
    });

    it('cannot be put forward when they show a reported problem, belong elsewhere, or are not from a recent handed-in check', async () => {
      // The photo of a reported problem.
      await proposeCheck(owner, problemPhoto).expect(404);
      // Another outlet's photo, even of the same restaurant: not for this page, by the Owner or the Manager.
      await proposeCheck(owner, otherOutletPhoto).expect(404);
      await proposeCheck(manager, otherOutletPhoto).expect(404);
      // A checklist that was never handed in, a day too long ago, a photo marked as doubtful.
      await proposeCheck(owner, unfinishedPhoto).expect(404);
      await proposeCheck(owner, oldPhoto).expect(404);
      await proposeCheck(owner, doubtfulPhoto).expect(404);
      // Not a checklist photo at all: a visit's, or one that belongs to nothing.
      await proposeCheck(owner, visitPhotos[2]!).expect(404);
      await proposeCheck(owner, loosePhoto).expect(404);
      await proposeCheck(owner, goodPhoto, 'CEILING').expect(400);
      await proposeCheck(owner, 'not-an-id').expect(400);
      expect(((await checkPhotos(owner).expect(200)).body as CheckPhotos).proposed).toEqual([]);
    });

    it('are put forward by a person with a caption from the fixed list, once each, and then wait for ECCS', async () => {
      put = (await proposeCheck(owner, goodPhoto, 'PREP_AREA').expect(201)).body as Photo;
      expect(put).toMatchObject({
        outletId,
        caption: 'PREP_AREA',
        status: 'PROPOSED',
        source: 'DAILY_CHECK',
        // The day of the check it was the proof for.
        takenOn: daysAgo(1),
        shownUntil: photoShownUntil(daysAgo(1)),
        expired: false,
        proposedByName: null,
        removed: false,
        shown: false,
      });
      expect((await proposeCheck(owner, goodPhoto).expect(409)).body).toMatchObject({ code: 'PHOTO_ALREADY_PROPOSED' });
      // The Manager can put one forward too.
      earlier = (await proposeCheck(manager, earlierGoodPhoto, 'WASH_AREA').expect(201)).body as Photo;
      expect(earlier).toMatchObject({ source: 'DAILY_CHECK', takenOn: daysAgo(2), status: 'PROPOSED' });

      // Nothing is published by putting it forward.
      expect((await expectLive()).photos).toEqual([]);
      await publicPhoto(1).expect(404);
      const list = (await checkPhotos(owner).expect(200)).body as CheckPhotos;
      expect(list.eligible).toEqual([]);
      expect(list.proposed.map((photo) => [photo.id, photo.status, photo.shown])).toEqual([
        [earlier.id, 'PROPOSED', false],
        [put.id, 'PROPOSED', false],
      ]);
      // One of the Supervisor's is still waiting too.
      expect(await settings(owner)).toMatchObject({ photos: [], photosWaiting: 3 });
    });

    it('go through the same ECCS approval, which is shown where each photo came from', async () => {
      const queue = (await photos(admin)).filter((photo) => photo.outletId === outletId && photo.source === 'DAILY_CHECK');
      expect(queue.map((photo) => photo.id)).toEqual([put.id, earlier.id]);
      expect(queue[0]).toMatchObject({ status: 'PROPOSED', caption: 'PREP_AREA', source: 'DAILY_CHECK', proposedByName: ownerName, sourcePhotoId: goodPhoto });
      expect(queue[1]).toMatchObject({ proposedByName: TEMP_MANAGER });
      // The restaurant cannot approve its own photo.
      for (const session of [owner, manager]) await approve(session, put.id).expect(403);

      expect((await approve(admin, put.id).expect(200)).body).toMatchObject({ status: 'APPROVED', source: 'DAILY_CHECK', shown: true });
      expect((await reject(admin, earlier.id, { reason: 'Blurred, dark or unclear' }).expect(200)).body).toMatchObject({ status: 'REJECTED' });
    });

    it('then appear on the page as taken by the restaurant’s staff, with the camera’s details cut out', async () => {
      const page = (await publicPage().expect(200)).body as Page;
      expect(page.photos).toEqual([{ n: 1, caption: 'PREP_AREA', date: daysAgo(1), by: 'RESTAURANT' }]);
      // Still no names, ids, times of day or check wording.
      const { updatedAt: _updatedAt, ...rest } = page;
      const text = JSON.stringify(rest);
      for (const hidden of [goodPhoto, put.id, ...peopleNames(), 'Secret']) expect(text).not.toContain(hidden);
      expect(text).not.toMatch(/\d{1,2}:\d{2}/);

      const answer = await publicPhoto(1).buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
      expect(answer.status).toBe(200);
      const file = answer.body as Buffer;
      expect(file.toString('latin1')).toContain('picture data check-good');
      expect(file.toString('latin1')).not.toContain(SECRET);
      await publicPhoto(2).expect(404);
    });

    it('tell the restaurant what became of each, with the reason when ECCS did not approve one', async () => {
      const list = (await checkPhotos(manager).expect(200)).body as CheckPhotos;
      expect(list.proposed).toMatchObject([
        // Its own photo, so the restaurant is told why.
        { id: earlier.id, status: 'REJECTED', rejectReason: 'Blurred, dark or unclear', shown: false, proposedByName: null },
        { id: put.id, status: 'APPROVED', shown: true, removed: false, rejectReason: null },
      ]);
      expect((await settings(owner)).photos).toMatchObject([{ id: put.id, source: 'DAILY_CHECK', shown: true }]);
      // A decision stands: neither can be put forward again.
      await proposeCheck(owner, earlierGoodPhoto).expect(409);
    });

    it('drop off the page by themselves 90 days after the day they were taken', async () => {
      const db = prisma.client;
      const days = PUBLIC_PAGE_RULES.photoShownDays;
      // Still shown on the last day.
      await db.publicPhoto.update({ where: { id: put.id }, data: { takenOn: dbDate(daysAgo(days)) } });
      expect((await expectLive()).photos).toEqual([{ n: 1, caption: 'PREP_AREA', date: daysAgo(days), by: 'RESTAURANT' }]);
      // Gone the day after: from the page, from its photo address, and from the Owner's list of what is on the page.
      await db.publicPhoto.update({ where: { id: put.id }, data: { takenOn: dbDate(daysAgo(days + 1)) } });
      expect((await expectLive()).photos).toEqual([]);
      await publicPhoto(1).expect(404);
      expect((await settings(owner)).photos).toEqual([]);
      expect(((await checkPhotos(owner).expect(200)).body as CheckPhotos).proposed.find((photo) => photo.id === put.id)).toMatchObject({
        status: 'APPROVED',
        expired: true,
        shown: false,
      });
      // The same rule for a photo ECCS took.
      expect((await photos(admin, { status: 'APPROVED' })).find((photo) => photo.id === put.id)).toMatchObject({ expired: true, shown: false });

      await db.publicPhoto.update({ where: { id: put.id }, data: { takenOn: dbDate(daysAgo(1)) } });
      expect((await expectLive()).photos).toHaveLength(1);
    });

    it('can be removed by the Owner at any time, and not by the Manager', async () => {
      await remove(manager, put.id).expect(403);
      await remove(owner, put.id).expect(204);
      expect((await expectLive()).photos).toEqual([]);
      await publicPhoto(1).expect(404);
      expect((await settings(owner)).photos).toEqual([]);
      expect(((await checkPhotos(owner).expect(200)).body as CheckPhotos).proposed.find((photo) => photo.id === put.id)).toMatchObject({
        removed: true,
        shown: false,
      });
      await proposeCheck(owner, goodPhoto).expect(409);
    });
  });

  describe('the photos shown', () => {
    it('are only the newest six', async () => {
      const db = prisma.client;
      const profile = await db.publicProfile.findUniqueOrThrow({ where: { outletId } });
      const captions = ['GRILL', 'HOOD', 'COLD_STORAGE', 'PREP_AREA', 'FLOOR_DRAINS', 'WASH_AREA', 'GRILL'];
      for (const [index, caption] of captions.entries()) {
        const attachmentId = await photoOf({}, `many-${index}`);
        await db.publicPhoto.create({
          data: {
            profileId: profile.id,
            attachmentId,
            captionCode: caption,
            status: 'APPROVED',
            source: 'ECCS_FOR_PAGE',
            takenOn: dbDate(daysAgo(3)),
            decidedAt: new Date(Date.now() - (10 - index) * 60_000),
          },
        });
      }
      const page = await expectLive();
      expect(page.photos).toHaveLength(PUBLIC_PAGE_RULES.maxPhotos);
      // Taken on the same day, so the most recently approved first; the oldest of the seven is left off.
      expect(page.photos.map((photo) => photo.caption)).toEqual(['GRILL', 'WASH_AREA', 'FLOOR_DRAINS', 'PREP_AREA', 'COLD_STORAGE', 'HOOD']);
      await publicPhoto(6).expect(200);
      await publicPhoto(7).expect(404);
      const mine = (await settings(owner)).photos;
      expect(mine).toHaveLength(7);
      expect(mine.filter((photo) => photo.shown)).toHaveLength(6);

      // A photo taken more recently goes ahead of them, whenever it was approved.
      const newest = await db.publicPhoto.findFirstOrThrow({ where: { profileId: profile.id, captionCode: 'HOOD', status: 'APPROVED' } });
      await db.publicPhoto.update({ where: { id: newest.id }, data: { takenOn: dbDate(daysAgo(1)) } });
      expect((await expectLive()).photos.map((photo) => [photo.caption, photo.date])[0]).toEqual(['HOOD', daysAgo(1)]);
    });
  });
});
