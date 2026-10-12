// The restaurant's own staff: people, attendance and the salary tracker. Who may
// do what (ECCS nothing at all, the Head Chef only today's sheet, a Manager only
// their own outlet), the Owner's corrections, and the month's pay worked out.
// Since face attendance nobody marks attendance by hand: only the Owner can set
// a day, with a reason. Clocking in and out is tested in attendance-face.e2e-spec.ts.
// Runs against the local database with the sample seed loaded. Everything is
// done at a throwaway outlet of the Deccan Biryani sample restaurant, with a
// throwaway Manager and Head Chef, and removed afterwards.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { attendanceDayOf, daysInMonth, shiftMonth } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { AttendanceClock } from './../src/attendance/attendance-clock.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-staff';
const OUTLET_CODE = 'E2EST-STAFF1';
const OTHER_OUTLET_CODE = 'E2EST-STAFF2';
const MANAGER_NAME = 'E2E Staff Manager';
const CHEF_NAME = 'E2E Staff Chef';
const OTHER_CHEF_NAME = 'E2E Staff Other Chef';

const rupees = (amount: number) => amount * 100;

type Person = {
  id: string;
  name: string;
  jobTitle: string | null;
  isActive: boolean;
  joinedOn: string | null;
  countedFrom: string;
  leftOn: string | null;
  userId: string | null;
  userName: string | null;
  pay: { payType: string; payPaise: number } | null;
  hasRecords: boolean;
};
type Day = {
  date: string;
  today: string;
  earliestDate: string;
  editable: boolean;
  people: { staffId: string; name: string; status: string | null; usualDayOff: boolean; markedByName: string | null }[];
};
type Totals = { daysInMonth: number; countedDays: number; present: number; halfDay: number; absent: number; leave: number; weeklyOff: number; notMarked: number };
type Salary = {
  staffId: string;
  month: string;
  beforeRecords: boolean;
  payType: string;
  ratePaise: number;
  totals: Totals;
  paidDays: number;
  divisor: number | null;
  dayRatePaise: number;
  lostDays: number;
  divisorKept: boolean;
  joinedOn: string | null;
  countedFrom: string;
  computedDuePaise: number;
  dueOverridePaise: number | null;
  duePaise: number;
  overtimeHours: number;
  overtimePaise: number;
  bonusPaise: number;
  advancesPaise: number;
  deductionsPaise: number;
  netPaise: number;
  carriedComputedPaise: number;
  carriedOverridePaise: number | null;
  carriedPaise: number;
  payablePaise: number;
  paidPaise: number;
  balancePaise: number;
  state: string;
  note: string | null;
  lastPaidOn: string | null;
  outletName: string;
  entries: { id: string; kind: string; date: string; amountPaise: number; note: string | null }[];
};

describe('Staff, attendance and salary (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let otherOutletId: string;
  let seededOutletId: string;
  let owner: string;
  let manager: string;
  let chef: string;
  let chefUserId: string;
  let otherChefUserId: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  /** Paid by the month, 30,000. */
  let cook: Person;
  /** Paid by the day, 600. */
  let helper: Person;

  const today = indiaDate();
  const thisMonth = today.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);
  const lastMonthDays = daysInMonth(lastMonth);
  const on = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}`;
  const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const people = (token: string, outlet = outletId, left = false) =>
    http().get('/staff/people').query({ outletId: outlet, ...(left && { left: '1' }) }).set(bearer(token));
  const addPerson = (token: string, body: Record<string, unknown>) =>
    http().post('/staff/people').set(bearer(token)).send({ outletId, ...body });
  const patchPerson = (token: string, id: string, body: Record<string, unknown>) =>
    http().patch(`/staff/people/${id}`).set(bearer(token)).send(body);
  const day = (token: string, date?: string, outlet = outletId) =>
    http().get('/staff/attendance/day').query({ outletId: outlet, ...(date && { date }) }).set(bearer(token));
  const mark = (token: string, date: string, marks: { staffId: string; status: string | null }[], reason: string | null = 'Entered from the register') =>
    http().put('/staff/attendance/day').set(bearer(token)).send({ outletId, date, marks, ...(reason !== null && { reason }) });
  const outletMonth = (token: string, month?: string) =>
    http().get('/staff/attendance/month').query({ outletId, ...(month && { month }) }).set(bearer(token));
  const personMonth = (token: string, id: string, month?: string) =>
    http().get(`/staff/people/${id}/attendance`).query(month ? { month } : {}).set(bearer(token));
  const salaryList = (token: string, month?: string) =>
    http().get('/staff/salary').query({ outletId, ...(month && { month }) }).set(bearer(token));
  const salary = (token: string, id: string, month?: string) =>
    http().get(`/staff/people/${id}/salary`).query(month ? { month } : {}).set(bearer(token));
  const saveSalary = (token: string, id: string, month: string, body: Record<string, unknown>) =>
    http()
      .put(`/staff/people/${id}/salary/${month}`)
      .set(bearer(token))
      .send({ overtimeHours: 0, overtimePaise: 0, bonusPaise: 0, deductionsPaise: 0, dueOverridePaise: null, carriedOverridePaise: null, ...body });
  const addEntry = (token: string, id: string, body: Record<string, unknown>) =>
    http().post(`/staff/people/${id}/pay-entries`).set(bearer(token)).send(body);

  async function cleanUp() {
    const db = prisma.client;
    const names = [MANAGER_NAME, CHEF_NAME, OTHER_CHEF_NAME];
    await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { user: { name: { in: names } } }] } });
    // Memberships go with their user.
    await db.user.deleteMany({ where: { name: { in: names } } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    for (const code of [OUTLET_CODE, OTHER_OUTLET_CODE]) {
      const outlet = await db.outlet.findUnique({ where: { code }, select: { id: true } });
      if (!outlet) continue;
      // The Owner's corrections are written to the audit log, which is not tied to the person's row.
      const staff = await db.staffMember.findMany({ where: { outletId: outlet.id }, select: { id: true } });
      await db.auditLog.deleteMany({ where: { entityId: { in: [outlet.id, ...staff.map((row) => row.id)] } } });
      // Attendance, pay records and pay entries go with their person.
      await db.staffMember.deleteMany({ where: { outletId: outlet.id } });
      // A server running alongside may have kept a score for the outlet.
      await db.hygieneScoreSnapshot.deleteMany({ where: { outletId: outlet.id } });
      await db.outlet.delete({ where: { id: outlet.id } });
    }
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  }

  async function pinLogin(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return session.body.token as string;
  }

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const session = await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200);
    return session.body.token as string;
  }

  /** A throwaway login at one of the throwaway outlets, made by the Owner as in the app. */
  async function newLogin(name: string, role: 'MANAGER' | 'HEAD_CHEF', outlet: string, code: string) {
    const made = await http().post('/restaurant-users').set(bearer(owner)).send({ name, role, outletId: outlet }).expect(201);
    return { token: await pinLogin(code, made.body.pin as string), userId: made.body.user.id as string };
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();

    const seeded = await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    seededOutletId = seeded.id;
    const outlet = (name: string, code: string) =>
      prisma.client.outlet.create({ data: { organizationId: seeded.organizationId, name, code, address: 'Test Road' } });
    outletId = (await outlet('E2E staff outlet', OUTLET_CODE)).id;
    otherOutletId = (await outlet('E2E staff outlet two', OTHER_OUTLET_CODE)).id;

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    manager = (await newLogin(MANAGER_NAME, 'MANAGER', outletId, OUTLET_CODE)).token;
    ({ token: chef, userId: chefUserId } = await newLogin(CHEF_NAME, 'HEAD_CHEF', outletId, OUTLET_CODE));
    otherChefUserId = (await newLogin(OTHER_CHEF_NAME, 'HEAD_CHEF', otherOutletId, OTHER_OUTLET_CODE)).userId;
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
  });

  afterAll(async () => {
    app.get(AttendanceClock).setForTest(null);
    await cleanUp();
    await app.close();
  });

  // ───────────────────────── People ─────────────────────────

  it('lets the Owner and the Manager add people, paid by the month or by the day', async () => {
    await addPerson(manager, { name: 'A', payType: 'MONTHLY', payPaise: rupees(30000) }).expect(400);
    await addPerson(manager, { name: 'E2E Cook', payType: 'WEEKLY', payPaise: rupees(30000) }).expect(400);
    await addPerson(manager, { name: 'E2E Cook', payType: 'MONTHLY', payPaise: 30000.5 }).expect(400);
    await addPerson(manager, { name: 'E2E Cook', payType: 'MONTHLY', payPaise: rupees(30000), phone: 'call me' }).expect(400);

    cook = (
      await addPerson(manager, { name: 'E2E Cook', jobTitle: 'Tandoor cook', phone: '9876543210', payType: 'MONTHLY', payPaise: rupees(30000), joinedOn: on(lastMonth, 1) }).expect(201)
    ).body as Person;
    expect(cook).toMatchObject({
      name: 'E2E Cook',
      jobTitle: 'Tandoor cook',
      isActive: true,
      // Both started at the beginning of last month: the Owner gives the real date when it is not today.
      joinedOn: on(lastMonth, 1),
      countedFrom: on(lastMonth, 1),
      leftOn: null,
      pay: { payType: 'MONTHLY', payPaise: rupees(30000) },
      hasRecords: false,
    });
    helper = (await addPerson(owner, { name: 'E2E Helper', payType: 'DAILY', payPaise: rupees(600), weeklyOffDay: 0, joinedOn: on(lastMonth, 1) }).expect(201)).body as Person;
    expect(helper.pay).toEqual({ payType: 'DAILY', payPaise: rupees(600) });

    const list = (await people(owner).expect(200)).body as Person[];
    expect(list.map((person) => person.name)).toEqual(['E2E Cook', 'E2E Helper']);
  });

  it('refuses ECCS staff everything, salaries included', async () => {
    for (const token of [admin, supervisor]) {
      await people(token).expect(403);
      await addPerson(token, { name: 'E2E Intruder', payType: 'MONTHLY', payPaise: 1 }).expect(403);
      await patchPerson(token, cook.id, { name: 'E2E Renamed' }).expect(403);
      await http().delete(`/staff/people/${cook.id}`).set(bearer(token)).expect(403);
      await day(token).expect(403);
      await mark(token, today, [{ staffId: cook.id, status: 'PRESENT' }]).expect(403);
      await outletMonth(token).expect(403);
      await personMonth(token, cook.id).expect(403);
      await salaryList(token).expect(403);
      await salary(token, cook.id).expect(403);
      await saveSalary(token, cook.id, thisMonth, {}).expect(403);
      await addEntry(token, cook.id, { kind: 'ADVANCE', month: thisMonth, date: today, amountPaise: 100 }).expect(403);
    }
  });

  it('shows the Head Chef the names but no pay, and nothing of the salary tracker', async () => {
    const list = (await people(chef).expect(200)).body as Person[];
    expect(list).toHaveLength(2);
    expect(list.every((person) => person.pay === null)).toBe(true);

    await addPerson(chef, { name: 'E2E Intruder', payType: 'MONTHLY', payPaise: 1 }).expect(403);
    await patchPerson(chef, cook.id, { name: 'E2E Renamed' }).expect(403);
    await outletMonth(chef).expect(403);
    await personMonth(chef, cook.id).expect(403);
    await salaryList(chef).expect(403);
    await salary(chef, cook.id).expect(403);
    await saveSalary(chef, cook.id, thisMonth, {}).expect(403);
    await addEntry(chef, cook.id, { kind: 'ADVANCE', month: thisMonth, date: today, amountPaise: 100 }).expect(403);
  });

  it('keeps a Manager to their own outlet, and another restaurant out altogether', async () => {
    // The throwaway Manager at the sample outlet of the same restaurant, and at the second throwaway outlet.
    await people(manager, seededOutletId).expect(403);
    await people(manager, otherOutletId).expect(403);
    await day(manager, undefined, otherOutletId).expect(403);
    await http().get('/staff/salary').query({ outletId: otherOutletId }).set(bearer(manager)).expect(403);
    await http().post('/staff/people').set(bearer(manager)).send({ outletId: otherOutletId, name: 'E2E Elsewhere', payType: 'DAILY', payPaise: 1 }).expect(403);

    // A Manager of another restaurant: this outlet is refused, and its people look as if they do not exist.
    await people(otherManager).expect(403);
    await day(otherManager).expect(403);
    await salaryList(otherManager).expect(403);
    await salary(otherManager, cook.id).expect(404);
    await personMonth(otherManager, cook.id).expect(404);
    await patchPerson(otherManager, cook.id, { name: 'E2E Renamed' }).expect(404);
    await mark(otherManager, today, [{ staffId: cook.id, status: 'ABSENT' }]).expect(403);

    // The Owner covers every outlet of the restaurant.
    await people(owner, otherOutletId).expect(200);
  });

  it('links a person to an app login of the same outlet, and a login to one person only', async () => {
    const linked = (await patchPerson(manager, helper.id, { userId: chefUserId }).expect(200)).body as Person;
    expect(linked).toMatchObject({ userId: chefUserId, userName: CHEF_NAME });
    await patchPerson(manager, cook.id, { userId: chefUserId }).expect(400);
    await patchPerson(owner, cook.id, { userId: otherChefUserId }).expect(400);
    // Saving the same link again is not a clash with itself.
    await patchPerson(manager, helper.id, { userId: chefUserId, jobTitle: 'Kitchen helper' }).expect(200);
  });

  // ───────────────────────── Attendance ─────────────────────────

  it("shows the Head Chef today's sheet only, and lets nobody but the Owner set a day by hand", async () => {
    // "Today" on the sheet is the attendance day, which runs from 4 am to 4 am.
    const sheetDay = attendanceDayOf(new Date());
    const sheet = (await day(chef).expect(200)).body as Day;
    expect(sheet).toMatchObject({ date: sheetDay, today: sheetDay, earliestDate: sheetDay, editable: false });
    expect(sheet.people.map((person) => [person.name, person.status])).toEqual([
      ['E2E Cook', null],
      ['E2E Helper', null],
    ]);
    await day(chef, addDays(sheetDay, -1)).expect(403);

    // Hand-marking ended with face attendance: the Head Chef and the Manager are refused, today or any day.
    const everyone = [
      { staffId: cook.id, status: 'PRESENT' },
      { staffId: helper.id, status: 'PRESENT' },
    ];
    for (const token of [chef, manager]) {
      await mark(token, today, everyone).expect(403);
      await mark(token, addDays(today, -1), [{ staffId: cook.id, status: 'ABSENT' }]).expect(403);
    }
    expect(((await day(manager, today).expect(200)).body as Day).editable).toBe(false);

    // The Owner can set a day, and must say why.
    expect((await mark(owner, today, everyone, null).expect(400)).body.code).toBe('REASON_REQUIRED');
    expect((await mark(owner, today, everyone, 'ok').expect(400)).body.code).toBe('REASON_REQUIRED');
    const marked = (await mark(owner, today, everyone).expect(200)).body as Day;
    expect(marked.editable).toBe(true);
    expect(marked.people.every((person) => person.status === 'PRESENT' && person.markedByName !== null)).toBe(true);

    // Changing one afterwards.
    const changed = (await mark(owner, today, [{ staffId: helper.id, status: 'HALF_DAY' }]).expect(200)).body as Day;
    expect(changed.people.find((person) => person.staffId === helper.id)!.status).toBe('HALF_DAY');
    expect(changed.people.find((person) => person.staffId === cook.id)!.status).toBe('PRESENT');
  });

  it('refuses a day that has not come, a day too long ago, and people not on this staff', async () => {
    const tomorrow = addDays(today, 1);
    for (const token of [owner, manager, chef]) await day(token, tomorrow).expect(400);
    await mark(owner, tomorrow, [{ staffId: cook.id, status: 'PRESENT' }]).expect(400);
    await day(owner, 'yesterday').expect(400);

    // Back to the first day of last month, and no further.
    const tooOld = on(shiftMonth(thisMonth, -2), 15);
    await mark(owner, tooOld, [{ staffId: cook.id, status: 'ABSENT' }]).expect(400);
    const old = (await day(manager, tooOld).expect(200)).body as Day;
    expect(old).toMatchObject({ editable: false, earliestDate: on(lastMonth, 1) });

    await mark(owner, today, [{ staffId: 'no-such-person', status: 'PRESENT' }]).expect(400);
    await mark(owner, today, [{ staffId: cook.id, status: 'ON_HOLIDAY' }]).expect(400);
    await mark(owner, today, []).expect(400);

    // Someone who joins today was not on the staff yesterday.
    const joiner = (await addPerson(manager, { name: 'E2E Joiner', payType: 'DAILY', payPaise: rupees(500), joinedOn: today }).expect(201)).body as Person;
    const yesterday = addDays(today, -1);
    if (yesterday >= on(lastMonth, 1)) {
      await mark(owner, yesterday, [{ staffId: joiner.id, status: 'PRESENT' }]).expect(400);
      const sheet = (await day(manager, yesterday).expect(200)).body as Day;
      expect(sheet.people.some((person) => person.staffId === joiner.id)).toBe(false);
    }
    // Added by mistake and with no records yet, so they can be removed outright.
    await http().delete(`/staff/people/${joiner.id}`).set(bearer(chef)).expect(403);
    await http().delete(`/staff/people/${joiner.id}`).set(bearer(manager)).expect(204);
    expect(((await people(manager, outletId, true).expect(200)).body as Person[]).some((person) => person.id === joiner.id)).toBe(false);
  });

  it('lets the Owner set and correct days of last month', async () => {
    // The cook: absent on the 2nd and 3rd, a half day on the 4th. The helper: present 1st to 10th,
    // a half day on the 11th, leave on the 12th, absent on the 13th.
    await mark(owner, on(lastMonth, 2), [{ staffId: cook.id, status: 'ABSENT' }]).expect(200);
    await mark(owner, on(lastMonth, 3), [{ staffId: cook.id, status: 'ABSENT' }]).expect(200);
    await mark(owner, on(lastMonth, 4), [{ staffId: cook.id, status: 'HALF_DAY' }]).expect(200);
    for (let dayNumber = 1; dayNumber <= 10; dayNumber += 1) {
      await mark(owner, on(lastMonth, dayNumber), [{ staffId: helper.id, status: 'PRESENT' }]).expect(200);
    }
    await mark(owner, on(lastMonth, 11), [{ staffId: helper.id, status: 'HALF_DAY' }]).expect(200);
    await mark(owner, on(lastMonth, 12), [{ staffId: helper.id, status: 'LEAVE' }]).expect(200);
    await mark(owner, on(lastMonth, 13), [{ staffId: helper.id, status: 'ABSENT' }]).expect(200);

    // A correction: the cook was there on the 3rd after all. And a mark made by mistake is taken away.
    const corrected = (await mark(owner, on(lastMonth, 3), [{ staffId: cook.id, status: 'PRESENT' }]).expect(200)).body as Day;
    expect(corrected.people.find((person) => person.staffId === cook.id)).toMatchObject({ status: 'PRESENT' });
    await mark(owner, on(lastMonth, 20), [{ staffId: cook.id, status: 'LEAVE' }]).expect(200);
    const cleared = (await mark(owner, on(lastMonth, 20), [{ staffId: cook.id, status: null }]).expect(200)).body as Day;
    expect(cleared.people.find((person) => person.staffId === cook.id)!.status).toBeNull();
  });

  it('adds up the month for the outlet and for one person', async () => {
    const month = (await outletMonth(manager, lastMonth).expect(200)).body as { month: string; people: { staffId: string; totals: Totals }[] };
    expect(month.month).toBe(lastMonth);
    const cookTotals = month.people.find((person) => person.staffId === cook.id)!.totals;
    expect(cookTotals).toMatchObject({
      daysInMonth: lastMonthDays,
      countedDays: lastMonthDays,
      present: 1,
      absent: 1,
      halfDay: 1,
      leave: 0,
      weeklyOff: 0,
      notMarked: lastMonthDays - 3,
    });
    const helperTotals = month.people.find((person) => person.staffId === helper.id)!.totals;
    expect(helperTotals).toMatchObject({ present: 10, halfDay: 1, leave: 1, absent: 1 });
    // The helper's usual day off is Sunday: unmarked Sundays count as the weekly off, the rest as not marked.
    expect(helperTotals.weeklyOff).toBeGreaterThanOrEqual(2);
    expect(helperTotals.weeklyOff + helperTotals.notMarked).toBe(lastMonthDays - 13);

    const one = (await personMonth(owner, cook.id, lastMonth).expect(200)).body as {
      marks: Record<string, string>;
      totals: Totals;
      checklistsHandedIn: number | null;
      staff: Person;
    };
    expect(one.marks).toEqual({ [on(lastMonth, 2)]: 'ABSENT', [on(lastMonth, 3)]: 'PRESENT', [on(lastMonth, 4)]: 'HALF_DAY' });
    expect(one.totals).toEqual(cookTotals);
    // No app login linked, so nothing is said about checklists; the helper is linked and has handed in none.
    expect(one.checklistsHandedIn).toBeNull();
    expect((await personMonth(owner, helper.id, lastMonth).expect(200)).body.checklistsHandedIn).toBe(0);

    await outletMonth(manager, shiftMonth(thisMonth, 1)).expect(400);
    await outletMonth(manager, 'October').expect(400);
  });

  // ───────────────────────── Salary tracker ─────────────────────────

  it("works out last month's pay from the attendance, by the month and by the day", async () => {
    const cookPay = (await salary(manager, cook.id, lastMonth).expect(200)).body as Salary;
    // 30,000 for the month, less one absence and one half day, divided by the days in the month.
    const cookDue = Math.round((rupees(30000) * (lastMonthDays - 1.5)) / lastMonthDays);
    expect(cookPay).toMatchObject({
      month: lastMonth,
      beforeRecords: false,
      payType: 'MONTHLY',
      ratePaise: rupees(30000),
      paidDays: lastMonthDays - 1.5,
      divisor: lastMonthDays,
      computedDuePaise: cookDue,
      dueOverridePaise: null,
      duePaise: cookDue,
      netPaise: cookDue,
      carriedPaise: 0,
      payablePaise: cookDue,
      paidPaise: 0,
      balancePaise: cookDue,
      state: 'DUE',
      outletName: 'E2E staff outlet',
      entries: [],
    });

    // 600 a day: ten days, a half day and a day of leave. The absence and the unmarked days earn nothing.
    const helperPay = (await salary(owner, helper.id, lastMonth).expect(200)).body as Salary;
    expect(helperPay).toMatchObject({ payType: 'DAILY', paidDays: 11.5, divisor: null, computedDuePaise: rupees(6900), balancePaise: rupees(6900) });

    const list = (await salaryList(manager, lastMonth).expect(200)).body as { people: Salary[] };
    expect(list.people.map((person) => [person.staffId, person.balancePaise])).toEqual([
      [cook.id, cookDue],
      [helper.id, rupees(6900)],
    ]);
    // Nothing was kept before last month.
    expect((await salary(owner, cook.id, shiftMonth(lastMonth, -1)).expect(200)).body).toMatchObject({ beforeRecords: true, balancePaise: 0 });
    await salary(owner, cook.id, shiftMonth(thisMonth, 1)).expect(400);
  });

  it('records advances and payments one by one, and overtime, bonus and deductions', async () => {
    const cookDue = Math.round((rupees(30000) * (lastMonthDays - 1.5)) / lastMonthDays);
    await addEntry(manager, cook.id, { kind: 'ADVANCE', month: lastMonth, date: addDays(today, 1), amountPaise: rupees(2000) }).expect(400);
    await addEntry(manager, cook.id, { kind: 'ADVANCE', month: lastMonth, date: on(lastMonth, 10), amountPaise: 0 }).expect(400);
    await addEntry(manager, cook.id, { kind: 'LOAN', month: lastMonth, date: on(lastMonth, 10), amountPaise: 100 }).expect(400);
    await addEntry(manager, cook.id, { kind: 'ADVANCE', month: shiftMonth(thisMonth, 1), date: today, amountPaise: 100 }).expect(400);

    await addEntry(manager, cook.id, { kind: 'ADVANCE', month: lastMonth, date: on(lastMonth, 10), amountPaise: rupees(2000), note: 'For the festival' }).expect(201);
    await addEntry(manager, cook.id, { kind: 'ADVANCE', month: lastMonth, date: on(lastMonth, 18), amountPaise: rupees(1500) }).expect(201);
    await saveSalary(manager, cook.id, lastMonth, { overtimePaise: -1 }).expect(400);
    await saveSalary(manager, cook.id, lastMonth, { overtimeHours: 6, overtimePaise: rupees(900), bonusPaise: rupees(500), deductionsPaise: rupees(200), note: 'Uniform' }).expect(200);
    const paid = (await addEntry(owner, cook.id, { kind: 'PAYMENT', month: lastMonth, date: today, amountPaise: rupees(10000) }).expect(201)).body as Salary;

    const net = cookDue + rupees(900) + rupees(500) - rupees(3500) - rupees(200);
    expect(paid).toMatchObject({
      overtimeHours: 6,
      overtimePaise: rupees(900),
      bonusPaise: rupees(500),
      advancesPaise: rupees(3500),
      deductionsPaise: rupees(200),
      netPaise: net,
      paidPaise: rupees(10000),
      lastPaidOn: today,
      balancePaise: net - rupees(10000),
      state: 'PART_PAID',
      note: 'Uniform',
    });
    expect(paid.entries.map((entry) => [entry.kind, entry.date, entry.amountPaise, entry.note])).toEqual([
      ['ADVANCE', on(lastMonth, 10), rupees(2000), 'For the festival'],
      ['ADVANCE', on(lastMonth, 18), rupees(1500), null],
      ['PAYMENT', today, rupees(10000), null],
    ]);

    // The copies kept on the month's record follow.
    const record = await prisma.client.salaryRecord.findFirstOrThrow({ where: { staffMemberId: cook.id } });
    expect(record).toMatchObject({ basePaise: rupees(30000), payType: 'MONTHLY', advancesPaise: rupees(3500), netPaise: net, paidPaise: rupees(10000) });
  });

  it('carries the balance into this month, and lets the Owner put their own figures in', async () => {
    const cookDue = Math.round((rupees(30000) * (lastMonthDays - 1.5)) / lastMonthDays);
    const owedLastMonth = cookDue + rupees(900) + rupees(500) - rupees(3500) - rupees(200) - rupees(10000);
    // This month so far: every day up to today, at 30,000 divided by the days in this month.
    const dayOfMonth = Number(today.slice(8));
    const soFar = Math.round((rupees(30000) * dayOfMonth) / daysInMonth(thisMonth));

    const now = (await salary(manager, cook.id).expect(200)).body as Salary;
    expect(now).toMatchObject({
      month: thisMonth,
      computedDuePaise: soFar,
      carriedComputedPaise: owedLastMonth,
      carriedPaise: owedLastMonth,
      payablePaise: soFar + owedLastMonth,
      balancePaise: soFar + owedLastMonth,
    });
    expect(now.totals).toMatchObject({ countedDays: dayOfMonth, present: 1 });

    // The Owner's own figure for last month's pay replaces the app's, which stays on show.
    const overridden = (await saveSalary(owner, cook.id, lastMonth, { overtimeHours: 6, overtimePaise: rupees(900), bonusPaise: rupees(500), deductionsPaise: rupees(200), dueOverridePaise: rupees(29000) }).expect(200)).body as Salary;
    expect(overridden).toMatchObject({ computedDuePaise: cookDue, dueOverridePaise: rupees(29000), duePaise: rupees(29000) });
    // And their own carried figure for this month replaces what last month left.
    const fresh = (await saveSalary(owner, cook.id, thisMonth, { carriedOverridePaise: -rupees(1000) }).expect(200)).body as Salary;
    expect(fresh).toMatchObject({
      carriedComputedPaise: overridden.balancePaise,
      carriedOverridePaise: -rupees(1000),
      carriedPaise: -rupees(1000),
      payablePaise: soFar - rupees(1000),
    });
    // Taking the override away goes back to the app's figure.
    const back = (await saveSalary(owner, cook.id, thisMonth, {}).expect(200)).body as Salary;
    expect(back).toMatchObject({ carriedOverridePaise: null, carriedPaise: overridden.balancePaise });
  });

  it('carries advances that were more than the pay forward as overpaid, and takes back an entry made by mistake', async () => {
    const over = (await addEntry(manager, helper.id, { kind: 'ADVANCE', month: lastMonth, date: on(lastMonth, 5), amountPaise: rupees(8000) }).expect(201)).body as Salary;
    expect(over).toMatchObject({ duePaise: rupees(6900), netPaise: -rupees(1100), balancePaise: -rupees(1100), state: 'OVERPAID' });
    // Half a day today at 600.
    expect((await salary(manager, helper.id).expect(200)).body).toMatchObject({ computedDuePaise: rupees(300), carriedPaise: -rupees(1100), balancePaise: -rupees(800) });

    await http().delete(`/staff/pay-entries/${over.entries[0]!.id}`).set(bearer(chef)).expect(403);
    await http().delete(`/staff/pay-entries/${over.entries[0]!.id}`).set(bearer(otherManager)).expect(404);
    const undone = (await http().delete(`/staff/pay-entries/${over.entries[0]!.id}`).set(bearer(manager)).expect(200)).body as Salary;
    expect(undone).toMatchObject({ advancesPaise: 0, balancePaise: rupees(6900), state: 'DUE', entries: [] });
  });

  it('keeps an earlier month at the pay it had when the pay is changed', async () => {
    const before = (await salary(owner, helper.id, lastMonth).expect(200)).body as Salary;
    const raised = (await patchPerson(owner, helper.id, { payPaise: rupees(700) }).expect(200)).body as Person;
    expect(raised.pay).toEqual({ payType: 'DAILY', payPaise: rupees(700) });

    expect((await salary(owner, helper.id, lastMonth).expect(200)).body).toMatchObject({ ratePaise: rupees(600), duePaise: before.duePaise });
    // This month takes the new pay: half a day today at 700.
    expect((await salary(owner, helper.id).expect(200)).body).toMatchObject({ ratePaise: rupees(700), computedDuePaise: rupees(350) });
  });

  // ───────────────────────── Leaving ─────────────────────────

  it('never deletes a person who has records: they are marked as having left', async () => {
    await http().delete(`/staff/people/${cook.id}`).set(bearer(owner)).expect(409);
    await patchPerson(manager, cook.id, { leftOn: addDays(today, 1) }).expect(400);

    const yesterday = addDays(today, -1);
    // Their last day was yesterday (or today, on the first of a month with nothing earlier to mark).
    const lastDay = yesterday >= on(lastMonth, 1) ? yesterday : today;
    const left = (await patchPerson(manager, cook.id, { leftOn: lastDay }).expect(200)).body as Person;
    expect(left).toMatchObject({ isActive: false, leftOn: lastDay, hasRecords: true });

    expect(((await people(manager).expect(200)).body as Person[]).some((person) => person.id === cook.id)).toBe(false);
    expect(((await people(manager, outletId, true).expect(200)).body as Person[]).some((person) => person.id === cook.id)).toBe(true);
    if (lastDay !== today) {
      // Not on today's sheet any more, and cannot be marked today; still on the sheet of a day they worked.
      expect(((await day(manager).expect(200)).body as Day).people.some((person) => person.staffId === cook.id)).toBe(false);
      await mark(owner, today, [{ staffId: cook.id, status: 'PRESENT' }]).expect(400);
      expect(((await day(manager, lastDay).expect(200)).body as Day).people.some((person) => person.staffId === cook.id)).toBe(true);
    }
    // What they are owed is still on the books.
    const owed = (await salary(owner, cook.id, lastMonth).expect(200)).body as Salary;
    expect(owed.balancePaise).toBeGreaterThan(0);
    expect(((await salaryList(owner).expect(200)).body as { people: Salary[] }).people.some((person) => person.staffId === cook.id)).toBe(true);

    // And they can come back.
    const returned = (await patchPerson(owner, cook.id, { leftOn: null }).expect(200)).body as Person;
    expect(returned).toMatchObject({ isActive: true, leftOn: null });
  });

  // ───────────────────────── Pay starts when the person joined; the divisor ─────────────────────────
  //
  // These move the attendance clock to August 2026 (a 31-day month, over long ago), so the
  // sums are the same whenever the suite runs. The clock is let go again at the end.

  describe('pay from the joining day, and the days a salary is divided by', () => {
    const AUGUST = '2026-08';
    const SEPTEMBER = '2026-09';
    const at = (date: string, time = '10:00') => app.get(AttendanceClock).setForTest(new Date(`${date}T${time}:00+05:30`));
    const settings = (token: string) => http().get(`/attendance/settings/${outletId}`).set(bearer(token));
    const saveSettings = (token: string, body: Record<string, unknown>) =>
      http().put(`/attendance/settings/${outletId}`).set(bearer(token)).send({ fullDayMinutes: 480, halfDayMinutes: 240, ...body });
    let newcomer: Person;

    afterAll(() => app.get(AttendanceClock).setForTest(null));

    it('counts a new person from the day they were added, not from the 1st', async () => {
      // Added on 12 August with no joining date: the server puts that day in.
      at('2026-08-12');
      newcomer = (await addPerson(owner, { name: 'E2E Newcomer', payType: 'MONTHLY', payPaise: rupees(31000) }).expect(201)).body as Person;
      expect(newcomer).toMatchObject({ joinedOn: '2026-08-12', countedFrom: '2026-08-12' });

      // On the 20th: nine days so far (the 12th to the 20th) of a 31-day month at 31,000, so 9,000. Not 20/31.
      at('2026-08-20');
      // Their first day on record. (A person's pay records begin with the first month that has any attendance.)
      await mark(owner, '2026-08-12', [{ staffId: newcomer.id, status: 'PRESENT' }]).expect(200);
      const soFar = (await salary(owner, newcomer.id, AUGUST).expect(200)).body as Salary;
      expect(soFar).toMatchObject({
        joinedOn: '2026-08-12',
        countedFrom: '2026-08-12',
        paidDays: 9,
        divisor: 31,
        dayRatePaise: rupees(1000),
        computedDuePaise: rupees(9000),
        balancePaise: rupees(9000),
      });
      expect(soFar.totals).toMatchObject({ daysInMonth: 31, countedDays: 9 });
      // They were not on the staff on the 11th: not on that day's sheet, and that day cannot be set for them.
      expect(((await day(owner, '2026-08-11').expect(200)).body as Day).people.some((person) => person.staffId === newcomer.id)).toBe(false);
      await mark(owner, '2026-08-11', [{ staffId: newcomer.id, status: 'PRESENT' }]).expect(400);
      // The month's attendance counts the same nine days.
      expect((await personMonth(owner, newcomer.id, AUGUST).expect(200)).body.totals).toMatchObject({ countedDays: 9 });

      // After the month is over: the 12th to the 31st, twenty days, 20,000.
      at('2026-09-05');
      expect((await salary(owner, newcomer.id, AUGUST).expect(200)).body).toMatchObject({ paidDays: 20, computedDuePaise: rupees(20000) });
    });

    it('lets the Owner give an earlier joining date, and counts someone with none from the day they were added', async () => {
      // The person really started on the 5th: 27 days of August.
      const earlier = (await patchPerson(owner, newcomer.id, { joinedOn: '2026-08-05' }).expect(200)).body as Person;
      expect(earlier).toMatchObject({ joinedOn: '2026-08-05', countedFrom: '2026-08-05' });
      expect((await salary(owner, newcomer.id, AUGUST).expect(200)).body).toMatchObject({ paidDays: 27, computedDuePaise: rupees(27000) });

      // Someone left without a joining date (as people added before this change were): counted from the
      // day their record was made. Here that is made to be 12 August.
      await prisma.client.staffMember.update({ where: { id: newcomer.id }, data: { joinedOn: null, createdAt: new Date('2026-08-12T10:00:00+05:30') } });
      const none = ((await people(owner).expect(200)).body as Person[]).find((person) => person.id === newcomer.id)!;
      expect(none).toMatchObject({ joinedOn: null, countedFrom: '2026-08-12' });
      expect((await salary(owner, newcomer.id, AUGUST).expect(200)).body).toMatchObject({ joinedOn: null, countedFrom: '2026-08-12', paidDays: 20, computedDuePaise: rupees(20000) });
      await patchPerson(owner, newcomer.id, { joinedOn: '2026-08-12' }).expect(200);
    });

    it('lets the Owner alone choose the days a salary is divided by, and the Manager read it', async () => {
      expect((await settings(manager).expect(200)).body).toMatchObject({ salaryDivisorDays: null, isDefault: true });
      await settings(chef).expect(403);
      await saveSettings(manager, { salaryDivisorDays: 30 }).expect(403);
      for (const wrong of [19, 32, 26.5, '30']) await saveSettings(owner, { salaryDivisorDays: wrong }).expect(400);

      expect((await saveSettings(owner, { salaryDivisorDays: 30 }).expect(200)).body).toMatchObject({ salaryDivisorDays: 30, fullDayMinutes: 480 });
      // An app built before the setting existed does not send it: it stays as it is.
      expect((await saveSettings(owner, {}).expect(200)).body).toMatchObject({ salaryDivisorDays: 30 });
      expect((await settings(manager).expect(200)).body).toMatchObject({ salaryDivisorDays: 30 });
      expect((await saveSettings(owner, { salaryDivisorDays: null }).expect(200)).body).toMatchObject({ salaryDivisorDays: null });
    });

    it('works a month out with the divisor chosen: calendar days, always 30, always 26', async () => {
      // One absence, on the 20th. 31,000 a month, joined on the 12th: 20 of 31 days is 20,000 before the absence.
      await mark(owner, '2026-08-20', [{ staffId: newcomer.id, status: 'ABSENT' }]).expect(200);
      const august = async () => (await salary(manager, newcomer.id, AUGUST).expect(200)).body as Salary;

      // The days in the month: 31,000 ÷ 31 = 1,000 a day, so 19,000.
      expect(await august()).toMatchObject({ divisor: 31, divisorKept: false, dayRatePaise: rupees(1000), lostDays: 1, paidDays: 19, computedDuePaise: rupees(19000) });
      // Always 30: 31,000 ÷ 30 = 1,033.33 a day, so 20,000 − 1,033.33.
      await saveSettings(owner, { salaryDivisorDays: 30 }).expect(200);
      expect(await august()).toMatchObject({ divisor: 30, divisorKept: false, dayRatePaise: 103_333, lostDays: 1, paidDays: 18.35, computedDuePaise: 1_896_667 });
      // Always 26: 31,000 ÷ 26 = 1,192.31 a day, so 20,000 − 1,192.31.
      await saveSettings(owner, { salaryDivisorDays: 26 }).expect(200);
      expect(await august()).toMatchObject({ divisor: 26, dayRatePaise: 119_231, paidDays: 15.77, computedDuePaise: 1_880_769 });
      // The outlet's list for the month says the same.
      const list = (await salaryList(manager, AUGUST).expect(200)).body as { people: Salary[] };
      expect(list.people.find((person) => person.staffId === newcomer.id)).toMatchObject({ divisor: 26, computedDuePaise: 1_880_769 });

      // A full month with no absence is the whole salary whatever the divisor. (The cook left and came back
      // above; in August they were not yet on the staff, so a second person is used.)
      const steady = (await addPerson(owner, { name: 'E2E Steady', payType: 'MONTHLY', payPaise: rupees(31000), joinedOn: '2026-08-01' }).expect(201)).body as Person;
      await mark(owner, '2026-08-03', [{ staffId: steady.id, status: 'PRESENT' }]).expect(200);
      for (const days of [null, 30, 26, 28]) {
        await saveSettings(owner, { salaryDivisorDays: days }).expect(200);
        expect((await salary(owner, steady.id, AUGUST).expect(200)).body).toMatchObject({ divisor: days ?? 31, paidDays: days ?? 31, computedDuePaise: rupees(31000) });
      }
      // Daily-wage staff are not touched by it.
      expect((await salary(owner, helper.id, AUGUST).expect(200)).body).toMatchObject({ divisor: null });
    });

    it('keeps the divisor a month was paid with when the setting is changed afterwards', async () => {
      await saveSettings(owner, { salaryDivisorDays: 30 }).expect(200);
      // An advance does not close the month: it still follows the setting.
      await addEntry(manager, newcomer.id, { kind: 'ADVANCE', month: AUGUST, date: '2026-08-25', amountPaise: rupees(1000) }).expect(201);
      expect((await salary(owner, newcomer.id, AUGUST).expect(200)).body).toMatchObject({ divisor: 30, divisorKept: false });

      // A payment does: August now holds 30.
      const paid = (await addEntry(owner, newcomer.id, { kind: 'PAYMENT', month: AUGUST, date: '2026-09-05', amountPaise: rupees(5000) }).expect(201)).body as Salary;
      expect(paid).toMatchObject({ divisor: 30, divisorKept: true, computedDuePaise: 1_896_667, paidPaise: rupees(5000) });
      const record = await prisma.client.salaryRecord.findFirstOrThrow({ where: { staffMemberId: newcomer.id } });
      expect(record).toMatchObject({ divisorDays: 30, basePaise: rupees(31000), payType: 'MONTHLY' });

      // The Owner moves the outlet to 26. August is not rewritten; September, still open, follows.
      await saveSettings(owner, { salaryDivisorDays: 26 }).expect(200);
      const august = (await salary(owner, newcomer.id, AUGUST).expect(200)).body as Salary;
      expect(august).toMatchObject({ divisor: 30, divisorKept: true, computedDuePaise: 1_896_667 });
      const september = (await salary(owner, newcomer.id, SEPTEMBER).expect(200)).body as Salary;
      expect(september).toMatchObject({ divisor: 26, divisorKept: false, carriedPaise: august.balancePaise });
      // Five days of September's thirty so far.
      expect(september.computedDuePaise).toBe(Math.round((rupees(31000) * 5) / 30));

      // Saving a month (overtime, a note...) keeps the divisor in force then, too.
      const saved = (await saveSalary(owner, newcomer.id, SEPTEMBER, { note: 'Checked' }).expect(200)).body as Salary;
      expect(saved).toMatchObject({ divisor: 26, divisorKept: true });
      await saveSettings(owner, { salaryDivisorDays: null }).expect(200);
      expect((await salary(owner, newcomer.id, SEPTEMBER).expect(200)).body).toMatchObject({ divisor: 26, divisorKept: true });
      expect((await salary(owner, newcomer.id, AUGUST).expect(200)).body).toMatchObject({ divisor: 30, divisorKept: true });
    });
  });
});
