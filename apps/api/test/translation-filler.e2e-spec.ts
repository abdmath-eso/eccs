// Filling in missing languages (15 Oct 2026): the timed job that goes back to the
// restaurant's own texts saved without their other languages (before AI existed, while
// it was off or over its limit, or picked from the English-only suggestion library) and
// fills in only the missing ones. Runs against the local database with the sample seed
// loaded.
//
// Anthropic is never called: the fake engine answers ("[te] ..."). The job only ever runs
// here for the throwaway outlet of the Deccan Biryani sample restaurant made for this run
// (its `outletIds`), except one read-only look at what it would pick across all outlets.
// Throwaway library entries and ECCS-owned texts stand in for the real ones. Everything
// made here, and exactly the AiRequest and activity log rows written here, is removed
// afterwards.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ActivityLogService } from './../src/activity-log/activity-log.service.js';
import { AI_ENGINE } from './../src/ai/ai-engine.js';
import { AiService } from './../src/ai/ai.service.js';
import { ContentTranslatorService } from './../src/ai/content-translator.service.js';
import { FakeAiEngine } from './../src/ai/fake-ai-engine.js';
import { TranslationFillerService } from './../src/ai/translation-filler.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const OWNER = { code: 'DECCA-KP6R3T', pin: '3917' };
const OUTLET_CODE = 'E2EFL-OUT001';
const DEVICE = 'e2e-translation-filler';
const CODES = { picked: 'E2E-FILL-LIB-01', unpicked: 'E2E-FILL-LIB-02', eccsSop: 'E2E-FILL-ECCS-SOP' };
const ALL = ['bn', 'en', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te', 'ur'];
const TEXT = {
  list: 'E2E Fill list',
  item: 'E2E Fill typed item',
  partial: 'E2E Fill partial',
  partialTe: 'E2E నా తెలుగు',
  picked: 'E2E Fill check for water leaks.',
  sop: 'E2E Fill SOP',
  steps: ['E2E Step one', 'E2E Step two'],
  label: 'E2E Fill label',
  labelTe: 'E2E ఫిల్ పెరుగు',
};

type Text = Record<string, string>;
type List = { id: string; title: Text; items: { id: string; label: Text }[] };

describe('Filling in missing languages (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ai: AiService;
  let fake: FakeAiEngine;
  let translator: ContentTranslatorService;
  let filler: TranslationFillerService;
  let activity: ActivityLogService;
  let outletId: string;
  let owner: string;
  const made = { list: '', template: '', item: '', partial: '', picked: '', sop: '', label: '', labelTe: '', entry: '', unpicked: '', eccsTemplate: '', eccsItem: '', eccsSop: '' };

  const http = () => request(app.getHttpServer());
  const as = (token: string, language = 'EN') => ({ Authorization: `Bearer ${token}`, 'X-App-Language': language });
  /** Eleven minutes from now: past the ten minutes a fresh save is left to its own translation. */
  const later = () => new Date(Date.now() + 11 * 60_000);
  const mine = () => ({ outletIds: [outletId], now: later() });
  // A pick of a photo check also writes its photo standard in the background; that has its own
  // tests (photo-standard.e2e-spec.ts), so it is switched off here to count translations only.
  const aiOn = () => ai.setForTest({ on: true, disabled: ['photo-standard'], dailyLimitUsd: 1000, outletDailyLimitUsd: 1000 });
  const db = () => prisma.client;
  const label = async (id: string) => (await db().checklistItem.findUniqueOrThrow({ where: { id } })).label as Text;

  async function cleanUp() {
    const outlet = await db().outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    if (outlet) {
      const where = { outletId: outlet.id };
      const lists = await db().outletChecklist.findMany({ where, select: { templateId: true } });
      await db().foodLabel.deleteMany({ where });
      await db().foodItem.deleteMany({ where });
      await db().sopTemplate.deleteMany({ where });
      await db().checklistRun.deleteMany({ where });
      await db().outletChecklist.deleteMany({ where });
      await db().checklistTemplate.deleteMany({ where: { id: { in: lists.map((list) => list.templateId) } } });
    }
    // ECCS-owned stand-ins: a basic checklist no outlet uses (its item goes with it) and a draft standard SOP.
    await db().checklistTemplate.deleteMany({ where: { outletId: null, title: { path: ['en'], equals: 'E2E FILL ECCS basic list' } } });
    await db().sopTemplate.deleteMany({ where: { code: CODES.eccsSop } });
    await db().checklistLibraryItem.deleteMany({ where: { code: { in: [CODES.picked, CODES.unpicked] } } });
    await db().session.deleteMany({ where: { deviceName: DEVICE } });
    await db().linkedDevice.deleteMany({ where: { name: DEVICE } });
    if (outlet) await db().outlet.delete({ where: { id: outlet.id } });
    if (ai) await db().aiRequest.deleteMany({ where: { id: { in: ai.recordedForTest() } } });
    if (activity) await db().activityLog.deleteMany({ where: { id: { in: activity.recordedForTest() } } });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    ai = app.get(AiService);
    fake = app.get<FakeAiEngine>(AI_ENGINE);
    translator = app.get(ContentTranslatorService);
    filler = app.get(TranslationFillerService);
    activity = app.get(ActivityLogService);
    expect(fake).toBeInstanceOf(FakeAiEngine);
    await cleanUp();

    const deccan = await db().outlet.findUniqueOrThrow({ where: { code: OWNER.code } });
    outletId = (await db().outlet.create({ data: { organizationId: deccan.organizationId, name: 'E2E Fill outlet', code: OUTLET_CODE, address: 'Test Road' } })).id;
    const phone = await http().post('/auth/device/link').send({ code: OWNER.code, deviceName: DEVICE }).expect(200);
    owner = (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin: OWNER.pin }).expect(200)).body.token as string;

    const entry = (code: string, text: string) =>
      db().checklistLibraryItem.create({ data: { code, source: 'eccs', checklistName: 'E2E', category: 'E2E', text: { en: text }, searchText: text.toLowerCase() } });
    made.entry = (await entry(CODES.picked, TEXT.picked)).id;
    made.unpicked = (await entry(CODES.unpicked, 'E2E Fill a suggestion nobody picked.')).id;
    const eccs = await db().checklistTemplate.create({
      data: { kind: 'DAILY', title: { en: 'E2E FILL ECCS basic list' }, items: { create: { position: 1, label: { en: 'E2E FILL ECCS basic item' } } } },
      include: { items: true },
    });
    made.eccsTemplate = eccs.id;
    made.eccsItem = eccs.items[0]!.id;
    made.eccsSop = (
      await db().sopTemplate.create({ data: { code: CODES.eccsSop, category: 'CLEANING', title: { en: 'E2E FILL ECCS SOP' }, body: { en: 'E2E ECCS step' } } })
    ).id;
  }, 60_000);

  afterAll(async () => {
    ai?.setForTest({ on: false });
    activity?.setForTest({ on: false });
    await translator?.settled();
    await cleanUp();
    await app?.close();
  });

  beforeEach(() => {
    fake.reset();
    aiOn();
  });

  it('keeps only what was typed while AI is off (the texts the job goes back to)', async () => {
    ai.setForTest({ on: false });
    const lists = (await http().post('/checklists/setup').set(as(owner)).send({ outletId, title: TEXT.list }).expect(201)).body as List[];
    made.list = lists.find((list) => list.title.en === TEXT.list)!.id;
    const add = async (body: object) =>
      ((await http().post(`/checklists/setup/${made.list}/items`).set(as(owner)).send(body).expect(201)).body as List[]).find((list) => list.id === made.list)!.items.at(-1)!;
    made.item = (await add({ label: TEXT.item })).id;
    made.partial = (await add({ label: TEXT.partial })).id;
    made.picked = (await add({ libraryItemId: made.entry })).id;
    made.sop = (await http().post('/sops').set(as(owner)).send({ outletId, category: 'CLEANING', title: TEXT.sop, steps: TEXT.steps }).expect(201)).body.id as string;
    made.label = (await http().post('/food-labels/items').set(as(owner)).send({ outletId, name: TEXT.label, shelfLifeHours: 24 }).expect(201)).body.id as string;
    made.labelTe = (await http().post('/food-labels/items').set(as(owner, 'TE')).send({ outletId, name: TEXT.labelTe, shelfLifeHours: 24 }).expect(201)).body
      .id as string;
    await translator.settled();
    made.template = (await db().outletChecklist.findUniqueOrThrow({ where: { id: made.list } })).templateId;
    // One item already has a second language, which must survive untouched.
    await db().checklistItem.update({ where: { id: made.partial }, data: { label: { en: TEXT.partial, te: TEXT.partialTe } } });

    expect(await label(made.item)).toEqual({ en: TEXT.item });
    expect(await label(made.picked)).toEqual({ en: TEXT.picked });
    expect((await db().foodItem.findUniqueOrThrow({ where: { id: made.labelTe } })).name).toEqual({ te: TEXT.labelTe });
    expect(fake.calls).toHaveLength(0);
  });

  it('leaves alone anything saved in the last ten minutes: its own translation may still be running', async () => {
    const report = await filler.run({ outletIds: [outletId] });
    expect(report).toMatchObject({ items: 0, lists: 0, sops: 0, labels: 0, library: 0, recent: 7, waiting: 0, stopped: null });
    expect(fake.calls).toHaveLength(0);
    // Eleven minutes on, all seven are waiting.
    const { texts } = await filler.findWaiting(mine());
    expect(texts.map((text) => `${text.kind}:${text.id}`).sort()).toEqual(
      [
        `library:${made.entry}`,
        `item:${made.item}`,
        `item:${made.partial}`,
        `list:${made.template}`,
        `sop:${made.sop}`,
        `label:${made.label}`,
        `label:${made.labelTe}`,
      ].sort(),
    );
  });

  it('stops when AI is off', async () => {
    ai.setForTest({ on: false });
    const report = await filler.run(mine());
    expect(report).toMatchObject({ stopped: 'AI_OFF', waiting: 7, items: 0, library: 0 });
    expect(fake.calls).toHaveLength(0);
    expect(await label(made.item)).toEqual({ en: TEXT.item });
  });

  it("waits while the outlet's or the platform's daily AI allowance is used up, without asking the AI", async () => {
    const before = ai.recordedForTest().length;
    ai.setForTest({ outletDailyLimitUsd: 0 });
    expect(await filler.run(mine())).toMatchObject({ overLimit: 1, waiting: 7, stopped: null, items: 0 });
    ai.setForTest({ outletDailyLimitUsd: 1000, dailyLimitUsd: 0 });
    expect(await filler.run(mine())).toMatchObject({ stopped: 'DAILY_LIMIT', waiting: 7, items: 0 });
    expect(fake.calls).toHaveLength(0);
    // Not even a refused request: the job asks about the limits before it calls.
    expect(ai.recordedForTest()).toHaveLength(before);
    expect(await label(made.item)).toEqual({ en: TEXT.item });
  });

  it("never picks ECCS's own text, or a library entry nobody has picked", async () => {
    // A read-only look across every outlet, as the hourly run sees them.
    const { texts } = await filler.findWaiting({ now: later() });
    const picked = new Set(texts.map((text) => text.id));
    for (const id of [made.eccsTemplate, made.eccsItem, made.eccsSop, made.unpicked]) expect(picked.has(id), id).toBe(false);
    expect(picked.has(made.item)).toBe(true);
    expect(picked.has(made.entry)).toBe(true);
    // Every checklist item, checklist name and SOP it picks belongs to an outlet.
    const own = async (kind: string, find: (ids: string[]) => Promise<{ outletId: string | null }[]>) => {
      const ids = texts.filter((text) => text.kind === kind).map((text) => text.id);
      return (await find(ids)).every((row) => row.outletId !== null);
    };
    expect(await own('item', (ids) => db().checklistItem.findMany({ where: { id: { in: ids } }, select: { outletId: true } }))).toBe(true);
    expect(await own('list', (ids) => db().checklistTemplate.findMany({ where: { id: { in: ids } }, select: { outletId: true } }))).toBe(true);
    expect(await own('sop', (ids) => db().sopTemplate.findMany({ where: { id: { in: ids } }, select: { outletId: true } }))).toBe(true);
  });

  it('fills in only the missing languages of each kind, one call per outlet and language, and logs the run', async () => {
    activity.setForTest({ on: true });
    const report = await filler.run(mine());
    await activity.flush();
    activity.setForTest({ on: false });
    expect(report).toEqual({ items: 2, lists: 1, sops: 1, labels: 2, library: 1, copied: 1, recent: 0, waiting: 0, failed: 0, overLimit: 0, stopped: null });

    // The library entry once; the English texts together; the Telugu label on its own.
    const calls = fake.calls.filter((call) => call.feature === 'translate-content');
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => [...(call.facts as { strings: string[] }).strings].sort())).toEqual([
      [TEXT.picked],
      [TEXT.item, TEXT.partial, TEXT.list, TEXT.sop, ...TEXT.steps, TEXT.label].sort(),
      [TEXT.labelTe],
    ]);
    for (const call of calls) expect((call.facts as { languages: string[] }).languages).toHaveLength(11);

    // A typed item: every language, the English exactly as typed, no typed language invented.
    const item = await db().checklistItem.findUniqueOrThrow({ where: { id: made.item } });
    expect(Object.keys(item.label as Text).sort()).toEqual(ALL);
    expect(item.label).toMatchObject({ en: TEXT.item, te: `[te] ${TEXT.item}`, ur: `[ur] ${TEXT.item}` });
    expect(item.typedLanguage).toBeNull();
    // A language that was there already is never changed.
    expect(await label(made.partial)).toMatchObject({ en: TEXT.partial, te: TEXT.partialTe, hi: `[hi] ${TEXT.partial}` });
    expect(Object.keys(await label(made.partial))).toHaveLength(12);

    // The library entry keeps the translation, and the item picked from it has the same.
    const entry = (await db().checklistLibraryItem.findUniqueOrThrow({ where: { id: made.entry } })).text as Text;
    expect(Object.keys(entry).sort()).toEqual(ALL);
    expect(entry.en).toBe(TEXT.picked);
    expect(await label(made.picked)).toEqual(entry);
    expect((await db().checklistItem.findUniqueOrThrow({ where: { id: made.picked } })).typedLanguage).toBeNull();

    const template = await db().checklistTemplate.findUniqueOrThrow({ where: { id: made.template } });
    expect(Object.keys(template.title as Text)).toHaveLength(12);
    expect((template.title as Text).en).toBe(TEXT.list);

    // An SOP: the title and every step, one step for one step.
    const sop = await db().sopTemplate.findUniqueOrThrow({ where: { id: made.sop } });
    expect(Object.keys(sop.title as Text)).toHaveLength(12);
    expect(Object.keys(sop.body as Text)).toHaveLength(12);
    expect((sop.body as Text).en).toBe(TEXT.steps.join('\n'));
    expect((sop.body as Text).te).toBe(TEXT.steps.map((step) => `[te] ${step}`).join('\n'));

    // Label names: the one typed in Telugu keeps its Telugu exactly, and gets English.
    const typedEn = await db().foodItem.findUniqueOrThrow({ where: { id: made.label } });
    expect(Object.keys(typedEn.name as Text)).toHaveLength(12);
    const typedTe = await db().foodItem.findUniqueOrThrow({ where: { id: made.labelTe } });
    expect(typedTe.name).toMatchObject({ te: TEXT.labelTe, en: `[en] ${TEXT.labelTe}` });
    expect(Object.keys(typedTe.name as Text)).toHaveLength(12);
    expect(typedTe.typedLanguage).toBeNull();

    // ECCS's own text and the unpicked suggestion are untouched.
    expect((await db().checklistLibraryItem.findUniqueOrThrow({ where: { id: made.unpicked } })).text).toEqual({ en: 'E2E Fill a suggestion nobody picked.' });
    expect(await label(made.eccsItem)).toEqual({ en: 'E2E FILL ECCS basic item' });
    expect((await db().sopTemplate.findUniqueOrThrow({ where: { id: made.eccsSop } })).title).toEqual({ en: 'E2E FILL ECCS SOP' });

    // The calls count against the outlet, made by the server rather than a person.
    const requests = await db().aiRequest.findMany({ where: { id: { in: ai.recordedForTest() }, feature: 'translate-content', outletId } });
    expect(requests.map((row) => [row.status, row.userId])).toEqual([
      ['OK', null],
      ['OK', null],
      ['OK', null],
    ]);

    // One activity log row for the run, with its counts.
    const rows = await db().activityLog.findMany({ where: { id: { in: activity.recordedForTest() }, action: 'system.translations.filled' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'SYSTEM',
      category: 'system',
      result: 'SUCCESS',
      details: { filled: 7, items: 2, lists: 1, sops: 1, labels: 2, library: 1, copied: 1, recent: 0, waiting: 0, failed: 0, overLimit: 0, stopped: null },
    });
  });

  it('finds nothing more on the next run: no call, and no log row for an empty run', async () => {
    const before = activity.recordedForTest().length;
    activity.setForTest({ on: true });
    const report = await filler.run(mine());
    await activity.flush();
    activity.setForTest({ on: false });
    expect(report).toEqual({ items: 0, lists: 0, sops: 0, labels: 0, library: 0, copied: 0, recent: 0, waiting: 0, failed: 0, overLimit: 0, stopped: null });
    expect(fake.calls).toHaveLength(0);
    expect(activity.recordedForTest()).toHaveLength(before);
  });

  it('gives a later pick of a translated suggestion all twelve languages with no call, from the library entry', async () => {
    const lists = (await http().post('/checklists/setup').set(as(owner)).send({ outletId, title: 'E2E Fill second list' }).expect(201)).body as List[];
    await translator.settled();
    fake.reset();
    const second = lists.find((list) => list.title.en === 'E2E Fill second list')!.id;
    const added = (await http().post(`/checklists/setup/${second}/items`).set(as(owner)).send({ libraryItemId: made.entry }).expect(201)).body as List[];
    await translator.settled();
    expect(fake.calls).toHaveLength(0);
    const item = added.find((list) => list.id === second)!.items.at(-1)!;
    expect(Object.keys(item.label).sort()).toEqual(ALL);
  });
});
