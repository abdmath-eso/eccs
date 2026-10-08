// Push notifications: registering a phone, and what is sent to Expo's push
// service. Expo itself is never contacted: `fetch` is replaced by a stand-in
// that records what would have been sent and answers as Expo does.
// Runs against the local database with the sample seed loaded. It reads the
// Spice Route sample logins but sends nothing to them: every notification goes
// to throwaway Head Chef logins created here and deleted afterwards.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { NotificationsService } from './../src/notifications/notifications.service.js';
import { PUSH_BATCH_SIZE, PushService } from './../src/notifications/push.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const JUBILEE_CODE = 'SPICE-JH2K7M';
const OWNER_PIN = '2580';
const ADMIN_PHONE = '+919000000001';
const DEVICE = 'e2e-push';
const TEMP_NAME = 'E2E Push Chef';
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

const token = (name: string) => `ExponentPushToken[e2e-push-${name}]`;

type Message = {
  to: string;
  title: string;
  body: string;
  channelId: string;
  sound: string;
  priority: string;
  data: { userId: string; notificationId?: string; type?: string; link?: unknown; test?: boolean };
};

describe('Push notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let push: PushService;
  let outletName: string;

  let owner: string;
  let admin: string;
  // Three throwaway Head Chefs: one reads Hindi, one English, one Telugu.
  let hindi: { session: string; id: string };
  let english: { session: string; id: string };
  let telugu: { session: string; id: string };

  /** Every batch of messages the stand-in for Expo was handed. */
  let sent: Message[][];
  /** Every set of receipt ids it was asked about. */
  let receiptsAsked: string[][];
  /** What it answers when asked for receipts. */
  let receipts: Record<string, unknown>;
  /** When true the stand-in behaves like a dead internet connection. */
  let offline: boolean;

  const http = () => request(app.getHttpServer());
  const bearer = (session: string) => ({ Authorization: `Bearer ${session}` });
  const db = () => prisma.client;
  const allSent = () => sent.flat();
  const tokensOf = async (userId: string) =>
    (await db().deviceToken.findMany({ where: { userId }, select: { token: true } })).map((row) => row.token).sort();

  async function cleanUp() {
    await db().deviceToken.deleteMany({ where: { token: { startsWith: 'ExponentPushToken[e2e-push-' } } });
    await db().notification.deleteMany({ where: { user: { name: { startsWith: TEMP_NAME } } } });
    await db().session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { user: { name: { startsWith: TEMP_NAME } } }] } });
    await db().user.deleteMany({ where: { name: { startsWith: TEMP_NAME } } });
    await db().linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db().otpChallenge.deleteMany({ where: { phone: ADMIN_PHONE } });
  }

  async function pinLogin(pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code: JUBILEE_CODE, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return session.body.token as string;
  }

  async function tempChef(language: string, outletId: string) {
    const created = await http()
      .post('/restaurant-users')
      .set(bearer(owner))
      .send({ name: `${TEMP_NAME} ${language}`, role: 'HEAD_CHEF', outletId, language })
      .expect(201);
    const session = await pinLogin(created.body.pin as string);
    const me = await http().get('/auth/me').set(bearer(session)).expect(200);
    expect(me.body.language).toBe(language);
    return { session, id: me.body.id as string };
  }

  const register = (session: string, name: string) =>
    http().post('/push/devices').set(bearer(session)).send({ token: token(name), platform: 'android' });

  /** Tells these people an issue is being worked on, and waits until the push for it has gone. */
  async function tell(userIds: string[], reference = 'ECCS-9999') {
    const written = await notifications.send(
      userIds,
      'ISSUE_IN_PROGRESS',
      { outlet: outletName, reference },
      { kind: 'issue', issueId: 'e2e-push-issue' },
    );
    await push.idle();
    return written;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    push = app.get(PushService);
    await cleanUp();

    // The stand-in for Expo's push service. It accepts every message except one
    // sent to a token with "dead" in it, which it reports as no longer registered.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (offline) throw new TypeError('fetch failed');
        const body = JSON.parse(init?.body as string) as unknown;
        if (String(url) === SEND_URL) {
          const batch = body as Message[];
          sent.push(batch);
          const data = batch.map((message) =>
            message.to.includes('dead')
              ? { status: 'error', message: 'Device not registered', details: { error: 'DeviceNotRegistered' } }
              : { status: 'ok', id: `ticket:${message.to}` },
          );
          return new Response(JSON.stringify({ data }), { status: 200 });
        }
        if (String(url) === RECEIPTS_URL) {
          receiptsAsked.push((body as { ids: string[] }).ids);
          return new Response(JSON.stringify({ data: receipts }), { status: 200 });
        }
        throw new Error(`Unexpected request to ${String(url)}`);
      }),
    );

    owner = await pinLogin(OWNER_PIN);
    const outlet = await db().outlet.findUniqueOrThrow({ where: { code: JUBILEE_CODE } });
    outletName = outlet.name;
    hindi = await tempChef('HI', outlet.id);
    english = await tempChef('EN', outlet.id);
    telugu = await tempChef('TE', outlet.id);

    await http().post('/auth/otp/request').send({ phone: ADMIN_PHONE }).expect(200);
    const session = await http()
      .post('/auth/otp/verify')
      .send({ phone: ADMIN_PHONE, code: env.DEV_FIXED_OTP, deviceName: DEVICE })
      .expect(200);
    admin = session.body.token as string;
  });

  beforeEach(() => {
    sent = [];
    receiptsAsked = [];
    receipts = {};
    offline = false;
    vi.mocked(fetch).mockClear();
    push.enabled = false;
  });

  afterAll(async () => {
    push.enabled = false;
    await push.idle();
    vi.unstubAllGlobals();
    await cleanUp();
    await app.close();
  });

  // ───────────────────────── Registering a phone ─────────────────────────

  it('needs a login, and a real push token', async () => {
    await http().post('/push/devices').send({ token: token('nobody'), platform: 'android' }).expect(401);
    await http().post('/push/devices').set(bearer(hindi.session)).send({ token: 'not-a-token', platform: 'android' }).expect(400);
    await http().post('/push/devices').set(bearer(hindi.session)).send({ token: token('a'), platform: 'windows' }).expect(400);
    await http().post('/push/devices/unregister').send({ token: token('nobody') }).expect(401);
  });

  it('is off under tests, and says so when a phone registers', async () => {
    expect(app.get(PushService).enabled).toBe(false);
    const answer = await register(hindi.session, 'shared').expect(200);
    expect(answer.body).toEqual({ serverEnabled: false });
    expect(await tokensOf(hindi.id)).toEqual([token('shared')]);
    // Registering the same phone again changes nothing.
    await register(hindi.session, 'shared').expect(200);
    expect(await db().deviceToken.count({ where: { token: token('shared') } })).toBe(1);
  });

  it('moves a shared phone to whoever registered it last', async () => {
    await register(english.session, 'shared').expect(200);
    expect(await tokensOf(hindi.id)).toEqual([]);
    expect(await tokensOf(english.id)).toEqual([token('shared')]);
    expect(await db().deviceToken.count({ where: { token: token('shared') } })).toBe(1);
  });

  it('unregisters only the person’s own phone', async () => {
    // The phone is the English reader's now: the Hindi reader cannot take it away.
    await http().post('/push/devices/unregister').set(bearer(hindi.session)).send({ token: token('shared') }).expect(200);
    expect(await tokensOf(english.id)).toEqual([token('shared')]);
    await http().post('/push/devices/unregister').set(bearer(english.session)).send({ token: token('shared') }).expect(200);
    expect(await tokensOf(english.id)).toEqual([]);
    // Unregistering a phone that is not registered is not an error (Lock is pressed without signal, then again with).
    await http().post('/push/devices/unregister').set(bearer(english.session)).send({ token: token('shared') }).expect(200);
  });

  // ───────────────────────── Sending ─────────────────────────

  it('sends nothing while it is switched off', async () => {
    await register(hindi.session, 'hindi').expect(200);
    await register(english.session, 'english').expect(200);
    expect(await tell([hindi.id, english.id])).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends each person their notification on their own phones, in their own language', async () => {
    push.enabled = true;
    await register(english.session, 'english-second').expect(200);
    // The Telugu reader has no phone registered and is only in the in-app list.
    expect(await tell([hindi.id, english.id, telugu.id], 'ECCS-0042')).toBe(3);

    expect(sent).toHaveLength(1);
    const messages = allSent();
    expect(messages.map((message) => message.to).sort()).toEqual([token('english'), token('english-second'), token('hindi')].sort());

    const forHindi = messages.find((message) => message.to === token('hindi'))!;
    expect(forHindi.title).toBe('समस्या पर काम चल रहा है');
    expect(forHindi.body).toBe('ECCS ECCS-0042 पर काम कर रहा है।');
    const forEnglish = messages.find((message) => message.to === token('english'))!;
    expect(forEnglish.title).toBe('Issue in progress');
    expect(forEnglish.body).toBe('ECCS is working on ECCS-0042.');

    // What the app needs to open the right screen and mark the notification read.
    const inList = await http().get('/notifications').set(bearer(hindi.session)).expect(200);
    const row = (inList.body.items as { id: string; type: string }[]).find((item) => item.type === 'ISSUE_IN_PROGRESS')!;
    expect(forHindi.data).toEqual({
      userId: hindi.id,
      notificationId: row.id,
      type: 'ISSUE_IN_PROGRESS',
      link: { kind: 'issue', issueId: 'e2e-push-issue' },
    });
    expect(forHindi).toMatchObject({ channelId: 'default', sound: 'default', priority: 'high' });
    expect(forEnglish.data.userId).toBe(english.id);
  });

  it('words names, dates and times in the reader’s language, and puts reminders on their own channel', async () => {
    push.enabled = true;
    await notifications.send(
      [hindi.id, english.id],
      'VISIT_TOMORROW',
      { outlet: outletName, service: { en: 'Deep clean', hi: 'डीप क्लीन' }, date: '2027-03-31', slot: 'AFTER_CLOSING' },
      { kind: 'visit', visitId: 'e2e-push-visit' },
    );
    await push.idle();
    const forHindi = allSent().find((message) => message.to === token('hindi'))!;
    expect(forHindi.title).toBe('कल विज़िट है');
    expect(forHindi.body).toBe('ECCS डीप क्लीन कल है, रेस्टोरेंट बंद होने के बाद।');
    expect(forHindi.channelId).toBe('reminders');
    expect(allSent().find((message) => message.to === token('english'))!.body).toBe('ECCS Deep clean is tomorrow, After closing.');

    sent = [];
    await notifications.send(
      [hindi.id, english.id],
      'VISIT_MOVED',
      { outlet: outletName, service: { en: 'Deep clean' }, date: '2027-03-31', slot: '1000' },
      null,
    );
    await push.idle();
    // A name with no Hindi falls back to English; the date and the time are still written the Hindi way.
    const moved = allSent().find((message) => message.to === token('hindi'))!;
    expect(moved.body).toContain('Deep clean');
    expect(moved.body).toContain('31 मार्च 2027');
    expect(moved.body).not.toMatch(/[०-९]/);
    expect(moved.data.link).toBeNull();
    expect(allSent().find((message) => message.to === token('english'))!.body).toBe(
      'Deep clean has moved to 31 Mar 2027, 10:00 am – 12:00 pm.',
    );
  });

  it('removes a phone Expo says is no longer registered, and keeps the others', async () => {
    push.enabled = true;
    await register(english.session, 'dead-phone').expect(200);
    await tell([english.id]);
    expect(allSent().map((message) => message.to)).toContain(token('dead-phone'));
    expect(await tokensOf(english.id)).toEqual([token('english'), token('english-second')].sort());
  });

  it('removes a phone when the receipt, asked for later, says it has gone', async () => {
    push.enabled = true;
    await tell([hindi.id]);
    // Too soon: Expo is not asked yet.
    expect(await push.checkReceipts(new Date())).toBe(0);
    expect(receiptsAsked).toHaveLength(0);

    receipts = {
      [`ticket:${token('hindi')}`]: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    };
    const later = new Date(Date.now() + 16 * 60_000);
    expect(await push.checkReceipts(later)).toBe(1);
    expect(receiptsAsked.flat()).toContain(`ticket:${token('hindi')}`);
    expect(await tokensOf(hindi.id)).toEqual([]);
    // Each receipt is asked for once.
    receiptsAsked = [];
    await push.checkReceipts(later);
    expect(receiptsAsked.flat()).not.toContain(`ticket:${token('hindi')}`);
  });

  it(`sends at most ${PUSH_BATCH_SIZE} messages in one request`, async () => {
    push.enabled = true;
    const extra = Array.from({ length: 120 }, (_, index) => token(`batch-${index}`));
    await db().deviceToken.createMany({ data: extra.map((value) => ({ userId: telugu.id, token: value, platform: 'android' })) });
    await tell([telugu.id]);
    expect(sent.map((batch) => batch.length)).toEqual([PUSH_BATCH_SIZE, 20]);
    expect(new Set(allSent().map((message) => message.to))).toEqual(new Set(extra));
    await db().deviceToken.deleteMany({ where: { token: { in: extra } } });
  });

  it('never fails the caller when Expo cannot be reached, and keeps the phones', async () => {
    push.enabled = true;
    offline = true;
    await expect(tell([english.id])).resolves.toBe(1);
    expect(await tokensOf(english.id)).toEqual([token('english'), token('english-second')].sort());
    expect(await push.checkReceipts(new Date(Date.now() + 16 * 60_000))).toBe(0);
  });

  it('sends nothing to someone who is no longer logged in anywhere', async () => {
    push.enabled = true;
    await register(telugu.session, 'telugu').expect(200);
    // The phone lost its signal as Lock was pressed, so it logged out without unregistering... here the
    // login simply ends while the phone is still registered.
    await db().session.updateMany({ where: { userId: telugu.id }, data: { revokedAt: new Date() } });
    expect(await tell([telugu.id, english.id])).toBe(2);
    expect(allSent().map((message) => message.to)).not.toContain(token('telugu'));
    expect(allSent().map((message) => message.to)).toContain(token('english'));
  });

  // ───────────────────────── The test push ─────────────────────────

  it('lets only an ECCS admin send a test push or see who has a phone registered', async () => {
    await http().post('/push/test').set(bearer(owner)).send({}).expect(403);
    await http().post('/push/test').set(bearer(english.session)).send({ userId: english.id }).expect(403);
    await http().get('/push/recipients').set(bearer(owner)).expect(403);
    await http().post('/push/test').send({}).expect(401);
  });

  it('lists the people with a phone registered', async () => {
    const list = await http().get('/push/recipients').set(bearer(admin)).expect(200);
    expect(list.body.serverEnabled).toBe(false);
    const people = list.body.recipients as { id: string; name: string; role: string; devices: number }[];
    expect(people.find((person) => person.id === english.id)).toEqual({
      id: english.id,
      name: `${TEMP_NAME} EN`,
      role: 'HEAD_CHEF',
      devices: 2,
    });
    // The Hindi reader's phone was removed above.
    expect(people.find((person) => person.id === hindi.id)).toBeUndefined();
  });

  it('says so, and sends nothing, when a test push is asked for while push is off', async () => {
    const result = await http().post('/push/test').set(bearer(admin)).send({ userId: english.id }).expect(200);
    expect(result.body).toEqual({ serverEnabled: false, devices: 2, accepted: 0, errors: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a test push to a chosen person, or to the admin themself, and writes nothing to their list', async () => {
    push.enabled = true;
    const before = await db().notification.count({ where: { userId: english.id } });
    const result = await http().post('/push/test').set(bearer(admin)).send({ userId: english.id }).expect(200);
    expect(result.body).toEqual({ serverEnabled: true, devices: 2, accepted: 2, errors: [] });
    expect(allSent()).toHaveLength(2);
    expect(allSent()[0]).toMatchObject({
      title: 'Test notification',
      body: 'Notifications from ECCS are working on this phone.',
      channelId: 'default',
      data: { userId: english.id, link: null, test: true },
    });
    expect(await db().notification.count({ where: { userId: english.id } })).toBe(before);

    // With nobody named it goes to the admin's own phones (the sample admin may or may not have one).
    sent = [];
    const adminId = (await http().get('/auth/me').set(bearer(admin)).expect(200)).body.id as string;
    const own = await http().post('/push/test').set(bearer(admin)).send({}).expect(200);
    expect(own.body.serverEnabled).toBe(true);
    expect(allSent()).toHaveLength(own.body.devices as number);
    for (const message of allSent()) expect(message.data.userId).toBe(adminId);

    await http().post('/push/test').set(bearer(admin)).send({ userId: 'nobody' }).expect(404);
  });

  it('reports what Expo refused in a test push', async () => {
    push.enabled = true;
    await register(english.session, 'dead-again').expect(200);
    const result = await http().post('/push/test').set(bearer(admin)).send({ userId: english.id }).expect(200);
    expect(result.body).toEqual({ serverEnabled: true, devices: 3, accepted: 2, errors: ['DeviceNotRegistered'] });
    expect(await tokensOf(english.id)).toEqual([token('english'), token('english-second')].sort());
  });
});
