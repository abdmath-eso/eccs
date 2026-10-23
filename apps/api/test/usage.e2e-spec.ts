// The Usage page (23 Oct 2026): counting the screens people open, and the page itself. Runs
// against the local database with the sample seed. It logs in as the sample Spice Route Owner,
// the Super Admin and the Ops Manager, whom the founder also uses, so it counts only screens of
// its own ("/e2e/usage-…", which no app has) and removes only the rows, phones, sessions and
// login codes it made, by their recorded ids.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { indiaDay, USAGE_RULES, type UsageOverviewDto } from '@eccs/shared';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { UsageService } from './../src/usage/usage.service.js';

const SPICE = { code: 'SPICE-JH2K7M', owner: '2580' };
const PHONES = { admin: '+919000000001', ops: '+919000000002' };
const DEVICE = 'e2e-usage';
const SCREEN_A = '/e2e/usage-a';
const SCREEN_B = '/e2e/usage-b';
const CONSOLE_SCREEN = '/e2e/usage-console?tab=one';

describe('Usage (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: string;
  let admin: string;
  let ops: string;
  let ownerId: string;
  let adminId: string;
  let spiceId: string;
  const devices: string[] = [];
  const sessions: string[] = [];
  const challenges: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const now = () => new Date().toISOString();
  const send = (token: string, app: 'APP' | 'CONSOLE', screens: string[], at = now()) =>
    http()
      .post('/usage/views')
      .set(bearer(token))
      .send({ app, views: screens.map((screen) => ({ screen, at })) });
  const overview = async (token: string, query = '') => (await http().get(`/usage/overview${query}`).set(bearer(token)).expect(200)).body as UsageOverviewDto;
  const rowsOf = (userId: string, screen: string) => prisma.client.usageDay.findMany({ where: { userId, screen } });

  /** The rows of this suite's own screens (a run stopped half way leaves some). */
  async function removeRows() {
    const db = prisma.client;
    const mine = await db.usageDay.findMany({ where: { userId: { in: [ownerId, adminId].filter(Boolean) }, screen: { in: [SCREEN_A, SCREEN_B, CONSOLE_SCREEN] } }, select: { id: true } });
    await db.usageDay.deleteMany({ where: { id: { in: mine.map((row) => row.id) } } });
  }

  async function cleanUp() {
    const db = prisma.client;
    await removeRows();
    await db.session.deleteMany({ where: { id: { in: sessions } } });
    await db.linkedDevice.deleteMany({ where: { id: { in: devices } } });
    await db.otpChallenge.deleteMany({ where: { id: { in: challenges } } });
  }

  async function pinLogin(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    const device = await prisma.client.linkedDevice.findFirstOrThrow({ where: { name: DEVICE, id: { notIn: devices } }, orderBy: { createdAt: 'desc' } });
    devices.push(device.id);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    const made = await prisma.client.session.findFirstOrThrow({ where: { linkedDeviceId: device.id }, orderBy: { createdAt: 'desc' } });
    sessions.push(made.id);
    return session.body.token as string;
  }

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const challenge = await prisma.client.otpChallenge.findFirstOrThrow({ where: { phone }, orderBy: { createdAt: 'desc' } });
    challenges.push(challenge.id);
    const session = await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200);
    const made = await prisma.client.session.findFirstOrThrow({ where: { deviceName: DEVICE, id: { notIn: sessions } }, orderBy: { createdAt: 'desc' } });
    sessions.push(made.id);
    return session.body.token as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    owner = await pinLogin(SPICE.code, SPICE.owner);
    admin = await otpLogin(PHONES.admin);
    ops = await otpLogin(PHONES.ops);
    ownerId = (await http().get('/auth/me').set(bearer(owner)).expect(200)).body.id;
    adminId = (await http().get('/auth/me').set(bearer(admin)).expect(200)).body.id;
    const outlet = await prisma.client.outlet.findUniqueOrThrow({ where: { code: SPICE.code }, select: { organizationId: true } });
    spiceId = outlet.organizationId;
    await removeRows();
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('needs a login to count anything', async () => {
    await http().post('/usage/views').send({ app: 'APP', views: [{ screen: SCREEN_A, at: now() }] }).expect(401);
  });

  it('counts each screen once a day per person, adding each open to the same row', async () => {
    await send(owner, 'APP', [SCREEN_A, SCREEN_A, SCREEN_B]).expect(204);
    await send(owner, 'APP', [SCREEN_A]).expect(204);
    const [a] = await rowsOf(ownerId, SCREEN_A);
    const [b] = await rowsOf(ownerId, SCREEN_B);
    expect(a).toMatchObject({ views: 3, role: 'OWNER', organizationId: spiceId, app: 'APP' });
    expect(a!.day.toISOString().slice(0, 10)).toBe(indiaDay(new Date()));
    expect(b).toMatchObject({ views: 1 });
    expect(await rowsOf(ownerId, SCREEN_A)).toHaveLength(1);
  });

  it("counts ECCS's own team with no restaurant", async () => {
    await send(admin, 'CONSOLE', [CONSOLE_SCREEN]).expect(204);
    const [row] = await rowsOf(adminId, CONSOLE_SCREEN);
    expect(row).toMatchObject({ views: 1, role: 'SUPER_ADMIN', organizationId: null, app: 'CONSOLE' });
  });

  it('counts a note from the future or from days ago on the day it arrives', async () => {
    await send(owner, 'APP', [SCREEN_B], new Date(Date.now() + 86_400_000).toISOString()).expect(204);
    await send(owner, 'APP', [SCREEN_B], new Date(Date.now() - 5 * 86_400_000).toISOString()).expect(204);
    const rows = await rowsOf(ownerId, SCREEN_B);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ views: 3 });
  });

  it('refuses anything that is not a screen name, and too many at once', async () => {
    await send(owner, 'APP', ['/vendors?search=ramesh']).expect(400);
    await send(owner, 'APP', ['not a screen']).expect(400);
    await send(owner, 'APP', Array.from({ length: USAGE_RULES.maxBatch + 1 }, () => SCREEN_A)).expect(400);
    await http().post('/usage/views').set(bearer(owner)).send({ app: 'TV', views: [{ screen: SCREEN_A, at: now() }] }).expect(400);
  });

  it("shows the Super Admin who used the restaurant app, and which screens", async () => {
    const page = await overview(admin);
    expect(page).toMatchObject({ segment: 'restaurants', restaurant: null, keepDays: USAGE_RULES.keepDays });
    expect(page.range.days).toBe(30);
    expect(page.daily).toHaveLength(30);
    const me = page.people.find((person) => person.id === ownerId);
    expect(me).toMatchObject({ role: 'OWNER', organizationId: spiceId, lastActiveOn: indiaDay(new Date()) });
    expect(me!.views).toBeGreaterThanOrEqual(6);
    expect(page.screens.find((screen) => screen.screen === SCREEN_A)).toMatchObject({ views: 3, people: 1, label: SCREEN_A, areaLabel: 'Other' });
    expect(page.restaurants.find((restaurant) => restaurant.id === spiceId)).toMatchObject({ lastActiveOn: indiaDay(new Date()) });
    expect(page.restaurantChoices.some((choice) => choice.id === spiceId)).toBe(true);
    expect(page.tiles.activeToday).toBeGreaterThanOrEqual(1);
    // ECCS's team is not in the restaurants' figures.
    expect(page.people.some((person) => person.id === adminId)).toBe(false);
  });

  it("shows ECCS's own team apart", async () => {
    const page = await overview(admin, '?segment=team&days=7');
    expect(page.restaurants).toEqual([]);
    expect(page.daily).toHaveLength(7);
    expect(page.people.find((person) => person.id === adminId)).toMatchObject({ role: 'SUPER_ADMIN', apps: ['CONSOLE'] });
    expect(page.people.some((person) => person.id === ownerId)).toBe(false);
    expect(page.screens.find((screen) => screen.screen === CONSOLE_SCREEN)).toMatchObject({ label: '/e2e/usage-console: one' });
  });

  it('narrows the page to one restaurant', async () => {
    const page = await overview(admin, `?restaurant=${spiceId}`);
    expect(page.restaurant).toMatchObject({ id: spiceId });
    expect(page.restaurants.map((restaurant) => restaurant.id)).toEqual([spiceId]);
    expect(page.people.every((person) => person.organizationId === spiceId)).toBe(true);
    await http().get('/usage/overview?restaurant=00000000-0000-4000-8000-000000000000').set(bearer(admin)).expect(404);
    await http().get('/usage/overview?days=14').set(bearer(admin)).expect(400);
  });

  it('is for the Super Admin only', async () => {
    await http().get('/usage/overview').set(bearer(ops)).expect(403);
    await http().get('/usage/overview').set(bearer(owner)).expect(403);
    await http().get('/usage/overview').expect(401);
  });

  it("keeps today's rows when old ones are deleted", async () => {
    const usage = app.get(UsageService);
    const { deleted } = await usage.prune(new Date());
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(await rowsOf(ownerId, SCREEN_A)).toHaveLength(1);
  });
});
