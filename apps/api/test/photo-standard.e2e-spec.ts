// The photo standard of a checklist item (15 Oct 2026): what a proof photo for the item must
// show, written once by AI from the item's wording and kept, so the camera nudge can judge
// any check a restaurant writes against what it means. It is made once and reused; made
// again only when the wording changes; kept on a library suggestion for every later pick;
// a check a photo cannot show is never called "not done"; the model's `seen` note is never
// returned, stored or logged; and with AI off nothing is made and the check works as before.
//
// Anthropic is never called: the fake engine answers (vitest.config.e2e.ts sets
// AI_ENGINE=fake and switches AI off for the rest of the run; these tests switch it on
// themselves). Everything happens at a throwaway outlet of the Deccan Biryani sample
// restaurant, with throwaway library suggestions; they, everything at the outlet, and
// exactly the AiRequest and activity log rows written here are removed afterwards.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { storedPhotoStandard, type StoredPhotoStandard } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { ActivityLogService } from './../src/activity-log/activity-log.service.js';
import { AppModule } from './../src/app.module.js';
import { AiEngineError, AI_ENGINE } from './../src/ai/ai-engine.js';
import { AiService } from './../src/ai/ai.service.js';
import { ContentTranslatorService } from './../src/ai/content-translator.service.js';
import { FAKE_SEEN, FakeAiEngine } from './../src/ai/fake-ai-engine.js';
import { PhotoStandardService } from './../src/checklists/photo-standard.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const DECCAN = { code: 'DECCA-KP6R3T', owner: '3917' };
const OUTLET_CODE = 'E2EPS-OUT001';
const DEVICE = 'e2e-photo-standard';
const LIBRARY = { picked: 'E2E-PSTD-LIB-01', lazy: 'E2E-PSTD-LIB-02' };
const CHECK = {
  tv: 'E2E TV is on',
  door: 'E2E Main door locked',
  gas: 'E2E Gas cylinder valve closed',
  lights: 'E2E All lights switched off',
  extinguisher: 'E2E Fire extinguisher in its holder',
  ratTrap: 'E2E Rat trap in place',
  register: 'E2E Temperature logged in the register',
  soap: 'E2E Soap dispenser filled',
  bins: 'E2E Dustbins emptied',
  hood: 'E2E Exhaust hood clean',
  fridge: 'E2E Fridge door shut',
};

/** A small "photo" whose bytes tell the fake engine what to answer. */
const photo = (marker = '') => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`sample proof photo ${marker}`)]);

type Text = Record<string, string>;
type List = { id: string; title: Text; items: { id: string; label: Text }[] };
type Run = { id: string; items: { id: string; label: Text }[] };

describe('The photo standard of a checklist item (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ai: AiService;
  let fake: FakeAiEngine;
  let standards: PhotoStandardService;
  let translator: ContentTranslatorService;
  let activity: ActivityLogService;
  let outletId: string;
  let owner: string;
  let ownerName: string;
  let listA: string;
  let listB: string;
  const entries = { picked: '', lazy: '' };

  const http = () => request(app.getHttpServer());
  const as = (token: string, language = 'EN') => ({ Authorization: `Bearer ${token}`, 'X-App-Language': language });
  const db = () => prisma.client;
  const callsFor = (feature: string) => fake.calls.filter((call) => call.feature === feature);
  const aiOn = () => ai.setForTest({ on: true, disabled: [], dailyLimitUsd: 1000, outletDailyLimitUsd: 1000 });
  const settled = async () => {
    await standards.settled();
    await translator.settled();
  };

  /** Adds an item to a checklist and gives back its id. */
  async function add(listId: string, body: object): Promise<string> {
    const lists = (await http().post(`/checklists/setup/${listId}/items`).set(as(owner)).send(body).expect(201)).body as List[];
    return lists.find((list) => list.id === listId)!.items.at(-1)!.id;
  }
  /** The item's stored standard, or null. */
  const standardOf = async (itemId: string): Promise<StoredPhotoStandard | null> =>
    storedPhotoStandard((await db().checklistItem.findUniqueOrThrow({ where: { id: itemId } })).photoStandard);
  /** Today's run of a checklist (made the first time anyone looks). */
  async function runOf(listId: string): Promise<string> {
    const runs = (await http().get('/checklists/today').query({ outletId }).set(as(owner)).expect(200)).body as (Run & { outletChecklistId: string })[];
    return runs.find((run) => run.outletChecklistId === listId)!.id;
  }
  /** The phone's call. */
  const check = (runId: string, itemId: string, file = photo(), language = 'EN') =>
    http()
      .post(`/checklists/runs/${runId}/items/${itemId}/photo-check`)
      .set(as(owner, language))
      .attach('file', file, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  /** What the last photo check sent with the photo. */
  const sentWith = () => JSON.parse(callsFor('photo-check').at(-1)!.text) as { check: string; standard: Record<string, unknown> | null; language: string };

  async function cleanUp() {
    const outlet = await db().outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    if (outlet) {
      const where = { outletId: outlet.id };
      const lists = await db().outletChecklist.findMany({ where, select: { templateId: true } });
      await db().checklistRun.deleteMany({ where });
      await db().outletChecklist.deleteMany({ where });
      // Only the checklists this test made (their items go with them); never ECCS's own.
      await db().checklistTemplate.deleteMany({ where: { id: { in: lists.map((list) => list.templateId) }, outletId: outlet.id } });
      await db().hygieneScoreSnapshot.deleteMany({ where });
      await db().outlet.delete({ where: { id: outlet.id } });
    }
    await db().checklistLibraryItem.deleteMany({ where: { code: { in: Object.values(LIBRARY) } } });
    await db().session.deleteMany({ where: { deviceName: DEVICE } });
    await db().linkedDevice.deleteMany({ where: { name: DEVICE } });
    if (ai) await db().aiRequest.deleteMany({ where: { id: { in: ai.recordedForTest() } } });
    if (activity) {
      await activity.flush();
      await db().activityLog.deleteMany({ where: { id: { in: activity.recordedForTest() } } });
    }
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    ai = app.get(AiService);
    fake = app.get<FakeAiEngine>(AI_ENGINE);
    standards = app.get(PhotoStandardService);
    translator = app.get(ContentTranslatorService);
    activity = app.get(ActivityLogService);
    expect(fake).toBeInstanceOf(FakeAiEngine);
    await cleanUp();

    const deccan = await db().outlet.findUniqueOrThrow({ where: { code: DECCAN.code } });
    outletId = (await db().outlet.create({ data: { organizationId: deccan.organizationId, name: 'E2E Photo standard outlet', code: OUTLET_CODE, address: 'Test Road' } })).id;
    const phone = await http().post('/auth/device/link').send({ code: DECCAN.code, deviceName: DEVICE }).expect(200);
    owner = (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin: DECCAN.owner }).expect(200)).body.token as string;
    ownerName = (await http().get('/auth/me').set(as(owner)).expect(200)).body.name as string;

    // Two throwaway suggestions stand in for the library's 588, so the real library is never touched.
    const entry = (code: string, text: string) =>
      db().checklistLibraryItem.create({ data: { code, source: 'eccs', checklistName: 'E2E', category: 'E2E', text: { en: text }, searchText: text.toLowerCase() } });
    entries.picked = (await entry(LIBRARY.picked, CHECK.extinguisher)).id;
    entries.lazy = (await entry(LIBRARY.lazy, CHECK.ratTrap)).id;

    // Two checklists of the restaurant's own, made with AI off.
    ai.setForTest({ on: false });
    const made = async (title: string) =>
      ((await http().post('/checklists/setup').set(as(owner)).send({ outletId, title }).expect(201)).body as List[]).find((list) => list.title.en === title)!.id;
    listA = await made('E2E Standard checks');
    listB = await made('E2E Standard second list');
  }, 60_000);

  afterAll(async () => {
    ai?.setForTest({ on: false });
    activity?.setForTest({ on: false });
    if (standards) await settled();
    await cleanUp();
    await app?.close();
  });

  beforeEach(() => {
    fake.reset();
    aiOn();
  });

  it('is written once, in the background, when a photo item is added, from the wording only, and the photo check judges against it', async () => {
    const tv = await add(listA, { label: CHECK.tv });
    await settled();
    const standard = await standardOf(tv);
    expect(standard).toMatchObject({ wording: CHECK.tv, photoCanShow: 'yes', aboutPeople: false, partlyNote: null });
    expect(standard!.subject).toBeTruthy();
    expect(Date.parse(standard!.madeAt)).toBeGreaterThan(Date.now() - 60_000);

    // One Haiku request with the wording and nothing else: no picture, nobody's name.
    const [made] = callsFor('photo-standard');
    expect(callsFor('photo-standard')).toHaveLength(1);
    expect(made).toMatchObject({ model: 'claude-haiku-5-5', hasFile: false });
    expect(JSON.parse(made!.text)).toEqual({ check: CHECK.tv });
    expect(made!.text).not.toContain(ownerName);
    const row = await db().aiRequest.findFirstOrThrow({ where: { id: { in: ai.recordedForTest() }, feature: 'photo-standard' } });
    // Only whether a photo can show it is kept on the request, never the standard's words.
    expect(row).toMatchObject({ status: 'OK', outletId, resultCode: 'YES', model: 'claude-haiku-5-5' });

    // The photo check: the photo, then the wording, the standard (without how it was kept) and the language.
    const runId = await runOf(listA);
    fake.reset();
    expect((await check(runId, tv).expect(200)).body).toMatchObject({ nudge: null, reason: null });
    expect(callsFor('photo-standard')).toHaveLength(0);
    expect(callsFor('photo-check')[0]).toMatchObject({ model: 'claude-haiku-5-5', hasFile: true });
    const { wording: _wording, madeAt: _madeAt, ...given } = standard!;
    expect(sentWith()).toEqual({ check: CHECK.tv, standard: given, language: 'English' });
    // And again: still no new standard.
    await check(runId, tv).expect(200);
    expect(callsFor('photo-standard')).toHaveLength(0);
  });

  it('is made at the first photo check of an item that has none, and kept for the next photo', async () => {
    ai.setForTest({ on: false });
    const gas = await add(listA, { label: CHECK.gas });
    await settled();
    expect(await standardOf(gas)).toBeNull();
    aiOn();

    const runId = await runOf(listA);
    await check(runId, gas).expect(200);
    expect(callsFor('photo-standard')).toHaveLength(1);
    expect(JSON.parse(callsFor('photo-standard')[0]!.text)).toEqual({ check: CHECK.gas });
    // The photo was judged against it at once.
    expect(sentWith().standard).toMatchObject({ photoCanShow: 'yes' });
    expect(await standardOf(gas)).toMatchObject({ wording: CHECK.gas });

    fake.reset();
    await check(runId, gas).expect(200);
    expect(callsFor('photo-standard')).toHaveLength(0);
  });

  it('is not made for a tick-only item until a photo of it is checked, or it is switched to need a photo', async () => {
    const lights = await add(listA, { label: CHECK.lights, photoRequired: false });
    await settled();
    expect(callsFor('photo-standard')).toHaveLength(0);
    expect(await standardOf(lights)).toBeNull();
    await http().patch(`/checklists/setup/items/${lights}`).set(as(owner)).send({ photoRequired: true }).expect(200);
    await settled();
    expect(callsFor('photo-standard')).toHaveLength(1);
    expect(await standardOf(lights)).toMatchObject({ wording: CHECK.lights });
  });

  it('is made again when the wording changes, but not when other languages are added', async () => {
    const tv = (await db().checklistItem.findFirstOrThrow({ where: { templateId: (await db().outletChecklist.findUniqueOrThrow({ where: { id: listA } })).templateId, label: { path: ['en'], equals: CHECK.tv } } })).id;
    const runId = await runOf(listA);
    const before = await standardOf(tv);

    // Translations filled in later keep the English: the same standard.
    await db().checklistItem.update({ where: { id: tv }, data: { label: { en: CHECK.tv, te: `[te] ${CHECK.tv}` } } });
    await check(runId, tv).expect(200);
    expect(callsFor('photo-standard')).toHaveLength(0);
    expect(await standardOf(tv)).toEqual(before);

    // New words: a new standard, made from them.
    await db().checklistItem.update({ where: { id: tv }, data: { label: { en: CHECK.door } } });
    await check(runId, tv).expect(200);
    expect(callsFor('photo-standard')).toHaveLength(1);
    expect(JSON.parse(callsFor('photo-standard')[0]!.text)).toEqual({ check: CHECK.door });
    expect(sentWith().check).toBe(CHECK.door);
    expect(await standardOf(tv)).toMatchObject({ wording: CHECK.door });
  });

  it("keeps a library suggestion's standard, so every later pick gets it with no AI call", async () => {
    const first = await add(listA, { libraryItemId: entries.picked });
    await settled();
    expect(callsFor('photo-standard')).toHaveLength(1);
    expect(JSON.parse(callsFor('photo-standard')[0]!.text)).toEqual({ check: CHECK.extinguisher });
    const kept = storedPhotoStandard((await db().checklistLibraryItem.findUniqueOrThrow({ where: { id: entries.picked } })).photoStandard);
    expect(kept).toMatchObject({ wording: CHECK.extinguisher, photoCanShow: 'yes' });
    expect(await standardOf(first)).toEqual(kept);

    // A later pick, on another checklist: the standard comes with it at once.
    fake.reset();
    const second = await add(listB, { libraryItemId: entries.picked });
    expect(await standardOf(second)).toEqual(kept);
    await settled();
    expect(callsFor('photo-standard')).toHaveLength(0);
    // Its first photo is judged against it, still with no new request.
    await check(await runOf(listB), second).expect(200);
    expect(callsFor('photo-standard')).toHaveLength(0);
    expect(sentWith().standard).toMatchObject({ subject: kept!.subject });
  });

  it('makes a suggestion picked while AI was off its standard at the first photo, and keeps it on the suggestion too', async () => {
    ai.setForTest({ on: false });
    const picked = await add(listA, { libraryItemId: entries.lazy });
    await settled();
    expect(await standardOf(picked)).toBeNull();
    aiOn();

    await check(await runOf(listA), picked).expect(200);
    expect(callsFor('photo-standard')).toHaveLength(1);
    expect(JSON.parse(callsFor('photo-standard')[0]!.text)).toEqual({ check: CHECK.ratTrap });
    const kept = storedPhotoStandard((await db().checklistLibraryItem.findUniqueOrThrow({ where: { id: entries.lazy } })).photoStandard);
    expect(kept).toMatchObject({ wording: CHECK.ratTrap });
    expect(await standardOf(picked)).toEqual(kept);
  });

  it('never says "not done" where a photo cannot show the check, whatever the model answers', async () => {
    const register = await add(listA, { label: CHECK.register });
    await settled();
    expect(await standardOf(register)).toMatchObject({ photoCanShow: 'no' });
    const runId = await runOf(listA);

    const answer = (await check(runId, register, photo('FAKE-AI:NOT_DONE')).expect(200)).body as { nudge: string | null; reason: string | null; aiRequestId: string };
    expect(answer).toMatchObject({ nudge: null, reason: null });
    // Recorded as what the person was shown.
    expect((await db().aiRequest.findUniqueOrThrow({ where: { id: answer.aiRequestId } })).resultCode).toBe('OK');
    // The other verdicts still come through for it.
    expect((await check(runId, register, photo('FAKE-AI:BLURRED')).expect(200)).body).toMatchObject({ nudge: 'BLURRED' });

    // Where a photo can show it, "not done" is shown as before.
    const gas = (await db().checklistItem.findFirstOrThrow({ where: { label: { path: ['en'], equals: CHECK.gas }, outletId } })).id;
    expect((await check(runId, gas, photo('FAKE-AI:NOT_DONE')).expect(200)).body).toMatchObject({ nudge: 'NOT_DONE', reason: expect.stringContaining('[en]') });
  });

  it('never returns, stores or logs what the model said it saw, and logs the standard as an AI request of its own', async () => {
    ai.setForTest({ on: false });
    const soap = await add(listA, { label: CHECK.soap });
    aiOn();
    activity.setForTest({ on: true });
    const answered = await check(await runOf(listA), soap, photo('FAKE-AI:NOT_DONE')).expect(200);
    await activity.flush();
    activity.setForTest({ on: false });

    // The phone gets the nudge, the reason and the request's id: nothing else.
    expect(Object.keys(answered.body).sort()).toEqual(['aiRequestId', 'nudge', 'reason']);
    expect(JSON.stringify(answered.body)).not.toContain('FAKE-SEEN');
    // Not on any AI request row, nor in the kept standard.
    const rows = await db().aiRequest.findMany({ where: { id: { in: ai.recordedForTest() } } });
    expect(JSON.stringify(rows)).not.toContain('FAKE-SEEN');
    expect(JSON.stringify(await standardOf(soap))).not.toContain('FAKE-SEEN');
    expect(FAKE_SEEN).toContain('FAKE-SEEN');

    // The log: the photo check, and the two AI requests it made, side by side; none of the words.
    const requestId = answered.headers['x-request-id'] as string;
    const logged = await db().activityLog.findMany({ where: { id: { in: activity.recordedForTest() }, requestId } });
    expect(logged.map((row) => row.action).sort()).toEqual(['ai.request.photoCheck', 'ai.request.photoStandard', 'checklists.photo.checked']);
    expect(logged.find((row) => row.action === 'ai.request.photoStandard')).toMatchObject({
      category: 'ai',
      aiFeature: 'photo-standard',
      aiModel: 'claude-haiku-5-5',
      aiStatus: 'OK',
      outletId,
      entityType: 'aiRequest',
    });
    const text = JSON.stringify(logged);
    expect(text).not.toContain('FAKE-SEEN');
    expect(text).not.toContain('it looks as');
    expect(text).not.toContain('water in them');
  });

  it('makes nothing with AI off, and the check steps aside as before; with only the standard off, judges from the wording', async () => {
    ai.setForTest({ on: false });
    const bins = await add(listA, { label: CHECK.bins });
    const runId = await runOf(listA);
    const before = ai.recordedForTest().length;
    expect((await check(runId, bins).expect(503)).body.code).toBe('AI_OFF');
    await settled();
    expect(fake.calls).toHaveLength(0);
    // One refused request, the photo check's own, as before: no standard was asked for.
    const refused = await db().aiRequest.findMany({ where: { id: { in: ai.recordedForTest().slice(before) } } });
    expect(refused.map((row) => [row.feature, row.status])).toEqual([['photo-check', 'OFF']]);
    expect(await standardOf(bins)).toBeNull();

    ai.setForTest({ on: true, disabled: ['photo-standard'] });
    const hood = await add(listA, { label: CHECK.hood });
    await settled();
    expect((await check(runId, hood).expect(200)).body).toMatchObject({ nudge: null });
    expect(callsFor('photo-standard')).toHaveLength(0);
    expect(sentWith()).toEqual({ check: CHECK.hood, standard: null, language: 'English' });
    expect(await standardOf(hood)).toBeNull();
  });

  it('judges from the wording when the standard cannot be made, and asks nothing over the daily limit', async () => {
    ai.setForTest({ on: false });
    const fridge = await add(listA, { label: CHECK.fridge });
    aiOn();
    const runId = await runOf(listA);

    fake.queue('photo-standard', new AiEngineError('TIMEOUT', 'Too slow'));
    expect((await check(runId, fridge, photo('FAKE-AI:WRONG_SUBJECT')).expect(200)).body).toMatchObject({ nudge: 'WRONG_SUBJECT' });
    expect(sentWith().standard).toBeNull();
    expect(await standardOf(fridge)).toBeNull();
    expect(await db().aiRequest.findFirstOrThrow({ where: { id: { in: ai.recordedForTest() }, feature: 'photo-standard', status: 'ERROR' } })).toMatchObject({ errorCode: 'TIMEOUT' });

    // Over the outlet's limit: one refused request, and no photo check asked for either.
    ai.setForTest({ outletDailyLimitUsd: 0 });
    fake.reset();
    const before = ai.recordedForTest().length;
    expect((await check(runId, fridge).expect(503)).body.code).toBe('AI_LIMIT');
    expect(fake.calls).toHaveLength(0);
    const refused = await db().aiRequest.findMany({ where: { id: { in: ai.recordedForTest().slice(before) } } });
    expect(refused.map((row) => [row.feature, row.status])).toEqual([['photo-standard', 'LIMIT']]);

    // Next time, with room again, it is made.
    aiOn();
    await check(runId, fridge).expect(200);
    expect(await standardOf(fridge)).toMatchObject({ wording: CHECK.fridge });
  });
});
