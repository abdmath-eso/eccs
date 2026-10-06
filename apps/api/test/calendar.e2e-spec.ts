// The history calendar. Runs against the local database with the sample seed
// loaded. It adds one service visit and one licence to the Deccan Biryani
// outlet and removes them afterwards.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { daysInMonth, holidaysBetween, shiftMonth } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const DEVICE = 'e2e-calendar';
const NOTE = 'E2E calendar visit';
const LICENCE = 'E2E calendar licence';

type Day = {
  date: string;
  checklists: { id: string; date: string; status: string }[];
  visits: { id: string; state: string; slot: string | null; service: { en?: string } }[];
  licences: { id: string; name: string | null }[];
  holidays: { en?: string }[];
};
type Month = {
  month: string;
  today: string;
  days: Day[];
  upcoming: { date: string; kind: string; visit?: { id: string }; licence?: { id: string } }[];
};

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

describe('History calendar (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let owner: string;
  let chef: string;
  let otherManager: string;

  const today = indiaDate();
  const thisMonth = today.slice(0, 7);
  const inDays = (days: number) => indiaDate(new Date(Date.now() + days * 86_400_000));

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const calendar = (token: string, month?: string, forOutlet = outletId) =>
    http()
      .get('/calendar')
      .query({ outletId: forOutlet, ...(month && { month }) })
      .set(bearer(token));
  const month = async (which: string) => (await calendar(owner, which).expect(200)).body as Month;

  async function cleanUp() {
    const db = prisma.client;
    await db.job.deleteMany({ where: { notes: NOTE } });
    await db.licence.deleteMany({ where: { name: LICENCE } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
  }

  async function pinLogin(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return session.body.token as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();

    const outlet = await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    outletId = outlet.id;
    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    chef = await pinLogin(CODES.kukatpally, PINS.chef);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('is for the Owner and Manager of the outlet only', async () => {
    await http().get('/calendar').query({ outletId }).expect(401);
    await calendar(chef).expect(403);
    await calendar(otherManager).expect(403);
    await http().get('/calendar').set(bearer(owner)).expect(400);
  });

  it("shows this month by default, with today's checklists on today", async () => {
    const body = (await calendar(owner).expect(200)).body as Month;
    expect(body.month).toBe(thisMonth);
    expect(body.today).toBe(today);

    const todayEntry = body.days.find((day) => day.date === today);
    expect(todayEntry!.checklists.length).toBeGreaterThan(0);
    // Nothing is recorded against days that have not happened yet.
    for (const day of body.days.filter((entry) => entry.date > today)) expect(day.checklists).toEqual([]);
    // Days come in order and only when they have something on them.
    expect(body.days.map((day) => day.date)).toEqual(body.days.map((day) => day.date).sort());
    for (const day of body.days) {
      expect(day.checklists.length + day.visits.length + day.licences.length + day.holidays.length).toBeGreaterThan(0);
    }
  });

  it('puts service visits on their day: done, upcoming, or not done', async () => {
    const serviceType = await prisma.client.serviceType.findFirstOrThrow({ where: { code: 'PEST' } });
    const visit = (scheduledDate: string, status: 'APPROVED' | 'ASSIGNED' | 'CANCELLED') =>
      prisma.client.job.create({
        data: { outletId, serviceTypeId: serviceType.id, scheduledDate: toDbDate(scheduledDate), scheduledSlot: 'morning', status, notes: NOTE },
      });
    const done = await visit(inDays(-3), 'APPROVED');
    const skipped = await visit(inDays(-2), 'ASSIGNED');
    const booked = await visit(inDays(4), 'ASSIGNED');
    const cancelled = await visit(inDays(4), 'CANCELLED');

    const find = async (date: string, id: string) =>
      (await month(date.slice(0, 7))).days.find((day) => day.date === date)?.visits.find((entry) => entry.id === id);

    expect(await find(inDays(-3), done.id)).toMatchObject({ state: 'DONE', slot: 'morning', service: { en: 'Pest control' } });
    expect(await find(inDays(-2), skipped.id)).toMatchObject({ state: 'NOT_DONE' });
    expect(await find(inDays(4), booked.id)).toMatchObject({ state: 'UPCOMING' });
    expect(await find(inDays(4), cancelled.id)).toBeUndefined();

    // Whichever month is open, what is coming up is listed, soonest first, without what is over.
    const { upcoming } = await month(shiftMonth(thisMonth, -2));
    const visitIds = upcoming.map((entry) => entry.visit?.id);
    expect(visitIds).toContain(booked.id);
    expect(visitIds).not.toContain(done.id);
    expect(visitIds).not.toContain(skipped.id);
    expect(upcoming.map((entry) => entry.date)).toEqual(upcoming.map((entry) => entry.date).sort());
  });

  it('puts a licence on the day it expires, and in what is coming up', async () => {
    const expiresOn = inDays(40);
    const licence = await prisma.client.licence.create({
      data: { outletId, type: 'OTHER', name: LICENCE, expiresOn: toDbDate(expiresOn) },
    });
    const body = await month(expiresOn.slice(0, 7));
    expect(body.days.find((day) => day.date === expiresOn)?.licences).toContainEqual({ id: licence.id, type: 'OTHER', name: LICENCE });
    expect(body.upcoming).toContainEqual({ date: expiresOn, kind: 'licence', licence: { id: licence.id, type: 'OTHER', name: LICENCE } });
  });

  it('marks public holidays', async () => {
    // Any month within reach that has a holiday in the list.
    const months = Array.from({ length: 25 }, (_, index) => shiftMonth(thisMonth, index - 12));
    const withHoliday = months.find((which) => holidaysBetween(`${which}-01`, `${which}-${daysInMonth(which)}`).length > 0)!;
    const [holiday] = holidaysBetween(`${withHoliday}-01`, `${withHoliday}-${daysInMonth(withHoliday)}`);
    const body = await month(withHoliday);
    expect(body.days.find((day) => day.date === holiday!.date)?.holidays).toContainEqual(holiday!.name);
  });

  it('goes one year back and one year ahead, and no further', async () => {
    await calendar(owner, shiftMonth(thisMonth, -12)).expect(200);
    await calendar(owner, shiftMonth(thisMonth, 12)).expect(200);
    await calendar(owner, shiftMonth(thisMonth, -13)).expect(400);
    await calendar(owner, shiftMonth(thisMonth, 13)).expect(400);
    await calendar(owner, '2026-13').expect(400);
    await calendar(owner, 'October').expect(400);
  });
});
