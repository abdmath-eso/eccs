// Runs against the local database with the sample seed loaded
// (packages/db: pnpm seed) and DEV_FIXED_OTP set in the root .env.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const PHONES = {
  superAdmin: '+919000000001',
  supervisor: '+919000000003',
  owner: '+919100000001',
  manager: '+919100000011',
  headChef: '+919100000012',
  otherOwner: '+919100000002',
  unknown: '+919999999999',
};
const OTP = env.DEV_FIXED_OTP ?? '';

describe('Login and roles (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());

  async function clearLoginState() {
    const phones = Object.values(PHONES);
    await prisma.client.otpChallenge.deleteMany({ where: { phone: { in: phones } } });
    await prisma.client.session.deleteMany({ where: { user: { phone: { in: phones } } } });
    await prisma.client.user.updateMany({
      where: { phone: { in: phones } },
      data: { pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }

  async function login(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const response = await http().post('/auth/otp/verify').send({ phone, code: OTP }).expect(200);
    return response.body.token as string;
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    expect(OTP, 'DEV_FIXED_OTP must be set in the root .env').toMatch(/^\d{6}$/);
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await clearLoginState();
  });

  afterAll(async () => {
    await clearLoginState();
    await app.close();
  });

  it('answers the health check without a login', async () => {
    await http().get('/health').expect(200, { status: 'ok' });
  });

  it('rejects requests without a session', async () => {
    await http().get('/auth/me').expect(401);
    await http().get('/outlets').expect(401);
    await http().get('/auth/me').set(bearer('not-a-real-token')).expect(401);
  });

  it('rejects a badly formed phone number', async () => {
    const response = await http().post('/auth/otp/request').send({ phone: '12345' }).expect(400);
    expect(response.body.message).toContain('valid 10-digit');
  });

  it('logs a head chef in with phone and code, however the number is typed', async () => {
    await http().post('/auth/otp/request').send({ phone: '91000 00012' }).expect(200);
    const response = await http().post('/auth/otp/verify').send({ phone: '091000 00012', code: OTP }).expect(200);

    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({ phone: PHONES.headChef, language: 'TE', hasPin: false });
    expect(response.body.user.memberships).toEqual([
      expect.objectContaining({
        role: 'HEAD_CHEF',
        organizationName: 'Spice Route Kitchens',
        outletName: 'Spice Route, Jubilee Hills',
      }),
    ]);

    const me = await http().get('/auth/me').set(bearer(response.body.token)).expect(200);
    expect(me.body.phone).toBe(PHONES.headChef);
    expect(me.body.sessionId).toBeUndefined();
  });

  it('rejects a wrong code and a reused code', async () => {
    await http().post('/auth/otp/request').send({ phone: PHONES.manager }).expect(200);
    await http().post('/auth/otp/verify').send({ phone: PHONES.manager, code: '000000' }).expect(401);
    await http().post('/auth/otp/verify').send({ phone: PHONES.manager, code: OTP }).expect(200);
    await http().post('/auth/otp/verify').send({ phone: PHONES.manager, code: OTP }).expect(401);
  });

  it('locks a code after five wrong attempts', async () => {
    await http().post('/auth/otp/request').send({ phone: PHONES.otherOwner }).expect(200);
    for (let attempt = 0; attempt < 5; attempt++) {
      await http().post('/auth/otp/verify').send({ phone: PHONES.otherOwner, code: '000000' }).expect(401);
    }
    await http().post('/auth/otp/verify').send({ phone: PHONES.otherOwner, code: OTP }).expect(401);
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

  it('shows each role only the outlets it should see', async () => {
    const names = async (phone: string) => {
      const token = await login(phone);
      const response = await http().get('/outlets').set(bearer(token)).expect(200);
      return (response.body as { name: string }[]).map((outlet) => outlet.name);
    };

    expect(await names(PHONES.superAdmin)).toHaveLength(3);
    expect(await names(PHONES.supervisor)).toHaveLength(3); // seed assigns the supervisor jobs at every outlet
    expect(await names(PHONES.owner)).toEqual(['Spice Route, Gachibowli', 'Spice Route, Jubilee Hills']);
    expect(await names(PHONES.manager)).toEqual(['Spice Route, Jubilee Hills']);
  });

  it('blocks a role that lacks the permission', async () => {
    const token = await login(PHONES.headChef);
    await http().get('/outlets').set(bearer(token)).expect(403);
  });

  it('lets a user change language', async () => {
    const token = await login(PHONES.owner);
    const response = await http().patch('/auth/me').set(bearer(token)).send({ language: 'HI' }).expect(200);
    expect(response.body.language).toBe('HI');
    await http().patch('/auth/me').set(bearer(token)).send({ language: 'FR' }).expect(400);
    await http().patch('/auth/me').set(bearer(token)).send({ language: 'EN' }).expect(200);
  });

  it('sets and checks a PIN, and locks after five wrong tries', async () => {
    const token = await login(PHONES.manager);
    await http().post('/auth/pin/verify').set(bearer(token)).send({ pin: '1234' }).expect(403);
    await http().put('/auth/pin').set(bearer(token)).send({ pin: '12' }).expect(400);
    await http().put('/auth/pin').set(bearer(token)).send({ pin: '4821' }).expect(204);
    await http().post('/auth/pin/verify').set(bearer(token)).send({ pin: '4821' }).expect(204);

    const me = await http().get('/auth/me').set(bearer(token)).expect(200);
    expect(me.body.hasPin).toBe(true);

    for (let attempt = 0; attempt < 5; attempt++) {
      await http().post('/auth/pin/verify').set(bearer(token)).send({ pin: '0000' }).expect(403);
    }
    await http().post('/auth/pin/verify').set(bearer(token)).send({ pin: '4821' }).expect(429);
  });

  it('ends the session on logout', async () => {
    const token = await login(PHONES.superAdmin);
    await http().get('/auth/me').set(bearer(token)).expect(200);
    await http().post('/auth/logout').set(bearer(token)).expect(204);
    await http().get('/auth/me').set(bearer(token)).expect(401);
  });
});
