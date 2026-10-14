// The AI features (the Claude API), 14 Oct 2026: reading a licence document into
// the form, translating support threads and the restaurant's own text, and "Why
// this score?". Runs against the local database with the sample seed loaded.
//
// Anthropic is never called: the fake engine answers (vitest.config.e2e.ts sets
// AI_ENGINE=fake, and switches AI off for the rest of the run; these tests switch it
// on themselves). Everything happens at a throwaway outlet of the Deccan Biryani
// sample restaurant, with a throwaway Manager and Head Chef made for the run; all of
// it, and exactly the AiRequest rows written here, are removed afterwards.

import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { AI_ENGINE, AiEngineError } from './../src/ai/ai-engine.js';
import { AiService } from './../src/ai/ai.service.js';
import { ContentTranslatorService } from './../src/ai/content-translator.service.js';
import { FakeAiEngine } from './../src/ai/fake-ai-engine.js';
import { env } from './../src/config/env.js';
import { LicenceReaderService } from './../src/licences/licence-reader.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const OWNER = { code: 'DECCA-KP6R3T', pin: '3917' };
const OTHER_MANAGER = { code: 'SPICE-JH2K7M', pin: '4821' };
const PHONES = { admin: '+919000000001', supervisor: '+919000000003' };
const OUTLET_CODE = 'E2EAI-OUT001';
const DEVICE = 'e2e-ai';
const TEMP = { manager: 'E2E AI Manager', chef: 'E2E AI Head Chef' };

/** A clear sample licence as an image. */
const LICENCE_IMAGE = readFileSync(new URL('./fixtures/sample-fssai-licence.png', import.meta.url));
const PDF = Buffer.from('%PDF-1.4\n% e2e sample licence document\n%%EOF\n');
const UNREADABLE_PDF = Buffer.from('%PDF-1.4\n% FAKE-AI:UNREADABLE\n%%EOF\n');
const HARD_PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('FAKE-AI:NEEDS-SONNET blurred photo')]);

/** A small one-page PDF with real (selectable) text, one line per entry: the free reader can read it. */
function textPdf(lines: string[]): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (ch) => '\\' + ch);
  const content = ['BT', '/F1 14 Tf', '72 740 Td', ...lines.flatMap((line) => [`(${escape(line)}) Tj`, '0 -24 Td']), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
const FIRE_NOC_TEXT = textPdf([
  'NO OBJECTION CERTIFICATE',
  'NOC No: FIRE/HYD/2026/00871',
  'Date of Issue: 12 June 2026',
  'This certificate is valid till 11 June 2027.',
]);

type Translation = { text: string; from: string } | null;
type Issue = {
  id: string;
  description: string;
  descriptionTranslation: Translation;
  translationPending: boolean;
  comments: { id: string; body: string; translation: Translation }[];
};
type Explanation = { sentences: string[]; aiRequestId: string; stored: boolean; helpful: boolean | null };

describe('AI features (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ai: AiService;
  let fake: FakeAiEngine;
  let translator: ContentTranslatorService;
  let outletId: string;
  let owner: string;
  let manager: string;
  let chef: string;
  let otherManager: string;
  let admin: string;

  const http = () => request(app.getHttpServer());
  /** A request as `token`, with the app on screen in `language`. */
  const as = (token: string, language = 'EN') => ({ Authorization: `Bearer ${token}`, 'X-App-Language': language });
  const callsFor = (feature: string) => fake.calls.filter((call) => call.feature === feature);
  const row = (id: string) => prisma.client.aiRequest.findUniqueOrThrow({ where: { id } });

  async function cleanUp() {
    const db = prisma.client;
    const outlet = await db.outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    if (outlet) {
      const where = { outletId: outlet.id };
      const lists = await db.outletChecklist.findMany({ where, select: { templateId: true } });
      await db.aiScoreExplanation.deleteMany({ where });
      await db.issue.deleteMany({ where });
      await db.document.deleteMany({ where });
      await db.attachment.deleteMany({ where });
      await db.licence.deleteMany({ where });
      await db.foodLabel.deleteMany({ where });
      await db.foodItem.deleteMany({ where });
      await db.sopTemplate.deleteMany({ where });
      await db.checklistRun.deleteMany({ where });
      await db.outletChecklist.deleteMany({ where });
      await db.checklistTemplate.deleteMany({ where: { id: { in: lists.map((list) => list.templateId) } } });
      await db.hygieneScoreSnapshot.deleteMany({ where });
      await db.inspection.deleteMany({ where });
    }
    await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { user: { name: { in: Object.values(TEMP) } } }] } });
    await db.user.deleteMany({ where: { name: { in: Object.values(TEMP) } } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    if (outlet) await db.outlet.delete({ where: { id: outlet.id } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
    // Exactly the requests these tests made, and nothing of anyone else's.
    if (ai) await db.aiRequest.deleteMany({ where: { id: { in: ai.recordedForTest() } } });
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
    translator = app.get(ContentTranslatorService);
    app.get(LicenceReaderService).setReaderForTest('ai');
    expect(fake).toBeInstanceOf(FakeAiEngine);
    await cleanUp();

    const deccan = await prisma.client.outlet.findUniqueOrThrow({ where: { code: OWNER.code } });
    outletId = (
      await prisma.client.outlet.create({
        data: { organizationId: deccan.organizationId, name: 'E2E AI outlet', code: OUTLET_CODE, address: 'Test Road' },
      })
    ).id;

    owner = await pinLogin(OWNER.code, OWNER.pin);
    otherManager = await pinLogin(OTHER_MANAGER.code, OTHER_MANAGER.pin);
    admin = await otpLogin(PHONES.admin);
    const makeLogin = async (name: string, role: string, language: string) => {
      const made = await http().post('/restaurant-users').set(as(owner)).send({ name, role, outletId, language }).expect(201);
      return pinLogin(OUTLET_CODE, made.body.pin as string);
    };
    manager = await makeLogin(TEMP.manager, 'MANAGER', 'EN');
    chef = await makeLogin(TEMP.chef, 'HEAD_CHEF', 'TE');
  }, 60_000);

  afterAll(async () => {
    ai?.setForTest({ on: false });
    app?.get(LicenceReaderService).setReaderForTest(env.LICENCE_READER);
    await cleanUp();
    await app?.close();
  });

  beforeEach(() => {
    fake.reset();
    aiOn();
  });

  describe('the shared part', () => {
    it('says which features are on, and all are off with the main switch off', async () => {
      const on = await http().get('/ai/status').set(as(chef)).expect(200);
      expect(on.body.features).toEqual({
        'licence-reader': true,
        'translate-support': true,
        'translate-content': true,
        'explain-score': true,
        'monitoring-digest': true,
        'inspection-summary': true,
        'photo-check': true,
      });
      ai.setForTest({ disabled: ['explain-score'] });
      expect((await http().get('/ai/status').set(as(chef)).expect(200)).body.features['explain-score']).toBe(false);
      ai.setForTest({ on: false });
      const off = await http().get('/ai/status').set(as(chef)).expect(200);
      expect(Object.values(off.body.features).every((on) => on === false)).toBe(true);
    });

    it('shows ECCS what AI has cost today and this month, by feature, and nobody else', async () => {
      const upload = await uploadDocument(owner, LICENCE_IMAGE, 'fssai.png');
      await http().post('/licences/read').set(as(owner)).send({ attachmentId: upload }).expect(200);
      const usage = await http().get('/ai/usage').set(as(admin)).expect(200);
      const reader = usage.body.today.byFeature.find((entry: { feature: string }) => entry.feature === 'licence-reader');
      expect(reader).toMatchObject({ requests: expect.any(Number), costUsd: expect.any(Number) });
      expect(reader.requests).toBeGreaterThan(0);
      expect(reader.costUsd).toBeGreaterThan(0);
      expect(usage.body.month.requests).toBeGreaterThanOrEqual(usage.body.today.requests);
      expect(usage.body.limits).toEqual({ dailyUsd: 1000, outletDailyUsd: 1000 });
      await http().get('/ai/usage').set(as(owner)).expect(403);
      await http().get('/ai/usage').set(as(manager)).expect(403);
    });
  });

  // ───────────────────────── Feature 1 ─────────────────────────

  const uploadDocument = async (token: string, file: Buffer, filename: string): Promise<string> =>
    (
      await http()
        .post('/attachments')
        .set(as(token))
        .field('outletId', outletId)
        .field('kind', 'DOCUMENT')
        .attach('file', file, { filename, contentType: 'application/octet-stream' })
        .expect(201)
    ).body.id as string;
  const read = (token: string, attachmentId: string) => http().post('/licences/read').set(as(token)).send({ attachmentId });

  describe('reading a licence document into the form', () => {
    it('fills the fields from a photo, with Haiku, and records the request with its cost', async () => {
      const reading = (await read(owner, await uploadDocument(owner, LICENCE_IMAGE, 'fssai.png')).expect(200)).body;
      expect(reading).toEqual({
        type: 'FSSAI',
        number: '13622012000456',
        issuedOn: '2026-04-01',
        expiresOn: '2027-03-31',
        textFound: true,
        source: 'ai',
        issuedTo: 'Sample Kitchen (sample)',
        aiRequestId: expect.any(String),
      });
      expect(fake.calls).toEqual([expect.objectContaining({ feature: 'licence-reader', model: 'claude-haiku-5-5', hasFile: true })]);
      const recorded = await row(reading.aiRequestId as string);
      expect(recorded).toMatchObject({ feature: 'licence-reader', model: 'claude-haiku-5-5', status: 'OK', outletId, outcome: null });
      expect(recorded.costMicroUsd).toBeGreaterThan(0);
      expect(recorded.inputTokens).toBeGreaterThan(1600);
    });

    it('reads a PDF', async () => {
      const reading = (await read(manager, await uploadDocument(manager, PDF, 'noc.pdf')).expect(200)).body;
      expect(reading).toMatchObject({ type: 'FIRE_NOC', number: 'FIRE/HYD/2026/00871', expiresOn: '2027-06-11', source: 'ai' });
    });

    it('leaves the fields it could not read empty, after Sonnet has tried once', async () => {
      const reading = (await read(owner, await uploadDocument(owner, UNREADABLE_PDF, 'scan.pdf')).expect(200)).body;
      expect(reading).toMatchObject({ type: null, number: null, issuedOn: null, expiresOn: null, issuedTo: null, textFound: false, source: 'ai' });
      expect(fake.calls.map((call) => call.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    });

    it('steps up to Sonnet when Haiku cannot read the number or the expiry date', async () => {
      const reading = (await read(owner, await uploadDocument(owner, HARD_PHOTO, 'blurred.jpg')).expect(200)).body;
      expect(reading).toMatchObject({ number: '13622012000456', expiresOn: '2027-03-31', source: 'ai' });
      expect(fake.calls.map((call) => call.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
      expect((await row(reading.aiRequestId as string)).model).toBe('claude-sonnet-5-5');
    });

    it('is refused to the Head Chef, and ECCS staff get the free reader, not AI', async () => {
      const mine = await uploadDocument(owner, PDF, 'licence.pdf');
      await read(chef, mine).expect(403);
      const eccs = (await read(admin, await uploadDocument(admin, FIRE_NOC_TEXT, 'noc.pdf')).expect(200)).body;
      expect(eccs).toEqual({ type: 'FIRE_NOC', number: 'FIRE/HYD/2026/00871', issuedOn: '2026-06-12', expiresOn: '2027-06-11', textFound: true });
      expect(fake.calls).toHaveLength(0);
    });

    it('lets the existing reader answer when AI is off, or when the call fails', async () => {
      ai.setForTest({ on: false });
      const off = (await read(owner, await uploadDocument(owner, FIRE_NOC_TEXT, 'noc.pdf')).expect(200)).body;
      expect(off).toEqual({ type: 'FIRE_NOC', number: 'FIRE/HYD/2026/00871', issuedOn: '2026-06-12', expiresOn: '2027-06-11', textFound: true });
      expect(fake.calls).toHaveLength(0);

      aiOn();
      fake.queue('licence-reader', new AiEngineError('HTTP_529', 'Overloaded'));
      const failed = (await read(owner, await uploadDocument(owner, FIRE_NOC_TEXT, 'noc.pdf')).expect(200)).body;
      expect(failed).not.toHaveProperty('source');
      expect(failed.expiresOn).toBe('2027-06-11');
      const errors = await prisma.client.aiRequest.findMany({ where: { id: { in: ai.recordedForTest() }, status: 'ERROR' } });
      expect(errors.map((entry) => entry.errorCode)).toContain('HTTP_529');
    });

    it('records whether the person kept or changed what was filled in, for their own request only', async () => {
      const reading = (await read(owner, await uploadDocument(owner, LICENCE_IMAGE, 'fssai.png')).expect(200)).body;
      const id = reading.aiRequestId as string;
      const outcome = (token: string, value: string) => http().post(`/ai/requests/${id}/outcome`).set(as(token)).send({ outcome: value });
      await outcome(owner, 'EDITED').expect(204);
      expect((await row(id)).outcome).toBe('EDITED');
      await outcome(otherManager, 'ACCEPTED').expect(404);
      await outcome(admin, 'ACCEPTED').expect(404);
      await outcome(owner, 'LOVED_IT').expect(400);
      await http().post('/ai/requests/made-up/outcome').set(as(owner)).send({ outcome: 'ACCEPTED' }).expect(404);
    });
  });

  // ───────────────────────── Feature 2a ─────────────────────────

  describe('translating support threads', () => {
    let issueId: string;
    const getIssue = async (token: string, language: string) =>
      (await http().get(`/issues/${issueId}`).set(as(token, language)).expect(200)).body as Issue;
    const translate = async (token: string, language: string) =>
      (await http().post(`/issues/${issueId}/translate`).set(as(token, language)).expect(200)).body as Issue;

    it('translates ECCS’s English reply for a Telugu reader, once, and keeps the original', async () => {
      const raised = await http()
        .post('/issues')
        .set(as(chef, 'TE'))
        .send({ outletId, category: 'EQUIPMENT', description: 'ఫ్రిజ్ పని చేయడం లేదు, దయచేసి సహాయం చేయండి' })
        .expect(201);
      issueId = raised.body.id as string;
      const reply = 'E2E We will send a technician tomorrow at 10:30.';
      await http().post(`/issues/${issueId}/comments`).set(as(admin)).send({ body: reply }).expect(200);

      const before = await getIssue(chef, 'TE');
      expect(before.translationPending).toBe(true);
      expect(before.comments[0]!.translation).toBeNull();

      const after = await translate(chef, 'TE');
      // The Head Chef's own Telugu description is not translated for them.
      expect(after.descriptionTranslation).toBeNull();
      expect(after.comments[0]).toMatchObject({ body: reply, translation: { text: `[te] ${reply}`, from: 'en' } });
      expect(after.translationPending).toBe(false);
      // Only the reply was sent: one call, one message.
      expect(callsFor('translate-support')).toHaveLength(1);
      expect((callsFor('translate-support')[0]!.facts as { messages: unknown[] }).messages).toHaveLength(1);

      // Stored: reading and asking again cost nothing.
      expect((await getIssue(chef, 'TE')).comments[0]!.translation).toEqual({ text: `[te] ${reply}`, from: 'en' });
      await translate(chef, 'TE');
      expect(callsFor('translate-support')).toHaveLength(1);
    });

    it('translates the Telugu description into English for ECCS, and the Owner reading Telugu needs no call', async () => {
      const forEccs = await translate(admin, 'EN');
      expect(forEccs.description).toBe('ఫ్రిజ్ పని చేయడం లేదు, దయచేసి సహాయం చేయండి');
      expect(forEccs.descriptionTranslation).toEqual({ text: '[en] ఫ్రిజ్ పని చేయడం లేదు, దయచేసి సహాయం చేయండి', from: 'te' });
      // ECCS's own reply is never translated for ECCS.
      expect(forEccs.comments[0]!.translation).toBeNull();
      expect(callsFor('translate-support')).toHaveLength(1);

      // The Owner reads Telugu: the description is plainly Telugu, and the reply's Telugu is stored.
      const forOwner = await getIssue(owner, 'TE');
      expect(forOwner.descriptionTranslation).toBeNull();
      expect(forOwner.comments[0]!.translation?.from).toBe('en');
      expect(forOwner.translationPending).toBe(false);
      await translate(owner, 'TE');
      expect(callsFor('translate-support')).toHaveLength(1);
    });

    it('shows the original only, with nothing pending, when translation is off or fails', async () => {
      await http().post(`/issues/${issueId}/comments`).set(as(admin)).send({ body: 'E2E The technician is on the way.' }).expect(200);
      ai.setForTest({ disabled: ['translate-support'] });
      const off = await getIssue(chef, 'TE');
      expect(off.translationPending).toBe(false);
      expect((await translate(chef, 'TE')).comments[1]!.translation).toBeNull();
      expect(fake.calls).toHaveLength(0);

      aiOn();
      fake.queue('translate-support', new AiEngineError('TIMEOUT', 'Too slow'));
      const failed = await translate(chef, 'TE');
      expect(failed.comments[1]).toMatchObject({ body: 'E2E The technician is on the way.', translation: null });
      expect(failed.comments[0]!.translation).not.toBeNull();
    });
  });

  // ───────────────────────── Feature 2b ─────────────────────────

  describe("filling in the other languages of the restaurant's own text", () => {
    type List = { id: string; title: Record<string, string>; items: { id: string; label: Record<string, string>; isCustom: boolean }[] };
    let listId: string;
    const setup = async (token: string, language = 'EN') =>
      (await http().get('/checklists/setup').query({ outletId }).set(as(token, language)).expect(200)).body as List[];

    it("fills in a checklist and its typed item in every language, keeping the Owner's English as typed", async () => {
      const lists = (await http().post('/checklists/setup').set(as(owner)).send({ outletId, title: 'E2E Mid-day checks' }).expect(201))
        .body as List[];
      listId = lists.find((list) => list.title.en === 'E2E Mid-day checks')!.id;
      await http().post(`/checklists/setup/${listId}/items`).set(as(owner)).send({ label: 'E2E Clean the tandoor' }).expect(201);
      await translator.settled();

      const list = (await setup(chef, 'TE')).find((entry) => entry.id === listId)!;
      expect(Object.keys(list.title)).toHaveLength(12);
      expect(list.title).toMatchObject({ en: 'E2E Mid-day checks', te: '[te] E2E Mid-day checks' });
      const item = list.items.find((entry) => entry.isCustom)!;
      expect(Object.keys(item.label).sort()).toEqual(['bn', 'en', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te', 'ur']);
      expect(item.label.en).toBe('E2E Clean the tandoor');
      expect(item.label.te).toBe('[te] E2E Clean the tandoor');
      expect(callsFor('translate-content')).toHaveLength(2);
      const stored = await prisma.client.checklistItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(stored.typedLanguage).toBe('en');
    });

    it("never sends ECCS's library checks, which are translated already", async () => {
      const suggestions = (await http().get(`/checklists/setup/${listId}/suggestions`).query({ q: 'fridge' }).set(as(owner)).expect(200))
        .body as { id: string }[];
      await http().post(`/checklists/setup/${listId}/items`).set(as(owner)).send({ libraryItemId: suggestions[0]!.id }).expect(201);
      await translator.settled();
      expect(fake.calls).toHaveLength(0);
    });

    it("fills in an SOP step by step, and the Head Chef reads it in Telugu", async () => {
      const created = await http()
        .post('/sops')
        .set(as(owner))
        .send({ outletId, category: 'CLEANING', title: 'E2E Closing the kitchen', steps: ['Switch off the gas', 'Clean the floor'] })
        .expect(201);
      await translator.settled();
      const sop = (await http().get(`/sops/${created.body.id}`).set(as(chef, 'TE')).expect(200)).body as {
        title: Record<string, string>;
        steps: Record<string, string[]>;
      };
      expect(sop.title.en).toBe('E2E Closing the kitchen');
      expect(sop.title.te).toBe('[te] E2E Closing the kitchen');
      expect(sop.steps.en).toEqual(['Switch off the gas', 'Clean the floor']);
      expect(sop.steps.te).toEqual(['[te] Switch off the gas', '[te] Clean the floor']);
      expect(Object.keys(sop.steps)).toHaveLength(12);
    });

    it('fills in a label name the Head Chef typed in Telugu, so the Owner reads it in English', async () => {
      await http()
        .post('/food-labels/items')
        .set(as(chef, 'TE'))
        .send({ outletId, name: 'E2E పెరుగు', shelfLifeHours: 24 })
        .expect(201);
      await translator.settled();
      const items = (await http().get('/food-labels/items').query({ outletId }).set(as(owner)).expect(200)).body as { name: string }[];
      expect(items.map((item) => item.name)).toContain('[en] E2E పెరుగు');
      const stored = await prisma.client.foodItem.findFirstOrThrow({ where: { outletId } });
      expect(stored.typedLanguage).toBe('te');
      expect((stored.name as Record<string, string>).te).toBe('E2E పెరుగు');
    });

    it('saves only what was typed when AI is off', async () => {
      ai.setForTest({ on: false });
      await http().post(`/checklists/setup/${listId}/items`).set(as(owner)).send({ label: 'E2E Wipe the shelves' }).expect(201);
      await translator.settled();
      const item = (await setup(owner)).find((entry) => entry.id === listId)!.items.find((entry) => entry.label.en === 'E2E Wipe the shelves')!;
      expect(item.label).toEqual({ en: 'E2E Wipe the shelves' });
      expect(fake.calls).toHaveLength(0);
    });
  });

  // ───────────────────────── Feature 3 ─────────────────────────

  describe('"Why this score?"', () => {
    const explain = (token: string, language = 'EN') => http().post(`/scores/${outletId}/explain`).set(as(token, language));
    let first: Explanation;

    beforeAll(async () => {
      // An approved ECCS inspection at 72 out of 100, so the outlet has a score with points lost.
      const supervisor = await otpLogin(PHONES.supervisor);
      const supervisorId = (await http().get('/auth/me').set(as(supervisor)).expect(200)).body.id as string;
      const template = await prisma.client.checklistTemplate.findFirstOrThrow({ where: { kind: 'INSPECTION' } });
      const now = new Date();
      await prisma.client.inspection.create({
        data: {
          outletId,
          templateId: template.id,
          supervisorId,
          status: 'APPROVED',
          conductedAt: now,
          startedAt: now,
          completedAt: now,
          approvedAt: now,
          overallScore: 72,
          grade: 'B',
        },
      });
    });

    it('gives the Owner three short sentences from the score, using only its numbers', async () => {
      const score = (await http().get(`/scores/${outletId}`).set(as(owner)).expect(200)).body as { score: number };
      first = (await explain(owner).expect(200)).body as Explanation;
      expect(first.stored).toBe(false);
      expect(first.helpful).toBeNull();
      expect(first.sentences.length).toBeGreaterThanOrEqual(2);
      expect(first.sentences[0]).toContain(`Your score is ${score.score}.`);
      const call = callsFor('explain-score')[0]!;
      expect(call.model).toBe('claude-haiku-5-5');
      // Only the score facts were sent: the score and its parts, nothing about people.
      expect(Object.keys(call.facts as object).sort()).toEqual(['band', 'checklistsDay', 'costingPoints', 'notes', 'outOf', 'parts', 'provisional', 'score']);
    });

    it('serves a second opening, and the Manager in the same language, from the store at no cost', async () => {
      const again = (await explain(owner).expect(200)).body as Explanation;
      expect(again).toMatchObject({ stored: true, aiRequestId: first.aiRequestId, sentences: first.sentences });
      expect((await explain(manager).expect(200)).body).toMatchObject({ stored: true, aiRequestId: first.aiRequestId });
      expect(fake.calls).toHaveLength(0);
    });

    it('is not for the Head Chef, ECCS staff or another restaurant', async () => {
      await explain(chef, 'TE').expect(403);
      await explain(admin).expect(403);
      await explain(otherManager).expect(404);
      expect(fake.calls).toHaveLength(0);
    });

    it('takes "Helpful?" from the Manager on the shared explanation', async () => {
      await http().post(`/ai/requests/${first.aiRequestId}/outcome`).set(as(manager)).send({ outcome: 'HELPFUL' }).expect(204);
      expect((await row(first.aiRequestId)).outcome).toBe('HELPFUL');
      expect(((await explain(owner).expect(200)).body as Explanation).helpful).toBe(true);
    });

    it('rejects an answer with a number the app did not give, and keeps nothing', async () => {
      fake.queue('explain-score', { pulledDown: 'Your score is 97531 because of the inspection.', doFirst: 'Fix the inspection points.', doNext: '' });
      const refused = await explain(manager, 'TE').expect(503);
      expect(refused.body.code).toBe('AI_FAILED');
      const rejected = await prisma.client.aiRequest.findFirstOrThrow({
        where: { id: { in: ai.recordedForTest() }, feature: 'explain-score', status: 'INVALID' },
      });
      expect(rejected.errorCode).toBe('NUMBERS');
      expect(await prisma.client.aiScoreExplanation.count({ where: { outletId, language: 'te' } })).toBe(0);
    });

    it('steps aside with AI_LIMIT over the outlet’s daily limit, and AI_OFF when switched off', async () => {
      ai.setForTest({ outletDailyLimitUsd: 0 });
      expect((await explain(owner, 'HI').expect(503)).body.code).toBe('AI_LIMIT');
      ai.setForTest({ outletDailyLimitUsd: 1000, dailyLimitUsd: 0 });
      expect((await explain(owner, 'HI').expect(503)).body.code).toBe('AI_LIMIT');
      ai.setForTest({ on: false });
      expect((await explain(owner, 'HI').expect(503)).body.code).toBe('AI_OFF');
      expect(fake.calls).toHaveLength(0);
      const refusals = await prisma.client.aiRequest.findMany({
        where: { id: { in: ai.recordedForTest() }, feature: 'explain-score', status: { in: ['LIMIT', 'OFF'] } },
      });
      expect(refusals.map((entry) => entry.status).sort()).toEqual(['LIMIT', 'LIMIT', 'OFF']);
      expect(refusals.every((entry) => entry.costMicroUsd === 0)).toBe(true);
    });
  });
});
