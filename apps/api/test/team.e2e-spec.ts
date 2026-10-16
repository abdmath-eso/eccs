// ECCS's own team (Stage C, 16 Oct 2026): who sees the Team page and salaries (the Super
// Admin; the Ops Manager without salaries; a BDE, a Supervisor and a restaurant user
// refused); adding, changing and marking as left (the login stops working; open leads are
// handed over first); leave; presence read from what each person did (a lead step logged
// offline counts on the day it was done; a Supervisor's visit arrival; the Ops Manager's
// changes in the activity log); a BDE's cards from Sales' own bdeWeek, agreeing with the
// Sales page; follow-ups on time from the next steps' history; What the app found; the
// Finance page's Salaries line made from Team with nothing counted twice; and nothing of pay
// in the activity log.
//
// Everything is a throwaway made here (logins, a client with one outlet and its visits,
// leads, activity log rows) and removed again; the sample people are only logged in.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import {
  addDays,
  followUpsOnTime,
  indiaDay,
  indiaMoment,
  monthEnd,
  monthOf,
  monthStart,
  salaryForMonth,
  weekStartOf,
  type ExpenseListDto,
  type FinanceOverviewDto,
  type LeadDetailDto,
  type SalesOverviewDto,
  type TeamListDto,
  type TeamMemberDto,
} from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ActivityLogService } from './../src/activity-log/activity-log.service.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const MARK = 'E2E Team';
const DEVICE = 'e2e-team';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003' };
const MINE = {
  bde: '+919199900071',
  bde2: '+919199900072',
  sup: '+919199900073',
  pay: '+919199900074',
  ops: '+919199900075',
  founder: '+919199900076',
  log: '+919199900077',
  secret: '+919199900079',
};
const OWNER = { code: 'SPICE-JH2K7M', pin: '2580' };
const OUTLET_CODE = 'E2ETM-TEAM01';
// Salaries no log row may ever contain (in paise, and in rupees as a form shows them).
const SECRET_PAY = { added: 3_141_500, changed: 2_718_200 };

describe('Team (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let activity: ActivityLogService;
  let admin: string;
  let ops: string;
  let supervisor: string;
  let owner: string;
  let bdeToken: string;
  const id = { bde: '', bde2: '', sup: '', pay: '', ops: '', founder: '', log: '' };
  let outletId = '';
  let organizationId = '';
  let settingsBefore: number | null = null;
  const insertedLogs: string[] = [];

  const now = () => new Date();
  const today = indiaDate();
  const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const page = async (token: string, userId: string): Promise<TeamMemberDto> => (await http().get(`/team/${userId}`).set(bearer(token)).expect(200)).body;
  const list = async (token: string): Promise<TeamListDto> => (await http().get('/team').set(bearer(token)).expect(200)).body;
  const finance = async (from = monthStart(monthOf(today)), to = today): Promise<FinanceOverviewDto> =>
    (await http().get('/finance/overview').query({ from, to }).set(bearer(admin)).expect(200)).body;
  const addMember = (body: Record<string, unknown>, token = admin) => http().post('/team').set(bearer(token)).send(body);

  async function otpLogin(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    return (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body.token as string;
  }
  async function pinLogin(code: string, pin: string) {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    return (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200)).body.token as string;
  }

  async function cleanUp() {
    const db = prisma.client;
    const users = await db.user.findMany({ where: { phone: { in: Object.values(MINE) } }, select: { id: true } });
    const ids = users.map((user) => user.id);
    await db.lead.deleteMany({ where: { OR: [{ ownerId: { in: ids } }, { businessName: { startsWith: MARK } }] } });
    await db.salesTarget.deleteMany({ where: { userId: { in: ids } } });
    await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { userId: { in: ids } }] } });
    // Their team details, salaries, leave and salary rows go with the logins.
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const ours = { name: { startsWith: MARK } };
    await db.job.deleteMany({ where: { outlet: { organization: ours } } });
    await db.outlet.deleteMany({ where: { organization: ours } });
    await db.organization.deleteMany({ where: ours });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: [...Object.values(PHONES), ...Object.values(MINE)] } } });
    await db.activityLog.deleteMany({ where: { id: { in: insertedLogs } } });
    if (activity) {
      await activity.flush();
      await db.activityLog.deleteMany({ where: { id: { in: activity.recordedForTest() } } });
    }
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    activity = app.get(ActivityLogService);
    await cleanUp();
    settingsBefore = (await prisma.client.teamSettings.findUnique({ where: { id: 'default' } }))?.onTimeTargetPercent ?? null;
    admin = await otpLogin(PHONES.admin);
    ops = await otpLogin(PHONES.ops);
    supervisor = await otpLogin(PHONES.supervisor);
    owner = await pinLogin(OWNER.code, OWNER.pin);

    const db = prisma.client;
    const organization = await db.organization.create({ data: { name: `${MARK} Client` } });
    organizationId = organization.id;
    outletId = (await db.outlet.create({ data: { organizationId, name: `${MARK} Outlet`, code: OUTLET_CODE, address: 'Team Road' } })).id;
  }, 90_000);

  afterAll(async () => {
    activity?.setForTest({ on: false });
    if (prisma) {
      if (settingsBefore === null) await prisma.client.teamSettings.deleteMany({ where: { id: 'default' } });
      else await prisma.client.teamSettings.update({ where: { id: 'default' }, data: { onTimeTargetPercent: settingsBefore } });
      await cleanUp();
    }
    await app?.close();
  });

  // ───────────────────────── Adding and who sees what ─────────────────────────

  describe('adding a team member', () => {
    it('makes their ECCS login, which works with the one-time code as other ECCS staff', async () => {
      const added = (
        await addMember({ name: `${MARK} Imran`, phone: '91999 00071', role: 'BDE', area: 'Jubilee Hills', joinedOn: addDays(today, -30), monthlySalaryPaise: 2_800_000 }).expect(201)
      ).body as TeamMemberDto;
      id.bde = added.userId;
      expect(added).toMatchObject({ name: `${MARK} Imran`, role: 'BDE', area: 'Jubilee Hills', joinedOn: addDays(today, -30), weeklyOff: 0, initials: 'ET', monthlyPaise: 2_800_000 });
      expect(added.salary).toEqual({ monthlyPaise: 2_800_000, history: [{ from: addDays(today, -30), monthlyPaise: 2_800_000 }] });
      expect(added.whatsappUrl).toBe('https://wa.me/919199900071');
      const memberships = await prisma.client.membership.findMany({ where: { userId: id.bde }, select: { role: true } });
      expect(memberships).toEqual([{ role: 'BDE' }]);
      bdeToken = await otpLogin(MINE.bde);
      expect((await http().get('/auth/me').set(bearer(bdeToken)).expect(200)).body.id).toBe(id.bde);

      for (const [key, role] of [
        ['bde2', 'BDE'],
        ['sup', 'SUPERVISOR'],
        ['ops', 'OPS_MANAGER'],
        ['log', 'OPS_MANAGER'],
      ] as const) {
        id[key] = ((await addMember({ name: `${MARK} ${key}`, phone: MINE[key], role, joinedOn: addDays(today, -30) }).expect(201)).body as TeamMemberDto).userId;
      }
    });

    it('refuses a number already on the team or belonging to a restaurant login', async () => {
      await addMember({ name: 'Again', phone: MINE.bde, role: 'BDE', joinedOn: today }).expect(409);
      // The sample restaurant owner's number: refused, and nothing about it changes.
      await addMember({ name: 'Owner', phone: '+919100000001', role: 'BDE', joinedOn: today }).expect(409);
      await addMember({ name: 'Bad', phone: '12345', role: 'BDE', joinedOn: today }).expect(400);
      await addMember({ name: 'Founder', phone: '+919199900079', role: 'SUPER_ADMIN', joinedOn: today }).expect(400);
    });

    it('shows a founder only once given a place on the team, and never marks one as left', async () => {
      const founder = await prisma.client.user.create({ data: { phone: MINE.founder, name: `${MARK} Founder`, memberships: { create: [{ role: 'SUPER_ADMIN' }] } } });
      id.founder = founder.id;
      expect((await list(admin)).members.some((row) => row.userId === id.founder)).toBe(false);
      await http().patch(`/team/${id.founder}`).set(bearer(admin)).send({ area: 'Head office' }).expect(400);
      const given = (await http().patch(`/team/${id.founder}`).set(bearer(admin)).send({ joinedOn: addDays(today, -60), area: 'Head office' }).expect(200)).body as TeamMemberDto;
      expect(given).toMatchObject({ role: 'SUPER_ADMIN', area: 'Head office' });
      expect((await list(admin)).members.find((row) => row.userId === id.founder)?.role).toBe('SUPER_ADMIN');
      await http().patch(`/team/${id.founder}`).set(bearer(admin)).send({ role: 'BDE' }).expect(400);
      await http().post(`/team/${id.founder}/mark-left`).set(bearer(admin)).send({ leftOn: today }).expect(403);
    });

    it('lets the Super Admin and the Ops Manager in, salaries for the Super Admin only; refuses everyone else', async () => {
      const mine = (await list(admin)).members.find((row) => row.userId === id.bde)!;
      expect(mine.monthlyPaise).toBe(2_800_000);
      const theirs = await list(ops);
      expect(theirs.members.every((row) => row.monthlyPaise === null)).toBe(true);
      const opsPage = await page(ops, id.bde);
      expect(opsPage.salary).toBeNull();
      expect(opsPage.canManage).toBe(false);
      expect(opsPage.canRecordLeave).toBe(true);
      expect(JSON.stringify(theirs) + JSON.stringify(opsPage)).not.toContain('2800000');
      for (const token of [bdeToken, supervisor, owner]) {
        await http().get('/team').set(bearer(token)).expect(403);
        await http().get(`/team/${id.bde}`).set(bearer(token)).expect(403);
      }
      // The Ops Manager neither adds, changes, marks as left nor sets the target.
      await addMember({ name: 'No', phone: '+919199900078', role: 'BDE', joinedOn: today }, ops).expect(403);
      await http().patch(`/team/${id.bde}`).set(bearer(ops)).send({ area: 'X' }).expect(403);
      await http().post(`/team/${id.bde}/mark-left`).set(bearer(ops)).send({ leftOn: today }).expect(403);
      await http().put('/team/settings').set(bearer(ops)).send({ onTimeTargetPercent: 80 }).expect(403);
    });
  });

  // ───────────────────────── Changing details ─────────────────────────

  describe('changing details', () => {
    it('changes only what is sent; a new salary takes effect from its day', async () => {
      const from = addDays(today, -5);
      const changed = (await http().patch(`/team/${id.bde}`).set(bearer(admin)).send({ weeklyOff: 3, salary: { monthlyPaise: 3_000_000, from } }).expect(200)).body as TeamMemberDto;
      expect(changed).toMatchObject({ area: 'Jubilee Hills', weeklyOff: 3, monthlyPaise: 3_000_000 });
      expect(changed.salary!.history).toEqual([
        { from: addDays(today, -30), monthlyPaise: 2_800_000 },
        { from, monthlyPaise: 3_000_000 },
      ]);
      // Set again on the same day, it replaces that one.
      const again = (await http().patch(`/team/${id.bde}`).set(bearer(admin)).send({ salary: { monthlyPaise: 3_100_000, from } }).expect(200)).body as TeamMemberDto;
      expect(again.salary!.history).toHaveLength(2);
      expect(again.monthlyPaise).toBe(3_100_000);
      // Back to Sunday off for the rest of the suite.
      await http().patch(`/team/${id.bde}`).set(bearer(admin)).send({ weeklyOff: 0 }).expect(200);
      await http().patch(`/team/${id.bde}`).set(bearer(admin)).send({ phone: MINE.ops }).expect(409);
    });
  });

  // ───────────────────────── Presence and the cards ─────────────────────────

  describe("a BDE's page", () => {
    let early: LeadDetailDto;

    beforeAll(async () => {
      // Logged on the phone without signal yesterday at 9:40, sent today.
      const yesterday = addDays(today, -1);
      const lead = (await http().post('/sales/leads').set(bearer(bdeToken)).send({ businessName: `${MARK} Offline Dhaba`, source: 'FIELD_VISIT', at: indiaMoment(addDays(today, -2), '18:00').toISOString() }).expect(201))
        .body as LeadDetailDto;
      await http().post(`/sales/leads/${lead.id}/steps`).set(bearer(bdeToken)).send({ kind: 'CALL', at: indiaMoment(yesterday, '09:40').toISOString() }).expect(201);
      await http().post(`/sales/leads/${lead.id}/steps`).set(bearer(bdeToken)).send({ kind: 'VISIT', at: indiaMoment(yesterday, '15:00').toISOString() }).expect(201);
      // A lead logged six days ago and never worked since: stale.
      early = (await http().post('/sales/leads').set(bearer(bdeToken)).send({ businessName: `${MARK} Quiet Cafe`, source: 'DRIVE', at: indiaMoment(addDays(today, -6), '11:00').toISOString() }).expect(201)).body;
    });

    it('reads presence from the first lead step of each day, by the time it was done', async () => {
      const mine = await page(admin, id.bde);
      expect(mine.presenceSource).toBe('LEAD_STEPS');
      expect(mine.days).toHaveLength(14);
      const yesterday = mine.days.find((day) => day.date === addDays(today, -1))!;
      expect(yesterday).toMatchObject({ state: 'IN', firstAt: '09:40', what: 'first call logged' });
      expect(mine.days.find((day) => day.date === addDays(today, -2))).toMatchObject({ firstAt: '18:00', what: 'first lead logged from the field' });
      expect(mine.presenceLine).toContain('Read from the first lead step E2E logs each day.');
    });

    it('shows days off and leave, and leave is never a day missed', async () => {
      // A day of leave three days ago, unless that is a Sunday (the day off), then four.
      let date = addDays(today, -3);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) date = addDays(today, -4);
      const before = await page(admin, id.bde);
      await http().post(`/team/${id.bde}/leave`).set(bearer(bdeToken)).send({ from: date, to: date }).expect(403);
      const after = (await http().post(`/team/${id.bde}/leave`).set(bearer(ops)).send({ from: date, to: date, reason: 'family function' }).expect(201)).body as TeamMemberDto;
      const day = after.days.find((entry) => entry.date === date)!;
      expect(day).toMatchObject({ state: 'LEAVE', onLeave: true, leaveReason: 'family function' });
      expect(after.leave.find((entry) => entry.from === date)).toMatchObject({ to: date, reason: 'family function' });
      // The day moves from "not in" to leave.
      const missed = (dto: TeamMemberDto) => dto.days.filter((entry) => entry.state === 'NOT_IN').length;
      expect(missed(after)).toBe(missed(before) - 1);
      expect(after.presenceLine).toMatch(/on leave/);
      // Sundays are the day off: grey, not missed.
      for (const entry of after.days.filter((entry) => new Date(`${entry.date}T00:00:00Z`).getUTCDay() === 0)) expect(['OFF', 'IN']).toContain(entry.state);
      // Overlapping leave is refused; removing it works for the Ops Manager.
      await http().post(`/team/${id.bde}/leave`).set(bearer(admin)).send({ from: date, to: date }).expect(409);
      const leaveId = after.leave.find((entry) => entry.from === date)!.id;
      await http().delete(`/team/leave/${leaveId}`).set(bearer(ops)).expect(204);
      await http().delete(`/team/leave/${leaveId}`).set(bearer(ops)).expect(404);
    });

    it("gives the cards from Sales' own week, agreeing with the Sales page", async () => {
      const sales = (await http().get('/sales/overview').set(bearer(admin)).expect(200)).body as SalesOverviewDto;
      const week = sales.byBde.find((row) => row.userId === id.bde)!;
      const mine = await page(admin, id.bde);
      const card = (key: string) => mine.cards.find((entry) => entry.key === key)!;
      expect(card('leads')).toMatchObject({ label: 'Leads logged this week', value: String(week.actual.leads), target: `target ${week.targets.leads}`, lastWeek: `last week ${week.lastWeek.leads}` });
      expect(card('checks')).toMatchObject({ value: String(week.actual.checks), target: `target ${week.targets.checks}`, lastWeek: `last week ${week.lastWeek.checks}` });
      const row = (await list(admin)).members.find((entry) => entry.userId === id.bde)!;
      expect(row.week).toEqual({ label: 'leads', done: week.actual.leads, target: week.targets.leads });
    });

    it('lists the stale leads worst first, and a lead leaves the list when its next step is logged', async () => {
      const mine = await page(admin, id.bde);
      const found = mine.foundLeads!.items.find((entry) => entry.leadId === early.id)!;
      expect(found.stale).toMatchObject({ reason: 'NO_NEXT_STEP', days: 6, words: 'no next step set, 6 days' });
      await http().post(`/sales/leads/${early.id}/steps`).set(bearer(bdeToken)).send({ kind: 'CALL' }).expect(201);
      expect((await page(admin, id.bde)).foundLeads!.items.some((entry) => entry.leadId === early.id)).toBe(false);
    });

    it('keeps each next step from when it is set, and counts follow-ups on time this week', async () => {
      const db = prisma.client;
      const start = Date.now();
      const minutes = (count: number) => new Date(start + count * 60_000).toISOString();
      // Due ten minutes ago, called five minutes ago (on the phone, sent now): on time.
      const met = (await http().post('/sales/leads').set(bearer(bdeToken)).send({ businessName: `${MARK} On Time`, source: 'DRIVE', at: minutes(-20), nextAction: 'Call back', nextActionAt: minutes(-10) }).expect(201))
        .body as LeadDetailDto;
      await http().post(`/sales/leads/${met.id}/steps`).set(bearer(bdeToken)).send({ kind: 'CALL', at: minutes(-12) }).expect(201);
      // Due fifteen minutes ago, called only now: late.
      const late = (await http().post('/sales/leads').set(bearer(bdeToken)).send({ businessName: `${MARK} Late`, source: 'DRIVE', at: minutes(-20), nextAction: 'Call back', nextActionAt: minutes(-15) }).expect(201))
        .body as LeadDetailDto;
      await http().post(`/sales/leads/${late.id}/steps`).set(bearer(bdeToken)).send({ kind: 'CALL' }).expect(201);
      // Moved to tomorrow before it fell due: the first one ends, a new one starts, neither counts yet.
      const moved = (await http().post('/sales/leads').set(bearer(bdeToken)).send({ businessName: `${MARK} Moved`, source: 'DRIVE', nextAction: 'Visit', nextActionAt: minutes(120) }).expect(201)).body as LeadDetailDto;
      await http().patch(`/sales/leads/${moved.id}`).set(bearer(bdeToken)).send({ nextActionAt: minutes(24 * 60) }).expect(200);

      const rows = await db.leadFollowUp.findMany({ where: { leadId: { in: [met.id, late.id, moved.id] } }, orderBy: { createdAt: 'asc' } });
      const iso = (date: Date | null) => date?.toISOString() ?? null;
      // Set when the lead was logged (the phone's time); ended by the call, at the call's own time.
      const metRows = rows.filter((row) => row.leadId === met.id);
      expect(metRows.map((row) => [row.ownerId, iso(row.setAt), iso(row.dueAt), iso(row.endedAt)])).toEqual([[id.bde, minutes(-20), minutes(-10), minutes(-12)]]);
      const lateRows = rows.filter((row) => row.leadId === late.id);
      expect(lateRows).toHaveLength(1);
      expect(lateRows[0]!.endedAt!.getTime()).toBeGreaterThan(Date.parse(minutes(-15)));
      const movedRows = rows.filter((row) => row.leadId === moved.id);
      expect(movedRows).toHaveLength(2);
      expect(iso(movedRows[0]!.dueAt)).toBe(minutes(120));
      expect(movedRows[0]!.endedAt).not.toBeNull();
      expect(iso(movedRows[1]!.dueAt)).toBe(minutes(24 * 60));
      expect(movedRows[1]!.endedAt).toBeNull();

      // What the card says is the rule applied to the recorded rows.
      const mine = await page(admin, id.bde);
      const weekStart = weekStartOf(today);
      const all = await db.leadFollowUp.findMany({ where: { ownerId: id.bde } });
      const steps = await db.leadActivity.findMany({ where: { leadId: { in: [...new Set(all.map((row) => row.leadId))] }, byId: { not: null } }, select: { leadId: true, at: true } });
      const expected = followUpsOnTime(
        all.map((row) => ({ leadId: row.leadId, setAt: row.setAt.toISOString(), dueAt: row.dueAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null })),
        steps.map((step) => ({ leadId: step.leadId, at: step.at.toISOString() })),
        weekStart,
        today,
        now(),
      );
      // Both fell due today (the suite does not run in the first twenty minutes after midnight).
      if (indiaDay(minutes(-20)) === today) expect(expected).toEqual({ due: 2, onTime: 1, percent: 50 });
      expect(mine.cards.find((entry) => entry.key === 'followUps')).toMatchObject({ label: 'Follow-ups on time', value: expected.percent === null ? '—' : `${expected.percent}%`, target: expect.stringMatching(/^target \d+%$/) });
    });

    it('uses the on-time target the Super Admin sets', async () => {
      await http().put('/team/settings').set(bearer(admin)).send({ onTimeTargetPercent: 95 }).expect(200);
      expect((await page(admin, id.bde)).cards.find((entry) => entry.key === 'followUps')!.target).toBe('target 95%');
      expect((await list(admin)).onTimeTargetPercent).toBe(95);
      await http().put('/team/settings').set(bearer(admin)).send({ onTimeTargetPercent: 0 }).expect(400);
    });

    it('says what to keep an eye on, or that nothing needs attention, with the day in words', async () => {
      const mine = await page(admin, id.bde);
      expect(mine.keep.note).toMatch(/^In since \d{1,2}(:\d{2})? (am|pm) today, first /);
      if (mine.keep.pick) expect(mine.flag).toEqual(mine.keep.pick);
      else expect(mine.keep.note).toMatch(/Everything is on target\.$/);
      expect(mine.today.state).toBe('IN');
    });

    it('can no longer stop selling while they own open leads', async () => {
      const refused = await http().patch(`/team/${id.bde}`).set(bearer(admin)).send({ role: 'SUPERVISOR' }).expect(409);
      expect(refused.body).toMatchObject({ code: 'OPEN_LEADS' });
    });
  });

  // ───────────────────────── A Supervisor and the Ops Manager ─────────────────────────

  describe("a Supervisor's and the Ops Manager's pages", () => {
    it("reads a Supervisor's presence from the visit arrival, and lists visits past their day", async () => {
      const db = prisma.client;
      const serviceType = await db.serviceType.findFirstOrThrow({ select: { id: true } });
      const yesterday = addDays(today, -1);
      await db.job.createMany({
        data: [
          { outletId, serviceTypeId: serviceType.id, supervisorId: id.sup, scheduledDate: toDb(yesterday), scheduledSlot: '1000', status: 'COMPLETED', checkInAt: indiaMoment(yesterday, '10:20'), completedAt: indiaMoment(yesterday, '11:30') },
          { outletId, serviceTypeId: serviceType.id, supervisorId: id.sup, scheduledDate: toDb(addDays(today, -2)), scheduledSlot: '1400', status: 'ASSIGNED' },
          { outletId, serviceTypeId: serviceType.id, supervisorId: id.sup, scheduledDate: toDb(addDays(today, 1)), scheduledSlot: '1400', status: 'ASSIGNED' },
        ],
      });
      const theirs = await page(admin, id.sup);
      expect(theirs.presenceSource).toBe('FIELD_WORK');
      expect(theirs.days.find((day) => day.date === yesterday)).toMatchObject({ state: 'IN', firstAt: '10:20', what: `arrived at ${MARK} Outlet` });
      expect(theirs.foundVisits).toMatchObject({ total: 1, items: [{ outletName: `${MARK} Outlet`, scheduledDate: addDays(today, -2), daysLate: 2 }] });
      expect(theirs.upcomingVisits).toBe(1);
      expect(theirs.cards.map((card) => card.key)).toEqual(['visits', 'inspections', 'arrivals']);
      const arrivals = theirs.cards.find((card) => card.key === 'arrivals')!;
      // Arrived at 10:20 for the 10 to 12 window: on time, this week or last.
      if (yesterday >= weekStartOf(today)) expect(arrivals.value).toBe('100%');
      else expect(arrivals.lastWeek).toBe('last week 100%');
      expect(theirs.keep.pick?.kind === 'VISITS_OVERDUE' || theirs.keep.pick?.kind === 'MISSED_DAYS').toBe(true);
      expect([theirs.keep.pick?.words, theirs.keep.note].join(' ')).toMatch(/1 visit (past its day|overdue)/);
    });

    it("reads the Ops Manager's presence from the changes they make (the activity log)", async () => {
      const at = indiaMoment(addDays(today, -1), '11:05');
      const row = await prisma.client.activityLog.create({
        data: { at, source: 'CONSOLE', actorUserId: id.log, actorName: `${MARK} log`, actorRole: 'OPS_MANAGER', category: 'clients', action: 'clients.outlet.changed', result: 'SUCCESS' },
      });
      insertedLogs.push(row.id);
      const theirs = await page(admin, id.log);
      expect(theirs.presenceSource).toBe('ACTIVITY_LOG');
      expect(theirs.cards).toEqual([]);
      expect(theirs.days.find((day) => day.date === addDays(today, -1))).toMatchObject({ state: 'IN', firstAt: '11:05', what: 'first change in the console' });
    });
  });

  // ───────────────────────── Salaries into Finance ─────────────────────────

  describe("Finance's Salaries line", () => {
    const thisMonth = monthOf(today);
    const lastMonth = monthOf(addDays(monthStart(thisMonth), -1));
    const rowsOf = (userId: string) => prisma.client.expense.findMany({ where: { teamMember: { userId } }, orderBy: { salaryMonth: 'asc' } });

    it('makes a row a month from the salary, counted once in Salaries, owed until marked paid', async () => {
      const before = await finance();
      const salaries = (data: FinanceOverviewDto) => data.lines.find((line) => line.line === 'SALARIES')!.actualPaise;
      // Joined on the first of last month at ₹25,000: last month and this month in full.
      id.pay = ((await addMember({ name: `${MARK} Payee`, phone: MINE.pay, role: 'SUPERVISOR', joinedOn: monthStart(lastMonth), monthlySalaryPaise: 2_500_000 }).expect(201)).body as TeamMemberDto).userId;
      const after = await finance();
      expect(salaries(after) - salaries(before)).toBe(2_500_000);
      const rows = await rowsOf(id.pay);
      expect(rows.map((row) => [row.salaryMonth, row.amountPaise, row.category, row.paidOn])).toEqual([
        [lastMonth, 2_500_000, 'SALARIES', null],
        [thisMonth, 2_500_000, 'SALARIES', null],
      ]);
      expect(rows[1]!.dueDate!.toISOString().slice(0, 10)).toBe(monthEnd(thisMonth));
      // Read again, nothing is added twice.
      await finance();
      await http().get('/finance/expenses').set(bearer(admin)).expect(200);
      expect(await rowsOf(id.pay)).toHaveLength(2);
      // The month's team salaries are one payout, with this person's row in it.
      const group = after.payouts.find((entry) => entry.key === `team|${thisMonth}`)!;
      expect(group.category).toBe('SALARIES');
      expect(group.vendor).toMatch(/^Team, /);
      expect(group.ids).toContain(rows[1]!.id);
      expect(after.cashFlow.dueOut.salariesPaise - before.cashFlow.dueOut.salariesPaise).toBe(5_000_000);
      // In the expense book it says where it came from, and cannot be changed or removed there.
      const book = (await http().get('/finance/expenses').query({ month: thisMonth }).set(bearer(admin)).expect(200)).body as ExpenseListDto;
      expect(book.entries.find((entry) => entry.id === rows[1]!.id)).toMatchObject({ team: { userId: id.pay, month: thisMonth }, vendor: `${MARK} Payee`, description: expect.stringMatching(/^Salary, /) });
      const body = { date: today, category: 'SALARIES', vendor: 'X', amountPaise: 100, paidVia: 'cash', paidOn: today };
      await http().patch(`/finance/expenses/${rows[1]!.id}`).set(bearer(admin)).send(body).expect(409);
      await http().delete(`/finance/expenses/${rows[1]!.id}`).set(bearer(admin)).expect(409);
      // No salary typed in by hand any more: it would count twice.
      await http().post('/finance/expenses').set(bearer(admin)).send({ ...body, vendor: 'E2E Hand Payroll' }).expect(400);
    });

    it('leaves a paid month as it was paid, and follows a change on the months still owed', async () => {
      const rows = await rowsOf(id.pay);
      await http().post('/finance/expenses/mark-paid').set(bearer(admin)).send({ ids: [rows[1]!.id], paidVia: 'bank-transfer', paidOn: today }).expect(200);
      const after = await finance();
      expect(after.payouts.find((entry) => entry.key === `team|${thisMonth}`)?.ids ?? []).not.toContain(rows[1]!.id);
      // A raise from the first of last month: last month (owed) follows, this month (paid) stays.
      await http().patch(`/team/${id.pay}`).set(bearer(admin)).send({ salary: { monthlyPaise: 2_800_000, from: monthStart(lastMonth) } }).expect(200);
      await finance();
      const now = await rowsOf(id.pay);
      expect(now.map((row) => [row.salaryMonth, row.amountPaise, row.paidOn !== null])).toEqual([
        [lastMonth, 2_800_000, false],
        [thisMonth, 2_500_000, true],
      ]);
    });

    it('refuses a last day still to come, and keeps a paid month as paid when someone leaves', async () => {
      await http().post(`/team/${id.pay}/mark-left`).set(bearer(admin)).send({ leftOn: addDays(today, 1) }).expect(400);
      await http().post(`/team/${id.pay}/mark-left`).set(bearer(admin)).send({ leftOn: today }).expect(200);
      await finance();
      const rows = await rowsOf(id.pay);
      expect(rows.map((row) => [row.salaryMonth, row.amountPaise, row.paidOn !== null])).toEqual([
        [lastMonth, 2_800_000, false],
        [thisMonth, 2_500_000, true],
      ]);
      expect((await page(admin, id.pay)).leftOn).toBe(today);
    });
  });

  // ───────────────────────── Marking as left ─────────────────────────

  describe('marking as left', () => {
    it('asks for whoever takes their open leads, hands them over, and stops the login', async () => {
      const open = await prisma.client.lead.count({ where: { ownerId: id.bde, status: { not: 'LOST' } } });
      expect(open).toBeGreaterThan(0);
      await http().post(`/team/${id.bde}/mark-left`).set(bearer(admin)).send({ leftOn: today, handTo: id.bde }).expect(400);
      const refused = await http().post(`/team/${id.bde}/mark-left`).set(bearer(admin)).send({ leftOn: today }).expect(409);
      expect(refused.body).toMatchObject({ code: 'OPEN_LEADS', count: open });
      const left = (await http().post(`/team/${id.bde}/mark-left`).set(bearer(admin)).send({ leftOn: today, handTo: id.bde2 }).expect(200)).body as TeamMemberDto;
      expect(left).toMatchObject({ leftOn: today, flag: null, canRecordLeave: false });
      expect(left.today.words).toMatch(/^Left /);
      expect(await prisma.client.lead.count({ where: { ownerId: id.bde, status: { not: 'LOST' } } })).toBe(0);
      expect(await prisma.client.lead.count({ where: { ownerId: id.bde2, businessName: { startsWith: MARK } } })).toBe(open);
      // Their open next steps went with the leads.
      expect(await prisma.client.leadFollowUp.count({ where: { ownerId: id.bde, endedAt: null } })).toBe(0);
      // The login no longer works, now or with a new code; the records stay.
      await http().get('/auth/me').set(bearer(bdeToken)).expect(401);
      await http().post('/auth/otp/request').send({ phone: MINE.bde }).expect(200);
      const tried = await http().post('/auth/otp/verify').send({ phone: MINE.bde, code: env.DEV_FIXED_OTP, deviceName: DEVICE });
      expect(tried.status).toBeGreaterThanOrEqual(400);
      expect(await prisma.client.leadActivity.count({ where: { byId: id.bde } })).toBeGreaterThan(0);
      // Still on the list, with the people who left; already left is refused.
      expect((await list(admin)).members.find((row) => row.userId === id.bde)?.leftOn).toBe(today);
      await http().post(`/team/${id.bde}/mark-left`).set(bearer(admin)).send({ leftOn: today, handTo: id.bde2 }).expect(409);
      // The month they leave is paid to their last day, due that day.
      await finance();
      const row = await prisma.client.expense.findFirstOrThrow({ where: { teamMember: { userId: id.bde }, salaryMonth: monthOf(today) } });
      const member = await prisma.client.teamMember.findUniqueOrThrow({ where: { userId: id.bde }, include: { salaries: true } });
      const expected = salaryForMonth({
        month: monthOf(today),
        joinedOn: member.joinedOn.toISOString().slice(0, 10),
        leftOn: today,
        steps: member.salaries.map((step) => ({ from: step.from.toISOString().slice(0, 10), monthlyPaise: step.monthlyPaise })),
      })!;
      expect(row.amountPaise).toBe(expected.paise);
      expect(row.dueDate!.toISOString().slice(0, 10)).toBe(today);
      expect(expected.lastDay).toBe(today);
    });
  });

  // ───────────────────────── The activity log ─────────────────────────

  describe('the activity log', () => {
    it('records each change as the action and who did it, never pay, dates, names or reasons', async () => {
      activity.setForTest({ on: true });
      try {
        const added = (await addMember({ name: `${MARK} Secret Tamarind`, phone: '+919199900079', role: 'OPS_MANAGER', joinedOn: addDays(today, -3), monthlySalaryPaise: SECRET_PAY.added }).expect(201)).body as TeamMemberDto;
        await http().patch(`/team/${added.userId}`).set(bearer(admin)).send({ salary: { monthlyPaise: SECRET_PAY.changed, from: today }, area: 'Secret Saffron Road' }).expect(200);
        const leave = (await http().post(`/team/${added.userId}/leave`).set(bearer(ops)).send({ from: today, to: today, reason: 'secret cardamom' }).expect(201)).body as TeamMemberDto;
        await http().delete(`/team/leave/${leave.leave[0]!.id}`).set(bearer(ops)).expect(204);
        // Their own salary row (never a sample one), marked paid.
        await finance();
        const own = await prisma.client.expense.findFirstOrThrow({ where: { teamMember: { userId: added.userId }, salaryMonth: monthOf(today) } });
        await http().post('/finance/expenses/mark-paid').set(bearer(admin)).send({ ids: [own.id], paidVia: 'cash', paidOn: today }).expect(200);
        await activity.flush();
        const rows = await prisma.client.activityLog.findMany({ where: { id: { in: activity.recordedForTest() } } });
        const team = rows.filter((row) => row.category === 'team');
        expect(team.map((row) => row.action).sort()).toEqual(['team.leave.added', 'team.leave.removed', 'team.member.added', 'team.member.changed']);
        for (const row of team) expect(row).toMatchObject({ details: null, entityId: null, entityLabel: null, actorUserId: expect.any(String) });
        const everything = JSON.stringify(rows);
        for (const secret of [String(SECRET_PAY.added), String(SECRET_PAY.changed), '31415', '27182', 'Tamarind', 'Saffron', 'cardamom', '9199900079']) {
          expect(everything.includes(secret), secret).toBe(false);
        }
        // The payment is recorded without its amount.
        const paid = rows.find((row) => row.action === 'finance.expenses.markedPaid')!;
        expect(paid.details).toEqual({ paidVia: 'cash', updated: 1 });
      } finally {
        activity.setForTest({ on: false });
      }
    });
  });
});
