// The BDE on the phone (Stage B2, 16 Oct 2026): a lead's photos (the shop board, a free
// check's "Needs fixing"), the AI shop-board reader, the free-check scorecard on a step,
// the BDE's day (Do today and the week against target), every step from the phone's
// outbox being safe to send twice, and a BDE reaching only their own leads and photos.
//
// Anthropic is never called: the fake engine reads every board the same way (FAKE_BOARD in
// fake-ai-engine.ts), and markers in a photo's bytes choose other answers. Everything is a
// throwaway made here (two BDE logins, their leads, photos and AI rows) and removed again,
// photos from the file store too. The activity log is switched on for one test and exactly
// its rows are removed.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { addDays, FREE_CHECK_POINTS, indiaMoment, type BdeDayDto, type FreeCheckAnswer, type FreeCheckPoint, type LeadDetailDto, type QuoteOptionDto } from '@eccs/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ActivityLogService } from './../src/activity-log/activity-log.service.js';
import { AI_ENGINE } from './../src/ai/ai-engine.js';
import { AiService } from './../src/ai/ai.service.js';
import { FAKE_SEEN, FakeAiEngine } from './../src/ai/fake-ai-engine.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { SalesService } from './../src/sales/sales.service.js';
import { StorageService } from './../src/storage/storage.service.js';

const MARK = 'E2E BDE';
const DEVICE = 'e2e-bde';
const PHONES = { admin: '+919000000001', supervisor: '+919000000003' };
const BDE_PHONES = { one: '+919199900091', two: '+919199900092' };
const OWNER = { code: 'SPICE-JH2K7M', pin: '2580' };

/** A small "photo": the JPEG header and a marker the fake engine reads. */
const jpeg = (marker = 'board') => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`e2e bde ${marker} ${randomUUID()}`)]);

describe('The BDE on the phone (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ai: AiService;
  let fake: FakeAiEngine;
  let activity: ActivityLogService;
  let admin: string;
  let supervisor: string;
  let owner: string;
  const bde = { one: '', two: '' };
  const bdeId = { one: '', two: '' };
  /** Photos the Super Admin filed here: removed with the BDEs' own. */
  const adminPhotos: string[] = [];

  const today = indiaDate();
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const aiOn = () => ai.setForTest({ on: true, disabled: [], dailyLimitUsd: 1000, outletDailyLimitUsd: 1000 });

  async function otpLogin(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    return (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body.token as string;
  }
  async function pinLogin(code: string, pin: string) {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    return (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200)).body.token as string;
  }

  const upload = (token: string, bytes: Buffer, fields: Record<string, string> = {}) => {
    let call = http().post('/sales/photos').set(bearer(token));
    for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
    return call.attach('file', bytes, { filename: 'board.jpg', contentType: 'image/jpeg' });
  };
  const photo = async (token: string, marker?: string) => (await upload(token, jpeg(marker), { id: randomUUID() }).expect(201)).body.id as string;
  const addLead = async (token: string, body: Record<string, unknown> & { businessName: string }): Promise<LeadDetailDto> =>
    (await http().post('/sales/leads').set(bearer(token)).send({ source: 'FIELD_VISIT', ...body, businessName: `${MARK} ${body.businessName}` }).expect(201)).body;
  const lead = async (token: string, leadId: string): Promise<LeadDetailDto> => (await http().get(`/sales/leads/${leadId}`).set(bearer(token)).expect(200)).body;
  /** Every point answered, OK unless said otherwise, a photo where given. */
  const scorecard = (changes: Partial<Record<FreeCheckPoint, FreeCheckAnswer>> = {}, photos: Partial<Record<FreeCheckPoint, string>> = {}) => ({
    answers: FREE_CHECK_POINTS.map((point) => ({ point, answer: changes[point] ?? 'OK', ...(photos[point] && { photoId: photos[point] }) })),
  });

  async function cleanUp() {
    const db = prisma.client;
    const users = await db.user.findMany({ where: { phone: { in: Object.values(BDE_PHONES) } }, select: { id: true } });
    const ids = users.map((user) => user.id);
    await db.lead.deleteMany({ where: { OR: [{ businessName: { startsWith: MARK } }, { ownerId: { in: ids } }] } });
    // The photos, from the file store as well as the table.
    const photos = await db.attachment.findMany({ where: { kind: 'LEAD', OR: [{ uploadedById: { in: ids } }, { id: { in: adminPhotos } }] }, select: { id: true, storageKey: true } });
    for (const entry of photos) await app.get(StorageService).remove(entry.storageKey).catch(() => undefined);
    await db.attachment.deleteMany({ where: { id: { in: photos.map((entry) => entry.id) } } });
    await db.salesTarget.deleteMany({ where: { userId: { in: ids } } });
    await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { userId: { in: ids } }] } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: [...Object.values(PHONES), ...Object.values(BDE_PHONES)] } } });
    if (ai) await db.aiRequest.deleteMany({ where: { id: { in: ai.recordedForTest() } } });
    if (activity) {
      await activity.flush();
      await db.activityLog.deleteMany({ where: { id: { in: activity.recordedForTest() } } });
    }
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    ai = app.get(AiService);
    fake = app.get<FakeAiEngine>(AI_ENGINE);
    activity = app.get(ActivityLogService);
    expect(fake).toBeInstanceOf(FakeAiEngine);
    await cleanUp();
    const db = prisma.client;
    for (const key of ['one', 'two'] as const) {
      const user = await db.user.create({ data: { phone: BDE_PHONES[key], name: `${MARK} ${key}`, memberships: { create: [{ role: 'BDE' }] } } });
      bdeId[key] = user.id;
      bde[key] = await otpLogin(BDE_PHONES[key]);
    }
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    owner = await pinLogin(OWNER.code, OWNER.pin);
  }, 90_000);

  afterAll(async () => {
    ai?.setForTest({ on: false });
    activity?.setForTest({ on: false });
    await cleanUp();
    await app?.close();
  });

  beforeEach(() => {
    fake.reset();
    aiOn();
  });

  // ───────────────────────── Photos ─────────────────────────

  describe("a lead's photos", () => {
    it('files a photo with the id the phone chose, once however often it is sent, for no outlet', async () => {
      const id = randomUUID();
      const first = (await upload(bde.one, jpeg(), { id, capturedAt: new Date().toISOString() }).expect(201)).body;
      expect(first).toEqual({ id, path: expect.stringContaining(`/attachments/${id}/content`) });
      await upload(bde.one, jpeg(), { id }).expect(201);
      const rows = await prisma.client.attachment.findMany({ where: { id } });
      expect(rows).toEqual([expect.objectContaining({ kind: 'LEAD', outletId: null, uploadedById: bdeId.one, mimeType: 'image/jpeg' })]);
      expect(rows[0]!.storageKey).toMatch(/^sales\/leads\//);
      // Someone else cannot take that id over.
      await upload(bde.two, jpeg(), { id }).expect(403);
    });

    it('takes only photos, and only from the BDEs, the founders and the Ops Manager', async () => {
      await http().post('/sales/photos').set(bearer(bde.one)).attach('file', Buffer.from('%PDF-1.4 not a photo'), { filename: 'x.pdf' }).expect(400);
      await http().post('/sales/photos').set(bearer(bde.one)).expect(400);
      for (const token of [supervisor, owner]) await upload(token, jpeg()).expect(403);
      adminPhotos.push((await upload(admin, jpeg()).expect(201)).body.id as string);
    });
  });

  // ───────────────────────── The shop board reader ─────────────────────────

  describe('reading the shop board', () => {
    const read = (token: string, photoId: string) => http().post('/sales/board-reading').set(bearer(token)).send({ photoId });

    it('fills the form from the board with Haiku, never sends the words it read, and records the cost for no outlet', async () => {
      const id = await photo(bde.one);
      const reading = (await read(bde.one, id).expect(200)).body;
      expect(reading).toEqual({
        businessName: 'Sri Annapurna Tiffins',
        area: 'Kukatpally',
        address: 'Plot 12, KPHB Colony, Kukatpally, Hyderabad 500072',
        phone: '+919848022338',
        otherPhones: ['040-2345 6789'],
        aiRequestId: expect.any(String),
      });
      expect(JSON.stringify(reading)).not.toContain(FAKE_SEEN);
      expect(fake.calls).toEqual([expect.objectContaining({ feature: 'shop-board', model: 'claude-haiku-5-5', hasFile: true })]);
      const row = await prisma.client.aiRequest.findUniqueOrThrow({ where: { id: reading.aiRequestId as string } });
      expect(row).toMatchObject({ feature: 'shop-board', status: 'OK', userId: bdeId.one, outletId: null, organizationId: null, resultCode: 'NAME+AREA+ADDRESS+MOBILE' });
      expect(row.costMicroUsd).toBeGreaterThan(0);
      // Saving what was read as it was is recorded against the request.
      await http().post(`/ai/requests/${reading.aiRequestId}/outcome`).set(bearer(bde.one)).send({ outcome: 'ACCEPTED' }).expect(204);
      expect((await prisma.client.aiRequest.findUniqueOrThrow({ where: { id: reading.aiRequestId as string } })).outcome).toBe('ACCEPTED');
    });

    it('leaves empty what the board does not show', async () => {
      expect((await read(bde.one, await photo(bde.one, 'FAKE-AI:UNREADABLE')).expect(200)).body).toMatchObject({
        businessName: null,
        area: null,
        address: null,
        phone: null,
        otherPhones: [],
      });
      expect((await read(bde.one, await photo(bde.one, 'FAKE-AI:NO-ADDRESS')).expect(200)).body).toMatchObject({ area: null, address: null, phone: '+919848022338' });
      // Only a landline: the phone field stays for the BDE to type; the landline is shown.
      expect((await read(bde.one, await photo(bde.one, 'FAKE-AI:LANDLINE')).expect(200)).body).toMatchObject({ phone: null, otherPhones: ['040-2345 6789'] });
      const rows = await prisma.client.aiRequest.findMany({ where: { id: { in: ai.recordedForTest() }, feature: 'shop-board', resultCode: 'NOTHING' } });
      expect(rows.length).toBeGreaterThan(0);
    });

    it('steps aside with its code when AI is off or over the day’s limit; an outlet limit does not apply', async () => {
      const id = await photo(bde.one);
      ai.setForTest({ on: false });
      expect((await read(bde.one, id).expect(503)).body.code).toBe('AI_OFF');
      aiOn();
      ai.setForTest({ disabled: ['shop-board'] });
      expect((await read(bde.one, id).expect(503)).body.code).toBe('AI_OFF');
      ai.setForTest({ disabled: [], dailyLimitUsd: 0 });
      expect((await read(bde.one, id).expect(503)).body.code).toBe('AI_LIMIT');
      // A lead is not a client: an outlet's allowance never stops it.
      ai.setForTest({ dailyLimitUsd: 1000, outletDailyLimitUsd: 0 });
      await read(bde.one, id).expect(200);
      expect(fake.calls).toHaveLength(1);
      const statuses = await prisma.client.aiRequest.findMany({ where: { id: { in: ai.recordedForTest() }, feature: 'shop-board', userId: bdeId.one }, select: { status: true } });
      expect(statuses.map((entry) => entry.status)).toEqual(expect.arrayContaining(['OFF', 'LIMIT', 'OK']));
    });

    it("reads only the BDE's own photos", async () => {
      const mine = await photo(bde.one);
      await read(bde.two, mine).expect(404);
      await read(supervisor, mine).expect(403);
      await read(bde.one, randomUUID()).expect(404);
      expect(fake.calls).toHaveLength(0);
    });

    it('writes the reading and the AI request in the activity log, never the words read', async () => {
      activity.setForTest({ on: true });
      try {
        const id = await photo(bde.one);
        const reading = (await read(bde.one, id).expect(200)).body;
        await activity.flush();
        const rows = await prisma.client.activityLog.findMany({ where: { id: { in: activity.recordedForTest() } } });
        const asked = rows.find((row) => row.action === 'sales.board.read');
        const answered = rows.find((row) => row.action === 'ai.request.shopBoard' && row.entityId === reading.aiRequestId);
        expect(asked).toMatchObject({ entityType: 'attachment', entityId: id, result: 'SUCCESS' });
        expect(answered).toBeDefined();
        expect(rows.find((row) => row.action === 'sales.photo.added' && row.entityId === id)).toBeDefined();
        for (const row of rows) expect(JSON.stringify(row)).not.toMatch(/Annapurna|Kukatpally|98480/);
      } finally {
        activity.setForTest({ on: false });
      }
    });
  });

  // ───────────────────────── A lead with its photo ─────────────────────────

  describe('a lead logged from the field', () => {
    it('keeps the shop-board photo with the lead, shows it on its page, and takes a retake', async () => {
      const board = await photo(bde.one);
      const logged = await addLead(bde.one, { id: randomUUID(), businessName: 'Annapurna', area: 'Kukatpally', contactPhone: '98480 22338', kitchens: 2, photoId: board });
      expect(logged).toMatchObject({ stage: 'NEW', status: 'OPEN', ownerId: bdeId.one, photo: { id: board, path: expect.stringContaining(board) } });
      // The console reads the same page.
      expect((await lead(admin, logged.id)).photo?.id).toBe(board);
      const retake = await photo(bde.one);
      const changed = (await http().patch(`/sales/leads/${logged.id}`).set(bearer(bde.one)).send({ photoId: retake }).expect(200)).body as LeadDetailDto;
      expect(changed.photo?.id).toBe(retake);
    });

    it("refuses someone else's photo on a lead", async () => {
      const theirs = await photo(bde.two);
      await http().post('/sales/leads').set(bearer(bde.one)).send({ businessName: `${MARK} Not mine`, source: 'FIELD_VISIT', photoId: theirs }).expect(400);
      await http().post('/sales/leads').set(bearer(bde.one)).send({ businessName: `${MARK} Not mine`, source: 'FIELD_VISIT', photoId: randomUUID() }).expect(400);
      expect(await prisma.client.lead.count({ where: { businessName: `${MARK} Not mine` } })).toBe(0);
    });

    it('offers each service with its kind, so a free check can suggest it', async () => {
      const options = (await http().get('/sales/quote-options').set(bearer(bde.one)).expect(200)).body as QuoteOptionDto[];
      expect(options.filter((option) => option.kind === 'PLAN').every((option) => option.serviceCode === null)).toBe(true);
      expect(options.filter((option) => option.kind === 'SERVICE').map((option) => option.serviceCode)).toEqual(expect.arrayContaining(['CHIMNEY', 'PEST', 'GREASE_TRAP']));
    });
  });

  // ───────────────────────── The free-check scorecard ─────────────────────────

  describe('the free-check scorecard', () => {
    it('keeps every answer with the step, moves the lead to Check done, and its count feeds Likely to close', async () => {
      const prospect = await addLead(bde.one, { businessName: 'Scorecard', area: 'Madhapur' });
      await http()
        .post(`/sales/leads/${prospect.id}/steps`)
        .set(bearer(bde.one))
        .send({ id: randomUUID(), kind: 'CHECK_BOOKED', checkAt: indiaMoment(today, '23:00').toISOString(), checkWith: 'Naveen' })
        .expect(201);
      const grease = await photo(bde.one);
      const stepId = randomUUID();
      const body = { id: stepId, kind: 'CHECK_DONE', note: 'Owner keen', findings: 9, scorecard: scorecard({ HOOD: 'FIX', DRAINS: 'FIX', STAFF: 'FIX', PESTS: 'UNSEEN' }, { HOOD: grease }) };
      const done = (await http().post(`/sales/leads/${prospect.id}/steps`).set(bearer(bde.one)).send(body).expect(201)).body as LeadDetailDto;
      // The count comes from the scorecard, not from what was typed.
      expect(done).toMatchObject({ stage: 'CHECK_DONE', checkFindings: 3, checkAt: null });
      const step = done.activities.find((entry) => entry.id === stepId)!;
      expect(step).toMatchObject({ kind: 'CHECK_DONE', findings: 3, note: 'Owner keen', toStage: 'CHECK_DONE' });
      expect(step.scorecard?.counts).toEqual({ OK: 6, FIX: 3, UNSEEN: 1 });
      expect(step.scorecard?.answers.map((entry) => entry.point)).toEqual([...FREE_CHECK_POINTS]);
      expect(step.scorecard?.answers[0]).toEqual({ point: 'HOOD', answer: 'FIX', photo: { id: grease, path: expect.stringContaining(grease) } });
      expect(done.close?.signals.map((signal) => signal.words)).toContain('check found 3 things to fix');
      // Do today now asks for the quote.
      expect(done.toDo).toMatchObject({ kind: 'QUOTE_NOT_SENT', action: 'SEND_QUOTE', params: { doneOn: today } });
      // The console's lead page reads the same scorecard.
      expect((await lead(admin, prospect.id)).activities.find((entry) => entry.id === stepId)?.scorecard?.counts.FIX).toBe(3);
    });

    it('refuses a scorecard with a point missing, or a photo that is not the BDE’s own', async () => {
      const prospect = await addLead(bde.one, { businessName: 'Bad scorecard' });
      const short = { answers: scorecard().answers.slice(2) };
      await http().post(`/sales/leads/${prospect.id}/steps`).set(bearer(bde.one)).send({ kind: 'CHECK_DONE', scorecard: short }).expect(400);
      const theirs = await photo(bde.two);
      await http()
        .post(`/sales/leads/${prospect.id}/steps`)
        .set(bearer(bde.one))
        .send({ kind: 'CHECK_DONE', scorecard: scorecard({ HOOD: 'FIX' }, { HOOD: theirs }) })
        .expect(400);
      expect((await lead(bde.one, prospect.id)).stage).toBe('NEW');
    });
  });

  // ───────────────────────── Sent twice from the outbox ─────────────────────────

  describe('every step sent again from the phone', () => {
    it('records a lead, a step, a park and a loss once, at the time they were done', async () => {
      const leadId = randomUUID();
      // Logged three hours ago in the street, sent now, and again.
      const loggedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const input = { id: leadId, at: loggedAt, businessName: `${MARK} Replayed`, source: 'FIELD_VISIT', kitchens: 1 };
      const first = (await http().post('/sales/leads').set(bearer(bde.one)).send(input).expect(201)).body as LeadDetailDto;
      await http().post('/sales/leads').set(bearer(bde.one)).send(input).expect(201);
      expect(await prisma.client.lead.count({ where: { id: leadId } })).toBe(1);
      expect(first).toMatchObject({ createdAt: loggedAt, lastActivityAt: loggedAt });
      expect(first.activities).toEqual([expect.objectContaining({ kind: 'CREATED', at: loggedAt })]);
      await http().post('/sales/leads').set(bearer(bde.one)).send({ ...input, id: randomUUID(), at: new Date(Date.now() + 3_600_000).toISOString() }).expect(400);

      // A visit logged two hours ago without signal arrives now, twice.
      const visit = { id: randomUUID(), kind: 'VISIT', at: new Date(Date.now() - 2 * 3_600_000).toISOString() };
      await http().post(`/sales/leads/${leadId}/steps`).set(bearer(bde.one)).send(visit).expect(201);
      const twice = (await http().post(`/sales/leads/${leadId}/steps`).set(bearer(bde.one)).send(visit).expect(201)).body as LeadDetailDto;
      expect(twice.activities.filter((entry) => entry.kind === 'VISIT')).toEqual([expect.objectContaining({ id: visit.id, at: visit.at })]);
      expect(twice.stage).toBe('CONTACTED');

      const park = { id: randomUUID(), at: new Date(Date.now() - 3_600_000).toISOString(), until: addDays(today, 10), reason: 'after Diwali' };
      await http().post(`/sales/leads/${leadId}/park`).set(bearer(bde.one)).send(park).expect(200);
      const parked = (await http().post(`/sales/leads/${leadId}/park`).set(bearer(bde.one)).send(park).expect(200)).body as LeadDetailDto;
      expect(parked).toMatchObject({ status: 'PARKED', parkedUntil: park.until, parkedReason: 'after Diwali', parkedAt: park.at });
      expect(parked.activities.filter((entry) => entry.kind === 'PARKED')).toHaveLength(1);

      const loss = { id: randomUUID(), reason: 'Has a vendor' };
      await http().post(`/sales/leads/${leadId}/lose`).set(bearer(bde.one)).send(loss).expect(200);
      // A second, different loss is still refused; the same one again is not.
      const lost = (await http().post(`/sales/leads/${leadId}/lose`).set(bearer(bde.one)).send(loss).expect(200)).body as LeadDetailDto;
      expect(lost.status).toBe('LOST');
      expect(lost.activities.filter((entry) => entry.kind === 'LOST')).toHaveLength(1);
      await http().post(`/sales/leads/${leadId}/lose`).set(bearer(bde.one)).send({ id: randomUUID(), reason: 'Again' }).expect(409);

      // A change of details sent twice leaves the same details.
      const change = { contactName: 'Faisal', nextAction: 'Call after Diwali', nextActionAt: indiaMoment(addDays(today, 12), '11:00').toISOString() };
      await http().patch(`/sales/leads/${leadId}`).set(bearer(bde.one)).send(change).expect(200);
      const changed = (await http().patch(`/sales/leads/${leadId}`).set(bearer(bde.one)).send(change).expect(200)).body as LeadDetailDto;
      expect(changed).toMatchObject({ contactName: 'Faisal', nextAction: 'Call after Diwali', nextActionAt: change.nextActionAt });
    });

    it('takes a park done on the phone yesterday until today, judged on the day it was done', async () => {
      const prospect = await addLead(bde.one, { businessName: 'Parked offline' });
      const yesterday = indiaMoment(addDays(today, -1), '18:00').toISOString();
      const parked = (await http().post(`/sales/leads/${prospect.id}/park`).set(bearer(bde.one)).send({ id: randomUUID(), at: yesterday, until: addDays(today, 1), reason: 'Owner away' }).expect(200)).body;
      expect(parked.parkedAt).toBe(yesterday);
      await http().post(`/sales/leads/${prospect.id}/park`).set(bearer(bde.one)).send({ at: new Date(Date.now() + 3_600_000).toISOString(), until: addDays(today, 3), reason: 'x' }).expect(400);
    });

    it('never lets a step id be reused on another lead', async () => {
      const a = await addLead(bde.one, { businessName: 'Step A' });
      const b = await addLead(bde.one, { businessName: 'Step B' });
      const id = randomUUID();
      await http().post(`/sales/leads/${a.id}/steps`).set(bearer(bde.one)).send({ id, kind: 'CALL' }).expect(201);
      await http().post(`/sales/leads/${b.id}/steps`).set(bearer(bde.one)).send({ id, kind: 'CALL' }).expect(409);
      await http().post(`/sales/leads/${b.id}/park`).set(bearer(bde.one)).send({ id, until: addDays(today, 5), reason: 'x' }).expect(409);
    });
  });

  // ───────────────────────── Own leads only ─────────────────────────

  describe("a BDE's own leads", () => {
    it("lets a BDE reach only their own leads and steps, and nobody else's", async () => {
      const mine = await addLead(bde.one, { businessName: 'Only mine', nextAction: 'Meet the owner', nextActionAt: indiaMoment(today, '23:30').toISOString() });
      await http().get(`/sales/leads/${mine.id}`).set(bearer(bde.two)).expect(404);
      await http().post(`/sales/leads/${mine.id}/steps`).set(bearer(bde.two)).send({ kind: 'CALL' }).expect(404);
      await http().post(`/sales/leads/${mine.id}/park`).set(bearer(bde.two)).send({ until: addDays(today, 3), reason: 'x' }).expect(404);
      await http().post(`/sales/leads/${mine.id}/lose`).set(bearer(bde.two)).send({ reason: 'x' }).expect(404);
      await http().patch(`/sales/leads/${mine.id}`).set(bearer(bde.two)).send({ contactName: 'x' }).expect(404);
      const theirList = (await http().get('/sales/leads').set(bearer(bde.two)).expect(200)).body;
      expect(theirList.leads.some((row: { id: string }) => row.id === mine.id)).toBe(false);
      await http().get('/sales/my-day').set(bearer(supervisor)).expect(403);
      await http().get('/sales/my-day').set(bearer(owner)).expect(403);
    });

    it("gives a BDE their own day: Do today for their leads only, and the week against their targets", async () => {
      const due = await addLead(bde.two, { businessName: 'Due today', contactPhone: '98480 11111', nextAction: 'Show the scorecard', nextActionAt: indiaMoment(today, '23:45').toISOString() });
      await addLead(bde.one, { businessName: 'Not theirs', nextAction: 'x', nextActionAt: indiaMoment(today, '23:45').toISOString() });
      const day = (await http().get('/sales/my-day').set(bearer(bde.two)).expect(200)).body as BdeDayDto;
      expect(day.today).toBe(today);
      expect(day.items.every((item) => item.ownerId === bdeId.two)).toBe(true);
      expect(day.items.find((item) => item.leadId === due.id)).toMatchObject({
        bucket: 'TODAY',
        kind: 'NEXT_ACTION_TODAY',
        time: '23:45',
        action: 'CALL',
        contactPhone: '+919848011111',
        params: { nextAction: 'Show the scorecard' },
      });
      expect(day.week).toMatchObject({ userId: bdeId.two, name: `${MARK} two` });
      expect(day.week!.actual.leads).toBeGreaterThanOrEqual(1);
      expect(day.week!.targets.leads).toBeGreaterThanOrEqual(10);
      // The same figures as the Sales page's "This week, by BDE".
      const overview = (await http().get('/sales/overview').query({ owner: bdeId.two }).set(bearer(admin)).expect(200)).body;
      expect(overview.byBde.find((row: { userId: string }) => row.userId === bdeId.two)).toEqual(day.week);
      // A founder selling for themselves has a day but no weekly targets.
      expect((await http().get('/sales/my-day').set(bearer(admin)).expect(200)).body.week).toBeNull();
    });
  });

  // ───────────────────────── Tidying ─────────────────────────

  describe('photos nothing points at', () => {
    it("removes an old photo nothing uses, and keeps a board's and a scorecard's", async () => {
      const db = prisma.client;
      const loose = await photo(bde.one);
      const board = await photo(bde.one);
      const card = await photo(bde.one);
      await addLead(bde.one, { businessName: 'Keeps its board', photoId: board });
      const checked = await addLead(bde.one, { businessName: 'Keeps its card' });
      await http().post(`/sales/leads/${checked.id}/steps`).set(bearer(bde.one)).send({ kind: 'CHECK_DONE', scorecard: scorecard({ WASTE: 'FIX' }, { WASTE: card }) }).expect(201);
      const old = new Date(Date.now() - 30 * 86_400_000);
      await db.attachment.updateMany({ where: { id: { in: [loose, board, card] } }, data: { createdAt: old } });
      await app.get(SalesService).dropUnusedPhotos();
      expect((await db.attachment.findMany({ where: { id: { in: [loose, board, card] } }, select: { id: true } })).map((row) => row.id).sort()).toEqual([board, card].sort());
    });
  });
});
