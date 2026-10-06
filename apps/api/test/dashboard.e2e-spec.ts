// The restaurant dashboard. Runs against the local database with the sample
// seed loaded. It only reads, and compares what it gets with the checklist,
// licence and issue endpoints, so it does not depend on the exact sample data.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const JUBILEE_CODE = 'SPICE-JH2K7M';
const PINS = { owner: '2580', manager: '4821', chef: '7306' };
const ADMIN_PHONE = '+919000000001';
const DEVICE = 'e2e-dashboard';

type Checklist = { id: string; status: string; itemCount: number; doneCount: number; problemCount: number; [key: string]: unknown };
type Licence = { id: string; state: string; daysLeft: number; [key: string]: unknown };
type Outlet = {
  outletId: string;
  outletName: string;
  date: string;
  checklists: Checklist[];
  licences: Licence[] | null;
  issues: { open: number; inProgress: number } | null;
};

describe('Restaurant dashboard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: string;
  let manager: string;
  let chef: string;
  let admin: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const dashboard = async (token: string) => (await http().get('/dashboard').set(bearer(token)).expect(200)).body as Outlet[];

  async function cleanUp() {
    const db = prisma.client;
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: ADMIN_PHONE } });
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
    await cleanUp();

    owner = await pinLogin(PINS.owner);
    manager = await pinLogin(PINS.manager);
    chef = await pinLogin(PINS.chef);
    await http().post('/auth/otp/request').send({ phone: ADMIN_PHONE }).expect(200);
    const session = await http()
      .post('/auth/otp/verify')
      .send({ phone: ADMIN_PHONE, code: env.DEV_FIXED_OTP, deviceName: DEVICE })
      .expect(200);
    admin = session.body.token as string;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('needs a login', async () => {
    await http().get('/dashboard').expect(401);
  });

  it('shows the Owner every outlet of the brand, and the Manager only their own', async () => {
    const forOwner = await dashboard(owner);
    expect(forOwner.map((outlet) => outlet.outletName).sort()).toEqual(['Spice Route, Gachibowli', 'Spice Route, Jubilee Hills']);
    for (const outlet of forOwner) expect(outlet.date).toBe(indiaDate());

    const forManager = await dashboard(manager);
    expect(forManager.map((outlet) => outlet.outletName)).toEqual(['Spice Route, Jubilee Hills']);
  });

  it("lists today's checklists with the same progress the checklist screen shows", async () => {
    const [outlet] = await dashboard(manager);
    const today = await http().get('/checklists/today').query({ outletId: outlet!.outletId }).set(bearer(manager)).expect(200);
    const runs = today.body as { id: string; status: string; items: { response: { passed: boolean } | null }[] }[];

    expect(outlet!.checklists.length).toBeGreaterThan(0);
    expect(outlet!.checklists.map((checklist) => checklist.id)).toEqual(runs.map((run) => run.id));
    for (const run of runs) {
      const row = outlet!.checklists.find((checklist) => checklist.id === run.id)!;
      expect(row.status).toBe(run.status);
      expect(row.itemCount).toBe(run.items.length);
      expect(row.doneCount).toBe(run.items.filter((item) => item.response).length);
      expect(row.problemCount).toBe(run.items.filter((item) => item.response?.passed === false).length);
    }
  });

  it('lists only the licences that need attention, and counts unresolved issues', async () => {
    for (const outlet of await dashboard(owner)) {
      const attention = await http().get('/licences').query({ outletId: outlet.outletId, attention: '1' }).set(bearer(owner)).expect(200);
      expect(outlet.licences!.map((licence) => licence.id)).toEqual((attention.body as Licence[]).map((licence) => licence.id));
      for (const licence of outlet.licences!) expect(licence.state).not.toBe('VALID');

      const open = await http().get('/issues').query({ outletId: outlet.outletId, status: 'open' }).set(bearer(owner)).expect(200);
      const statuses = (open.body as { status: string }[]).map((issue) => issue.status);
      expect(outlet.issues).toEqual({
        open: statuses.filter((status) => status === 'OPEN').length,
        inProgress: statuses.filter((status) => status === 'IN_PROGRESS').length,
      });
    }
  });

  it('shows the Head Chef only the checklists', async () => {
    const forChef = await dashboard(chef);
    expect(forChef).toHaveLength(1);
    expect(forChef[0]!.checklists.length).toBeGreaterThan(0);
    expect(forChef[0]!.licences).toBeNull();
    expect(forChef[0]!.issues).toBeNull();
  });

  it('gives ECCS staff nothing: their view is the console', async () => {
    expect(await dashboard(admin)).toEqual([]);
  });
});
