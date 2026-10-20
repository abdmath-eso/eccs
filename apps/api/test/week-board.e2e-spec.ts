// The Visits week board (Stage I, 20 Oct 2026): the week endpoint and its capacity, a visit
// moved through the diary's own PATCH and seen on its new day, the capacity setting (the
// Super Admin only), an outlet's area on its cards, Sales' free checks (which use no slot),
// and who sees what: the Ops Manager every visit, a Supervisor only theirs and read-only,
// a BDE nothing. Runs on a week about nine months ahead, where no sample or plan visit
// falls, at the sample Deccan Biryani outlet. Everything it makes is removed by the ids it
// recorded; the capacity row and the outlet's area are put back as they were.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { addDays, boardMonday, type WeekBoardDto } from '@eccs/shared';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODE = 'DECCA-KP6R3T';
const PHONES = { superAdmin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003', bde: '+919000000004' };
const DEVICE = 'e2e-week-board';
const AREA = 'E2E Week Area';

describe('Visits week board (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let organizationId: string;
  let originalArea: string | null;
  let originalSettings: { capacityMon: number; capacityTue: number; capacityWed: number; capacityThu: number; capacityFri: number; capacitySat: number } | null;
  const tokens = { superAdmin: '', ops: '', supervisor: '', bde: '' };
  let supervisorId: string;
  let superAdminId: string;

  // A Monday about nine months ahead: past the 30 days plan visits are made for, inside the 365 days a visit may be put on.
  const monday = boardMonday(addDays(indiaDate(), 270));
  const tuesday = addDays(monday, 1);
  const wednesday = addDays(monday, 2);

  // Everything made here, by id.
  const made = { visits: [] as string[], leads: [] as string[], sessions: [] as string[], challenges: [] as string[] };

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const challenge = await prisma.client.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (challenge) made.challenges.push(challenge.id);
    const session = await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200);
    const row = await prisma.client.session.findFirst({ where: { deviceName: DEVICE, user: { phone } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (row) made.sessions.push(row.id);
    return session.body.token as string;
  }

  const week = async (token: string, start = wednesday): Promise<WeekBoardDto> =>
    (await http().get('/visits/week').query({ start }).set(bearer(token)).expect(200)).body;

  async function addVisit(date: string, supervisor: string | null = null): Promise<string> {
    const response = await http()
      .post('/visits')
      .set(bearer(tokens.ops))
      .send({ outletId, serviceCode: 'PEST', date, slot: '1000', supervisorId: supervisor })
      .expect(201);
    made.visits.push(response.body.id);
    return response.body.id as string;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const outlet = await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODE } });
    outletId = outlet.id;
    organizationId = outlet.organizationId;
    originalArea = outlet.area;
    originalSettings = await prisma.client.visitSettings.findUnique({
      where: { id: 'default' },
      select: { capacityMon: true, capacityTue: true, capacityWed: true, capacityThu: true, capacityFri: true, capacitySat: true },
    });

    tokens.superAdmin = await otpLogin(PHONES.superAdmin);
    tokens.ops = await otpLogin(PHONES.ops);
    tokens.supervisor = await otpLogin(PHONES.supervisor);
    tokens.bde = await otpLogin(PHONES.bde);
    supervisorId = (await prisma.client.user.findUniqueOrThrow({ where: { phone: PHONES.supervisor } })).id;
    superAdminId = (await prisma.client.user.findUniqueOrThrow({ where: { phone: PHONES.superAdmin } })).id;
  });

  afterAll(async () => {
    const db = prisma.client;
    await db.job.deleteMany({ where: { id: { in: made.visits } } });
    await db.lead.deleteMany({ where: { id: { in: made.leads } } });
    await db.outlet.update({ where: { id: outletId }, data: { area: originalArea } });
    if (originalSettings) await db.visitSettings.update({ where: { id: 'default' }, data: originalSettings });
    else await db.visitSettings.deleteMany({ where: { id: 'default' } });
    await db.session.deleteMany({ where: { id: { in: made.sessions } } });
    await db.otpChallenge.deleteMany({ where: { id: { in: made.challenges } } });
    await app.close();
  });

  it('lets the Super Admin set the capacity per day, and nobody else', async () => {
    const capacity = { MON: 2, TUE: 2, WED: 2, THU: 2, FRI: 2, SAT: 1 };
    const saved = await http().put('/visits/settings').set(bearer(tokens.superAdmin)).send(capacity).expect(200);
    expect(saved.body).toMatchObject({ capacity, canChange: true });
    await http().put('/visits/settings').set(bearer(tokens.ops)).send(capacity).expect(403);
    await http().put('/visits/settings').set(bearer(tokens.supervisor)).send(capacity).expect(403);
    await http().put('/visits/settings').set(bearer(tokens.superAdmin)).send({ ...capacity, MON: 21 }).expect(400);

    const read = await http().get('/visits/settings').set(bearer(tokens.ops)).expect(200);
    expect(read.body).toMatchObject({ capacity, canChange: false });
  });

  it('shows the week with each day booked of capacity, and a day over', async () => {
    await addVisit(monday);
    await addVisit(monday, supervisorId);
    const latest = await addVisit(monday);

    const board = await week(tokens.ops);
    expect(board.start).toBe(monday);
    expect(board.days.map((day) => day.date)).toEqual([0, 1, 2, 3, 4, 5].map((index) => addDays(monday, index)));
    expect(board.days[0]).toMatchObject({ booked: 3, capacity: 2, over: true });
    expect(board.days[1]).toMatchObject({ booked: 0, capacity: 2, over: false });
    expect(board.week).toEqual({ booked: 3, capacity: 11, percent: 27 });
    expect(board.headline).toBe('3 of 11 slots booked. Monday is one over.');
    expect(board.canMove).toBe(true);
    expect(board.canChangeCapacity).toBe(false);
    expect(board.days[0]?.visits.map((card) => card.id).sort()).toEqual([...made.visits].sort());
    expect(board.days[0]?.visits.every((card) => card.canMove)).toBe(true);
    // The latest booked moves to the lightest later day, Tuesday.
    expect(board.suggestion).toMatchObject({ visitId: latest, fromDate: monday, toDate: tuesday });
    expect(board.streak.max).toBe(26);
  });

  it('moves a visit through the diary and shows it on its new day', async () => {
    const moving = made.visits[2]!;
    await http().patch(`/visits/${moving}`).set(bearer(tokens.ops)).send({ date: tuesday }).expect(200);
    const board = await week(tokens.ops);
    expect(board.days[0]).toMatchObject({ booked: 2, over: false });
    expect(board.days[1]?.visits.map((card) => card.id)).toEqual([moving]);
    expect(board.suggestion).toBeNull();
  });

  it("colours a card by its outlet's area", async () => {
    await http().patch(`/organizations/${organizationId}/outlets/${outletId}`).set(bearer(tokens.ops)).send({ area: `  ${AREA}  ` }).expect(200);
    const clients = await http().get('/organizations').set(bearer(tokens.ops)).expect(200);
    const outlet = (clients.body as { outlets: { id: string; area: string | null }[] }[]).flatMap((client) => client.outlets).find((row) => row.id === outletId);
    expect(outlet?.area).toBe(AREA);
    const board = await week(tokens.ops);
    expect(board.days[0]?.visits[0]?.area).toBe(AREA);
    // Sent empty, it clears.
    await http().patch(`/organizations/${organizationId}/outlets/${outletId}`).set(bearer(tokens.ops)).send({ area: '' }).expect(200);
    expect((await prisma.client.outlet.findUniqueOrThrow({ where: { id: outletId } })).area).toBeNull();
  });

  it("shows Sales' free checks, which use no slot", async () => {
    const lead = await prisma.client.lead.create({
      data: {
        businessName: 'E2E Week Board check',
        area: AREA,
        source: 'OTHER',
        ownerId: superAdminId,
        stage: 'CHECK_BOOKED',
        checkAt: new Date(`${wednesday}T11:00:00.000+05:30`),
        checkWith: 'E2E',
      },
    });
    made.leads.push(lead.id);
    const board = await week(tokens.ops);
    expect(board.showsChecks).toBe(true);
    expect(board.days[2]?.checks).toEqual([{ leadId: lead.id, businessName: 'E2E Week Board check', area: AREA, date: wednesday, time: '11:00', checkWith: 'E2E' }]);
    expect(board.days[2]?.booked).toBe(0);
    expect(board.week.booked).toBe(3);
  });

  it('shows a Supervisor only their own visits, read-only, and no free checks', async () => {
    const board = await week(tokens.supervisor);
    const cards = board.days.flatMap((day) => day.visits);
    expect(cards.map((card) => card.id)).toEqual([made.visits[1]]);
    expect(cards[0]?.canMove).toBe(false);
    expect(board.canMove).toBe(false);
    expect(board.showsChecks).toBe(false);
    expect(board.days[2]?.checks).toEqual([]);
    expect(board.suggestion).toBeNull();
    // The day's count is the crew's, not only theirs.
    expect(board.days[0]?.booked).toBe(2);
    await http().patch(`/visits/${made.visits[1]}`).set(bearer(tokens.supervisor)).send({ date: wednesday }).expect(403);
  });

  it('keeps finished and cancelled visits where they are', async () => {
    const cancelled = made.visits[0]!;
    await http().post(`/visits/${cancelled}/cancel`).set(bearer(tokens.ops)).expect(200);
    const board = await week(tokens.ops);
    expect(board.days[0]?.visits.map((card) => card.id)).not.toContain(cancelled);
    expect(board.days[0]?.booked).toBe(1);
    await http().patch(`/visits/${cancelled}`).set(bearer(tokens.ops)).send({ date: wednesday }).expect(409);
  });

  it('refuses a BDE, who has no visits', async () => {
    await http().get('/visits/week').set(bearer(tokens.bde)).expect(403);
    await http().get('/visits/settings').set(bearer(tokens.bde)).expect(403);
  });

  it('refuses a week that is not a date', async () => {
    await http().get('/visits/week').query({ start: 'next week' }).set(bearer(tokens.ops)).expect(400);
  });
});
