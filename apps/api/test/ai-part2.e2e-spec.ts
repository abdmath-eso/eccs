// The AI features, part 2 (14 Oct 2026): the daily digest on the Monitoring board,
// the draft summary of an inspection report, and the nudge at the camera for
// checklist proof photos. Runs against the local database with the sample seed and
// the inspection template loaded, and local object storage running (for the
// inspection's photos and its PDF).
//
// Anthropic is never called: the fake engine answers (vitest.config.e2e.ts sets
// AI_ENGINE=fake and switches AI off for the rest of the run; these tests switch it on
// themselves). Everything happens at a throwaway outlet of the Deccan Biryani sample
// restaurant; it, everything at it and exactly the AiRequest rows written here are
// removed afterwards. Today's digest is one for the whole board: if one was already
// kept today, it is set aside before the tests and put back after them.

import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { AI_ENGINE } from './../src/ai/ai-engine.js';
import { AiService } from './../src/ai/ai.service.js';
import { FAKE_NOT_DONE_REASON, FakeAiEngine } from './../src/ai/fake-ai-engine.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PdfPrinterService } from './../src/pdf/pdf-printer.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { StorageService } from './../src/storage/storage.service.js';

const DECCAN = { code: 'DECCA-KP6R3T', owner: '3917', chef: '8264' };
const SPICE_MANAGER = { code: 'SPICE-JH2K7M', pin: '4821' };
const PHONES = { superAdmin: '+919000000001', opsManager: '+919000000002', supervisor: '+919000000003' };
const OUTLET_CODE = 'E2EAI2-OUT01';
const DEVICE = 'e2e-ai-part2';
const CHECK_LABEL = 'E2E Clean inside the fridge';

/** A real picture, for the inspection's finding photos and its PDF. */
const PICTURE = readFileSync(new URL('./fixtures/sample-fssai-licence.png', import.meta.url));
/** A small "photo" whose bytes tell the fake engine what to answer. */
const photo = (marker = '') => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`sample proof photo ${marker}`)]);

const dbToday = () => new Date(`${indiaDate()}T00:00:00.000Z`);
const daysAhead = (days: number) => indiaDate(new Date(Date.now() + days * 86_400_000));

type Digest = {
  date: string;
  overview: string;
  points: { outletId: string; outletName: string; organizationName: string; text: string }[];
  madeAt: string;
  canUpdate: boolean;
  aiRequestId: string;
  stored: boolean;
  helpful: boolean | null;
};
type Check = { itemId: string; number: number; answer: string | null; findingId?: string | null; note: string | null };
type Nudge = { nudge: string | null; reason: string | null; aiRequestId: string };
type Inspection = {
  id: string;
  status: string;
  overallScore: number | null;
  sections: { checks: Check[] }[];
  writeUp?: { summary: string; fixFirst: string[]; aiDrafted: boolean; updatedAt: string } | null;
  canWriteUp?: boolean;
};

describe('AI features, part 2 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ai: AiService;
  let fake: FakeAiEngine;
  let outletId: string;
  let superAdmin: string;
  let opsManager: string;
  let supervisor: string;
  let owner: string;
  let chef: string;
  let spiceManager: string;
  /** The sample people's names: none of them may ever be sent to the AI. */
  const names: string[] = [];
  /** Today's digest as it was before the tests, put back afterwards. */
  let keptDigest: { id: string; date: Date; overview: string; points: unknown; aiRequestId: string; madeAt: Date } | null = null;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}`, 'X-App-Language': 'EN' });
  const callsFor = (feature: string) => fake.calls.filter((call) => call.feature === feature);
  const row = (id: string) => prisma.client.aiRequest.findUniqueOrThrow({ where: { id } });
  const mine = (where: object) =>
    prisma.client.aiRequest.findFirstOrThrow({ where: { id: { in: ai.recordedForTest() }, ...where }, orderBy: { createdAt: 'desc' } });

  async function cleanUp() {
    const db = prisma.client;
    const outlet = await db.outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    if (outlet) {
      const where = { outletId: outlet.id };
      const files = await db.attachment.findMany({ where, select: { storageKey: true } });
      const lists = await db.outletChecklist.findMany({ where, select: { templateId: true } });
      await db.document.deleteMany({ where });
      await db.attachment.deleteMany({ where });
      await Promise.all(files.map((file) => app.get(StorageService).remove(file.storageKey).catch(() => undefined)));
      await db.licence.deleteMany({ where });
      await db.checklistRun.deleteMany({ where });
      await db.outletChecklist.deleteMany({ where });
      // Only the checklist this test made; never ECCS's own templates.
      await db.checklistTemplate.deleteMany({ where: { id: { in: lists.map((list) => list.templateId) }, outletId: outlet.id } });
      await db.inspection.deleteMany({ where });
      await db.hygieneScoreSnapshot.deleteMany({ where });
      await db.outlet.delete({ where: { id: outlet.id } });
    }
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
    if (ai) {
      // Exactly the requests these tests made, and today's digest made from them.
      const ids = ai.recordedForTest();
      await db.aiDigest.deleteMany({ where: { aiRequestId: { in: ids } } });
      await db.aiRequest.deleteMany({ where: { id: { in: ids } } });
    }
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

  /** Switches AI on with limits high enough that anyone's real spending today cannot get in the way. */
  const aiOn = () => ai.setForTest({ on: true, disabled: [], dailyLimitUsd: 1000, outletDailyLimitUsd: 1000 });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    ai = app.get(AiService);
    fake = app.get<FakeAiEngine>(AI_ENGINE);
    expect(fake).toBeInstanceOf(FakeAiEngine);
    await cleanUp();

    const deccan = await prisma.client.outlet.findUniqueOrThrow({ where: { code: DECCAN.code } });
    outletId = (
      await prisma.client.outlet.create({
        data: { organizationId: deccan.organizationId, name: 'E2E AI part 2 outlet', code: OUTLET_CODE, address: 'Test Road' },
      })
    ).id;
    // An expired licence, so the outlet needs attention on the board.
    await prisma.client.licence.create({ data: { outletId, type: 'FIRE_NOC', expiresOn: new Date(`${daysAhead(-12)}T00:00:00.000Z`) } });

    superAdmin = await otpLogin(PHONES.superAdmin);
    opsManager = await otpLogin(PHONES.opsManager);
    supervisor = await otpLogin(PHONES.supervisor);
    owner = await pinLogin(DECCAN.code, DECCAN.owner);
    chef = await pinLogin(DECCAN.code, DECCAN.chef);
    spiceManager = await pinLogin(SPICE_MANAGER.code, SPICE_MANAGER.pin);
    for (const token of [superAdmin, opsManager, supervisor, owner, chef, spiceManager]) {
      names.push((await http().get('/auth/me').set(as(token)).expect(200)).body.name as string);
    }

    // Set today's real digest aside, if there is one.
    keptDigest = await prisma.client.aiDigest.findUnique({ where: { date: dbToday() } });
    if (keptDigest) await prisma.client.aiDigest.delete({ where: { date: dbToday() } });
  }, 120_000);

  afterAll(async () => {
    ai?.setForTest({ on: false });
    await cleanUp();
    if (keptDigest) {
      await prisma.client.aiDigest.deleteMany({ where: { date: keptDigest.date } });
      await prisma.client.aiDigest.create({ data: { ...keptDigest, points: keptDigest.points as object } });
    }
    await app?.close();
  });

  beforeEach(() => {
    fake.reset();
    aiOn();
  });

  // ───────────────────────── Feature 4 ─────────────────────────

  describe('the daily digest on the Monitoring board', () => {
    const digest = (token: string) => http().get('/monitoring/digest').set(as(token));
    const update = (token: string) => http().post('/monitoring/digest').set(as(token));
    let first: Digest;

    it('is written for the Super Admin from the board’s own facts, with Sonnet, and names only outlets on the board', async () => {
      first = (await digest(superAdmin).expect(200)).body as Digest;
      expect(first).toMatchObject({ date: indiaDate(), stored: false, canUpdate: false, helpful: null });
      expect(first.overview).toMatch(/outlets need attention/);
      expect(first.points.length).toBeGreaterThan(0);
      expect(first.points.length).toBeLessThanOrEqual(6);

      const call = callsFor('monitoring-digest')[0]!;
      expect(call.model).toBe('claude-sonnet-5-5');
      const facts = call.facts as { counts: object; outlets: { id: string; level: string; areas: Record<string, object> }[] };
      // This outlet's expired licence is there, as facts only.
      const ours = facts.outlets.find((outlet) => outlet.id === outletId)!;
      expect(ours).toMatchObject({ level: 'ATTENTION', areas: { licences: { level: 'ATTENTION', expired: 1, licences: [{ type: 'fire NOC', expiredDaysAgo: 12 }] } } });
      // Only outlets needing attention or worth watching are described; nothing about people is sent.
      expect(facts.outlets.every((outlet) => outlet.level === 'ATTENTION' || outlet.level === 'WATCH')).toBe(true);
      for (const name of names) expect(call.text).not.toContain(name);
      expect(call.text).not.toMatch(/"(items|description|note|supervisorId|reference)"/);

      const board = (await http().get('/monitoring').set(as(superAdmin)).expect(200)).body as { outlets: { outletId: string; outletName: string }[] };
      for (const point of first.points) {
        expect(board.outlets.map((outlet) => outlet.outletId)).toContain(point.outletId);
        expect(point.outletName).toBe(board.outlets.find((outlet) => outlet.outletId === point.outletId)!.outletName);
      }
      expect(await row(first.aiRequestId)).toMatchObject({ feature: 'monitoring-digest', status: 'OK', outletId: null, organizationId: null });
    });

    it('serves the Ops Manager the same digest from the store, at no cost', async () => {
      const again = (await digest(opsManager).expect(200)).body as Digest;
      expect(again).toMatchObject({ stored: true, aiRequestId: first.aiRequestId, overview: first.overview });
      expect(fake.calls).toHaveLength(0);
    });

    it('is refused to a Supervisor and to restaurant people', async () => {
      await digest(supervisor).expect(403);
      await digest(owner).expect(403);
      await digest(chef).expect(403);
      await update(supervisor).expect(403);
      expect(fake.calls).toHaveLength(0);
    });

    it('takes "Helpful?" from either admin, and from nobody else', async () => {
      const rate = (token: string, outcome: string) =>
        http().post(`/ai/requests/${first.aiRequestId}/outcome`).set(as(token)).send({ outcome });
      await rate(opsManager, 'HELPFUL').expect(204);
      expect((await row(first.aiRequestId)).outcome).toBe('HELPFUL');
      expect(((await digest(superAdmin).expect(200)).body as Digest).helpful).toBe(true);
      await rate(supervisor, 'NOT_HELPFUL').expect(404);
      await rate(owner, 'NOT_HELPFUL').expect(404);
    });

    it('updates at most once an hour', async () => {
      const soon = (await update(superAdmin).expect(200)).body as Digest;
      expect(soon).toMatchObject({ stored: true, aiRequestId: first.aiRequestId, canUpdate: false });
      expect(fake.calls).toHaveLength(0);

      await prisma.client.aiDigest.update({ where: { date: dbToday() }, data: { madeAt: new Date(Date.now() - 61 * 60_000) } });
      expect(((await digest(opsManager).expect(200)).body as Digest).canUpdate).toBe(true);
      const fresh = (await update(opsManager).expect(200)).body as Digest;
      expect(fresh.stored).toBe(false);
      expect(fresh.aiRequestId).not.toBe(first.aiRequestId);
      expect(fresh.canUpdate).toBe(false);
      expect(callsFor('monitoring-digest')).toHaveLength(1);
    });

    it("puts the points in the board's own order (worst first), whatever order the AI wrote them in", async () => {
      await prisma.client.aiDigest.deleteMany({ where: { date: dbToday() } });
      const board = (await http().get('/monitoring').set(as(superAdmin)).expect(200)).body as {
        outlets: { outletId: string; level: string }[];
      };
      const flagged = board.outlets.filter((outlet) => outlet.level === 'ATTENTION' || outlet.level === 'WATCH').map((outlet) => outlet.outletId);
      const chosen = flagged.slice(0, 4);
      expect(chosen.length).toBeGreaterThan(0);
      // The AI ranks them backwards.
      fake.queue('monitoring-digest', {
        overview: 'Some outlets need attention.',
        points: [...chosen].reverse().map((id) => ({ outletId: id, text: 'Checklists were missed.' })),
      });
      const made = (await digest(superAdmin).expect(200)).body as Digest;
      expect(made.points.map((point) => point.outletId)).toEqual(chosen);
      // Kept in that order, so later openings show the same.
      expect(((await digest(opsManager).expect(200)).body as Digest).points.map((point) => point.outletId)).toEqual(chosen);
    });

    it('refuses an answer naming an outlet that is not on the board, or a number that is not in the facts, and keeps nothing', async () => {
      await prisma.client.aiDigest.deleteMany({ where: { date: dbToday() } });
      fake.queue('monitoring-digest', { overview: 'Busy day.', points: [{ outletId: 'made-up-outlet', text: 'Call them.' }] });
      expect((await digest(superAdmin).expect(503)).body.code).toBe('AI_FAILED');
      expect(await mine({ feature: 'monitoring-digest', status: 'INVALID' })).toMatchObject({ errorCode: 'IDS' });

      fake.queue('monitoring-digest', { overview: 'There are 98765 problems today.', points: [] });
      expect((await digest(superAdmin).expect(503)).body.code).toBe('AI_FAILED');
      expect(await mine({ feature: 'monitoring-digest', status: 'INVALID' })).toMatchObject({ errorCode: 'NUMBERS' });
      expect(await prisma.client.aiDigest.count({ where: { date: dbToday() } })).toBe(0);
    });

    it('steps aside with AI_OFF when switched off, and the board works as before', async () => {
      ai.setForTest({ on: false });
      expect((await digest(superAdmin).expect(503)).body.code).toBe('AI_OFF');
      const board = (await http().get('/monitoring').set(as(superAdmin)).expect(200)).body as { outlets: { outletId: string; level: string }[] };
      expect(board.outlets.find((outlet) => outlet.outletId === outletId)?.level).toBe('ATTENTION');
      expect(fake.calls).toHaveLength(0);
    });
  });

  // ───────────────────────── Feature 5 ─────────────────────────

  describe('the summary for an inspection report', () => {
    let inspectionId: string;
    let findingIds: string[];
    const get = async (token: string) => (await http().get(`/inspections/${inspectionId}`).set(as(token)).expect(200)).body as Inspection;
    const draft = (token: string) => http().post(`/inspections/${inspectionId}/summary/draft`).set(as(token));
    const save = (token: string, body: object) => http().put(`/inspections/${inspectionId}/summary`).set(as(token)).send(body);

    beforeAll(async () => {
      // An inspection given to the Supervisor and answered in full: two checks not compliant, the rest compliant.
      ai.setForTest({ on: false });
      const supervisorId = (await http().get('/auth/me').set(as(supervisor)).expect(200)).body.id as string;
      const started = await http().post('/inspections').set(as(opsManager)).send({ outletId, supervisorId }).expect(201);
      inspectionId = started.body.id as string;
      const checks = (started.body as Inspection).sections.flatMap((section) => section.checks);
      for (const [index, check] of checks.entries()) {
        const failed = index === 3 || index === 20;
        await http()
          .put(`/inspections/${inspectionId}/checks/${check.itemId}`)
          .set(as(supervisor))
          .send(
            failed
              ? {
                  answer: 'NON_COMPLIANT',
                  note: index === 3 ? 'E2E Grease on the hood filters' : 'E2E Raw and cooked food on one shelf',
                  severity: index === 3 ? 'HIGH' : 'MEDIUM',
                  correctiveAction: index === 3 ? 'Degrease the filters' : 'Keep raw food on the lowest shelf',
                  dueDate: daysAhead(index === 3 ? 3 : 7),
                }
              : { answer: 'COMPLIANT' },
          )
          .expect(200);
        if (failed) {
          await http()
            .post(`/inspections/${inspectionId}/checks/${check.itemId}/photos`)
            .set(as(supervisor))
            .attach('file', PICTURE, { filename: 'finding.png', contentType: 'image/png' })
            .expect(200);
        }
      }
    }, 120_000);

    it('cannot be drafted or written before Finish', async () => {
      await draft(supervisor).expect(409);
      await save(supervisor, { summary: 'Too early.' }).expect(409);
      await http().post(`/inspections/${inspectionId}/finish`).set(as(supervisor)).expect(200);
      const finished = await get(supervisor);
      expect(finished).toMatchObject({ status: 'SUBMITTED', canWriteUp: true, writeUp: null });
      findingIds = finished.sections.flatMap((section) => section.checks).filter((check) => check.findingId).map((check) => check.findingId!);
      expect(findingIds).toHaveLength(2);
      expect(fake.calls).toHaveLength(0);
    });

    it('drafts a summary for the Supervisor with Sonnet, picking from the inspection’s own findings, and saves nothing', async () => {
      const made = (await draft(supervisor).expect(200)).body as { summary: string; fixFirst: string[]; aiRequestId: string };
      const score = (await get(supervisor)).overallScore!;
      expect(made.summary).toContain(`scored ${score} out of 100`);
      expect(made.fixFirst).toEqual(findingIds);
      const call = callsFor('inspection-summary')[0]!;
      expect(call.model).toBe('claude-sonnet-5-5');
      expect(call.hasFile).toBe(false);
      // The checks' wording, answers and findings; no photos and no names of people.
      expect(call.text).toContain('E2E Grease on the hood filters');
      for (const name of names) expect(call.text).not.toContain(name);
      expect(call.text).not.toMatch(/photo|attachment|path/i);
      expect((await get(supervisor)).writeUp).toBeNull();
      expect(await row(made.aiRequestId)).toMatchObject({ feature: 'inspection-summary', status: 'OK', outletId, outcome: null });
    });

    it('is only for the Supervisor who did it, or an ECCS admin standing in', async () => {
      await draft(superAdmin).expect(200);
      // Restaurant people never write an inspection report.
      await draft(owner).expect(403);
      await draft(chef).expect(403);
      await draft(spiceManager).expect(403);
      await save(owner, { summary: 'Not mine to write.' }).expect(403);
    });

    it('refuses a draft naming a finding that is not this inspection’s, or a number that is not in the facts', async () => {
      fake.queue('inspection-summary', { summary: 'A fair inspection overall.', fixFirst: [findingIds[0], 'made-up-finding'] });
      expect((await draft(supervisor).expect(503)).body.code).toBe('AI_FAILED');
      expect(await mine({ feature: 'inspection-summary', status: 'INVALID' })).toMatchObject({ errorCode: 'IDS' });

      fake.queue('inspection-summary', { summary: 'The kitchen scored 4321 out of 100.', fixFirst: [] });
      expect((await draft(supervisor).expect(503)).body.code).toBe('AI_FAILED');
      expect(await mine({ feature: 'inspection-summary', status: 'INVALID' })).toMatchObject({ errorCode: 'NUMBERS' });

      // A check's number (1 to 92) is not a count: "55 checks were compliant" is refused too.
      fake.queue('inspection-summary', { summary: 'Only 55 checks were compliant.', fixFirst: [] });
      expect((await draft(supervisor).expect(503)).body.code).toBe('AI_FAILED');
    });

    it('steps aside with AI_OFF, and the Supervisor writes and saves the summary by hand', async () => {
      ai.setForTest({ on: false });
      expect((await draft(supervisor).expect(503)).body.code).toBe('AI_OFF');
      const saved = (await save(supervisor, { summary: 'E2E Written by hand.', fixFirst: [findingIds[1]] }).expect(200)).body as Inspection;
      expect(saved.writeUp).toMatchObject({ summary: 'E2E Written by hand.', fixFirst: [findingIds[1]], aiDrafted: false });
      await save(supervisor, { summary: 'E2E Bad list.', fixFirst: ['made-up-finding'] }).expect(400);
      expect(fake.calls).toHaveLength(0);
    });

    it('saves an edited AI draft, says it was drafted with AI, and records that it was edited', async () => {
      const made = (await draft(supervisor).expect(200)).body as { summary: string; fixFirst: string[]; aiRequestId: string };
      const summary = `${made.summary} E2E Checked by the inspector.`;
      const saved = (
        await save(supervisor, { summary, fixFirst: made.fixFirst.slice(0, 1), aiDrafted: true, draft: { requestId: made.aiRequestId, edited: true } }).expect(200)
      ).body as Inspection;
      expect(saved.writeUp).toMatchObject({ summary, fixFirst: [findingIds[0]], aiDrafted: true });
      expect((await row(made.aiRequestId)).outcome).toBe('EDITED');
      // A draft kept as it came is ACCEPTED.
      const second = (await draft(supervisor).expect(200)).body as { summary: string; fixFirst: string[]; aiRequestId: string };
      await save(supervisor, { summary, fixFirst: second.fixFirst.slice(0, 1), aiDrafted: true, draft: { requestId: second.aiRequestId, edited: false } }).expect(200);
      expect((await row(second.aiRequestId)).outcome).toBe('ACCEPTED');
    });

    it('goes into the approved report and its PDF, and is locked once approved', async () => {
      // The real PDF is made; the page it was made from is read on the way.
      const spy = vi.spyOn(app.get(PdfPrinterService), 'print');
      let html = '';
      try {
        await http().post(`/inspections/${inspectionId}/approve`).set(as(opsManager)).expect(200);
        const link = (await http().post(`/inspections/${inspectionId}/report-pdf`).set(as(owner)).expect(200)).body as { path: string };
        const pdf = await http()
          .get(link.path)
          .buffer(true)
          .parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
          })
          .expect(200);
        expect((pdf.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
        html = spy.mock.calls.map((call) => call[0]).join('');
      } finally {
        spy.mockRestore();
      }
      expect(html).toContain('<h2>Summary</h2>');
      expect(html).toContain('E2E Checked by the inspector.');
      expect(html).toContain('Drafted with AI help and checked by the inspector.');
      expect(html).toContain('<h2>Fix these first</h2>');
      expect(html).toContain('E2E Grease on the hood filters');
      expect(html).toContain('Degrease the filters');

      // The restaurant reads it; nobody can change it now.
      const forOwner = await get(owner);
      expect(forOwner.writeUp).toMatchObject({ aiDrafted: true, fixFirst: [findingIds[0]] });
      expect(forOwner.canWriteUp).toBe(false);
      await save(supervisor, { summary: 'Too late.' }).expect(409);
      await draft(supervisor).expect(409);
    }, 60_000);
  });

  // ───────────────────────── Feature 6 ─────────────────────────

  describe('the nudge at the camera', () => {
    let runId: string;
    let itemId: string;
    /** The phone's call, with the language on its screen. */
    const check = (token: string, file: Buffer, filename = 'photo.jpg', language = 'EN') =>
      http()
        .post(`/checklists/runs/${runId}/items/${itemId}/photo-check`)
        .set({ ...as(token), 'X-App-Language': language })
        .attach('file', file, { filename, contentType: 'image/jpeg' });

    beforeAll(async () => {
      // The restaurant's own checklist with one photo check, set up with AI off.
      ai.setForTest({ on: false });
      const lists = (await http().post('/checklists/setup').set(as(owner)).send({ outletId, title: 'E2E Night checks' }).expect(201)).body as {
        id: string;
        title: Record<string, string>;
      }[];
      const listId = lists.find((list) => list.title.en === 'E2E Night checks')!.id;
      await http().post(`/checklists/setup/${listId}/items`).set(as(owner)).send({ label: CHECK_LABEL }).expect(201);
      const runs = (await http().get('/checklists/today').query({ outletId }).set(as(owner)).expect(200)).body as {
        id: string;
        items: { id: string; label: Record<string, string> }[];
      }[];
      const run = runs.find((entry) => entry.items.some((item) => item.label.en === CHECK_LABEL))!;
      runId = run.id;
      itemId = run.items.find((item) => item.label.en === CHECK_LABEL)!.id;
    });

    it('tells someone who may answer the check when the photo is clearly unusable, with Haiku, and keeps no picture', async () => {
      const before = await prisma.client.attachment.count({ where: { outletId } });
      const blurred = (await check(owner, photo('FAKE-AI:BLURRED')).expect(200)).body as Nudge;
      expect(blurred).toMatchObject({ nudge: 'BLURRED', reason: null });
      expect((await check(owner, photo('FAKE-AI:TOO_DARK')).expect(200)).body).toMatchObject({ nudge: 'TOO_DARK', reason: null });
      expect((await check(owner, photo('FAKE-AI:WRONG_SUBJECT')).expect(200)).body).toMatchObject({ nudge: 'WRONG_SUBJECT', reason: null });
      // Lenient: fine and unsure both show nothing.
      const fine = (await check(owner, photo()).expect(200)).body as Nudge;
      expect(fine).toMatchObject({ nudge: null, reason: null });
      expect((await check(owner, photo('FAKE-AI:UNSURE')).expect(200)).body).toMatchObject({ nudge: null, reason: null });

      const call = callsFor('photo-check')[0]!;
      expect(call).toMatchObject({ model: 'claude-haiku-5-5', hasFile: true, facts: { check: CHECK_LABEL, language: 'en' } });
      // Only the photo, the check's wording and the language are sent.
      expect(JSON.parse(call.text)).toEqual({ check: CHECK_LABEL, language: 'English' });
      // The verdict is kept for measuring, also when nothing was shown.
      expect(await row(blurred.aiRequestId)).toMatchObject({ feature: 'photo-check', status: 'OK', outletId, resultCode: 'BLURRED' });
      expect((await row(fine.aiRequestId)).resultCode).toBe('OK');
      expect(await prisma.client.attachment.count({ where: { outletId } })).toBe(before);

      // The phone records a retake after the nudge.
      await http().post(`/ai/requests/${blurred.aiRequestId}/outcome`).set(as(owner)).send({ outcome: 'ACCEPTED' }).expect(204);
      expect((await row(blurred.aiRequestId)).outcome).toBe('ACCEPTED');
    });

    it('says when the check looks not done, with a reason in the language on screen, and keeps the verdict but never the reason', async () => {
      const inTelugu = (await check(owner, photo('FAKE-AI:NOT_DONE'), 'photo.jpg', 'TE').expect(200)).body as Nudge;
      expect(inTelugu).toMatchObject({ nudge: 'NOT_DONE', reason: `[te] ${FAKE_NOT_DONE_REASON}` });
      const call = callsFor('photo-check')[0]!;
      expect(call).toMatchObject({ model: 'claude-haiku-5-5', facts: { check: CHECK_LABEL, language: 'te' } });
      expect(JSON.parse(call.text)).toEqual({ check: CHECK_LABEL, language: 'Telugu' });
      for (const name of names) expect(call.text).not.toContain(name);

      const inEnglish = (await check(owner, photo('FAKE-AI:NOT_DONE')).expect(200)).body as Nudge;
      expect(inEnglish).toMatchObject({ nudge: 'NOT_DONE', reason: `[en] ${FAKE_NOT_DONE_REASON}` });

      // Stored: the verdict only. Nothing of the reason is anywhere on the row.
      const stored = await row(inTelugu.aiRequestId);
      expect(stored).toMatchObject({ feature: 'photo-check', status: 'OK', resultCode: 'NOT_DONE', outcome: null });
      expect(JSON.stringify(stored)).not.toMatch(/bottles|water/i);

      // NOT_DONE that comes without a reason has nothing to say, so nothing is shown.
      fake.queue('photo-check', { verdict: 'NOT_DONE', reason: null });
      expect((await check(owner, photo()).expect(200)).body).toMatchObject({ nudge: null, reason: null });
      // A reason far too long is refused, and nothing is shown either.
      fake.queue('photo-check', { verdict: 'NOT_DONE', reason: 'water '.repeat(80) });
      expect((await check(owner, photo()).expect(503)).body.code).toBe('AI_FAILED');
    });

    it('records Keep it as DISCARDED, and /ai/usage counts each verdict with the photos retaken and kept after it', async () => {
      type Counts = { verdict: string; requests: number; retaken: number; kept: number };
      const counts = async () => {
        const usage = (await http().get('/ai/usage').set(as(superAdmin)).expect(200)).body as { today: { photoCheck: Counts[] }; month: { photoCheck: Counts[] } };
        const of = (list: Counts[], verdict: string) => list.find((entry) => entry.verdict === verdict) ?? { verdict, requests: 0, retaken: 0, kept: 0 };
        return { notDone: of(usage.today.photoCheck, 'NOT_DONE'), ok: of(usage.today.photoCheck, 'OK'), month: of(usage.month.photoCheck, 'NOT_DONE') };
      };
      const before = await counts();

      const kept = (await check(owner, photo('FAKE-AI:NOT_DONE')).expect(200)).body as Nudge;
      const retaken = (await check(owner, photo('FAKE-AI:NOT_DONE')).expect(200)).body as Nudge;
      await check(owner, photo()).expect(200);
      // Keep it: the person keeps the photo the nudge doubted.
      await http().post(`/ai/requests/${kept.aiRequestId}/outcome`).set(as(owner)).send({ outcome: 'DISCARDED' }).expect(204);
      expect((await row(kept.aiRequestId)).outcome).toBe('DISCARDED');
      await http().post(`/ai/requests/${retaken.aiRequestId}/outcome`).set(as(owner)).send({ outcome: 'ACCEPTED' }).expect(204);

      const after = await counts();
      expect(after.notDone).toEqual({
        verdict: 'NOT_DONE',
        requests: before.notDone.requests + 2,
        retaken: before.notDone.retaken + 1,
        kept: before.notDone.kept + 1,
      });
      expect(after.ok.requests).toBe(before.ok.requests + 1);
      expect(after.month.requests).toBeGreaterThanOrEqual(after.notDone.requests);
      // Only ECCS sees it.
      await http().get('/ai/usage').set(as(owner)).expect(403);
    });

    it('is refused to anyone who may not answer the check', async () => {
      await check(spiceManager, photo()).expect(404);
      await check(chef, photo()).expect(404);
      await check(supervisor, photo()).expect(403);
      expect(fake.calls).toHaveLength(0);
    });

    it('refuses what is not a picture, and a picture that is too large', async () => {
      await check(owner, Buffer.from('not a picture at all'), 'notes.txt').expect(400);
      await check(owner, Buffer.concat([photo(), Buffer.alloc(1024 * 1024 + 10)])).expect(413);
      expect(fake.calls).toHaveLength(0);
    });

    it('steps aside when off or over the outlet’s limit, and the answer and photo upload work as always', async () => {
      ai.setForTest({ outletDailyLimitUsd: 0 });
      expect((await check(owner, photo('FAKE-AI:BLURRED')).expect(503)).body.code).toBe('AI_LIMIT');
      ai.setForTest({ on: false });
      expect((await check(owner, photo('FAKE-AI:BLURRED')).expect(503)).body.code).toBe('AI_OFF');
      expect(fake.calls).toHaveLength(0);

      const upload = await http()
        .post('/attachments')
        .set(as(owner))
        .field('outletId', outletId)
        .attach('file', photo('FAKE-AI:BLURRED'), { filename: 'proof.jpg', contentType: 'image/jpeg' })
        .expect(201);
      const answered = await http()
        .put(`/checklists/runs/${runId}/items/${itemId}`)
        .set(as(owner))
        .send({ passed: true, attachmentId: upload.body.id })
        .expect(200);
      expect(answered.body.items.find((item: { id: string }) => item.id === itemId).response.photoPath).toBeTruthy();
    });

    it('changes nothing when the check looks not done: the answer and the checklist stay as they are, nobody is told, and it can be submitted', async () => {
      // The item was answered OK with its photo by the test above.
      const saved = () =>
        Promise.all([
          prisma.client.checklistRun.findUniqueOrThrow({ where: { id: runId } }),
          prisma.client.checklistResponse.findMany({ where: { runId }, include: { attachments: { select: { id: true } } } }),
          prisma.client.attachment.count({ where: { outletId } }),
        ]);
      const before = await saved();
      expect(before[1]).toHaveLength(1);
      expect(before[1][0]).toMatchObject({ itemId, passed: true });
      const since = new Date();

      const nudged = (await check(owner, photo('FAKE-AI:NOT_DONE')).expect(200)).body as Nudge;
      expect(nudged.nudge).toBe('NOT_DONE');
      expect(await saved()).toEqual(before);
      // Nobody else hears of it: no notification about this checklist or outlet since the photo was checked.
      const told = await prisma.client.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "Notification"
        WHERE "createdAt" >= ${since} AND (data::text LIKE ${`%${runId}%`} OR data::text LIKE ${`%${outletId}%`})`;
      expect(Number(told[0]!.n)).toBe(0);

      // The person keeps the photo and hands the checklist in, exactly as without AI.
      await http().post(`/ai/requests/${nudged.aiRequestId}/outcome`).set(as(owner)).send({ outcome: 'DISCARDED' }).expect(204);
      const submitted = (await http().post(`/checklists/runs/${runId}/submit`).set(as(owner)).expect(200)).body as {
        status: string;
        items: { id: string; response: { passed: boolean } | null }[];
      };
      expect(submitted.status).toBe('SUBMITTED');
      expect(submitted.items.find((item) => item.id === itemId)?.response?.passed).toBe(true);
    });
  });
});
