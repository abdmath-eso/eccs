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
type Run = { id: string; status: string; title: { en: string }; items: Item[]; [key: string]: unknown };

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
    await db.attachment.deleteMany({ where: { outletId } });
    await db.checklistItem.deleteMany({ where: { outletId } });
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
    expect(runs.map((run) => run.title.en)).toEqual(['Opening checklist', 'Closing checklist']);
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

  it('does not let one photo stand as proof for two items', async () => {
    const [opening] = await today(chef);
    const first = opening!.items[0]!.response as { photoPath: string };
    const usedPhotoId = first.photoPath.split('/')[2]!;
    await answer(chef, opening!.id, opening!.items[1]!.id, { passed: true, attachmentId: usedPhotoId }).expect(400);
  });

  it('refuses to submit until every item has a photo, then locks the checklist', async () => {
    const [opening] = await today(chef);
    const refused = await http().post(`/checklists/runs/${opening!.id}/submit`).set(bearer(chef)).expect(400);
    expect(refused.body.message).toBe('4 items still need a photo');

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
      expect.objectContaining({ title: { en: 'Opening checklist', te: expect.any(String), hi: expect.any(String) }, status: 'SUBMITTED', itemCount: 5, doneCount: 5, problemCount: 1 }),
      expect.objectContaining({ status: 'PENDING', doneCount: 0, problemCount: 0 }),
    ]);
    // Earlier days, when nobody opened the app, are recorded as missed (the seed is at most a few days old).
    expect(rows.filter((row) => row.date !== indiaDate()).every((row) => row.status === 'MISSED')).toBe(true);
  });
});
