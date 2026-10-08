// Runs against the local database with the sample seed loaded and local
// object storage running (pnpm services:up). Uses the Deccan Biryani outlet
// and removes what it creates, so the other sample restaurant stays clean.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const DEVICE = 'e2e-checklists';

// Enough of a JPEG for the server to recognise it as one.
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e sample photo bytes')]);

type Item = { id: string; isCustom: boolean; label: Record<string, string>; response: null | Record<string, unknown> };
type Run = { id: string; status: string; title: Record<string, string>; items: Item[]; [key: string]: unknown };
type List = { id: string; title: Record<string, string>; dueTime: string | null; isCustom: boolean; items: unknown[] };

/** A checklist's name, whichever language it was typed in. */
const nameOf = (thing: { title: Record<string, string> }) => thing.title.en ?? Object.values(thing.title)[0];

describe('Daily checklists (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let otherOutletId: string;
  let chef: string;
  let owner: string;
  let otherManager: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanUp() {
    const db = prisma.client;
    await db.checklistRun.deleteMany({ where: { outletId } });
    // Only the checklist photos: files that belong to a visit, an issue, an inspection or a filed
  // document (an invoice or report PDF, say) are not this test's to remove.
  await db.attachment.deleteMany({
    where: { outletId, jobId: null, issueId: null, inspectionFindingId: null, documents: { none: {} }, signOffs: { none: {} }, publicPhotos: { none: {} } },
  });
    await db.checklistItem.deleteMany({ where: { outletId } });
    await db.outletChecklist.deleteMany({ where: { template: { outletId } } });
    await db.checklistTemplate.deleteMany({ where: { outletId } });
    await db.user.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
  }

  async function login(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return session.body.token as string;
  }

  async function uploadPhoto(token: string, forOutlet = outletId): Promise<{ id: string; path: string }> {
    const response = await http()
      .post('/attachments')
      .set(bearer(token))
      .field('outletId', forOutlet)
      .attach('file', PHOTO, { filename: 'proof.jpg', contentType: 'image/jpeg' })
      .expect(201);
    return response.body;
  }

  const today = async (token: string): Promise<Run[]> =>
    (await http().get('/checklists/today').query({ outletId }).set(bearer(token)).expect(200)).body;

  const answer = (token: string, runId: string, itemId: string, body: Record<string, unknown>) =>
    http().put(`/checklists/runs/${runId}/items/${itemId}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const outlets = await prisma.client.outlet.findMany({ where: { code: { in: Object.values(CODES) } } });
    outletId = outlets.find((o) => o.code === CODES.kukatpally)!.id;
    otherOutletId = outlets.find((o) => o.code === CODES.jubilee)!.id;
    await cleanUp();

    chef = await login(CODES.kukatpally, PINS.chef);
    owner = await login(CODES.kukatpally, PINS.owner);
    otherManager = await login(CODES.jubilee, PINS.otherManager);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it("gives the head chef today's basic opening and closing checklists", async () => {
    const runs = await today(chef);
    expect(runs.map(nameOf)).toEqual(['Opening checklist', 'Closing checklist']);
    for (const run of runs) {
      expect(run).toMatchObject({ status: 'PENDING', date: indiaDate(), submittedAt: null });
      expect(run.items).toHaveLength(5);
      expect(run.items.every((item) => !item.isCustom && item.response === null)).toBe(true);
    }
    // Looking again does not create second copies.
    expect((await today(chef)).map((run) => run.id)).toEqual(runs.map((run) => run.id));
  });

  it("keeps another restaurant's staff out", async () => {
    await http().get('/checklists/today').query({ outletId }).set(bearer(otherManager)).expect(403);
    const [opening] = await today(chef);
    await http().get(`/checklists/runs/${opening!.id}`).set(bearer(otherManager)).expect(404);
    await http().get('/checklists/today').set(bearer(chef)).expect(400);
  });

  it('only accepts real photos, for your own outlet', async () => {
    await http()
      .post('/attachments')
      .set(bearer(chef))
      .field('outletId', outletId)
      .attach('file', Buffer.from('not an image'), { filename: 'proof.jpg', contentType: 'image/jpeg' })
      .expect(400);
    await http().post('/attachments').set(bearer(chef)).field('outletId', outletId).expect(400);
    await http()
      .post('/attachments')
      .set(bearer(chef))
      .field('outletId', otherOutletId)
      .attach('file', PHOTO, { filename: 'proof.jpg', contentType: 'image/jpeg' })
      .expect(403);
  });

  it('will not record an answer without a photo', async () => {
    const [opening] = await today(chef);
    const item = opening!.items[0]!;
    await answer(chef, opening!.id, item.id, { passed: true }).expect(400);
    await answer(chef, opening!.id, item.id, { passed: true, attachmentId: 'made-up' }).expect(400);

    const elsewhere = await uploadPhoto(otherManager, otherOutletId);
    await answer(chef, opening!.id, item.id, { passed: true, attachmentId: elsewhere.id }).expect(400);
    await prisma.client.attachment.delete({ where: { id: elsewhere.id } });
  });

  it('records an answer with its photo, and serves the photo through a signed link', async () => {
    const [opening] = await today(chef);
    const item = opening!.items[0]!;
    const photo = await uploadPhoto(chef);

    const updated = await answer(chef, opening!.id, item.id, { passed: true, attachmentId: photo.id }).expect(200);
    expect(updated.body.status).toBe('IN_PROGRESS');
    const response = (updated.body as Run).items[0]!.response as {
      passed: boolean;
      photoPath: string;
      takenByName: string;
      capturedAt: string;
    };
    expect(response.passed).toBe(true);
    expect(response.takenByName).toBe('Sample Head Chef (Kukatpally)');
    expect(Math.abs(Date.now() - new Date(response.capturedAt).getTime())).toBeLessThan(60_000);

    const image = await http().get(response.photoPath).expect(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(image.body as Buffer, PHOTO)).toBe(0);

    await http().get(response.photoPath.replace(/sig=.{4}/, 'sig=0000')).expect(403);
    await http().get(response.photoPath.replace(/exp=\d+/, 'exp=1')).expect(403);
  });

  it('needs a reason when a problem is reported', async () => {
    const [opening] = await today(chef);
    const item = opening!.items[0]!;
    const attachmentId = (item.response as { photoPath: string }).photoPath.split('/')[2]!;
    const refused = await answer(chef, opening!.id, item.id, { passed: false, attachmentId }).expect(400);
    expect(refused.body.message).toBe('Describe the problem');
    await answer(chef, opening!.id, item.id, { passed: false, note: '   ', attachmentId }).expect(400);
    // Still recorded as fine.
    expect((await today(chef))[0]!.items[0]!.response).toMatchObject({ passed: true });
  });

  it('does not let one photo stand as proof for two items', async () => {
    const [opening] = await today(chef);
    const first = opening!.items[0]!.response as { photoPath: string };
    const usedPhotoId = first.photoPath.split('/')[2]!;
    await answer(chef, opening!.id, opening!.items[1]!.id, { passed: true, attachmentId: usedPhotoId }).expect(400);
  });

  it('refuses to submit until every item has a photo, then locks the checklist', async () => {
    const [opening] = await today(chef);
    const refused = await http().post(`/checklists/runs/${opening!.id}/submit`).set(bearer(chef)).expect(400);
    expect(refused.body.message).toBe('4 items are not done yet');

    for (const item of opening!.items.slice(1)) {
      const photo = await uploadPhoto(chef);
      const problem = item === opening!.items[4];
      await answer(chef, opening!.id, item.id, {
        passed: !problem,
        note: problem ? 'Saw droppings near the store room' : undefined,
        attachmentId: photo.id,
      }).expect(200);
    }

    const submitted = await http().post(`/checklists/runs/${opening!.id}/submit`).set(bearer(chef)).expect(200);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', submittedByName: 'Sample Head Chef (Kukatpally)' });

    const photo = await uploadPhoto(chef);
    await answer(chef, opening!.id, opening!.items[0]!.id, { passed: true, attachmentId: photo.id }).expect(409);
    await http().post(`/checklists/runs/${opening!.id}/submit`).set(bearer(chef)).expect(409);
  });

  it('lets the owner review a submitted checklist, but not the head chef', async () => {
    const [opening, closing] = await today(owner);
    await http().post(`/checklists/runs/${opening!.id}/review`).set(bearer(chef)).expect(403);
    await http().post(`/checklists/runs/${closing!.id}/review`).set(bearer(owner)).expect(409);

    const reviewed = await http().post(`/checklists/runs/${opening!.id}/review`).set(bearer(owner)).expect(200);
    expect(reviewed.body.reviewedByName).toBe('Sample Owner (Deccan Biryani)');
    expect(reviewed.body.reviewedAt).toEqual(expect.any(String));
  });

  it("lets the owner add the restaurant's own items, which then need a photo like the rest", async () => {
    const setup = await http().get('/checklists/setup').query({ outletId }).set(bearer(owner)).expect(200);
    const closingList = (setup.body as { id: string; title: { en: string } }[]).find(
      (list) => list.title.en === 'Closing checklist',
    )!;

    await http().post(`/checklists/setup/${closingList.id}/items`).set(bearer(chef)).send({ label: 'E2E nope' }).expect(403);
    await http().post(`/checklists/setup/${closingList.id}/items`).set(bearer(otherManager)).send({ label: 'E2E nope' }).expect(403);
    await http().post(`/checklists/setup/${closingList.id}/items`).set(bearer(owner)).send({ label: 'x' }).expect(400);

    const added = await http()
      .post(`/checklists/setup/${closingList.id}/items`)
      .set(bearer(owner))
      .send({ label: 'E2E Tandoor ash emptied' })
      .expect(201);
    const lists = added.body as { id: string; items: { id: string; isCustom: boolean; label: Record<string, string> }[] }[];
    const custom = lists.find((list) => list.id === closingList.id)!.items.filter((item) => item.isCustom);
    // The sample owner's language is Telugu, so the text is stored under that language.
    expect(custom).toEqual([expect.objectContaining({ label: { te: 'E2E Tandoor ash emptied' } })]);

    const [, closing] = await today(chef);
    expect(closing!.items).toHaveLength(6);
    expect(closing!.items[5]).toMatchObject({ isCustom: true, response: null });

    // The other restaurant's lists are untouched.
    const elsewhere = await http().get('/checklists/setup').query({ outletId: otherOutletId }).set(bearer(otherManager)).expect(200);
    expect((elsewhere.body as { items: unknown[] }[]).every((list) => list.items.length === 5)).toBe(true);
  });

  it("lets the owner remove their own items but not ECCS's basic ones", async () => {
    const [, closing] = await today(owner);
    const basic = closing!.items[0]!;
    const custom = closing!.items.find((item) => item.isCustom)!;

    await http().delete(`/checklists/setup/items/${basic.id}`).set(bearer(owner)).expect(404);
    await http().delete(`/checklists/setup/items/${custom.id}`).set(bearer(chef)).expect(403);
    await http().delete(`/checklists/setup/items/${custom.id}`).set(bearer(owner)).expect(200);

    expect((await today(chef))[1]!.items).toHaveLength(5);
  });

  it('shows recent history with what was done and what had a problem', async () => {
    const history = await http().get('/checklists/history').query({ outletId, days: 3 }).set(bearer(owner)).expect(200);
    const rows = history.body as { title: { en: string }; date: string; status: string; [key: string]: unknown }[];

    const todays = rows.filter((row) => row.date === indiaDate());
    expect(todays).toEqual([
      // The name comes in every language the app has; three are enough to check here.
      expect.objectContaining({
        title: expect.objectContaining({ en: 'Opening checklist', te: expect.any(String), hi: expect.any(String) }),
        status: 'SUBMITTED',
        itemCount: 5,
        doneCount: 5,
        problemCount: 1,
      }),
      expect.objectContaining({ status: 'PENDING', doneCount: 0, problemCount: 0 }),
    ]);
    // Earlier days, when nobody opened the app, are recorded as missed (the seed is at most a few days old).
    expect(rows.filter((row) => row.date !== indiaDate()).every((row) => row.status === 'MISSED')).toBe(true);
  });

  it('shares one checklist between head chefs: once one submits, the other cannot change it', async () => {
    const created = await http()
      .post('/restaurant-users')
      .set(bearer(owner))
      .send({ name: 'E2E Second Chef', role: 'HEAD_CHEF', outletId })
      .expect(201);
    const secondChef = await login(CODES.kukatpally, created.body.pin as string);

    // The second chef sees the same checklist, already submitted by the first.
    const [opening, closing] = await today(secondChef);
    expect(opening).toMatchObject({ status: 'SUBMITTED', submittedByName: 'Sample Head Chef (Kukatpally)' });

    const photo = await uploadPhoto(secondChef);
    await answer(secondChef, opening!.id, opening!.items[0]!.id, { passed: false, note: 'E2E too late', attachmentId: photo.id }).expect(409);
    await http().post(`/checklists/runs/${opening!.id}/submit`).set(bearer(secondChef)).expect(409);

    // A checklist that is still open is filled in together: each photo carries its own taker's name.
    const shared = await answer(secondChef, closing!.id, closing!.items[0]!.id, { passed: true, attachmentId: photo.id }).expect(200);
    expect((shared.body as Run).items[0]!.response).toMatchObject({ takenByName: 'E2E Second Chef' });
    expect((await today(chef))[1]!.items[0]!.response).toMatchObject({ takenByName: 'E2E Second Chef' });
  });

  describe('suggestions from the checklist library', () => {
    type Suggestion = { id: string; text: { en: string }; checklistName: string; category: string };
    let closingListId: string;
    const suggest = async (token: string, search: string, listId = closingListId): Promise<Suggestion[]> =>
      (await http().get(`/checklists/setup/${listId}/suggestions`).query({ q: search }).set(bearer(token)).expect(200)).body;

    beforeAll(async () => {
      const lists = (await http().get('/checklists/setup').query({ outletId }).set(bearer(owner)).expect(200)).body as List[];
      closingListId = lists.find((list) => nameOf(list) === 'Closing checklist')!.id;
    });

    it('has the whole master sheet and the ECCS additions loaded', async () => {
      const counts = await prisma.client.checklistLibraryItem.groupBy({ by: ['source'], where: { isActive: true }, _count: true });
      const bySource = Object.fromEntries(counts.map((row) => [row.source, row._count]));
      expect(bySource.sheet).toBe(588);
      expect(bySource.eccs).toBeGreaterThanOrEqual(45);
    });

    it('finds checks by a word in the check itself', async () => {
      const results = await suggest(owner, 'fridge');
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(8);
      expect(results[0]!.text.en.toLowerCase()).toContain('fridge');
      expect(results[0]).toMatchObject({ checklistName: expect.any(String), category: expect.any(String) });
    });

    it('finds checks by keyword and category even when the word is not in the check', async () => {
      // "fifo" is a keyword for the Storage & Inventory category in the sheet.
      expect((await suggest(owner, 'fifo')).some((s) => s.category === 'Storage & Inventory')).toBe(true);
      // "tandoor" and "lpg" only exist in the ECCS additions.
      expect((await suggest(owner, 'tandoor')).every((s) => s.category === 'Indian Kitchen')).toBe(true);
      expect((await suggest(owner, 'lpg cylinder'))[0]!.text.en).toContain('LPG cylinders');
    });

    it('understands everyday words for the same thing', async () => {
      const texts = async (search: string) => (await suggest(owner, search)).map((s) => s.text.en.toLowerCase());
      // The sheet says "refrigerator"; kitchens say "fridge".
      expect((await texts('fridge temperature')).some((text) => text.includes('refrigerator temperature'))).toBe(true);
      expect((await texts('chimney')).some((text) => text.includes('hood'))).toBe(true);
      expect((await texts('toilet')).some((text) => text.includes('washroom'))).toBe(true);
      expect((await texts('dustbin')).some((text) => text.includes('bins') || text.includes('waste'))).toBe(true);
    });

    it('narrows as more words are typed, and returns nothing for nonsense or very short input', async () => {
      const broad = await suggest(owner, 'gas');
      const narrow = await suggest(owner, 'gas hose');
      expect(narrow.length).toBeGreaterThan(0);
      expect(narrow.length).toBeLessThanOrEqual(broad.length);
      expect(narrow[0]!.text.en.toLowerCase()).toContain('hose');

      expect(await suggest(owner, 'zzqqxx')).toEqual([]);
      expect(await suggest(owner, 'a')).toEqual([]);
      expect(await suggest(owner, '')).toEqual([]);
    });

    it('is only for people who can edit that checklist', async () => {
      await http().get(`/checklists/setup/${closingListId}/suggestions`).query({ q: 'gas' }).set(bearer(chef)).expect(403);
      await http().get(`/checklists/setup/${closingListId}/suggestions`).query({ q: 'gas' }).set(bearer(otherManager)).expect(403);
    });

    it('adds a chosen suggestion to the checklist and then stops suggesting it', async () => {
      const [choice] = await suggest(owner, 'gas valve closing');
      expect(choice!.text.en).toContain('Main gas valve');

      const lists = (
        await http().post(`/checklists/setup/${closingListId}/items`).set(bearer(owner)).send({ libraryItemId: choice!.id }).expect(201)
      ).body as List[];
      const closing = lists.find((list) => list.id === closingListId)! as List & { items: { label: { en: string }; isCustom: boolean }[] };
      expect(closing.items.at(-1)).toMatchObject({ label: { en: choice!.text.en }, isCustom: true });

      // Staff now see it on today's checklist, needing a photo like the rest.
      const todays = (await today(chef)).find((run) => nameOf(run) === 'Closing checklist')!;
      expect(todays.items.at(-1)).toMatchObject({ label: { en: choice!.text.en }, response: null });

      expect((await suggest(owner, 'gas valve closing')).map((s) => s.id)).not.toContain(choice!.id);
    });

    it('still lets the person type their own check, and rejects an empty or double request', async () => {
      const post = (body: Record<string, unknown>) =>
        http().post(`/checklists/setup/${closingListId}/items`).set(bearer(owner)).send(body);
      await post({ label: 'E2E Handi lids washed' }).expect(201);
      await post({}).expect(400);
      await post({ label: 'E2E both', libraryItemId: 'something' }).expect(400);
      await post({ libraryItemId: 'not-a-real-id' }).expect(404);
    });
  });

  describe('tick-only items, for checks where a photo is not practical', () => {
    type SetupItem = { id: string; label: Record<string, string>; isCustom: boolean; photoRequired: boolean };
    type SetupList = { id: string; title: Record<string, string>; items: SetupItem[] };
    let closingListId: string;
    let tickItemId: string;
    const closingRun = async (token: string) => (await today(token)).find((run) => nameOf(run) === 'Closing checklist')!;
    const post = (token: string, body: Record<string, unknown>) =>
      http().post(`/checklists/setup/${closingListId}/items`).set(bearer(token)).send(body);

    beforeAll(async () => {
      const lists = (await http().get('/checklists/setup').query({ outletId }).set(bearer(owner)).expect(200)).body as SetupList[];
      closingListId = lists.find((list) => nameOf(list) === 'Closing checklist')!.id;
    });

    it('lets the owner add an item as tick only; photo stays the default', async () => {
      const withPhoto = (await post(owner, { label: 'E2E Photo by default' }).expect(201)).body as SetupList[];
      expect(withPhoto.find((l) => l.id === closingListId)!.items.at(-1)).toMatchObject({ photoRequired: true });

      const tickOnly = (await post(owner, { label: 'E2E Cash drawer counted', photoRequired: false }).expect(201)).body as SetupList[];
      const item = tickOnly.find((l) => l.id === closingListId)!.items.at(-1)!;
      expect(item).toMatchObject({ photoRequired: false, isCustom: true });
      tickItemId = item.id;

      // ECCS's basic items always need a photo.
      expect(tickOnly.find((l) => l.id === closingListId)!.items.filter((i) => !i.isCustom).every((i) => i.photoRequired)).toBe(true);
    });

    it('lets staff tick a tick-only item without a photo, recording who and when', async () => {
      const run = await closingRun(chef);
      const item = run.items.find((i) => i.id === tickItemId)!;
      expect(item).toMatchObject({ photoRequired: false, response: null });

      const ticked = await answer(chef, run.id, tickItemId, { passed: true }).expect(200);
      const response = (ticked.body as Run).items.find((i) => i.id === tickItemId)!.response;
      expect(response).toMatchObject({ passed: true, photoPath: null, takenByName: 'Sample Head Chef (Kukatpally)' });

      // A photo item still cannot be answered without one.
      const photoItem = run.items.find((i) => (i as unknown as { photoRequired: boolean }).photoRequired && !i.response)!;
      await answer(chef, run.id, photoItem.id, { passed: true }).expect(400);
    });

    it('lets staff undo a tick made by mistake, and report a problem with a reason', async () => {
      const run = await closingRun(chef);
      const cleared = await http().delete(`/checklists/runs/${run.id}/items/${tickItemId}`).set(bearer(chef)).expect(200);
      expect((cleared.body as Run).items.find((i) => i.id === tickItemId)!.response).toBeNull();

      await answer(chef, run.id, tickItemId, { passed: false }).expect(400);
      const problem = await answer(chef, run.id, tickItemId, { passed: false, note: 'E2E drawer short by 200' }).expect(200);
      expect((problem.body as Run).items.find((i) => i.id === tickItemId)!.response).toMatchObject({
        passed: false,
        note: 'E2E drawer short by 200',
        photoPath: null,
      });
    });

    it('lets the owner switch their own items between photo and tick only, but not basic items', async () => {
      const patchItem = (token: string, itemId: string, photoRequired: boolean) =>
        http().patch(`/checklists/setup/items/${itemId}`).set(bearer(token)).send({ photoRequired });

      await patchItem(chef, tickItemId, true).expect(403);
      await patchItem(otherManager, tickItemId, true).expect(403);

      const lists = (await patchItem(owner, tickItemId, true).expect(200)).body as SetupList[];
      expect(lists.find((l) => l.id === closingListId)!.items.find((i) => i.id === tickItemId)!.photoRequired).toBe(true);
      await patchItem(owner, tickItemId, false).expect(200);

      const basic = lists.find((l) => l.id === closingListId)!.items.find((i) => !i.isCustom)!;
      await patchItem(owner, basic.id, false).expect(404);
    });

    it('counts a tick-only item as done when submitting, and a photo item only with its photo', async () => {
      const run = await closingRun(chef);
      const waiting = run.items.filter((i) => !i.response).length;
      const refused = await http().post(`/checklists/runs/${run.id}/submit`).set(bearer(chef)).expect(400);
      // The tick-only item is answered, so it is not among the ones still waiting.
      expect(refused.body.message).toBe(`${waiting} items are not done yet`);
      expect(run.items.find((i) => i.id === tickItemId)!.response).not.toBeNull();
    });
  });

  describe("the restaurant's own checklists", () => {
    const setup = async (token: string): Promise<List[]> =>
      (await http().get('/checklists/setup').query({ outletId }).set(bearer(token)).expect(200)).body;
    let midDay: List;

    it('lets the owner create an extra checklist with a name and due time', async () => {
      const body = { outletId, title: 'E2E Mid-day checklist', dueTime: '14:30' };
      await http().post('/checklists/setup').set(bearer(chef)).send(body).expect(403);
      await http().post('/checklists/setup').set(bearer(otherManager)).send(body).expect(403);
      await http().post('/checklists/setup').set(bearer(owner)).send({ ...body, dueTime: '25:00' }).expect(400);
      await http().post('/checklists/setup').set(bearer(owner)).send({ ...body, title: '' }).expect(400);

      const lists = (await http().post('/checklists/setup').set(bearer(owner)).send(body).expect(201)).body as List[];
      // Listed in the order they fall due.
      expect(lists.map(nameOf)).toEqual(['Opening checklist', 'E2E Mid-day checklist', 'Closing checklist']);
      midDay = lists[1]!;
      expect(midDay).toMatchObject({ isCustom: true, dueTime: '14:30', items: [] });
    });

    it('does not hand out a checklist until it has items', async () => {
      expect(await today(chef)).toHaveLength(2);

      await http()
        .post(`/checklists/setup/${midDay.id}/items`)
        .set(bearer(owner))
        .send({ label: 'E2E Buffet counter wiped' })
        .expect(201);

      const runs = await today(chef);
      expect(runs.map(nameOf)).toEqual(['Opening checklist', 'E2E Mid-day checklist', 'Closing checklist']);
      expect(runs[1]).toMatchObject({ status: 'PENDING', dueTime: '14:30' });
      expect(runs[1]!.items).toEqual([expect.objectContaining({ isCustom: true, response: null })]);
    });

    it('flags a checklist as overdue once its due time has passed, unless it was submitted', async () => {
      const setDue = (dueTime: string | null) =>
        http().patch(`/checklists/setup/${midDay.id}`).set(bearer(owner)).send({ dueTime }).expect(200);
      const midDayRun = async () => (await today(chef)).find((run) => nameOf(run) === 'E2E Mid-day checklist')!;

      await setDue('00:00');
      expect((await midDayRun()).isOverdue).toBe(true);
      await setDue('23:59');
      expect((await midDayRun()).isOverdue).toBe(false);
      await setDue(null);
      expect(await midDayRun()).toMatchObject({ isOverdue: false, dueTime: null });

      // The opening checklist was submitted earlier, so it is never overdue whatever the time.
      const opening = (await setup(owner)).find((list) => nameOf(list) === 'Opening checklist')!;
      await http().patch(`/checklists/setup/${opening.id}`).set(bearer(owner)).send({ dueTime: '00:00' }).expect(200);
      expect((await today(chef)).find((run) => nameOf(run) === 'Opening checklist')!.isOverdue).toBe(false);
      await http().patch(`/checklists/setup/${opening.id}`).set(bearer(owner)).send({ dueTime: '10:30' }).expect(200);
    });

    it("lets the restaurant rename and remove its own checklists, but not ECCS's basic ones", async () => {
      const closing = (await setup(owner)).find((list) => nameOf(list) === 'Closing checklist')!;
      expect(closing.isCustom).toBe(false);
      await http().patch(`/checklists/setup/${closing.id}`).set(bearer(owner)).send({ title: 'E2E Renamed' }).expect(403);
      await http().delete(`/checklists/setup/${closing.id}`).set(bearer(owner)).expect(403);

      await http().patch(`/checklists/setup/${midDay.id}`).set(bearer(otherManager)).send({ dueTime: '09:00' }).expect(403);
      await http().delete(`/checklists/setup/${midDay.id}`).set(bearer(chef)).expect(403);

      const renamed = await http()
        .patch(`/checklists/setup/${midDay.id}`)
        .set(bearer(owner))
        .send({ title: 'E2E Lunch checklist', dueTime: '15:00' })
        .expect(200);
      expect((renamed.body as List[]).map(nameOf)).toContain('E2E Lunch checklist');

      const afterRemoval = await http().delete(`/checklists/setup/${midDay.id}`).set(bearer(owner)).expect(200);
      expect((afterRemoval.body as List[]).map(nameOf)).toEqual(['Opening checklist', 'Closing checklist']);
      expect(await today(chef)).toHaveLength(2);
      await http().delete(`/checklists/setup/${midDay.id}`).set(bearer(owner)).expect(404);
    });
  });
});
