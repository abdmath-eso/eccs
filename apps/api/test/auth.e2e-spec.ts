// Runs against the local database with the sample seed loaded
// (packages/db: pnpm seed) and DEV_FIXED_OTP set in the root .env.
// It cleans up after itself, so the sample logins keep working.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { pinLookup } from '@eccs/db';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const PHONES = {
  superAdmin: '+919000000001',
  supervisor: '+919000000003',
  spiceOwner: '+919100000001',
  deccanOwner: '+919100000002',
  unknown: '+919999999999',
};
const CODES = { jubilee: 'SPICE-JH2K7M', gachibowli: 'SPICE-GB4N8P', kukatpally: 'DECCA-KP6R3T' };
const PINS = {
  spiceOwner: '2580',
  jubileeManager: '4821',
  jubileeChef: '7306',
  gachibowliManager: '1593',
  deccanOwner: '3917',
};
const OTP = env.DEV_FIXED_OTP ?? '';
const DEVICE = 'e2e';

describe('Login and roles (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  // Phones linked once and shared, because linking is rate-limited per client.
  let jubileePhone: string;
  let gachibowliPhone: string;
  let kukatpallyPhone: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanUp() {
    const db = prisma.client;
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.user.deleteMany({ where: { name: { startsWith: 'E2E ' } } });

    await restoreDeccanOwnerPin();
  }

  // Puts back the seeded PIN of the owner whose PIN the reset test replaces.
  async function restoreDeccanOwnerPin() {
    const db = prisma.client;
    const deccanOwner = await db.user.findUniqueOrThrow({ where: { phone: PHONES.deccanOwner } });
    await db.user.update({
      where: { id: deccanOwner.id },
      data: { pinLookup: pinLookup(env.PIN_SECRET, deccanOwner.pinOrganizationId!, PINS.deccanOwner) },
    });
  }

  async function otpLogin(phone: string, extra: Record<string, unknown> = {}) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const response = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: OTP, deviceName: DEVICE, ...extra })
      .expect(200);
    return response.body;
  }

  async function linkPhone(code: string): Promise<string> {
    const response = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    return response.body.deviceToken as string;
  }

  async function pinLogin(deviceToken: string, pin: string): Promise<string> {
    const response = await http().post('/auth/pin/login').send({ deviceToken, pin }).expect(200);
    return response.body.token as string;
  }

  beforeAll(async () => {
    expect(OTP, 'DEV_FIXED_OTP must be set in the root .env').toMatch(/^\d{6}$/);
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();
    jubileePhone = await linkPhone(CODES.jubilee);
    gachibowliPhone = await linkPhone(CODES.gachibowli);
    kukatpallyPhone = await linkPhone(CODES.kukatpally);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('basics', () => {
    it('answers the health check without a login', async () => {
      await http().get('/health').expect(200, { status: 'ok' });
    });

    it('rejects requests without a session', async () => {
      await http().get('/auth/me').expect(401);
      await http().get('/outlets').expect(401);
      await http().get('/auth/me').set(bearer('not-a-real-token')).expect(401);
    });
  });

  describe('one-time code (ECCS staff, and owners at onboarding)', () => {
    it('rejects a badly formed phone number', async () => {
      const response = await http().post('/auth/otp/request').send({ phone: '12345' }).expect(400);
      expect(response.body.message).toContain('valid 10-digit');
    });

    it('logs ECCS staff in with phone and code, however the number is typed', async () => {
      await http().post('/auth/otp/request').send({ phone: '90000 00001' }).expect(200);
      const response = await http()
        .post('/auth/otp/verify')
        .send({ phone: '090000 00001', code: OTP, deviceName: DEVICE })
        .expect(200);

      expect(response.body.user.memberships).toEqual([expect.objectContaining({ role: 'SUPER_ADMIN' })]);
      expect(response.body.linkedDevice).toBeUndefined();
      expect(response.body.generatedPin).toBeUndefined();

      const me = await http().get('/auth/me').set(bearer(response.body.token)).expect(200);
      expect(me.body.phone).toBe(PHONES.superAdmin);
      expect(me.body.sessionId).toBeUndefined();
    });

    it('rejects a wrong code and a reused code', async () => {
      await http().post('/auth/otp/request').send({ phone: PHONES.supervisor }).expect(200);
      await http().post('/auth/otp/verify').send({ phone: PHONES.supervisor, code: '000000' }).expect(401);
      await http().post('/auth/otp/verify').send({ phone: PHONES.supervisor, code: OTP, deviceName: DEVICE }).expect(200);
      await http().post('/auth/otp/verify').send({ phone: PHONES.supervisor, code: OTP }).expect(401);
    });

    it('locks a code after five wrong attempts', async () => {
      await http().post('/auth/otp/request').send({ phone: PHONES.spiceOwner }).expect(200);
      for (let attempt = 0; attempt < 5; attempt++) {
        await http().post('/auth/otp/verify').send({ phone: PHONES.spiceOwner, code: '000000' }).expect(401);
      }
      await http().post('/auth/otp/verify').send({ phone: PHONES.spiceOwner, code: OTP }).expect(401);
    });

    it('gives an unknown phone the same answer but never a session', async () => {
      await http().post('/auth/otp/request').send({ phone: PHONES.unknown }).expect(200, { expiresInSeconds: 300 });
      await http().post('/auth/otp/verify').send({ phone: PHONES.unknown, code: OTP }).expect(401);
    });

    it('limits how many codes one phone can request', async () => {
      await prisma.client.otpChallenge.deleteMany({ where: { phone: PHONES.unknown } });
      for (let i = 0; i < 5; i++) {
        await http().post('/auth/otp/request').send({ phone: PHONES.unknown }).expect(200);
      }
      await http().post('/auth/otp/request').send({ phone: PHONES.unknown }).expect(429);
    });

    it('onboards an owner: links the phone and, on reset, issues a new PIN', async () => {
      const first = await otpLogin(PHONES.deccanOwner);
      expect(first.user.memberships).toEqual([expect.objectContaining({ role: 'OWNER' })]);
      expect(first.linkedDevice).toMatchObject({ organizationName: 'Deccan Biryani House', outletName: null });
      expect(first.generatedPin).toBeUndefined(); // the seeded owner already has a PIN

      // The owner's linked phone now accepts the PIN, with no further codes.
      await pinLogin(first.linkedDevice.deviceToken, PINS.deccanOwner);

      const reset = await otpLogin(PHONES.deccanOwner, { resetPin: true });
      expect(reset.generatedPin).toMatch(/^\d{4}$/);
      await pinLogin(reset.linkedDevice.deviceToken, reset.generatedPin);
      if (reset.generatedPin !== PINS.deccanOwner) {
        await http()
          .post('/auth/pin/login')
          .send({ deviceToken: reset.linkedDevice.deviceToken, pin: PINS.deccanOwner })
          .expect(401);
      }
      await restoreDeccanOwnerPin();
    });
  });

  describe('restaurant code and PIN (everyone at a restaurant)', () => {
    it('links a phone with the restaurant code, typed loosely', async () => {
      const response = await http().post('/auth/device/link').send({ code: ' spice jh2k7m ', deviceName: DEVICE }).expect(200);
      expect(response.body).toMatchObject({
        deviceToken: expect.any(String),
        organizationName: 'Spice Route Kitchens',
        outletName: 'Spice Route, Jubilee Hills',
      });
    });

    it('rejects a restaurant code that does not exist', async () => {
      await http().post('/auth/device/link').send({ code: 'SPICE-XXXXXX' }).expect(404);
    });

    it('lets the PIN decide who is logging in', async () => {
      const phone = jubileePhone;
      const who = async (pin: string) => {
        const response = await http().post('/auth/pin/login').send({ deviceToken: phone, pin }).expect(200);
        return response.body.user.memberships[0].role as string;
      };

      expect(await who(PINS.jubileeManager)).toBe('MANAGER');
      expect(await who(PINS.jubileeChef)).toBe('HEAD_CHEF');
      expect(await who(PINS.spiceOwner)).toBe('OWNER');
    });

    it("does not accept another outlet's or another restaurant's PIN", async () => {
      const phone = jubileePhone;
      await http().post('/auth/pin/login').send({ deviceToken: phone, pin: PINS.gachibowliManager }).expect(401);
      await http().post('/auth/pin/login').send({ deviceToken: phone, pin: PINS.deccanOwner }).expect(401);
    });

    it('tells the app when the phone is not linked', async () => {
      const response = await http().post('/auth/pin/login').send({ deviceToken: 'nonsense', pin: '4821' }).expect(401);
      expect(response.body.code).toBe('DEVICE_NOT_LINKED');
    });

    it('locks a phone after five wrong PINs, without affecting other phones', async () => {
      const phone = await linkPhone(CODES.jubilee);
      const otherPhone = await linkPhone(CODES.jubilee);
      for (let attempt = 0; attempt < 5; attempt++) {
        await http().post('/auth/pin/login').send({ deviceToken: phone, pin: '0001' }).expect(401);
      }
      await http().post('/auth/pin/login').send({ deviceToken: phone, pin: PINS.jubileeManager }).expect(429);
      await pinLogin(otherPhone, PINS.jubileeManager);
    });
  });

  describe('what each role can see', () => {
    it('shows each role only the outlets it should see', async () => {
      const names = async (token: string) => {
        const response = await http().get('/outlets').set(bearer(token)).expect(200);
        return (response.body as { name: string }[]).map((outlet) => outlet.name);
      };
      expect(await names((await otpLogin(PHONES.superAdmin)).token)).toHaveLength(3);
      expect(await names(await pinLogin(jubileePhone, PINS.spiceOwner))).toEqual([
        'Spice Route, Gachibowli',
        'Spice Route, Jubilee Hills',
      ]);
      expect(await names(await pinLogin(jubileePhone, PINS.jubileeManager))).toEqual(['Spice Route, Jubilee Hills']);
      const chef = await pinLogin(jubileePhone, PINS.jubileeChef);
      await http().get('/outlets').set(bearer(chef)).expect(403);
    });
  });

  describe('adding staff (the owner or manager is shown a PIN once)', () => {
    let owner: string;
    let manager: string;
    let jubileeId: string;
    let gachibowliId: string;

    beforeAll(async () => {
      owner = await pinLogin(jubileePhone, PINS.spiceOwner);
      manager = await pinLogin(jubileePhone, PINS.jubileeManager);
      const outlets = await prisma.client.outlet.findMany({ where: { code: { in: [CODES.jubilee, CODES.gachibowli] } } });
      jubileeId = outlets.find((o) => o.code === CODES.jubilee)!.id;
      gachibowliId = outlets.find((o) => o.code === CODES.gachibowli)!.id;
    });

    const addPerson = (token: string, body: Record<string, unknown>) =>
      http().post('/restaurant-users').set(bearer(token)).send(body);

    it('lets the owner add a manager, who can then log in with the generated PIN', async () => {
      const created = await addPerson(owner, { name: 'E2E Manager', role: 'MANAGER', outletId: gachibowliId }).expect(201);
      expect(created.body.pin).toMatch(/^\d{4}$/);
      expect(created.body.user).toMatchObject({ name: 'E2E Manager', role: 'MANAGER', outletName: 'Spice Route, Gachibowli' });

      const session = await http()
        .post('/auth/pin/login')
        .send({ deviceToken: gachibowliPhone, pin: created.body.pin })
        .expect(200);
      expect(session.body.user).toMatchObject({ name: 'E2E Manager', phone: null });
      expect(session.body.user.memberships[0].role).toBe('MANAGER');

      // The new manager's PIN is for Gachibowli; it does nothing on a Jubilee Hills phone.
      await http().post('/auth/pin/login').send({ deviceToken: jubileePhone, pin: created.body.pin }).expect(401);
    });

    it('lets a manager add kitchen staff at their own outlet only', async () => {
      await addPerson(manager, { name: 'E2E Chef', role: 'HEAD_CHEF', outletId: jubileeId }).expect(201);
      await addPerson(manager, { name: 'E2E Chef Elsewhere', role: 'HEAD_CHEF', outletId: gachibowliId }).expect(403);
      await addPerson(manager, { name: 'E2E Second Manager', role: 'MANAGER', outletId: jubileeId }).expect(403);
    });

    it('does not let kitchen staff add anyone', async () => {
      const chef = await pinLogin(jubileePhone, PINS.jubileeChef);
      await addPerson(chef, { name: 'E2E Nope', role: 'HEAD_CHEF', outletId: jubileeId }).expect(403);
    });

    it('rejects an invalid request', async () => {
      await addPerson(owner, { name: '', role: 'MANAGER', outletId: jubileeId }).expect(400);
      await addPerson(owner, { name: 'E2E Owner Two', role: 'OWNER', outletId: jubileeId }).expect(400);
    });

    it('lists people within reach of the role', async () => {
      const ownerList = await http().get('/restaurant-users').set(bearer(owner)).expect(200);
      const ownerOutlets = new Set((ownerList.body as { outletName: string | null }[]).map((u) => u.outletName));
      expect(ownerOutlets).toEqual(new Set([null, 'Spice Route, Jubilee Hills', 'Spice Route, Gachibowli']));

      const managerList = await http().get('/restaurant-users').set(bearer(manager)).expect(200);
      const managerOutlets = new Set((managerList.body as { outletName: string | null }[]).map((u) => u.outletName));
      expect(managerOutlets).toEqual(new Set(['Spice Route, Jubilee Hills']));
    });

    it('resets a PIN: the old one stops working and the person is logged out', async () => {
      const created = await addPerson(owner, { name: 'E2E Reset Me', role: 'HEAD_CHEF', outletId: jubileeId }).expect(201);
      const oldSession = await pinLogin(jubileePhone, created.body.pin);

      const reset = await http()
        .post(`/restaurant-users/${created.body.user.id}/reset-pin`)
        .set(bearer(owner))
        .expect(201);
      expect(reset.body.pin).toMatch(/^\d{4}$/);

      await http().get('/auth/me').set(bearer(oldSession)).expect(401);
      await pinLogin(jubileePhone, reset.body.pin);
      if (reset.body.pin !== created.body.pin) {
        await http().post('/auth/pin/login').send({ deviceToken: jubileePhone, pin: created.body.pin }).expect(401);
      }
    });

    it('deactivates a person: their PIN and session stop working', async () => {
      const created = await addPerson(owner, { name: 'E2E Leaver', role: 'HEAD_CHEF', outletId: jubileeId }).expect(201);
      const session = await pinLogin(jubileePhone, created.body.pin);

      await http()
        .patch(`/restaurant-users/${created.body.user.id}`)
        .set(bearer(owner))
        .send({ isActive: false })
        .expect(200);

      await http().get('/auth/me').set(bearer(session)).expect(401);
      await http().post('/auth/pin/login').send({ deviceToken: jubileePhone, pin: created.body.pin }).expect(401);
    });

    it("keeps one restaurant's people out of reach of another's owner, and managers away from managers", async () => {
      const created = await addPerson(owner, { name: 'E2E Protected', role: 'MANAGER', outletId: jubileeId }).expect(201);
      const id = created.body.user.id as string;

      const otherOwner = await pinLogin(kukatpallyPhone, PINS.deccanOwner);
      await http().post(`/restaurant-users/${id}/reset-pin`).set(bearer(otherOwner)).expect(404);
      await http().post(`/restaurant-users/${id}/reset-pin`).set(bearer(manager)).expect(404);
    });
  });

  describe('profile and logout', () => {
    it('lets a user change language', async () => {
      const token = await pinLogin(jubileePhone, PINS.jubileeChef);
      const response = await http().patch('/auth/me').set(bearer(token)).send({ language: 'HI' }).expect(200);
      expect(response.body.language).toBe('HI');
      await http().patch('/auth/me').set(bearer(token)).send({ language: 'FR' }).expect(400);
      await http().patch('/auth/me').set(bearer(token)).send({ language: 'TE' }).expect(200);
    });

    it('ends the session on logout', async () => {
      const token = await pinLogin(jubileePhone, PINS.jubileeManager);
      await http().get('/auth/me').set(bearer(token)).expect(200);
      await http().post('/auth/logout').set(bearer(token)).expect(204);
      await http().get('/auth/me').set(bearer(token)).expect(401);
    });
  });
});
