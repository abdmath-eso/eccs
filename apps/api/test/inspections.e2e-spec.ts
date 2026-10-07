// Scored inspections: planning, answering, the scoring rule, approval and who
// may see what. Runs against the local database with the sample seed and the
// inspection template loaded (pnpm inspection:load in packages/db) and local
// object storage running. Uses the Deccan Biryani outlet and removes what it creates.

import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { scoreInspection, type InspectionAnswer, type ScoredCheck } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { StorageService } from './../src/storage/storage.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-inspections';
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e inspection photo bytes')]);

type Check = {
  itemId: string;
  number: number;
  critical: boolean;
  marks: number;
  answer: InspectionAnswer | null;
  note: string | null;
  severity: string | null;
  correctiveAction: string | null;
  dueDate: string | null;
  photos: { id: string; path: string }[];
  complete: boolean;
};
type Section = { key: string; title: string; score: number | null; earned: number; possible: number; checks: Check[] };
type Inspection = {
  id: string;
  status: string;
  date: string;
  supervisorId: string;
  answered: number;
  complete: number;
  total: number;
  overallScore: number | null;
  grade: string | null;
  nonCompliant: number;
  criticalFailed: number;
  reportNumber: string | null;
  correctionNote: string | null;
  canRecord: boolean;
  canReview: boolean;
  canManage: boolean;
  sections: Section[];
  [key: string]: unknown;
};

const daysAhead = (days: number) => indiaDate(new Date(Date.now() + days * 86_400_000));

/**
 * A real picture (a 320 × 240 PNG of coloured bands), so the printed report has
 * photos a browser can draw. `shade` makes each one look different.
 */
function picture(shade: number): Buffer {
  const width = 320;
  const height = 240;
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const start = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const band = Math.floor((x + y) / 40) % 2;
      rows.set([(shade * 67) % 256, band ? 150 : 90, (y + shade * 40) % 256], start + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits a colour, red-green-blue
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('The scoring rule', () => {
  const check = (section: string, marks: number, answer: InspectionAnswer | null): ScoredCheck => ({ section, marks, answer });

  it('gives marks for compliant checks, none for non-compliant ones, and leaves out those not applicable', () => {
    const score = scoreInspection([
      check('Storage', 2, 'COMPLIANT'),
      check('Storage', 2, 'NON_COMPLIANT'),
      check('Storage', 4, 'COMPLIANT'),
      check('Storage', 2, 'NOT_APPLICABLE'),
      check('Pests', 2, 'COMPLIANT'),
      check('Pests', 2, 'COMPLIANT'),
      check('Transport', 2, 'NOT_APPLICABLE'),
    ]);
    // Storage: 6 of 8 marks = 75. Pests: 4 of 4 = 100. Transport: nothing applies.
    expect(score.sections.map((section) => [section.section, section.score, section.earned, section.possible])).toEqual([
      ['Storage', 75, 6, 8],
      ['Pests', 100, 4, 4],
      ['Transport', null, 0, 0],
    ]);
    // Overall: 10 of 12 marks = 83, not the average of 75 and 100.
    expect(score).toMatchObject({ overallScore: 83, earned: 10, possible: 12, grade: 'A', nonCompliant: 1, criticalFailed: 0, notApplicable: 2 });
  });

  it('grades A+ from 88, A from 80, B from 68, and nothing below', () => {
    // Fifty 2-mark checks, so each one is two points of the score.
    const withFailed = (failed: number) =>
      scoreInspection(Array.from({ length: 50 }, (_, index) => check('All', 2, index < failed ? 'NON_COMPLIANT' : 'COMPLIANT')));
    expect(withFailed(0)).toMatchObject({ overallScore: 100, grade: 'A_PLUS' });
    expect(withFailed(6)).toMatchObject({ overallScore: 88, grade: 'A_PLUS' });
    expect(withFailed(7)).toMatchObject({ overallScore: 86, grade: 'A' });
    expect(withFailed(10)).toMatchObject({ overallScore: 80, grade: 'A' });
    expect(withFailed(11)).toMatchObject({ overallScore: 78, grade: 'B' });
    expect(withFailed(16)).toMatchObject({ overallScore: 68, grade: 'B' });
    expect(withFailed(17)).toMatchObject({ overallScore: 66, grade: 'NON_COMPLIANT' });
  });

  it('gives no grade when a critical check fails, whatever the score', () => {
    const checks = Array.from({ length: 49 }, () => check('All', 2, 'COMPLIANT'));
    const score = scoreInspection([...checks, check('All', 4, 'NON_COMPLIANT')]);
    expect(score).toMatchObject({ overallScore: 96, grade: 'NON_COMPLIANT', criticalFailed: 1 });
  });

  it('counts an unanswered check as not earned', () => {
    expect(scoreInspection([check('All', 2, 'COMPLIANT'), check('All', 2, null)])).toMatchObject({ overallScore: 50, nonCompliant: 0 });
  });
});

describe('Inspections (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let otherOutletId: string;
  let chef: string;
  let owner: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  let inspectionId: string;
  const created: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanUp() {
    const db = prisma.client;
    // The report PDFs: the file, its place in the outlet's documents and its attachment.
    const reports = await db.inspection.findMany({ where: { id: { in: created }, pdfKey: { not: null } }, select: { pdfKey: true } });
    const keys = reports.map((report) => report.pdfKey!);
    await db.document.deleteMany({ where: { attachment: { storageKey: { in: keys } } } });
    await db.attachment.deleteMany({ where: { storageKey: { in: keys } } });
    await Promise.all(keys.map((key) => app.get(StorageService).remove(key).catch(() => undefined)));
    await db.attachment.deleteMany({ where: { inspectionFinding: { inspectionId: { in: created } } } });
    await db.inspection.deleteMany({ where: { id: { in: created } } });
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

  const start = async (token: string, body: Record<string, unknown> = {}) => {
    const response = await http().post('/inspections').set(bearer(token)).send({ outletId, ...body });
    if (response.status === 201) created.push(response.body.id as string);
    return response;
  };
  const list = async (token: string, query: Record<string, string> = {}): Promise<Inspection[]> =>
    (await http().get('/inspections').query(query).set(bearer(token)).expect(200)).body;
  const get = async (token: string, id = inspectionId): Promise<Inspection> =>
    (await http().get(`/inspections/${id}`).set(bearer(token)).expect(200)).body;
  const answer = (token: string, itemId: string, body: Record<string, unknown>, id = inspectionId) =>
    http().put(`/inspections/${id}/checks/${itemId}`).set(bearer(token)).send(body);
  const addPhoto = (token: string, itemId: string, id = inspectionId, photo: Buffer = PHOTO) =>
    http()
      .post(`/inspections/${id}/checks/${itemId}/photos`)
      .set(bearer(token))
      .attach('file', photo, { filename: 'finding.jpg', contentType: 'image/jpeg' });
  const pdf = (token: string, id = inspectionId) => http().post(`/inspections/${id}/report-pdf`).set(bearer(token));
  /** The check numbered `place` within section `section`, both counted from 1. */
  const pick = (inspection: Inspection, section: number, place: number) => inspection.sections[section - 1]!.checks[place - 1]!;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    outletId = (await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } })).id;
    otherOutletId = (await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.jubilee } })).id;

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

  describe('planning', () => {
    it('lets ECCS give an inspection to a Supervisor for a day', async () => {
      await start(admin, { supervisorId, date: daysAhead(-1) }).then((response) => expect(response.status).toBe(400));
      await start(admin, { supervisorId: 'nobody' }).then((response) => expect(response.status).toBe(400));

      const response = await start(admin, { supervisorId, date: daysAhead(2) });
      expect(response.status).toBe(201);
      const inspection = response.body as Inspection;
      inspectionId = inspection.id;
      expect(inspection).toMatchObject({
        status: 'PLANNED',
        date: daysAhead(2),
        supervisorId,
        answered: 0,
        total: 92,
        overallScore: null,
        grade: null,
        reportNumber: null,
        canManage: true,
        canReview: false,
      });
      // The founder's ten sections and 92 checks, eleven of them critical and worth 4 marks.
      expect(inspection.sections.map((section) => section.checks.length)).toEqual([8, 10, 10, 13, 10, 7, 10, 8, 8, 8]);
      const checks = inspection.sections.flatMap((section) => section.checks);
      expect(checks.map((check) => check.number)).toEqual(Array.from({ length: 92 }, (_, index) => index + 1));
      expect(checks.filter((check) => check.critical).length).toBe(11);
      expect(checks.every((check) => check.marks === (check.critical ? 4 : 2))).toBe(true);
      expect(pick(inspection, 8, 1).critical).toBe(true);
    });

    it('lets ECCS move it until it is started, and nobody else', async () => {
      await http().patch(`/inspections/${inspectionId}`).set(bearer(supervisor)).send({ date: daysAhead(1) }).expect(403);
      const moved = await http().patch(`/inspections/${inspectionId}`).set(bearer(admin)).send({ date: indiaDate() }).expect(200);
      expect(moved.body.date).toBe(indiaDate());
    });

    it('lets ECCS remove one that has not been started', async () => {
      const extra = await start(admin, { supervisorId });
      await http().delete(`/inspections/${extra.body.id}`).set(bearer(supervisor)).expect(403);
      await http().delete(`/inspections/${extra.body.id}`).set(bearer(admin)).expect(204);
      await http().get(`/inspections/${extra.body.id}`).set(bearer(admin)).expect(404);
    });

    it('lets a Supervisor start one for themselves, at an outlet they work at only', async () => {
      const own = await start(supervisor);
      expect(own.status).toBe(201);
      expect(own.body).toMatchObject({ supervisorId, status: 'PLANNED', date: indiaDate(), canManage: false, canRecord: true });
      // Giving it to someone else is ECCS's job.
      const adminId = (await http().get('/auth/me').set(bearer(admin)).expect(200)).body.id;
      await start(supervisor, { supervisorId: adminId }).then((response) => expect(response.status).toBe(403));

      const outlets = (await http().get('/inspections/outlets').set(bearer(supervisor)).expect(200)).body as { id: string }[];
      expect(outlets.map((outlet) => outlet.id)).toContain(outletId);
      const all = (await http().get('/inspections/outlets').set(bearer(admin)).expect(200)).body as { id: string }[];
      expect(all.map((outlet) => outlet.id)).toEqual(expect.arrayContaining([outletId, otherOutletId]));
    });
  });

  describe('who may see what', () => {
    let adminsOwn: string;

    it('shows a Supervisor only their own inspections', async () => {
      // An admin carrying one out themselves: it is not the Supervisor's.
      const response = await start(admin);
      adminsOwn = response.body.id as string;
      expect(response.body.supervisorId).not.toBe(supervisorId);

      const mine = await list(supervisor);
      expect(mine.map((entry) => entry.id)).toContain(inspectionId);
      expect(mine.map((entry) => entry.id)).not.toContain(adminsOwn);
      expect(mine.every((entry) => entry.supervisorId === supervisorId)).toBe(true);
      await http().get(`/inspections/${adminsOwn}`).set(bearer(supervisor)).expect(404);

      const item = pick(await get(admin, adminsOwn), 1, 1).itemId;
      await answer(supervisor, item, { answer: 'COMPLIANT' }, adminsOwn).expect(404);
      expect((await list(admin)).map((entry) => entry.id)).toEqual(expect.arrayContaining([inspectionId, adminsOwn]));
    });

    it('keeps the Head Chef out altogether', async () => {
      await http().get('/inspections').set(bearer(chef)).expect(403);
      await http().get(`/inspections/${inspectionId}`).set(bearer(chef)).expect(403);
      await http().post('/inspections').set(bearer(chef)).send({ outletId }).expect(403);
    });

    it('shows the restaurant nothing that is not approved, and lets it change nothing', async () => {
      expect((await list(owner)).map((entry) => entry.id)).not.toContain(inspectionId);
      await http().get(`/inspections/${inspectionId}`).set(bearer(owner)).expect(404);
      await http().post('/inspections').set(bearer(owner)).send({ outletId }).expect(403);
      const item = pick(await get(admin), 1, 1).itemId;
      await answer(owner, item, { answer: 'COMPLIANT' }).expect(403);
      await http().post(`/inspections/${inspectionId}/approve`).set(bearer(owner)).expect(403);
    });
  });

  describe('on site', () => {
    let failed: Check;

    it('saves each answer as it is given and starts the inspection with the first', async () => {
      const before = await get(supervisor);
      expect(before.canRecord).toBe(true);
      const first = pick(before, 1, 1);

      const saved = await answer(supervisor, first.itemId, { answer: 'NOT_APPLICABLE' }).expect(200);
      expect(saved.body).toMatchObject({ status: 'IN_PROGRESS', answered: 1, complete: 1, total: 92 });
      expect(saved.body.check).toMatchObject({ itemId: first.itemId, answer: 'NOT_APPLICABLE', complete: true });

      // Once started, ECCS can no longer move or remove it.
      await http().patch(`/inspections/${inspectionId}`).set(bearer(admin)).send({ date: daysAhead(3) }).expect(409);
      await http().delete(`/inspections/${inspectionId}`).set(bearer(admin)).expect(409);

      await answer(supervisor, 'not-a-check', { answer: 'COMPLIANT' }).expect(404);
      await answer(supervisor, first.itemId, { answer: 'MAYBE' }).expect(400);
    });

    it('holds a non-compliance open until it has a note, severity, corrective action, date and photo', async () => {
      failed = pick(await get(supervisor), 2, 1);

      // The answer alone is saved straight away, but the check is not complete yet.
      const bare = await answer(supervisor, failed.itemId, { answer: 'NON_COMPLIANT' }).expect(200);
      expect(bare.body.check).toMatchObject({ answer: 'NON_COMPLIANT', complete: false, severity: null, note: null });
      expect(bare.body).toMatchObject({ answered: 2, complete: 1 });

      await answer(supervisor, failed.itemId, { answer: 'NON_COMPLIANT', dueDate: daysAhead(-3) }).expect(400);
      await answer(supervisor, failed.itemId, { answer: 'NON_COMPLIANT', severity: 'TERRIBLE' }).expect(400);

      const details = {
        answer: 'NON_COMPLIANT',
        note: 'Grease on the floor under the fryer',
        severity: 'HIGH',
        correctiveAction: 'Degrease the floor and add it to the closing checklist',
        dueDate: daysAhead(7),
      };
      const detailed = await answer(supervisor, failed.itemId, details).expect(200);
      expect(detailed.body.check).toMatchObject({ ...details, complete: false, photos: [] });

      const withPhoto = await addPhoto(supervisor, failed.itemId).expect(200);
      expect(withPhoto.body.check.photos).toHaveLength(1);
      expect(withPhoto.body.check.complete).toBe(true);
      expect(withPhoto.body.complete).toBe(2);
      await http().get(withPhoto.body.check.photos[0].path).expect(200);

      // A photo belongs to a non-compliance only.
      const compliant = pick(await get(supervisor), 2, 2);
      await addPhoto(supervisor, compliant.itemId).expect(409);
    });

    it('removes a photo, and drops the details when the answer changes', async () => {
      const other = pick(await get(supervisor), 3, 3);
      await answer(supervisor, other.itemId, { answer: 'NON_COMPLIANT', note: 'Apron not clean', severity: 'LOW' }).expect(200);
      const photo = (await addPhoto(supervisor, other.itemId).expect(200)).body.check.photos[0] as { id: string };
      const removed = await http().delete(`/inspections/${inspectionId}/photos/${photo.id}`).set(bearer(supervisor)).expect(200);
      expect(removed.body.check.photos).toEqual([]);

      await addPhoto(supervisor, other.itemId).expect(200);
      const changed = await answer(supervisor, other.itemId, { answer: 'COMPLIANT' }).expect(200);
      expect(changed.body.check).toMatchObject({ answer: 'COMPLIANT', note: null, severity: null, photos: [], complete: true });
      expect(await prisma.client.inspectionFinding.count({ where: { inspectionId } })).toBe(1);
      expect(await prisma.client.attachment.count({ where: { inspectionFinding: { inspectionId } } })).toBe(1);
    });

    it('will not finish with a check unanswered or a non-compliance incomplete', async () => {
      const unanswered = await http().post(`/inspections/${inspectionId}/finish`).set(bearer(supervisor)).expect(400);
      expect(unanswered.body.message).toMatch(/every check/i);

      const inspection = await get(supervisor);
      for (const check of inspection.sections.flatMap((section) => section.checks)) {
        if (check.answer === null) await answer(supervisor, check.itemId, { answer: 'COMPLIANT' }).expect(200);
      }

      // One more non-compliance, left without its details.
      const loose = pick(inspection, 9, 1);
      await answer(supervisor, loose.itemId, { answer: 'NON_COMPLIANT' }).expect(200);
      const incomplete = await http().post(`/inspections/${inspectionId}/finish`).set(bearer(supervisor)).expect(400);
      expect(incomplete.body.message).toMatch(/non-compliance/i);
      await answer(supervisor, loose.itemId, { answer: 'COMPLIANT' }).expect(200);

      expect(await get(supervisor)).toMatchObject({ status: 'IN_PROGRESS', answered: 92, complete: 92, nonCompliant: 1 });
    });

    it('scores the inspection on finishing and gives the report its number', async () => {
      await http().post(`/inspections/${inspectionId}/finish`).set(bearer(admin)).expect(200);
      const report = await get(supervisor);
      // 92 checks carry 206 marks (81 at 2 and 11 at 4). Check 1.1 (2 marks) is not
      // applicable, so 204 are possible; check 2.1 (2 marks) failed, so 202 are earned.
      // 202 of 204 = 99.
      expect(report).toMatchObject({
        status: 'SUBMITTED',
        overallScore: 99,
        grade: 'A_PLUS',
        nonCompliant: 1,
        criticalFailed: 0,
        canRecord: false,
      });
      expect(report.reportNumber).toMatch(/^IR-\d{4}-\d{5}$/);
      // Section 1: eight checks, one critical, 18 marks; 16 apply after leaving out 1.1, all
      // earned. Section 2: ten checks, one critical, 22 marks; 20 earned.
      expect(report.sections[0]).toMatchObject({ score: 100, earned: 16, possible: 16 });
      expect(report.sections[1]).toMatchObject({ score: 91, earned: 20, possible: 22 });
      expect(report.sections.slice(2).every((section) => section.score === 100)).toBe(true);

      // Finished: nothing more can be changed.
      await answer(supervisor, failed.itemId, { answer: 'COMPLIANT' }).expect(409);
      await addPhoto(supervisor, failed.itemId).expect(409);
      await http().post(`/inspections/${inspectionId}/finish`).set(bearer(supervisor)).expect(409);
    });
  });

  describe('approval', () => {
    it('still hides a finished report from the restaurant until ECCS approves it', async () => {
      expect((await list(owner)).map((entry) => entry.id)).not.toContain(inspectionId);
      await http().get(`/inspections/${inspectionId}`).set(bearer(owner)).expect(404);
      // No PDF either: the report can still change.
      await pdf(admin).expect(409);
      await pdf(supervisor).expect(409);
      await pdf(owner).expect(404);
    });

    it('lets only ECCS send it back, with a note the Supervisor sees', async () => {
      await http().post(`/inspections/${inspectionId}/send-back`).set(bearer(supervisor)).send({ note: 'Check 8.1 again' }).expect(403);
      await http().post(`/inspections/${inspectionId}/approve`).set(bearer(supervisor)).expect(403);
      await http().post(`/inspections/${inspectionId}/send-back`).set(bearer(admin)).send({ note: ' ' }).expect(400);

      expect((await get(admin)).canReview).toBe(true);
      const number = (await get(admin)).reportNumber;
      const back = await http()
        .post(`/inspections/${inspectionId}/send-back`)
        .set(bearer(admin))
        .send({ note: 'Cockroaches were reported at this outlet: check 8.1 again' })
        .expect(200);
      expect(back.body).toMatchObject({ status: 'IN_PROGRESS', overallScore: null, grade: null, reportNumber: number });
      expect((await get(supervisor)).correctionNote).toMatch(/Cockroaches/);
      await http().post(`/inspections/${inspectionId}/approve`).set(bearer(admin)).expect(409);
    });

    it('gives no grade once a critical check fails, and keeps the report number', async () => {
      const before = await get(supervisor);
      const pests = pick(before, 8, 1);
      expect(pests.critical).toBe(true);
      await answer(supervisor, pests.itemId, {
        answer: 'NON_COMPLIANT',
        note: 'Live cockroaches behind the dishwasher',
        severity: 'CRITICAL',
        correctiveAction: 'Book a pest control treatment and seal the gap behind the dishwasher',
        dueDate: daysAhead(2),
      }).expect(200);
      await addPhoto(supervisor, pests.itemId).expect(200);

      const again = await http().post(`/inspections/${inspectionId}/finish`).set(bearer(supervisor)).expect(200);
      // 198 of 204 marks = 97, but a failed critical check means no grade.
      expect(again.body).toMatchObject({
        status: 'SUBMITTED',
        overallScore: 97,
        grade: 'NON_COMPLIANT',
        nonCompliant: 2,
        criticalFailed: 1,
        reportNumber: before.reportNumber,
      });
      // Section 8: eight checks, two critical, 20 marks; 16 earned.
      expect(again.body.sections[7]).toMatchObject({ score: 80, earned: 16, possible: 20 });
    });

    it('releases the report to the restaurant on approval, without the correction note', async () => {
      const approved = await http().post(`/inspections/${inspectionId}/approve`).set(bearer(admin)).expect(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', canReview: false, correctionNote: null });
      expect(approved.body.approvedAt).toBeTruthy();
      await http().post(`/inspections/${inspectionId}/approve`).set(bearer(admin)).expect(409);
      await http().post(`/inspections/${inspectionId}/send-back`).set(bearer(admin)).send({ note: 'Too late' }).expect(409);

      const reports = await list(owner);
      expect(reports.map((entry) => entry.id)).toContain(inspectionId);
      expect(reports.every((entry) => entry.status === 'APPROVED')).toBe(true);
      const report = await get(owner);
      expect(report).toMatchObject({
        status: 'APPROVED',
        overallScore: 97,
        grade: 'NON_COMPLIANT',
        total: 92,
        canRecord: false,
        canReview: false,
        canManage: false,
        correctionNote: null,
      });
      const findings = report.sections.flatMap((section) => section.checks).filter((check) => check.answer === 'NON_COMPLIANT');
      expect(findings).toHaveLength(2);
      expect(findings.every((check) => check.note && check.correctiveAction && check.dueDate && check.photos.length === 1)).toBe(true);
      await http().get(findings[0]!.photos[0]!.path).expect(200);
    });

    it("keeps another restaurant away from this outlet's report", async () => {
      expect((await list(otherManager)).map((entry) => entry.id)).not.toContain(inspectionId);
      expect(await list(otherManager, { outletId })).toEqual([]);
      await http().get(`/inspections/${inspectionId}`).set(bearer(otherManager)).expect(404);
    });
  });

  // These really print: a browser (Chrome, Edge or Chromium) must be installed.
  describe('the report as a PDF', () => {
    let fullId: string;
    let reportNumber: string;

    const download = async (path: string): Promise<Buffer> =>
      (
        await http()
          .get(path)
          .buffer(true)
          .parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
          })
          .expect(200)
          .expect('Content-Type', /application\/pdf/)
      ).body as Buffer;

    it('is not there until ECCS approves the report', async () => {
      // A full inspection: four non-compliances with photos, one of them a critical check,
      // notes typed in several scripts, and some checks that do not apply.
      fullId = (await start(admin, { supervisorId })).body.id as string;
      const blank = await get(supervisor, fullId);
      const findings = [
        {
          check: pick(blank, 8, 1),
          photos: 2,
          note: 'Live cockroaches behind the dishwasher and droppings under the dry store racks.',
          severity: 'CRITICAL',
          correctiveAction: 'Book a pest control treatment, seal the gap behind the dishwasher and clean under the racks daily.',
          dueDate: daysAhead(2),
        },
        {
          check: pick(blank, 2, 1),
          photos: 1,
          note: 'ఫ్రయ్యర్ కింద నేలపై గ్రీజు పేరుకుపోయింది.',
          severity: 'HIGH',
          correctiveAction: 'నేలను డీగ్రీజ్ చేసి, ముగింపు చెక్‌లిస్ట్‌లో చేర్చండి.',
          dueDate: daysAhead(7),
        },
        {
          check: pick(blank, 4, 3),
          photos: 3,
          note: 'कच्चा चिकन पके हुए खाने के ऊपर वाली शेल्फ़ पर रखा था।',
          severity: 'MEDIUM',
          correctiveAction: 'कच्चा मांस हमेशा सबसे नीचे की शेल्फ़ पर, ढककर रखें।\nStaff to be briefed at the next shift meeting.',
          dueDate: daysAhead(3),
        },
        {
          check: pick(blank, 6, 2),
          photos: 1,
          note: 'ایک ملازم کا ایپرن صاف نہیں تھا۔',
          severity: 'LOW',
          correctiveAction: 'Issue two clean aprons per person per shift.',
          dueDate: daysAhead(15),
        },
      ];
      expect(findings[0]!.check.critical).toBe(true);
      const notApplicable = new Set(blank.sections[9]!.checks.slice(0, 3).map((check) => check.itemId));

      let shade = 0;
      for (const check of blank.sections.flatMap((section) => section.checks)) {
        const finding = findings.find((entry) => entry.check.itemId === check.itemId);
        if (finding) {
          const { check: _check, photos, ...details } = finding;
          await answer(supervisor, check.itemId, { answer: 'NON_COMPLIANT', ...details }, fullId).expect(200);
          for (let count = 0; count < photos; count++) await addPhoto(supervisor, check.itemId, fullId, picture(++shade)).expect(200);
        } else {
          const value = notApplicable.has(check.itemId) ? 'NOT_APPLICABLE' : 'COMPLIANT';
          await answer(supervisor, check.itemId, { answer: value }, fullId).expect(200);
        }
      }
      const finished = (await http().post(`/inspections/${fullId}/finish`).set(bearer(supervisor)).expect(200)).body as Inspection;
      expect(finished).toMatchObject({ status: 'SUBMITTED', nonCompliant: 4, criticalFailed: 1, grade: 'NON_COMPLIANT' });
      reportNumber = finished.reportNumber!;

      await pdf(admin, fullId).expect(409);
      await pdf(supervisor, fullId).expect(409);
      await pdf(owner, fullId).expect(404);
      await http().post(`/inspections/${fullId}/approve`).set(bearer(admin)).expect(200);
    }, 120_000);

    it('is there once approved, for the restaurant, ECCS and the Supervisor, and for nobody else', async () => {
      await pdf(chef, fullId).expect(403);
      await pdf(otherManager, fullId).expect(404);
      await http().post(`/inspections/${fullId}/report-pdf`).expect(401);

      const link = (await pdf(owner, fullId).expect(200)).body as { path: string };
      const file = await download(link.path);
      expect(file.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      // Seven photos and several pages: far more than an empty page.
      expect(file.length).toBeGreaterThan(20_000);
      // A copy to look at, when asked for: INSPECTION_PDF_SAMPLE=<where to put it>.
      if (process.env.INSPECTION_PDF_SAMPLE) writeFileSync(process.env.INSPECTION_PDF_SAMPLE, file);

      // Asking again gives the same file, not a second copy.
      const again = (await pdf(admin, fullId).expect(200)).body as { path: string };
      expect(again.path.split('?')[0]).toBe(link.path.split('?')[0]);
      const third = (await pdf(supervisor, fullId).expect(200)).body as { path: string };
      expect(third.path.split('?')[0]).toBe(link.path.split('?')[0]);
      expect(await prisma.client.attachment.count({ where: { storageKey: { endsWith: `/inspection-reports/${reportNumber}.pdf` } } })).toBe(1);
      const saved = await prisma.client.inspection.findUniqueOrThrow({ where: { id: fullId }, select: { pdfKey: true } });
      expect(saved.pdfKey).toBe(`outlets/${outletId}/inspection-reports/${reportNumber}.pdf`);
    }, 60_000);

    it('is made in the background on approval, without being asked for', async () => {
      // The first report was approved earlier in this suite and nobody has asked for its PDF.
      // Asking now joins or follows the background job, so it is finished before the suite tidies up.
      const link = (await pdf(owner).expect(200)).body as { path: string };
      expect((await download(link.path)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      const report = await prisma.client.inspection.findUniqueOrThrow({ where: { id: inspectionId }, select: { pdfKey: true, reportNumber: true } });
      expect(report.pdfKey).toContain(report.reportNumber!);
    }, 60_000);

    it('is filed in the outlet’s documents', async () => {
      const documents = (await http().get('/documents').query({ outletId }).set(bearer(owner)).expect(200)).body as {
        title: string;
        category: string;
      }[];
      const filed = documents.filter((document) => document.title.startsWith(`Inspection report ${reportNumber}:`));
      expect(filed).toHaveLength(1);
      expect(filed[0]!.category).toBe('report');
      // Another restaurant's documents do not gain it.
      const elsewhere = (await http().get('/documents').query({ outletId: otherOutletId }).set(bearer(otherManager)).expect(200))
        .body as { title: string }[];
      expect(elsewhere.some((document) => document.title.includes(reportNumber))).toBe(false);
    });
  });
});
