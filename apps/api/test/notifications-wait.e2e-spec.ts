// "Anything new?" (GET /notifications/wait): the request the console holds open
// so a new notification shows on the PC within a second or two.
// Runs against the local database with the sample seed loaded. Everything is
// done to two throwaway Head Chef logins created here and deleted afterwards
// (their notifications go with them), so the sample people's lists are untouched.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { NotificationsService } from './../src/notifications/notifications.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const JUBILEE_CODE = 'SPICE-JH2K7M';
const OWNER_PIN = '2580';
const DEVICE = 'e2e-notifications-wait';
const TEMP_NAMES = ['E2E News Chef', 'E2E News Other Chef'];

type News = { items: { id: string; title: string; readAt: string | null }[]; latestId: string | null; unreadCount: number };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Notifications: anything new? (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  /** The person asking, and someone else at the same outlet. */
  let chef: string;
  let chefId: string;
  let otherId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Asks, and says how long the answer took. */
  async function ask(latest?: string | null): Promise<{ news: News; tookMs: number }> {
    const from = Date.now();
    const response = await http()
      .get('/notifications/wait')
      .query(latest ? { latest } : {})
      .set(bearer(chef))
      .expect(200);
    return { news: response.body as News, tookMs: Date.now() - from };
  }

  const tell = (userId: string, reference: string) =>
    notifications.send([userId], 'ISSUE_RESOLVED', { outlet: 'Test outlet', reference }, { kind: 'issue', issueId: reference });

  async function cleanUp() {
    const db = prisma.client;
    await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { user: { name: { in: TEMP_NAMES } } }] } });
    // Their notifications are deleted with them.
    await db.user.deleteMany({ where: { name: { in: TEMP_NAMES } } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
  }

  async function pinLogin(pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code: JUBILEE_CODE, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return session.body.token as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    await cleanUp();

    const owner = await pinLogin(OWNER_PIN);
    const outlet = await prisma.client.outlet.findUniqueOrThrow({ where: { code: JUBILEE_CODE } });
    const add = async (name: string) =>
      (await http().post('/restaurant-users').set(bearer(owner)).send({ name, role: 'HEAD_CHEF', outletId: outlet.id, language: 'EN' }).expect(201))
        .body as { id: string; pin: string };
    const first = await add(TEMP_NAMES[0]!);
    await add(TEMP_NAMES[1]!);
    chef = await pinLogin(first.pin);
    chefId = (await http().get('/auth/me').set(bearer(chef)).expect(200)).body.id;
    otherId = (await prisma.client.user.findFirstOrThrow({ where: { name: TEMP_NAMES[1]! } })).id;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('needs a login', async () => {
    await http().get('/notifications/wait').expect(401);
  });

  it('holds the answer while there is nothing new, then says so', async () => {
    notifications.maxWaitMs = 400;
    const { news, tookMs } = await ask();
    expect(news).toEqual({ items: [], latestId: null, unreadCount: 0 });
    expect(tookMs).toBeGreaterThanOrEqual(350);
  });

  it('is not answered early by a notification for someone else', async () => {
    notifications.maxWaitMs = 600;
    const asked = ask();
    await pause(150);
    await tell(otherId, 'ECCS-9100');
    const { news, tookMs } = await asked;
    expect(news.items).toHaveLength(0);
    expect(tookMs).toBeGreaterThanOrEqual(550);
  });

  it('answers as soon as a notification arrives for the person', async () => {
    notifications.maxWaitMs = 10_000;
    const asked = ask();
    await pause(150);
    await tell(chefId, 'ECCS-9101');
    const { news, tookMs } = await asked;
    expect(tookMs).toBeLessThan(5_000);
    expect(news.items).toHaveLength(1);
    expect(news.items[0]).toMatchObject({ title: 'Issue resolved', readAt: null });
    expect(news.latestId).toBe(news.items[0]!.id);
    expect(news.unreadCount).toBe(1);
  });

  it('answers at once when the asker is behind', async () => {
    notifications.maxWaitMs = 10_000;
    const known = (await ask('not-the-newest')).news.latestId!;
    await pause(10);
    await tell(chefId, 'ECCS-9102');
    // Written while nobody was asking: the next question is answered straight away, newest first.
    const { news, tookMs } = await ask(known);
    expect(tookMs).toBeLessThan(5_000);
    expect(news.items).toHaveLength(2);
    expect(news.latestId).not.toBe(known);
    expect(news.items[1]!.id).toBe(known);
  });

  it('answers when one is marked read, so the unread number follows in other windows', async () => {
    notifications.maxWaitMs = 10_000;
    const latest = (await ask('not-the-newest')).news.latestId!;
    const asked = ask(latest);
    await pause(150);
    await http().post(`/notifications/${latest}/read`).set(bearer(chef)).expect(200);
    const { news, tookMs } = await asked;
    expect(tookMs).toBeLessThan(5_000);
    expect(news.latestId).toBe(latest);
    expect(news.unreadCount).toBe(1);
  });

  it('leaves nobody waiting once answered', async () => {
    notifications.maxWaitMs = 200;
    await ask((await ask('not-the-newest')).news.latestId);
    // The list of people waiting is private; an empty one means every held request was tidied away.
    expect((notifications as unknown as { waiting: Map<string, unknown> }).waiting.size).toBe(0);
  });
});
