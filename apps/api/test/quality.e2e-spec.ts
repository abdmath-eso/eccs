// Quality (Stage I, step 3; 20 Oct 2026): Follow-ups and Photos, the page's counts, Today's new
// kinds and the Health board's rejections. A throwaway restaurant (its Owner, a Manager and a Head
// Chef) and a throwaway Supervisor make every cause and every photo through the real routes: a
// visit rated 2, an issue reopened twice, the hygiene score's daily records falling 18 points, an
// inspection approved with no grade; a checklist ticked too fast with a photo picked from files,
// and a visit photo picked from files. Each follow-up comes in once and leaves when its free visit
// is done or it is closed; a free visit is never invoiced and makes no inspection; a rejection tells
// the outlet's Manager or the visit's Supervisor. Everything made is removed by the ids recorded
// here (and written to E2E_STATE_FILE, when set, as it goes, so a failed run can still be cleaned).

import { writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { addDays, type FollowUpDto, type FollowUpsDto, type PhotoQueueDto, type QualityCountsDto, type QualitySummaryDto, type TodayDto } from '@eccs/shared';
import { encode } from 'jpeg-js';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { sha256 } from './../src/auth/auth.crypto.js';
import { BillingService } from './../src/billing/billing.service.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { StorageService } from './../src/storage/storage.service.js';

const MARK = 'QAE2E';
const DEVICE = 'e2e-quality';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003', bde: '+919000000004' };
const OWNER_PHONE = '+919199900511';
const SUPERVISOR_PHONE = '+919199900512';

/** A made-up picture saved as a JPEG; the same seed is the same picture. */
function jpeg(seed: number): Buffer {
  const width = 320;
  const height = 240;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * seed * 7) % 256;
      data[offset + 1] = (y * (seed + 3) * 5) % 256;
      data[offset + 2] = ((x + y) * 3 + seed * 40) % 256;
      data[offset + 3] = 255;
    }
  }
  return encode({ data, width, height }, 70).data;
}

describe('Quality (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = { admin: '', ops: '', sampleSupervisor: '', bde: '', owner: '', manager: '', chef: '', supervisor: '' };
  let outletId = '';
  let outletCode = '';
  let organizationId = '';
  let supervisorId = '';
  let managerId = '';
  let followUpsBefore = new Set<string>();

  // Everything made here, by id.
  const made = {
    visits: [] as string[],
    issues: [] as string[],
    inspections: [] as string[],
    snapshots: [] as string[],
    followUps: [] as string[],
    reviews: [] as string[],
    attachments: [] as string[],
    templates: [] as string[],
    userIds: [] as string[],
    sessionIds: [] as string[],
    challengeIds: [] as string[],
    deviceIds: [] as string[],
  };
  const remember = <K extends keyof typeof made>(kind: K, ...ids: string[]) => {
    for (const id of ids) if (id && !made[kind].includes(id)) made[kind].push(id);
    if (process.env.E2E_STATE_FILE) writeFileSync(process.env.E2E_STATE_FILE, JSON.stringify({ spec: 'quality', outletId, organizationId, made }, null, 2));
  };

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const db = () => prisma.client;

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const challenge = await db().otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (challenge) remember('challengeIds', challenge.id);
    const body = (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body;
    const session = await db().session.findUnique({ where: { tokenHash: sha256(body.token as string) }, select: { id: true } });
    if (session) remember('sessionIds', session.id);
    return body.token as string;
  }

  async function pinLogin(pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code: outletCode, deviceName: DEVICE }).expect(200);
    const device = await db().linkedDevice.findFirst({ where: { outletId, name: DEVICE }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (device) remember('deviceIds', device.id);
    const body = (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200)).body;
    const session = await db().session.findUnique({ where: { tokenHash: sha256(body.token as string) }, select: { id: true } });
    if (session) remember('sessionIds', session.id);
    return body.token as string;
  }

  async function addPerson(role: 'MANAGER' | 'HEAD_CHEF'): Promise<{ token: string; id: string }> {
    const person = await http().post('/restaurant-users').set(bearer(tokens.admin)).send({ name: `${MARK} ${role}`, role, outletId }).expect(201);
    remember('userIds', person.body.user.id as string);
    return { token: await pinLogin(person.body.pin as string), id: person.body.user.id as string };
  }

  async function addVisit(input: { date?: string; serviceCode?: string; slot?: string } = {}): Promise<string> {
    const response = await http()
      .post('/visits')
      .set(bearer(tokens.ops))
      .send({ outletId, serviceCode: input.serviceCode ?? 'DEEP_CLEAN', date: input.date ?? indiaDate(), slot: input.slot ?? '1000', supervisorId })
      .expect(201);
    remember('visits', response.body.id as string);
    return response.body.id as string;
  }

  const followUps = async (token = tokens.ops, state: 'open' | 'done' = 'open'): Promise<FollowUpsDto> =>
    (await http().get('/quality/follow-ups').query({ state }).set(bearer(token)).expect(200)).body;
  /** Our outlet's follow-ups, recording their ids for the clean-up. */
  const ours = async (state: 'open' | 'done' = 'open'): Promise<FollowUpDto[]> => {
    const items = (await followUps(tokens.ops, state)).items.filter((item) => item.outletId === outletId);
    remember('followUps', ...items.map((item) => item.id));
    return items;
  };
  const photoQueue = async (): Promise<PhotoQueueDto> => (await http().get('/quality/photos').set(bearer(tokens.ops)).expect(200)).body;
  const today = async (token = tokens.ops): Promise<TodayDto> => (await http().get('/today').set(bearer(token)).expect(200)).body;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    // Reading Quality brings in causes from the sample data too; those this run made are removed after it.
    followUpsBefore = new Set((await db().followUp.findMany({ select: { id: true } })).map((row) => row.id));
    tokens.admin = await otpLogin(PHONES.admin);
    tokens.ops = await otpLogin(PHONES.ops);
    tokens.sampleSupervisor = await otpLogin(PHONES.supervisor);
    tokens.bde = await otpLogin(PHONES.bde);

    // A throwaway Supervisor, so no sample person is told anything.
    const supervisor = await db().user.create({ data: { name: `${MARK} Naveen`, phone: SUPERVISOR_PHONE, memberships: { create: { role: 'SUPERVISOR' } } } });
    supervisorId = supervisor.id;
    remember('userIds', supervisorId);
    tokens.supervisor = await otpLogin(SUPERVISOR_PHONE);

    // The throwaway restaurant, onboarded as the console does it.
    const created = await http()
      .post('/organizations')
      .set(bearer(tokens.admin))
      .send({ name: `${MARK} Dhaba`, ownerName: `${MARK} Owner`, ownerPhone: OWNER_PHONE, outletName: `${MARK} Dhaba, Jubilee Hills`, outletAddress: 'Road 36' })
      .expect(201);
    organizationId = created.body.id as string;
    remember('userIds', created.body.owners[0].id as string);
    outletId = created.body.outlets[0].id as string;
    outletCode = created.body.outlets[0].code as string;
    tokens.owner = await otpLogin(OWNER_PHONE);
    const manager = await addPerson('MANAGER');
    tokens.manager = manager.token;
    managerId = manager.id;
    tokens.chef = (await addPerson('HEAD_CHEF')).token;
  }, 60_000);

  afterAll(async () => {
    const failures: unknown[] = [];
    const step = async (work: () => Promise<unknown>) => {
      await work().catch((error: unknown) => failures.push(error));
    };
    const visits = { in: made.visits };
    // Anything the outlet holds in Quality goes with it too (cascade), but by id first.
    await step(async () => {
      const madeHere = (await db().followUp.findMany({ select: { id: true } })).map((row) => row.id).filter((id) => !followUpsBefore.has(id));
      remember('followUps', ...madeHere);
      await db().followUp.deleteMany({ where: { OR: [{ id: { in: made.followUps } }, { visitId: visits }] } });
    });
    await step(() => db().photoReview.deleteMany({ where: { id: { in: made.reviews } } }));
    await step(() => db().notification.deleteMany({ where: { userId: { in: made.userIds } } }));
    // Approving the free visit's report filed its PDF in the outlet's documents.
    if (outletId) await step(() => db().document.deleteMany({ where: { outletId } }));
    await step(async () => {
      const files = await db().attachment.findMany({
        where: { OR: [{ id: { in: made.attachments } }, { jobId: visits }, ...(outletId ? [{ outletId }] : [])] },
        select: { id: true, storageKey: true },
      });
      await db().attachment.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
      await Promise.all(files.map((file) => app.get(StorageService).remove(file.storageKey).catch(() => undefined)));
    });
    await step(() => db().invoice.deleteMany({ where: { outletId } }));
    await step(() => db().certificate.deleteMany({ where: { jobId: visits } }));
    await step(() => db().serviceReport.deleteMany({ where: { jobId: visits } }));
    await step(() => db().job.deleteMany({ where: { id: visits } }));
    await step(() => db().issueComment.deleteMany({ where: { issueId: { in: made.issues } } }));
    await step(() => db().issue.deleteMany({ where: { id: { in: made.issues } } }));
    await step(() => db().inspection.deleteMany({ where: { id: { in: made.inspections } } }));
    await step(() => db().hygieneScoreSnapshot.deleteMany({ where: { OR: [{ id: { in: made.snapshots } }, { outletId }] } }));
    if (outletId) {
      await step(() => db().checklistRun.deleteMany({ where: { outletId } }));
      await step(() => db().outletChecklist.deleteMany({ where: { outletId } }));
      await step(() => db().checklistItem.deleteMany({ where: { outletId } }));
      await step(() => db().checklistTemplate.deleteMany({ where: { id: { in: made.templates } } }));
      await step(() => db().staffMember.deleteMany({ where: { outletId } }));
      await step(() => db().publicProfile.deleteMany({ where: { outletId } }));
    }
    await step(() => db().legalAcceptance.deleteMany({ where: { userId: { in: made.userIds } } }));
    await step(() => db().session.deleteMany({ where: { OR: [{ id: { in: made.sessionIds } }, { userId: { in: made.userIds } }] } }));
    await step(() => db().linkedDevice.deleteMany({ where: { OR: [{ id: { in: made.deviceIds } }, ...(organizationId ? [{ organizationId }] : [])] } }));
    await step(() => db().otpChallenge.deleteMany({ where: { id: { in: made.challengeIds } } }));
    await step(() => db().user.deleteMany({ where: { id: { in: made.userIds } } }));
    if (outletId) await step(() => db().outlet.deleteMany({ where: { id: outletId } }));
    if (organizationId) await step(() => db().organization.deleteMany({ where: { id: organizationId } }));
    await app.close();
    if (failures.length > 0) throw failures[0];
  });

  it('is for the Super Admin and the Ops Manager: a Supervisor and a BDE are refused', async () => {
    for (const token of [tokens.sampleSupervisor, tokens.bde]) {
      await http().get('/quality').set(bearer(token)).expect(403);
      await http().get('/quality/counts').set(bearer(token)).expect(403);
      await http().get('/quality/follow-ups').set(bearer(token)).expect(403);
      await http().get('/quality/photos').set(bearer(token)).expect(403);
      await http().post('/quality/photos/accept').set(bearer(token)).send({ kind: 'VISIT', id: outletId, photoIds: [] }).expect(403);
    }
    const summary = (await http().get('/quality').set(bearer(tokens.admin)).expect(200)).body as QualitySummaryDto;
    expect(summary.strip.map((tile) => tile.key)).toEqual(['RATINGS', 'FIRST_TIME', 'FOLLOW_UPS', 'INCIDENTS']);
    expect(summary.approvesCustomerPhotos).toBe(true);
    // The customer-page photos waiting count in the badge as they did on Customer pages.
    const counts = (await http().get('/quality/counts').set(bearer(tokens.ops)).expect(200)).body as QualityCountsDto;
    expect(counts.customerPhotos).toBe(await db().publicPhoto.count({ where: { status: 'PROPOSED' } }));
    expect(counts.total).toBe(counts.followUps + counts.photos + counts.customerPhotos + counts.incidents);
  });

  describe('Follow-ups', () => {
    let ratedVisit = '';
    let rated: FollowUpDto;

    it('brings in a visit rated 3 or fewer, once, and leaves a good rating out', async () => {
      ratedVisit = await addVisit({ serviceCode: 'DEEP_CLEAN' });
      const good = await addVisit({ serviceCode: 'PEST', slot: '1400' });
      for (const id of [ratedVisit, good]) await db().job.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await http().post(`/visits/${ratedVisit}/sign-off`).set(bearer(tokens.owner)).send({ rating: 2, comment: 'crew left early, floor still wet' }).expect(200);
      await http().post(`/visits/${good}/sign-off`).set(bearer(tokens.owner)).send({ rating: 4 }).expect(200);

      const first = await ours();
      expect(first.filter((item) => item.source.kind === 'VISIT' && item.source.visitId === good)).toEqual([]);
      const found = first.filter((item) => item.cause === 'RATING');
      expect(found).toHaveLength(1);
      rated = found[0]!;
      expect(rated).toMatchObject({
        reason: expect.stringMatching(/^Kitchen deep clean on \d+ \w+ rated 2 stars: "crew left early, floor still wet"$/),
        source: { kind: 'VISIT', visitId: ratedVisit },
        status: 'OPEN',
        standing: 'NOT_BOOKED',
        standingWords: 'Not booked',
        told: null,
        suggestedService: 'DEEP_CLEAN',
        sinceDays: 0,
      });
      // Read again (and again at once): still one, never twice for the same rating.
      await Promise.all([ours(), ours()]);
      expect(await db().followUp.count({ where: { causeKey: `RATING:${ratedVisit}` } })).toBe(1);
    });

    it("shows on Today as a follow-up due, for the office only", async () => {
      const item = (await today()).needsYou.find((entry) => entry.key === `FOLLOW_UP_DUE:${rated.id}`);
      expect(item).toMatchObject({ title: `${MARK} Dhaba, Jubilee Hills: follow-up due`, button: 'Open', target: { kind: 'FOLLOW_UP', followUpId: rated.id } });
      expect((await today(tokens.supervisor)).needsYou.some((entry) => entry.kind === 'FOLLOW_UP_DUE')).toBe(false);
    });

    it('logs a call with who called, then books a free visit: in the diary, marked free, and gone from Today', async () => {
      const opsId = (await db().user.findUniqueOrThrow({ where: { phone: PHONES.ops } })).id;
      await http().post(`/quality/follow-ups/${rated.id}/calls`).set(bearer(tokens.admin)).send({ note: 'x', calledById: opsId }).expect(400);
      const called = (
        await http().post(`/quality/follow-ups/${rated.id}/calls`).set(bearer(tokens.admin)).send({ note: 'a free redo offered', calledById: opsId }).expect(201)
      ).body as FollowUpDto;
      const opsName = (await db().user.findUniqueOrThrow({ where: { id: opsId } })).name;
      expect(called.told).toBe(`${opsName}: a free redo offered`);
      expect(called.calls).toHaveLength(1);

      const date = addDays(indiaDate(), 2);
      const booked = (
        await http().post(`/quality/follow-ups/${rated.id}/visit`).set(bearer(tokens.ops)).send({ serviceCode: 'DEEP_CLEAN', date, slot: '1400', supervisorId }).expect(201)
      ).body as FollowUpDto;
      remember('visits', booked.visit!.id);
      expect(booked).toMatchObject({ standing: 'BOOKED', visit: { date, slot: '1400', status: 'ASSIGNED' } });
      const visit = await db().job.findUniqueOrThrow({ where: { id: booked.visit!.id } });
      expect(visit).toMatchObject({ free: true, outletId, supervisorId, bookingId: null });
      expect((await http().get(`/visits/${visit.id}`).set(bearer(tokens.ops)).expect(200)).body.free).toBe(true);
      // One at a time.
      await http().post(`/quality/follow-ups/${rated.id}/visit`).set(bearer(tokens.ops)).send({ serviceCode: 'DEEP_CLEAN', date, slot: '1000' }).expect(409);
      expect((await today()).needsYou.some((entry) => entry.key === `FOLLOW_UP_DUE:${rated.id}`)).toBe(false);
    });

    it('leaves the queue once its free visit is done; the free visit is never invoiced and makes no inspection', async () => {
      const visitId = (await db().followUp.findUniqueOrThrow({ where: { id: rated.id } })).visitId!;
      const inspectionsBefore = await db().inspection.count({ where: { outletId } });
      // The free visit is done and signed off, and ECCS approves its report.
      await db().job.update({ where: { id: visitId }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await http().post(`/visits/${visitId}/sign-off`).set(bearer(tokens.owner)).send({ rating: 5 }).expect(200);
      await http().post(`/visits/${visitId}/approve-report`).set(bearer(tokens.ops)).expect(200);

      expect((await ours()).map((item) => item.id)).not.toContain(rated.id);
      expect((await ours('done')).find((item) => item.id === rated.id)).toMatchObject({ status: 'DONE', standing: 'DONE' });
      expect(await app.get(BillingService).billVisit(visitId)).toBeNull();
      expect(await db().invoice.count({ where: { outletId } })).toBe(0);
      expect(await db().inspection.count({ where: { outletId } })).toBe(inspectionsBefore);
      await http().post(`/quality/follow-ups/${rated.id}/close`).set(bearer(tokens.ops)).send({ note: 'already done' }).expect(409);
    });

    it('brings in an issue each time it is reopened, and lets one be closed with a note', async () => {
      const raised = await http().post('/issues').set(bearer(tokens.owner)).send({ outletId, category: 'PEST_SIGHTING', description: `${MARK}: cockroaches again` }).expect(201);
      const issueId = raised.body.id as string;
      remember('issues', issueId);
      const cycle = async () => {
        await http().patch(`/issues/${issueId}`).set(bearer(tokens.ops)).send({ status: 'RESOLVED' }).expect(200);
        await http().patch(`/issues/${issueId}`).set(bearer(tokens.owner)).send({ status: 'OPEN' }).expect(200);
      };
      await cycle();
      let reopened = (await ours()).filter((item) => item.cause === 'ISSUE_REOPENED');
      expect(reopened).toHaveLength(1);
      expect(reopened[0]).toMatchObject({ source: { kind: 'ISSUE', issueId }, reason: expect.stringMatching(/^Issue ECCS-\d{4} reopened: /) });

      const closed = (await http().post(`/quality/follow-ups/${reopened[0]!.id}/close`).set(bearer(tokens.ops)).send({ note: 'Called the manager; treatment booked' }).expect(200)).body;
      expect(closed).toMatchObject({ status: 'CLOSED', closeNote: 'Called the manager; treatment booked' });
      await http().post(`/quality/follow-ups/${reopened[0]!.id}/calls`).set(bearer(tokens.ops)).send({ note: 'too late' }).expect(409);

      // Reopened a second time: a new cause, a new follow-up.
      await cycle();
      reopened = (await ours()).filter((item) => item.cause === 'ISSUE_REOPENED');
      expect(reopened).toHaveLength(1);
      expect(reopened[0]!.reason).toContain('reopened (twice)');
      expect(await db().followUp.count({ where: { issueId } })).toBe(2);
    });

    it("brings in the hygiene score falling 15 points in a week, once however long it stays down", async () => {
      const today0 = indiaDate();
      for (const [ago, score] of [
        [6, 82],
        [4, 80],
        [2, 64],
        [1, 63],
      ] as const) {
        const row = await db().hygieneScoreSnapshot.create({ data: { outletId, date: new Date(`${addDays(today0, -ago)}T00:00:00.000Z`), score, breakdown: {} } });
        remember('snapshots', row.id);
      }
      const drops = (await ours()).filter((item) => item.cause === 'SCORE_DROP');
      expect(drops).toHaveLength(1);
      expect(drops[0]).toMatchObject({ source: { kind: 'HEALTH', outletId }, score: 63, reason: expect.stringMatching(/^Hygiene score fell 18 points in a week: 82 on /) });
      const row = await db().hygieneScoreSnapshot.create({ data: { outletId, date: new Date(`${today0}T00:00:00.000Z`), score: 60, breakdown: {} } });
      remember('snapshots', row.id);
      expect((await ours()).filter((item) => item.cause === 'SCORE_DROP')).toHaveLength(1);
    });

    it('brings in an inspection approved with no grade, and not one with a grade', async () => {
      const template = await db().checklistTemplate.findFirstOrThrow({ where: { kind: 'INSPECTION', outletId: null }, select: { id: true } });
      const make = (grade: string) =>
        db().inspection.create({
          data: { outletId, templateId: template.id, supervisorId, status: 'APPROVED', conductedAt: new Date(), approvedAt: new Date(), overallScore: grade === 'B' ? 72 : 58, grade },
        });
      const failed = await make('NON_COMPLIANT');
      const passed = await make('B');
      remember('inspections', failed.id, passed.id);
      const found = (await ours()).filter((item) => item.cause === 'INSPECTION');
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ source: { kind: 'INSPECTION', inspectionId: failed.id }, reason: expect.stringMatching(/: no grade \(score 58\)$/) });
    });

    it('counts kitchens and follow-ups for the headline and the badge', async () => {
      const summary = (await http().get('/quality').set(bearer(tokens.ops)).expect(200)).body as QualitySummaryDto;
      expect(summary.headline).toMatch(/kitchens? needs? a follow-up\./);
      expect(summary.counts.followUps).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Photos', () => {
    let runId = '';
    let checklistPhoto = '';
    let visitId = '';
    let visitPhoto = '';

    it('brings in a checklist ticked too fast, with its photo picked from files', async () => {
      const title = `${MARK} closing checks`;
      const lists = (await http().post('/checklists/setup').set(bearer(tokens.manager)).send({ outletId, title, dueTime: '23:59' }).expect(201)).body as {
        id: string;
        title: Record<string, string>;
      }[];
      const list = lists.find((entry) => Object.values(entry.title).includes(title))!;
      remember('templates', list.id);
      for (let index = 1; index <= 6; index += 1) {
        await http()
          .post(`/checklists/setup/${list.id}/items`)
          .set(bearer(tokens.manager))
          .send({ label: `${MARK} check ${index}`, photoRequired: index === 1 })
          .expect(201);
      }
      type Run = { id: string; title: Record<string, string>; items: { id: string }[] };
      const runs = (await http().get('/checklists/today').query({ outletId }).set(bearer(tokens.chef)).expect(200)).body as Run[];
      const run = runs.find((entry) => Object.values(entry.title).includes(title))!;
      runId = run.id;

      const upload = await http().post('/attachments').set(bearer(tokens.chef)).field('outletId', outletId).field('source', 'FILE').attach('file', jpeg(3), { filename: 'p.jpg', contentType: 'image/jpeg' }).expect(201);
      checklistPhoto = upload.body.id as string;
      remember('attachments', checklistPhoto);
      // Six checks ticked a second apart.
      const start = Date.now() - 60_000;
      for (const [index, item] of run.items.entries()) {
        await http()
          .put(`/checklists/runs/${runId}/items/${item.id}`)
          .set(bearer(tokens.chef))
          .send({ passed: true, capturedAt: new Date(start + index * 1000).toISOString(), ...(index === 0 && { attachmentId: checklistPhoto }) })
          .expect(200);
      }
      await http().post(`/checklists/runs/${runId}/submit`).set(bearer(tokens.chef)).expect(200);
      const stored = await db().checklistRun.findUniqueOrThrow({ where: { id: runId } });
      expect(stored.integrityFlags).toEqual([{ code: 'TOO_FAST', certain: false, checks: 6, seconds: 5 }]);

      const item = (await photoQueue()).items.find((entry) => entry.key === `CHECKLIST:${runId}`);
      expect(item).toMatchObject({
        kind: 'CHECKLIST',
        outletId,
        tells: "The outlet's Manager",
        reasons: expect.arrayContaining(['Checklist finished too fast: 6 checks ticked in 5 s', "Picked from files, not taken with the app's camera"]),
      });
      expect(item!.photos).toHaveLength(1);
      expect(item!.photos[0]).toMatchObject({ id: checklistPhoto, kind: 'PROOF', takenBy: `${MARK} HEAD_CHEF, Head Chef` });
    });

    it("brings in an ECCS visit's doubtful photo, saying the Supervisor is told", async () => {
      visitId = await addVisit({ serviceCode: 'PEST', slot: '1600' });
      await http().post(`/visits/${visitId}/check-in`).set(bearer(tokens.supervisor)).send({}).expect(200);
      const visit = await http().post(`/visits/${visitId}/photos`).set(bearer(tokens.supervisor)).field('kind', 'AFTER').field('source', 'FILE').attach('file', jpeg(5), { filename: 'v.jpg', contentType: 'image/jpeg' }).expect(200);
      visitPhoto = (visit.body.photos as { id: string }[])[0]!.id;
      remember('attachments', visitPhoto);
      const item = (await photoQueue()).items.find((entry) => entry.key === `VISIT:${visitId}`);
      expect(item).toMatchObject({ kind: 'VISIT', visitId, tells: `${MARK} Naveen, the Supervisor` });
      expect(item!.photos.map((photo) => photo.id)).toEqual([visitPhoto]);

      // Today puts the queue in one line.
      const flagged = (await today()).needsYou.find((entry) => entry.kind === 'PHOTO_FLAGGED');
      expect(flagged).toMatchObject({ key: 'PHOTO_FLAGGED', button: 'Review', target: { kind: 'QUALITY_PHOTOS' }, title: expect.stringMatching(/^\d+ photos? flagged for review$/) });
    });

    it('rejects the checklist and tells the outlet\'s Manager; the Health board counts the rejection', async () => {
      await http().post('/quality/photos/reject').set(bearer(tokens.ops)).send({ kind: 'CHECKLIST', id: runId, photoIds: [checklistPhoto], note: 'x' }).expect(400);
      const judged = (
        await http()
          .post('/quality/photos/reject')
          .set(bearer(tokens.ops))
          .send({ kind: 'CHECKLIST', id: runId, photoIds: [checklistPhoto], note: 'The checklist was ticked too fast to be real' })
          .expect(200)
      ).body;
      remember('reviews', judged.reviewId as string);
      expect(judged).toMatchObject({ verdict: 'REJECTED', told: 1 });
      const told = await db().notification.findMany({ where: { userId: { in: made.userIds }, type: 'PHOTO_REJECTED' } });
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ userId: managerId, title: 'Photo not accepted: please retake' });
      expect((told[0]!.data as { link: unknown }).link).toEqual({ kind: 'checklist', outletId, runId });
      expect((await db().attachment.findUniqueOrThrow({ where: { id: checklistPhoto } })).photoReviewId).toBe(judged.reviewId);
      expect((await db().checklistRun.findUniqueOrThrow({ where: { id: runId } })).photoReviewId).toBe(judged.reviewId);
      expect((await photoQueue()).items.some((entry) => entry.key === `CHECKLIST:${runId}`)).toBe(false);
      // Judged once only.
      await http().post('/quality/photos/accept').set(bearer(tokens.ops)).send({ kind: 'CHECKLIST', id: runId, photoIds: [checklistPhoto] }).expect(404);

      type Board = { outlets: { outletId: string; photos: { rejected?: number; level: string } }[] };
      const board = (await http().get('/monitoring').set(bearer(tokens.ops)).expect(200)).body as Board;
      expect(board.outlets.find((row) => row.outletId === outletId)?.photos).toMatchObject({ rejected: 1, level: 'ATTENTION' });
    });

    it("accepts the visit's photo: no one is told, and it is no longer counted as doubtful", async () => {
      const judged = (await http().post('/quality/photos/accept').set(bearer(tokens.admin)).send({ kind: 'VISIT', id: visitId, photoIds: [visitPhoto] }).expect(200)).body;
      remember('reviews', judged.reviewId as string);
      expect(judged).toMatchObject({ verdict: 'ACCEPTED', told: 0 });
      expect(await db().notification.count({ where: { userId: supervisorId, type: 'PHOTO_REJECTED' } })).toBe(0);
      expect((await photoQueue()).items.some((entry) => entry.key === `VISIT:${visitId}`)).toBe(false);
      type Board = { outlets: { outletId: string; photos: { doubtful: number; items: { id: string }[] } }[] };
      const photos = ((await http().get('/monitoring').set(bearer(tokens.ops)).expect(200)).body as Board).outlets.find((row) => row.outletId === outletId)!.photos;
      expect(photos.items.map((photo) => photo.id)).not.toContain(visitPhoto);
    });

    it("rejects a visit photo to its Supervisor, and judges only the photos the page showed", async () => {
      const second = await http().post(`/visits/${visitId}/photos`).set(bearer(tokens.supervisor)).field('kind', 'BEFORE').field('source', 'FILE').attach('file', jpeg(7), { filename: 'b.jpg', contentType: 'image/jpeg' }).expect(200);
      const before = (second.body.photos as { id: string; kind: string }[]).find((photo) => photo.kind === 'BEFORE')!.id;
      remember('attachments', before);
      // A page that showed nothing of it judges nothing.
      await http().post('/quality/photos/reject').set(bearer(tokens.ops)).send({ kind: 'VISIT', id: visitId, photoIds: [], note: 'Too dark or blurred to see' }).expect(409);
      const judged = (
        await http().post('/quality/photos/reject').set(bearer(tokens.ops)).send({ kind: 'VISIT', id: visitId, photoIds: [before], note: 'Too dark or blurred to see' }).expect(200)
      ).body;
      remember('reviews', judged.reviewId as string);
      expect(judged.told).toBe(1);
      const told = await db().notification.findFirstOrThrow({ where: { userId: supervisorId, type: 'PHOTO_REJECTED' } });
      expect((told.data as { link: unknown }).link).toEqual({ kind: 'visit', visitId });
      expect(told.body).toBe(`${MARK} Dhaba, Jubilee Hills, Pest control: Too dark or blurred to see. Please take the photo again.`);
    });

    it('counts the month\'s judgements', async () => {
      const queue = await photoQueue();
      expect(queue.month.judged).toBeGreaterThanOrEqual(3);
      expect(queue.month.rejected).toBeGreaterThanOrEqual(2);
      // Kept for the clean-up even if a judgement above stopped part-way.
      remember('reviews', ...(await db().photoReview.findMany({ where: { outletId }, select: { id: true } })).map((row) => row.id));
    });
  });

  it('keeps the month strip: ratings, reports approved first time, follow-ups and incidents', async () => {
    const summary = (await http().get('/quality').set(bearer(tokens.ops)).expect(200)).body as QualitySummaryDto;
    const ratings = summary.strip.find((tile) => tile.key === 'RATINGS')!;
    expect(ratings.value).toMatch(/^\d+ of \d+$/);
    expect(ratings.detail).toMatch(/^average \d\.\d · /);
    // A report sent back once is not "first time".
    const visitId = made.visits[1]!;
    await http().post(`/visits/${visitId}/return-report`).set(bearer(tokens.ops)).send({ note: 'Add the after photo' }).expect(200);
    expect((await db().job.findUniqueOrThrow({ where: { id: visitId } })).returnedCount).toBe(1);
  });
});
