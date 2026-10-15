// The activity log (15 Oct 2026): every route that changes something carries an action
// key; requests from the restaurant app, the Supervisor's app and the console are told
// apart; refusals are recorded; logins right and wrong are recorded without the PIN or
// code; nothing private reaches a row (PINs, codes, tokens, typed text, checklist
// problems, staff details); clock-ins are never recorded; only the Super Admin and Ops
// Manager can read; every filter, the menus, the summary, one event and the export
// work; a failing write never fails a request; old rows are deleted.
//
// Runs against the local database with the sample seed loaded. The log is off for the
// rest of the e2e run (vitest.config.e2e.ts) and is switched on here. Everything happens
// at a throwaway outlet of the Deccan Biryani sample client, with a throwaway Manager;
// the sample people are only logged in, never changed. Every log row this suite makes,
// and everything else it creates, is removed afterwards.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { pinLookup } from '@eccs/db';
import {
  ACTIVITY_ACTIONS,
  type ActivityLogEntryDto,
  type ActivityLogEventDto,
  type ActivityLogFacetsDto,
  type ActivityLogPageDto,
  type ActivityLogSummaryDto,
} from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { ActivityLogService } from './../src/activity-log/activity-log.service.js';
import { ActivityRoutesService } from './../src/activity-log/activity-routes.service.js';
import { AiService } from './../src/ai/ai.service.js';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T' };
const PINS = { owner: '3917', chef: '8264' };
const PHONES = { admin: '+919000000001', opsManager: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-activity-log';
const OUTLET_CODE = 'E2EAL-LOG001';
// Starts with "=" so the export's guard against spreadsheet formulas is tested too.
const OUTLET_NAME = '=E2E Activity Log Outlet';
const MANAGER_NAME = 'E2E Activity Manager';
// Things that must never reach a row.
const SECRET = {
  problem: 'E2E-SECRET-PROBLEM-quartz',
  message: 'E2E-SECRET-MESSAGE-saffron',
  issue: 'E2E-SECRET-ISSUE-cardamom',
  staffName: 'E2E Secret Staffname Tamarind',
  staffRename: 'E2E Secret Rename Fenugreek',
  salary: 3_141_593,
  advance: 2_718_281,
  payNote: 'E2E-SECRET-PAYNOTE-clove',
};
const MOBILE = { 'X-ECCS-Client': 'mobile', 'X-ECCS-App-Version': '9.9.9-e2e' };
const CONSOLE = { 'X-ECCS-Client': 'console', 'X-ECCS-App-Version': 'console-1' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e activity log photo')]);

type Login = { token: string; deviceToken: string };

describe('Activity log (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let activity: ActivityLogService;
  let ai: AiService;
  let startedAt: Date;
  let outletId: string;
  let organizationId: string;
  let owner: Login;
  let manager: Login;
  let managerId: string;
  let managerPin: string;
  let chef: string;
  let admin: string;
  let opsManager: string;
  let supervisor: string;
  let supervisorId: string;
  /** Every token and code handed out in this suite, none of which may reach a row. */
  const secrets: string[] = [];
  /** Rows written straight into the table by the retention test. */
  const insertedIds: string[] = [];

  // The app runs under the "v1" prefix here, as it does for real (main.ts), so the middleware is
  // known to catch prefixed routes and the recorded route patterns are known to leave the prefix out.
  const http = () => {
    const agent = request(app.getHttpServer());
    return {
      get: (path: string) => agent.get(`/v1${path}`),
      post: (path: string) => agent.post(`/v1${path}`),
      put: (path: string) => agent.put(`/v1${path}`),
      patch: (path: string) => agent.patch(`/v1${path}`),
      delete: (path: string) => agent.delete(`/v1${path}`),
    };
  };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const flush = () => activity.flush();

  async function pinLogin(code: string, pin: string, headers: Record<string, string> = MOBILE): Promise<Login> {
    const phone = await http().post('/auth/device/link').set(headers).send({ code, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').set(headers).send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    secrets.push(phone.body.deviceToken as string, session.body.token as string);
    return { token: session.body.token as string, deviceToken: phone.body.deviceToken as string };
  }

  async function otpLogin(phone: string, headers: Record<string, string>): Promise<string> {
    await http().post('/auth/otp/request').set(headers).send({ phone }).expect(200);
    const session = await http().post('/auth/otp/verify').set(headers).send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200);
    secrets.push(session.body.token as string);
    return session.body.token as string;
  }

  /** The rows this suite has written so far. */
  async function rowsMade() {
    await flush();
    return prisma.client.activityLog.findMany({ where: { id: { in: activity.recordedForTest() } }, orderBy: { at: 'asc' } });
  }
  async function rowsFor(requestId: string) {
    await flush();
    return prisma.client.activityLog.findMany({ where: { requestId, id: { in: activity.recordedForTest() } } });
  }
  const list = async (token: string, query: Record<string, string>) =>
    (await http().get('/activity-log').query({ from: startedAt.toISOString(), ...query }).set(bearer(token)).expect(200)).body as ActivityLogPageDto;

  async function cleanUp() {
    const db = prisma.client;
    const outlet = await db.outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    if (outlet) {
      const lists = await db.outletChecklist.findMany({ where: { outletId: outlet.id }, select: { templateId: true } });
      const staff = await db.staffMember.findMany({ where: { outletId: outlet.id }, select: { id: true } });
      const issues = await db.issue.findMany({ where: { outletId: outlet.id }, select: { id: true } });
      await db.issueComment.deleteMany({ where: { issueId: { in: issues.map((issue) => issue.id) } } });
      await db.issue.deleteMany({ where: { outletId: outlet.id } });
      await db.checklistRun.deleteMany({ where: { outletId: outlet.id } });
      await db.outletChecklist.deleteMany({ where: { outletId: outlet.id } });
      await db.checklistItem.deleteMany({ where: { templateId: { in: lists.map((entry) => entry.templateId) } } });
      await db.checklistTemplate.deleteMany({ where: { id: { in: lists.map((entry) => entry.templateId) } } });
      await db.auditLog.deleteMany({ where: { entityId: { in: [outlet.id, ...staff.map((row) => row.id)] } } });
      await db.staffMember.deleteMany({ where: { outletId: outlet.id } });
      await db.attendanceSettings.deleteMany({ where: { outletId: outlet.id } });
      await db.hygieneScoreSnapshot.deleteMany({ where: { outletId: outlet.id } });
      await db.publicProfile.deleteMany({ where: { outletId: outlet.id } });
      await db.attachment.deleteMany({ where: { outletId: outlet.id } });
      await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { user: { name: MANAGER_NAME } }] } });
      await db.linkedDevice.deleteMany({ where: { OR: [{ name: DEVICE }, { outletId: outlet.id }] } });
      await db.membership.deleteMany({ where: { outletId: outlet.id } });
      await db.user.deleteMany({ where: { name: MANAGER_NAME } });
      await db.outlet.delete({ where: { id: outlet.id } });
    }
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
    if (ai) await db.aiRequest.deleteMany({ where: { id: { in: ai.recordedForTest() } } });
    if (activity) {
      await activity.flush();
      await db.activityLog.deleteMany({ where: { id: { in: [...activity.recordedForTest(), ...insertedIds] } } });
    }
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = app.get(PrismaService);
    activity = app.get(ActivityLogService);
    ai = app.get(AiService);
    await cleanUp();

    const db = prisma.client;
    const seeded = await db.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    organizationId = seeded.organizationId;
    outletId = (await db.outlet.create({ data: { organizationId, name: OUTLET_NAME, code: OUTLET_CODE, address: 'Log Road', city: 'Hyderabad' } })).id;

    startedAt = new Date();
    activity.setForTest({ on: true, failWrites: false });

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    chef = (await pinLogin(CODES.kukatpally, PINS.chef)).token;
    // A Manager of the throwaway outlet, made by the Owner: the restaurant app's own action.
    const created = await http()
      .post('/restaurant-users')
      .set({ ...bearer(owner.token), ...MOBILE })
      .send({ name: MANAGER_NAME, role: 'MANAGER', outletId, language: 'EN' })
      .expect(201);
    managerId = created.body.user.id as string;
    managerPin = created.body.pin as string;
    secrets.push(managerPin);
    manager = await pinLogin(OUTLET_CODE, managerPin);
    admin = await otpLogin(PHONES.admin, CONSOLE);
    opsManager = await otpLogin(PHONES.opsManager, CONSOLE);
    supervisor = await otpLogin(PHONES.supervisor, MOBILE);
    supervisorId = (await http().get('/auth/me').set(bearer(supervisor)).expect(200)).body.id as string;
  }, 60_000);

  afterAll(async () => {
    ai?.setForTest({ on: false });
    activity?.setForTest({ failWrites: false });
    await cleanUp();
    activity?.setForTest({ on: false });
    await app.close();
  });

  // ───────────────────────── Nothing goes unrecorded ─────────────────────────

  describe('coverage', () => {
    it('gives every route that changes something a known action key', () => {
      const routes = app.get(ActivityRoutesService).routes();
      const changing = routes.filter((route) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method));
      expect(changing.length).toBeGreaterThan(140);
      const missing = app.get(ActivityRoutesService).unlabelled();
      expect(missing.map((route) => `${route.method} ${route.route} (${route.controller}.${route.handler})`)).toEqual([]);
      for (const route of changing) expect(Object.hasOwn(ACTIVITY_ACTIONS, route.action!), `${route.method} ${route.route}`).toBe(true);
    });

    it('leaves only the clock-in and face-scan routes unrecorded, each with its reason', () => {
      const never = app.get(ActivityRoutesService).routes().filter((route) => route.never);
      expect(never.map((route) => `${route.method} ${route.route}`).sort()).toEqual([
        'POST /attendance/clock/assisted',
        'POST /attendance/clock/confirm',
        'POST /attendance/clock/identify',
      ]);
      for (const route of never) expect(route.never!.length).toBeGreaterThan(20);
    });
  });

  // ───────────────────────── Where a request came from ─────────────────────────

  describe('sources', () => {
    it('records a restaurant action as the restaurant app, with the person, outlet, phone and app version', async () => {
      const rows = await rowsMade();
      const added = rows.find((row) => row.action === 'appLogins.user.added');
      expect(added).toMatchObject({
        source: 'RESTAURANT_APP',
        category: 'appLogins',
        result: 'SUCCESS',
        actorRole: 'OWNER',
        organizationId,
        outletId,
        outletName: OUTLET_NAME,
        entityType: 'user',
        entityId: managerId,
        entityLabel: `${MANAGER_NAME} (Manager)`,
        method: 'POST',
        route: '/restaurant-users',
        statusCode: 201,
        client: 'mobile',
        appVersion: '9.9.9-e2e',
      });
      expect(added!.deviceId).toBeTruthy();
      expect(added!.requestId).toBeTruthy();
      expect(added!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("records a Supervisor's action on the phone as the Supervisor's app", async () => {
      const language = (await http().get('/auth/me').set(bearer(supervisor)).expect(200)).body.language as string;
      const answer = await http().patch('/auth/me').set({ ...bearer(supervisor), ...MOBILE }).send({ language }).expect(200);
      const [row] = await rowsFor(answer.headers['x-request-id'] as string);
      expect(row).toMatchObject({ source: 'SUPERVISOR_APP', actorUserId: supervisorId, actorRole: 'SUPERVISOR', action: 'profile.details.changed', category: 'profile', result: 'SUCCESS' });
      expect(row!.details).toEqual({ language, changed: ['language'] });
    });

    it('records the console as the console, from the header or from a browser', async () => {
      const language = (await http().get('/auth/me').set(bearer(admin)).expect(200)).body.language as string;
      const said = await http().patch('/auth/me').set({ ...bearer(admin), ...CONSOLE }).send({ language }).expect(200);
      const browser = await http()
        .patch('/auth/me')
        .set({ ...bearer(admin), 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0' })
        .send({ language })
        .expect(200);
      expect((await rowsFor(said.headers['x-request-id'] as string))[0]).toMatchObject({ source: 'CONSOLE', actorRole: 'SUPER_ADMIN', client: 'console', appVersion: 'console-1' });
      expect((await rowsFor(browser.headers['x-request-id'] as string))[0]).toMatchObject({ source: 'CONSOLE', client: 'console', appVersion: null });
    });

    it('falls back on the phone network library when an older app sends no header', async () => {
      const answer = await http().patch('/auth/me').set({ ...bearer(manager.token), 'User-Agent': 'okhttp/4.12.0' }).send({ language: 'EN' }).expect(200);
      expect((await rowsFor(answer.headers['x-request-id'] as string))[0]).toMatchObject({ source: 'RESTAURANT_APP', client: 'mobile', actorUserId: managerId, outletId });
    });

    it('records a timed job as the server', async () => {
      const before = new Set(activity.recordedForTest());
      activity.jobRun('visits.plans.ran', { created: 3 });
      activity.jobRun('notifications.reminders.ran', { sent: 0 }, { quiet: true });
      await flush();
      const fresh = (await rowsMade()).filter((row) => !before.has(row.id));
      expect(fresh).toHaveLength(1);
      expect(fresh[0]).toMatchObject({ source: 'SYSTEM', action: 'visits.plans.ran', category: 'visits', actorUserId: null, actorName: null, result: 'SUCCESS', details: { created: 3 } });
    });

    it('records a notification the server sends with its kind and the roles told, and never a checklist problem', async () => {
      const ownerId = (await http().get('/auth/me').set(bearer(owner.token)).expect(200)).body.id as string;
      const before = new Set(activity.recordedForTest());
      activity.notificationSent('DOCUMENT_ADDED', [ownerId, managerId], { kind: 'documents', outletId });
      activity.notificationSent('CHECKLIST_PROBLEM', [ownerId], { kind: 'checklist', outletId });
      const fresh = (await rowsMade()).filter((row) => !before.has(row.id));
      expect(fresh).toHaveLength(1);
      expect(fresh[0]).toMatchObject({ source: 'SYSTEM', action: 'notifications.sent', outletId, details: { kind: 'DOCUMENT_ADDED', people: 2, roles: ['MANAGER', 'OWNER'] } });
    });
  });

  // ───────────────────────── Refusals, logins ─────────────────────────

  describe('refusals and logins', () => {
    it('records a refused request as REFUSED, with who tried', async () => {
      const refused = await http().post('/staff/people').set({ ...bearer(chef), ...MOBILE }).send({ outletId, name: SECRET.staffName, payType: 'MONTHLY', payPaise: SECRET.salary }).expect(403);
      const [row] = await rowsFor(refused.headers['x-request-id'] as string);
      expect(row).toMatchObject({ action: 'staff.person.added', result: 'REFUSED', statusCode: 403, actorRole: 'HEAD_CHEF', source: 'RESTAURANT_APP', details: null, entityId: null });
      const nobody = await http().patch('/auth/me').set(MOBILE).send({ language: 'EN' }).expect(401);
      expect((await rowsFor(nobody.headers['x-request-id'] as string))[0]).toMatchObject({ action: 'profile.details.changed', result: 'REFUSED', actorUserId: null, statusCode: 401 });
    });

    it('records a rejected request (bad input) as REJECTED', async () => {
      const bad = await http().post('/issues').set({ ...bearer(manager.token), ...MOBILE }).send({ outletId, category: 'NOPE', description: 'x' }).expect(400);
      expect((await rowsFor(bad.headers['x-request-id'] as string))[0]).toMatchObject({ action: 'issues.issue.raised', result: 'REJECTED', statusCode: 400 });
    });

    it('records a wrong PIN with the outlet and phone, never the PIN or who it was meant for', async () => {
      // A PIN nobody at this restaurant has.
      const taken = new Set((await prisma.client.user.findMany({ where: { pinOrganizationId: organizationId }, select: { pinLookup: true } })).map((user) => user.pinLookup));
      const wrong = ['4705', '5829', '6914', '7058', '8163'].find((pin) => !taken.has(pinLookup(env.PIN_SECRET, organizationId, pin)))!;
      secrets.push(wrong);
      const answer = await http().post('/auth/pin/login').set(MOBILE).send({ deviceToken: manager.deviceToken, pin: wrong }).expect(401);
      const [row] = await rowsFor(answer.headers['x-request-id'] as string);
      const device = await prisma.client.linkedDevice.findFirstOrThrow({ where: { outletId, name: DEVICE } });
      expect(row).toMatchObject({ action: 'auth.pin.wrong', result: 'REFUSED', source: 'RESTAURANT_APP', actorUserId: null, actorName: null, outletId, deviceId: device.id, details: { wrongInARow: 1 } });
    });

    it('records a phone locked after five wrong PINs as a row of its own', async () => {
      const phone = await http().post('/auth/device/link').set(MOBILE).send({ code: OUTLET_CODE, deviceName: DEVICE }).expect(200);
      secrets.push(phone.body.deviceToken as string);
      const taken = new Set((await prisma.client.user.findMany({ where: { pinOrganizationId: organizationId }, select: { pinLookup: true } })).map((user) => user.pinLookup));
      const wrong = ['4705', '5829', '6914', '7058', '8163', '9274'].find((pin) => !taken.has(pinLookup(env.PIN_SECRET, organizationId, pin)))!;
      for (let attempt = 1; attempt <= 4; attempt++) await http().post('/auth/pin/login').set(MOBILE).send({ deviceToken: phone.body.deviceToken, pin: wrong }).expect(401);
      const locking = await http().post('/auth/pin/login').set(MOBILE).send({ deviceToken: phone.body.deviceToken, pin: wrong }).expect(429);
      const rows = await rowsFor(locking.headers['x-request-id'] as string);
      expect(rows.map((row) => row.action).sort()).toEqual(['auth.pin.locked', 'auth.pin.wrong']);
      expect(rows.find((row) => row.action === 'auth.pin.locked')).toMatchObject({ result: 'REFUSED', outletId, source: 'RESTAURANT_APP', details: { lockedMinutes: 15 } });
      const whileLocked = await http().post('/auth/pin/login').set(MOBILE).send({ deviceToken: phone.body.deviceToken, pin: wrong }).expect(429);
      expect((await rowsFor(whileLocked.headers['x-request-id'] as string))[0]).toMatchObject({ action: 'auth.pin.whileLocked', result: 'REFUSED' });
    });

    it('records a right PIN with the person who logged in', async () => {
      const rows = await rowsMade();
      const login = rows.find((row) => row.action === 'auth.pin.login' && row.actorUserId === managerId);
      expect(login).toMatchObject({ result: 'SUCCESS', source: 'RESTAURANT_APP', actorName: MANAGER_NAME, actorRole: 'MANAGER', outletId, client: 'mobile' });
      expect(rows.some((row) => row.action === 'auth.device.linked' && row.outletId === outletId && row.result === 'SUCCESS')).toBe(true);
    });

    it('records a code asked for and a wrong code with the last four digits only, and a console login as the console', async () => {
      await http().post('/auth/otp/request').set(MOBILE).send({ phone: PHONES.supervisor }).expect(200);
      const wrongCode = env.DEV_FIXED_OTP === '987654' ? '876543' : '987654';
      secrets.push(wrongCode, env.DEV_FIXED_OTP!);
      const wrong = await http().post('/auth/otp/verify').set(MOBILE).send({ phone: PHONES.supervisor, code: wrongCode, deviceName: DEVICE }).expect(401);
      const [row] = await rowsFor(wrong.headers['x-request-id'] as string);
      expect(row).toMatchObject({ action: 'auth.otp.wrong', result: 'REFUSED', source: 'SUPERVISOR_APP', actorUserId: null, details: { phoneLast4: '…0003' } });
      const rows = await rowsMade();
      expect(rows.some((entry) => entry.action === 'auth.otp.requested' && entry.source === 'CONSOLE' && (entry.details as { phoneLast4?: string })?.phoneLast4 === '…0001')).toBe(true);
      expect(rows.find((entry) => entry.action === 'auth.otp.verified' && entry.actorRole === 'OPS_MANAGER')).toMatchObject({ source: 'CONSOLE', result: 'SUCCESS' });
    });

    it('records Lock on a linked phone as Lock', async () => {
      const spare = await pinLogin(OUTLET_CODE, managerPin);
      const answer = await http().post('/auth/logout').set({ ...bearer(spare.token), ...MOBILE }).expect(204);
      expect((await rowsFor(answer.headers['x-request-id'] as string))[0]).toMatchObject({ action: 'auth.session.locked', actorUserId: managerId });
    });
  });

  // ───────────────────────── What is kept, and what never is ─────────────────────────

  describe('the restaurant’s private business', () => {
    let runId: string;
    let issueReference: string;
    let photoCheckRequestId: string;
    let aiRequestId: string;

    it('records a checklist hand-in with counts only, and an answer sent later as done offline', async () => {
      const lists = (await http().post('/checklists/setup').set({ ...bearer(manager.token), ...MOBILE }).send({ outletId, title: 'E2E Log Checklist', dueTime: '23:59' }).expect(201)).body as { id: string; title: { en: string } }[];
      const list = lists.find((entry) => entry.title.en === 'E2E Log Checklist')!;
      await http().post(`/checklists/setup/${list.id}/items`).set({ ...bearer(manager.token), ...MOBILE }).send({ label: 'E2E log check one', photoRequired: false }).expect(201);
      await http().post(`/checklists/setup/${list.id}/items`).set({ ...bearer(manager.token), ...MOBILE }).send({ label: 'E2E log check two', photoRequired: false }).expect(201);
      const today = (await http().get('/checklists/today').query({ outletId }).set(bearer(manager.token)).expect(200)).body as {
        id: string;
        title: { en: string };
        items: { id: string }[];
      }[];
      const run = today.find((entry) => entry.title.en === 'E2E Log Checklist')!;
      runId = run.id;
      const [first, second] = run.items;
      // Answered on the phone an hour ago, with no signal, and sent now.
      const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
      const problem = await http()
        .put(`/checklists/runs/${runId}/items/${first!.id}`)
        .set({ ...bearer(manager.token), ...MOBILE })
        .send({ passed: false, note: SECRET.problem, capturedAt: anHourAgo })
        .expect(200);

      // The nudge at the camera (AI), while the checklist is still open.
      ai.setForTest({ on: true, disabled: [], dailyLimitUsd: 1000, outletDailyLimitUsd: 1000 });
      const checked = await http()
        .post(`/checklists/runs/${runId}/items/${second!.id}/photo-check`)
        .set({ ...bearer(manager.token), ...MOBILE })
        .attach('file', JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });
      ai.setForTest({ on: false });
      expect(checked.status, JSON.stringify(checked.body)).toBe(200);
      photoCheckRequestId = checked.headers['x-request-id'] as string;
      aiRequestId = checked.body.aiRequestId as string;

      await http().put(`/checklists/runs/${runId}/items/${second!.id}`).set({ ...bearer(manager.token), ...MOBILE }).send({ passed: true }).expect(200);
      const submitted = await http().post(`/checklists/runs/${runId}/submit`).set({ ...bearer(manager.token), ...MOBILE }).expect(200);

      const [answered] = await rowsFor(problem.headers['x-request-id'] as string);
      expect(answered).toMatchObject({ action: 'checklists.item.answered', entityType: 'checklistRun', entityId: runId, entityLabel: 'E2E Log Checklist', offline: true });
      expect(answered!.phoneAt?.toISOString()).toBe(anHourAgo);
      // Never whether it was a problem: only the run's own state.
      expect(answered!.details).toEqual({ status: expect.any(String) });
      const [handedIn] = await rowsFor(submitted.headers['x-request-id'] as string);
      expect(handedIn).toMatchObject({ action: 'checklists.run.submitted', result: 'SUCCESS', details: { status: 'SUBMITTED', answered: 2, problems: 1 } });
    });

    it('records an AI request as category AI, with its outcome later, beside the request that asked', async () => {
      const rows = await rowsFor(photoCheckRequestId);
      const aiRow = rows.find((row) => row.category === 'ai');
      expect(aiRow).toMatchObject({
        action: 'ai.request.photoCheck',
        source: 'RESTAURANT_APP',
        actorUserId: managerId,
        outletId,
        aiFeature: 'photo-check',
        aiModel: 'claude-haiku-5-5',
        aiStatus: 'OK',
        result: 'SUCCESS',
        entityType: 'aiRequest',
        entityId: aiRequestId,
      });
      expect(aiRow!.aiCostMicroUsd).toBeGreaterThanOrEqual(0);
      // The verdict is never copied into the log.
      expect(JSON.stringify(aiRow!.details)).not.toMatch(/verdict|OK_TO|NOT_DONE/);
      expect(rows.find((row) => row.category === 'checklists')).toMatchObject({ action: 'checklists.photo.checked' });

      await http().post(`/ai/requests/${aiRequestId}/outcome`).set({ ...bearer(manager.token), ...MOBILE }).send({ outcome: 'ACCEPTED' }).expect(204);
      await flush();
      // The AI request's own row (the person's "outcome" request is a row about the same record too).
      const updated = await prisma.client.activityLog.findFirstOrThrow({ where: { entityType: 'aiRequest', entityId: aiRequestId, action: 'ai.request.photoCheck' } });
      expect(updated.aiOutcome).toBe('ACCEPTED');
      expect(updated.details).toMatchObject({ outcome: 'ACCEPTED' });
    });

    it('records an issue by its reference and category, never its words', async () => {
      const raised = await http()
        .post('/issues')
        .set({ ...bearer(manager.token), ...MOBILE })
        .send({ outletId, category: 'HYGIENE', description: SECRET.issue })
        .expect(201);
      issueReference = raised.body.reference as string;
      await http().post(`/issues/${raised.body.id}/comments`).set({ ...bearer(manager.token), ...MOBILE }).send({ body: SECRET.message }).expect(200);
      await http().post(`/issues/${raised.body.id}/comments`).set({ ...bearer(admin), ...CONSOLE }).send({ body: SECRET.message }).expect(200);
      const rows = await rowsMade();
      expect(rows.find((row) => row.action === 'issues.issue.raised' && row.result === 'SUCCESS')).toMatchObject({ reference: issueReference, entityLabel: 'HYGIENE', outletId });
      expect(rows.filter((row) => row.action === 'issues.comment.added').map((row) => row.source).sort()).toEqual(['CONSOLE', 'RESTAURANT_APP']);
    });

    it('records staff, pay and face actions with no name, time, amount or value, and never a clock-in', async () => {
      const added = await http()
        .post('/staff/people')
        .set({ ...bearer(owner.token), ...MOBILE })
        .send({ outletId, name: SECRET.staffName, payType: 'MONTHLY', payPaise: SECRET.salary, jobTitle: 'Secret job title' })
        .expect(201);
      const staffId = added.body.id as string;
      await http().patch(`/staff/people/${staffId}`).set({ ...bearer(owner.token), ...MOBILE }).send({ name: SECRET.staffRename, payPaise: SECRET.salary + 1 }).expect(200);
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const entry = await http()
        .post(`/staff/people/${staffId}/pay-entries`)
        .set({ ...bearer(owner.token), ...MOBILE })
        .send({ kind: 'ADVANCE', month: month.slice(0, 7), date: month, amountPaise: SECRET.advance, note: SECRET.payNote })
        .expect(201);
      const entryId = (entry.body.entries as { id: string }[])[0]!.id;
      await http().delete(`/staff/pay-entries/${entryId}`).set({ ...bearer(owner.token), ...MOBILE }).expect(200);
      // Clocking in and a face scan, refused or not, are never recorded.
      await http().post('/attendance/clock/confirm').set(MOBILE).send({ deviceToken: manager.deviceToken, ticket: 'no-such-ticket' });
      await http().post('/attendance/clock/identify').set(MOBILE).field('deviceToken', manager.deviceToken);
      // "0000" is never anyone's PIN, so no punch is made.
      await http().post('/attendance/clock/assisted').set(MOBILE).field('deviceToken', manager.deviceToken).field('approverPin', '0000').field('staffId', staffId);

      const rows = (await rowsMade()).filter((row) => row.category === 'staff');
      const actions = rows.map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(['staff.person.added', 'staff.person.changed', 'staff.pay.entryAdded', 'staff.pay.entryRemoved']));
      for (const row of rows) {
        expect(row, row.action).toMatchObject({ entityId: null, entityLabel: null, reference: null, details: null, phoneAt: null });
        if (row.result === 'SUCCESS') expect(row).toMatchObject({ outletId, organizationId, actorRole: 'OWNER' });
      }
      expect((await rowsMade()).some((row) => (row.route ?? '').startsWith('/attendance/clock'))).toBe(false);
    });

    it('lets no row carry a PIN, a code, a token, a phone number, typed text, a checklist problem or a staff detail', async () => {
      const rows = await rowsMade();
      expect(rows.length).toBeGreaterThan(30);
      const everything = rows.map((row) => JSON.stringify(row)).join('\n');
      const longSecrets = secrets.filter((value) => value.length >= 12);
      for (const value of [...longSecrets, SECRET.problem, SECRET.message, SECRET.issue, SECRET.staffName, SECRET.staffRename, SECRET.payNote, 'Secret job title', CODES.kukatpally, OUTLET_CODE, '9000000001', '9000000002', '9000000003']) {
        expect(everything.includes(value), value).toBe(false);
      }
      // Short secrets (PINs, the code) could appear by chance inside an id, so only the readable fields are searched.
      // (The AI's token counts are left out: a count could equal a PIN by chance.)
      const facts = (details: unknown) =>
        JSON.stringify(Object.fromEntries(Object.entries((details ?? {}) as Record<string, unknown>).filter(([name]) => !name.endsWith('Tokens'))));
      const readable = rows
        .map((row) => [row.actorName, row.organizationName, row.outletName, row.entityLabel, row.reference, row.route, row.ip, row.appVersion, facts(row.details)].join(' '))
        .join('\n');
      for (const value of [...secrets.filter((value) => value.length < 12), String(SECRET.salary), String(SECRET.advance), String(SECRET.salary + 1), PINS.owner, PINS.chef]) {
        expect(readable.includes(value), value).toBe(false);
      }
      expect(issueReference).toMatch(/^ECCS-\d{4,}$/);
    });

    describe('reading', () => {
      it('is for the Super Admin and the Ops Manager only', async () => {
        for (const token of [supervisor, owner.token, manager.token, chef]) await http().get('/activity-log').set(bearer(token)).expect(403);
        await http().get('/activity-log').expect(401);
        for (const path of ['/activity-log/facets', '/activity-log/summary', '/activity-log/export']) await http().get(path).set(bearer(supervisor)).expect(403);
        await http().get('/activity-log').set(bearer(admin)).expect(200);
        await http().get('/activity-log').set(bearer(opsManager)).expect(200);
      });

      it('lists newest first, a page at a time with a cursor', async () => {
        const first = await list(admin, { outletId, limit: '3' });
        expect(first.entries).toHaveLength(3);
        expect(first.nextCursor).toBeTruthy();
        const second = await list(admin, { outletId, limit: '3', cursor: first.nextCursor! });
        const all = [...first.entries, ...second.entries];
        expect(new Set(all.map((entry) => entry.id)).size).toBe(all.length);
        for (let i = 1; i < all.length; i++) expect(all[i - 1]!.at >= all[i]!.at).toBe(true);
        expect(first.entries[0]).toMatchObject({ outletName: OUTLET_NAME, sourceLabel: expect.any(String), actionLabel: expect.any(String), categoryLabel: expect.any(String), resultLabel: expect.any(String) });
      });

      it('applies every filter, alone and together', async () => {
        const check = async (query: Record<string, string>, each: (entry: ActivityLogEntryDto) => boolean, atLeast = 1) => {
          const page = await list(admin, { ...query, limit: '200' });
          expect(page.entries.length, JSON.stringify(query)).toBeGreaterThanOrEqual(atLeast);
          for (const entry of page.entries) expect(each(entry), `${JSON.stringify(query)} ${entry.action}`).toBe(true);
          return page.entries;
        };
        await check({ source: 'RESTAURANT_APP' }, (entry) => entry.source === 'RESTAURANT_APP');
        await check({ source: 'SUPERVISOR_APP,CONSOLE' }, (entry) => ['SUPERVISOR_APP', 'CONSOLE'].includes(entry.source), 2);
        await check({ organizationId }, (entry) => entry.organizationId === organizationId);
        await check({ outletId }, (entry) => entry.outletId === outletId);
        await check({ actorUserId: managerId }, (entry) => entry.actorUserId === managerId);
        await check({ role: 'OWNER,HEAD_CHEF' }, (entry) => ['OWNER', 'HEAD_CHEF'].includes(entry.actorRole ?? ''), 2);
        await check({ category: 'staff' }, (entry) => entry.category === 'staff');
        await check({ action: 'checklists.run.submitted' }, (entry) => entry.action === 'checklists.run.submitted');
        await check({ result: 'REJECTED' }, (entry) => entry.result === 'REJECTED');
        await check({ failuresOnly: '1' }, (entry) => entry.result !== 'SUCCESS', 3);
        await check({ entityType: 'checklistRun', entityId: runId }, (entry) => entry.entityId === runId, 3);
        await check({ reference: issueReference.toLowerCase() }, (entry) => entry.reference === issueReference, 2);
        await check({ deviceId: (await prisma.client.linkedDevice.findFirstOrThrow({ where: { outletId, name: DEVICE } })).id }, (entry) => entry.deviceId !== null);
        const ip = (await list(admin, { outletId, limit: '1' })).entries[0]!.ip!;
        await check({ ip }, (entry) => entry.ip === ip);
        await check({ client: 'console' }, (entry) => entry.client === 'console');
        await check({ requestId: photoCheckRequestId }, (entry) => entry.requestId === photoCheckRequestId, 2);
        await check({ offline: '1' }, (entry) => entry.offline);
        await check({ aiFeature: 'photo-check' }, (entry) => entry.ai?.feature === 'photo-check');
        await check({ aiModel: 'claude-haiku-5-5' }, (entry) => entry.ai?.model === 'claude-haiku-5-5');
        await check({ aiStatus: 'OK' }, (entry) => entry.ai?.status === 'OK');
        await check({ aiOutcome: 'ACCEPTED' }, (entry) => entry.ai?.outcome === 'ACCEPTED');
        await check({ q: MANAGER_NAME.toLowerCase() }, (entry) => entry.actorName === MANAGER_NAME || (entry.entityLabel ?? '').includes(MANAGER_NAME));
        await check({ q: 'handed in' }, (entry) => entry.action === 'checklists.run.submitted');
        await check({ q: issueReference }, (entry) => entry.reference === issueReference, 2);
        await check({ outletId, category: 'checklists', source: 'RESTAURANT_APP', result: 'SUCCESS' }, (entry) => entry.outletId === outletId && entry.category === 'checklists' && entry.result === 'SUCCESS', 4);
        // A period that ended before the suite began has none of its rows.
        const before = new Date(startedAt.getTime() - 1).toISOString();
        const none = (await http().get('/activity-log').query({ to: before, outletId }).set(bearer(admin)).expect(200)).body as ActivityLogPageDto;
        expect(none.entries).toEqual([]);
        await http().get('/activity-log').query({ source: 'PHONE' }).set(bearer(admin)).expect(400);
      });

      it('gives the filter menus with counts, each menu counted under the other filters', async () => {
        const facets = (await http().get('/activity-log/facets').query({ from: startedAt.toISOString(), outletId }).set(bearer(admin)).expect(200)).body as ActivityLogFacetsDto;
        expect(facets.outlets.find((option) => option.value === outletId)).toMatchObject({ label: OUTLET_NAME, organizationId });
        expect(facets.organizations.some((option) => option.value === organizationId)).toBe(true);
        expect(facets.people.find((option) => option.value === managerId)).toMatchObject({ label: MANAGER_NAME, role: 'MANAGER' });
        expect(facets.categories.map((option) => option.value)).toEqual(expect.arrayContaining(['checklists', 'staff', 'issues']));
        expect(facets.actions.find((option) => option.value === 'checklists.run.submitted')).toMatchObject({ category: 'checklists', label: 'Handed in a checklist', count: 1 });
        expect(facets.sources.find((option) => option.value === 'RESTAURANT_APP')!.count).toBeGreaterThan(5);
        expect(facets.roles.some((option) => option.value === 'MANAGER')).toBe(true);
        expect(facets.aiFeatures.find((option) => option.value === 'photo-check')!.count).toBe(1);
        expect(facets.results.map((option) => option.value)).toEqual(expect.arrayContaining(['SUCCESS', 'REFUSED']));
        for (const option of facets.categories) expect(option.count).toBeGreaterThan(0);
      });

      it('sums up the current filters', async () => {
        const query = { from: startedAt.toISOString(), outletId };
        const summary = (await http().get('/activity-log/summary').query(query).set(bearer(admin)).expect(200)).body as ActivityLogSummaryDto;
        const all = await list(admin, { outletId, limit: '200' });
        expect(summary.events).toBe(all.entries.length);
        expect(summary.failures).toBe(all.entries.filter((entry) => entry.result !== 'SUCCESS').length);
        expect(summary.failures).toBe(summary.refused + summary.rejected + summary.failed);
        expect(summary.people).toBe(new Set(all.entries.map((entry) => entry.actorUserId).filter(Boolean)).size);
        expect(summary.aiCalls).toBe(1);
        expect(summary.aiCostUsd).toBeGreaterThanOrEqual(0);
        expect(summary.offline).toBeGreaterThanOrEqual(1);
      });

      it('shows one event in full, with what the server did for the same request', async () => {
        const row = (await list(admin, { requestId: photoCheckRequestId, category: 'checklists' })).entries[0]!;
        const event = (await http().get(`/activity-log/${row.id}`).set(bearer(admin)).expect(200)).body as ActivityLogEventDto;
        expect(event).toMatchObject({ id: row.id, action: 'checklists.photo.checked', route: '/checklists/runs/:runId/items/:itemId/photo-check' });
        expect(event.related.map((entry) => entry.action)).toEqual(['ai.request.photoCheck']);
        await http().get('/activity-log/no-such-entry').set(bearer(admin)).expect(404);
        await http().get(`/activity-log/${row.id}`).set(bearer(supervisor)).expect(403);
      });

      it('exports the current filters as CSV, safe to open in a spreadsheet, and logs the export', async () => {
        const answer = await http()
          .get('/activity-log/export')
          .query({ from: startedAt.toISOString(), outletId, q: OUTLET_NAME.slice(1) })
          .set({ ...bearer(opsManager), ...CONSOLE })
          .buffer(true)
          .parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks).toString('utf8')));
          })
          .expect(200)
          .expect('Content-Type', /text\/csv/)
          .expect('Content-Disposition', /attachment; filename="eccs-activity-\d{4}-\d{2}-\d{2}\.csv"/);
        const csv = answer.body as string;
        expect(csv.startsWith('﻿Time (India),Time (UTC),Source,Person')).toBe(true);
        // The outlet's name starts with "=": it must not run as a formula.
        expect(csv).toContain(`'${OUTLET_NAME}`);
        expect(csv).not.toMatch(/,=E2E/);
        const [logged] = await rowsFor(answer.headers['x-request-id'] as string);
        expect(logged).toMatchObject({ action: 'system.logs.exported', source: 'CONSOLE', actorRole: 'OPS_MANAGER', result: 'SUCCESS', outletId: null });
        expect((logged!.details as { rows: number; filters: string[] }).filters).toEqual(['from', 'outletId', 'q']);
        // The names of the filters, never the words searched for.
        expect(JSON.stringify(logged)).not.toContain(OUTLET_NAME.slice(1));
        expect((logged!.details as { rows: number }).rows).toBeGreaterThan(20);
        expect(Number(answer.headers['x-export-rows'])).toBe((logged!.details as { rows: number }).rows);
      });
    });
  });

  // ───────────────────────── Safety ─────────────────────────

  describe('safety', () => {
    it('never fails a request when the log cannot be written', async () => {
      activity.setForTest({ failWrites: true });
      const answer = await http().patch('/auth/me').set({ ...bearer(manager.token), ...MOBILE }).send({ language: 'EN' }).expect(200);
      expect(answer.body.id).toBe(managerId);
      await flush();
      activity.setForTest({ failWrites: false });
      expect(await prisma.client.activityLog.count({ where: { requestId: answer.headers['x-request-id'] as string } })).toBe(0);
    });

    it('records nothing while switched off', async () => {
      activity.setForTest({ on: false });
      const answer = await http().patch('/auth/me').set({ ...bearer(manager.token), ...MOBILE }).send({ language: 'EN' }).expect(200);
      activity.setForTest({ on: true });
      await flush();
      expect(await prisma.client.activityLog.count({ where: { requestId: answer.headers['x-request-id'] as string } })).toBe(0);
    });

    it('deletes rows older than the keeping period and records how many', async () => {
      const day = 86_400_000;
      const old = (days: number) => ({
        at: new Date(Date.now() - days * day),
        source: 'SYSTEM',
        category: 'system',
        action: 'system.server.started',
        result: 'SUCCESS',
        requestId: `e2e-retention-${days}`,
      });
      const made = await prisma.client.activityLog.createManyAndReturn({ data: [old(env.ACTIVITY_LOG_DAYS + 5), old(env.ACTIVITY_LOG_DAYS + 40), old(env.ACTIVITY_LOG_DAYS - 5)], select: { id: true } });
      insertedIds.push(...made.map((row) => row.id));
      const before = new Set(activity.recordedForTest());
      const { deleted } = await activity.prune();
      expect(deleted).toBeGreaterThanOrEqual(2);
      const left = await prisma.client.activityLog.findMany({ where: { id: { in: insertedIds } } });
      expect(left.map((row) => row.requestId)).toEqual([`e2e-retention-${env.ACTIVITY_LOG_DAYS - 5}`]);
      const recorded = (await rowsMade()).filter((row) => !before.has(row.id));
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ action: 'system.logs.pruned', source: 'SYSTEM', details: { deleted, keepDays: env.ACTIVITY_LOG_DAYS } });
    });
  });
});
