// The AI usage page and the AI settings (Stage F, 19 Oct 2026): only the Super Admin
// changes the settings and the Ops Manager reads them; a helper switched off answers OFF
// on its next request; a helper's model, changed in the console, is the model its next
// request asks for; the monthly limit and the outlet's daily limit refuse; the overview's
// figures are exactly the rows of a throwaway outlet and the filters narrow them; the log
// pages through them; the CSV has the rows and no words of a prompt; every change reaches
// the activity log.
//
// Anthropic is never called: the fake engine answers. The settings row the tests write is
// the tests' own ("e2e"), never the server's ("main"). Everything is a throwaway made
// here and removed by the ids recorded: two outlets, three sessions made straight in the
// database for the sample Super Admin, Ops Manager and an Owner (no login codes asked
// for), the AiRequest rows inserted or made, the activity log rows, and the settings row.

import { createHash, randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { addDays, type AiOverviewDto, type AiRequestPageDto, type AiSettingsDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { ActivityLogService } from './../src/activity-log/activity-log.service.js';
import { AI_ENGINE } from './../src/ai/ai-engine.js';
import { LICENCE_READER_INSTRUCTIONS } from './../src/ai/ai-prompts.js';
import { AiSettingsService } from './../src/ai/ai-settings.service.js';
import { AiService } from './../src/ai/ai.service.js';
import { FakeAiEngine } from './../src/ai/fake-ai-engine.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { LicenceReaderService } from './../src/licences/licence-reader.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const PHONES = { admin: '+919000000001', ops: '+919000000002' };
const DECCAN = 'DECCA-KP6R3T';
const OUTLETS = { a: 'E2EAIU-OUT001', b: 'E2EAIU-OUT002' };
const SETTINGS_ROW = AiSettingsService.testRowId;
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e ai usage licence photo')]);
const HARD_PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('FAKE-AI:NEEDS-SONNET e2e ai usage')]);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('AI usage and the AI settings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ai: AiService;
  let config: AiSettingsService;
  let fake: FakeAiEngine;
  let reader: LicenceReaderService;
  let activity: ActivityLogService;
  let admin: string;
  let ops: string;
  let owner: string;
  let adminId: string;
  let organizationId: string;
  const outletIds: Record<'a' | 'b', string> = { a: '', b: '' };
  const made = { sessions: [] as string[], aiRows: [] as string[], logRowsBefore: new Set<string>(), settingsBefore: null as { settings: unknown; history: unknown } | null };

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, 'X-ECCS-Client': 'console' });
  const save = (token: string, change: object) => http().patch('/ai/settings').set(bearer(token)).send(change);
  const overview = async (filters: Record<string, string>): Promise<AiOverviewDto> => (await http().get('/ai/overview').query(filters).set(bearer(admin)).expect(200)).body;
  const whoAt = (outletId: string) => ({ userId: adminId, organizationId, outletId });
  const askExplain = (outletId: string) =>
    ai.run({
      feature: 'explain-score',
      model: ai.modelFor('explain-score'),
      instructions: 'e2e',
      text: 'e2e',
      answer: { schema: {}, check: { safeParse: (value: unknown) => ({ success: true, data: value }) } as never },
      maxOutputTokens: 10,
      who: whoAt(outletId),
      facts: { costingPoints: [] },
    });

  /** A session made straight in the database for a sample login: its id is recorded and removed by it. */
  async function session(userId: string): Promise<string> {
    const token = randomBytes(24).toString('hex');
    const row = await prisma.client.session.create({ data: { userId, tokenHash: sha256(token), deviceName: 'e2e AI usage', expiresAt: new Date(Date.now() + 3_600_000) } });
    made.sessions.push(row.id);
    return token;
  }

  async function cleanUp() {
    const db = prisma.client;
    if (ai) await db.aiRequest.deleteMany({ where: { id: { in: [...ai.recordedForTest(), ...made.aiRows] } } });
    if (activity) await db.activityLog.deleteMany({ where: { id: { in: activity.recordedForTest().filter((id) => !made.logRowsBefore.has(id)) } } });
    // The tests' own settings row: put back as it was, or removed when there was none.
    if (made.settingsBefore) {
      await db.aiSettings.update({ where: { id: SETTINGS_ROW }, data: made.settingsBefore as never });
    } else {
      await db.aiSettings.deleteMany({ where: { id: SETTINGS_ROW } });
    }
    await db.session.deleteMany({ where: { id: { in: made.sessions } } });
    const ids = Object.values(outletIds).filter(Boolean);
    if (ids.length > 0) await db.outlet.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    ai = app.get(AiService);
    config = app.get(AiSettingsService);
    fake = app.get<FakeAiEngine>(AI_ENGINE);
    reader = app.get(LicenceReaderService);
    activity = app.get(ActivityLogService);
    expect(fake).toBeInstanceOf(FakeAiEngine);
    reader.setReaderForTest('ai');

    const db = prisma.client;
    const before = await db.aiSettings.findUnique({ where: { id: SETTINGS_ROW } });
    made.settingsBefore = before ? { settings: before.settings, history: before.history } : null;
    await db.aiSettings.deleteMany({ where: { id: SETTINGS_ROW } });
    config.forgetForTest();

    const deccan = await db.outlet.findUniqueOrThrow({ where: { code: DECCAN } });
    organizationId = deccan.organizationId;
    for (const key of ['a', 'b'] as const) {
      outletIds[key] = (await db.outlet.create({ data: { organizationId, name: `E2E AI usage outlet ${key.toUpperCase()}`, code: OUTLETS[key], address: 'Test Road' } })).id;
    }
    const sampleAdmin = await db.user.findUniqueOrThrow({ where: { phone: PHONES.admin } });
    const sampleOps = await db.user.findUniqueOrThrow({ where: { phone: PHONES.ops } });
    const sampleOwner = await db.membership.findFirstOrThrow({ where: { organizationId, role: 'OWNER' } });
    adminId = sampleAdmin.id;
    admin = await session(sampleAdmin.id);
    ops = await session(sampleOps.id);
    owner = await session(sampleOwner.userId);
    // The server's own switches on; the limits are the tests' settings row's, saved below.
    ai.setForTest({ on: true, disabled: [] });
  }, 60_000);

  afterAll(async () => {
    ai?.setForTest({ on: false });
    reader?.setReaderForTest(env.LICENCE_READER);
    activity?.setForTest({ on: false });
    if (prisma) await cleanUp();
    await app?.close();
  });

  beforeEach(() => fake.reset());

  it('lets only the Super Admin change the settings; the Ops Manager reads them; nobody else sees the page', async () => {
    const read = (await http().get('/ai/settings').set(bearer(ops)).expect(200)).body as AiSettingsDto;
    expect(read.canChange).toBe(false);
    // Nothing saved yet: today's .env defaults.
    expect(read.settings.limits).toEqual({ dailyUsd: 2, monthlyUsd: null, outletDailyUsd: 0.25 });
    expect(read.server).toMatchObject({ aiOn: true, keySet: true, engine: 'fake', disabled: [], fromEnv: false });
    await save(ops, { limits: { dailyUsd: 3 } }).expect(403);
    for (const path of ['/ai/settings', '/ai/overview', '/ai/requests', '/ai/alerts']) await http().get(path).set(bearer(owner)).expect(403);

    // Limits high enough that anyone's real spending today cannot get in the way of these tests.
    const saved = (await save(admin, { limits: { dailyUsd: 150, outletDailyUsd: 50 } }).expect(200)).body as AiSettingsDto;
    expect(saved.canChange).toBe(true);
    expect(saved.settings.limits).toEqual({ dailyUsd: 150, monthlyUsd: null, outletDailyUsd: 50 });
    expect(saved.history[0]).toMatchObject({ by: expect.any(String), role: 'Super Admin' });
    expect(saved.history[0]!.changes).toEqual([
      { section: 'limits', label: 'Daily limit, everything', from: 'US$2.00', to: 'US$150.00' },
      { section: 'limits', label: 'Daily limit, per outlet', from: 'US$0.25', to: 'US$50.00' },
    ]);
    expect(saved.sections.limits).toMatchObject({ by: saved.history[0]!.by });
    expect(saved.sections.helpers).toBeNull();
    // The Ops Manager sees the change.
    expect(((await http().get('/ai/settings').set(bearer(ops)).expect(200)).body as AiSettingsDto).settings.limits.dailyUsd).toBe(150);
  });

  it('refuses values out of bounds, a model a helper does not allow, and anything unknown', async () => {
    expect((await save(admin, { helpers: { 'photo-check': { model: 'opus' } } }).expect(400)).body.message).toBe('Camera nudge cannot use Opus 5.5: choose Haiku 5.5 or Sonnet 5.5');
    expect((await save(admin, { limits: { dailyUsd: 5000 } }).expect(400)).body.message).toBe('The daily limit can be at most US$200');
    expect((await save(admin, { limits: { outletDailyUsd: 151 } }).expect(400)).body.message).toBe('The per-outlet limit can be at most US$50');
    await save(admin, { limitz: { dailyUsd: 1 } }).expect(400);
    await save(admin, { helpers: { 'no-such-helper': { on: false } } }).expect(400);
    // Nothing of those was saved.
    expect(config.current.helpers['photo-check'].model).toBe('haiku');
  });

  it('switching a helper off makes its next request come back OFF, and so does switching them all off', async () => {
    await save(admin, { helpers: { 'explain-score': { on: false } } }).expect(200);
    expect((await http().get('/ai/status').set(bearer(owner)).expect(200)).body.features['explain-score']).toBe(false);
    const off = await askExplain(outletIds.a);
    expect(off).toMatchObject({ ok: false, code: 'AI_OFF' });
    expect((await prisma.client.aiRequest.findUniqueOrThrow({ where: { id: off.requestId! } })).status).toBe('OFF');
    expect(fake.calls).toHaveLength(0);

    await save(admin, { helpers: { 'explain-score': { on: true } } }).expect(200);
    expect(await askExplain(outletIds.a)).toMatchObject({ ok: true });

    await save(admin, { allOn: false }).expect(200);
    expect(Object.values((await http().get('/ai/status').set(bearer(owner)).expect(200)).body.features).every((on) => on === false)).toBe(true);
    expect(await askExplain(outletIds.a)).toMatchObject({ ok: false, code: 'AI_OFF' });
    const alerts = (await http().get('/ai/alerts').set(bearer(ops)).expect(200)).body as { warnings: { kind: string }[] };
    expect(alerts.warnings.map((warning) => warning.kind)).toContain('CONSOLE_OFF');
    await save(admin, { allOn: true }).expect(200);
  });

  it("changing a helper's model makes its next request ask for that model, and the log keeps it", async () => {
    await save(admin, { helpers: { 'licence-reader': { model: 'sonnet' } }, licenceReader: { secondModel: 'opus' } }).expect(200);
    const reading = await reader.read(PHOTO, 'image/jpeg', whoAt(outletIds.a));
    expect(reading).toMatchObject({ source: 'ai', number: '13622012000456' });
    expect(fake.calls.map((call) => call.model)).toEqual(['claude-sonnet-5-5']);
    expect((await prisma.client.aiRequest.findUniqueOrThrow({ where: { id: (reading as { aiRequestId: string }).aiRequestId } })).model).toBe('claude-sonnet-5-5');

    // The second try, with the model chosen for it, and not at all when switched off.
    fake.reset();
    await save(admin, { helpers: { 'licence-reader': { model: 'haiku' } } }).expect(200);
    await reader.read(HARD_PHOTO, 'image/jpeg', whoAt(outletIds.a));
    expect(fake.calls.map((call) => call.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    fake.reset();
    await save(admin, { licenceReader: { secondTry: false } }).expect(200);
    await reader.read(HARD_PHOTO, 'image/jpeg', whoAt(outletIds.a));
    expect(fake.calls.map((call) => call.model)).toEqual(['claude-haiku-5-5']);
    await save(admin, { licenceReader: { secondTry: true, secondModel: 'sonnet' } }).expect(200);
  });

  it('refuses at the monthly limit, and still at the outlet\'s daily limit (ECCS\'s own work aside)', async () => {
    const today = indiaDate();
    const monthSpent = (await prisma.client.aiRequest.aggregate({ where: { createdAt: { gte: new Date(`${today.slice(0, 7)}-01T00:00:00.000+05:30`) } }, _sum: { costMicroUsd: true } }))._sum.costMicroUsd ?? 0;
    // The smallest monthly limit is US$1: a month that has not spent that yet gets a throwaway row that makes it so.
    if (monthSpent < 1_000_000) {
      const row = await prisma.client.aiRequest.create({ data: { feature: 'photo-check', model: 'claude-haiku-5-5', outletId: outletIds.a, organizationId, costMicroUsd: 1_000_000 - monthSpent + 1, status: 'OK', source: 'SYSTEM' } });
      made.aiRows.push(row.id);
    }
    await save(admin, { limits: { monthlyUsd: 1 } }).expect(200);
    const refused = await askExplain(outletIds.a);
    expect(refused).toMatchObject({ ok: false, code: 'AI_LIMIT' });
    expect((await prisma.client.aiRequest.findUniqueOrThrow({ where: { id: refused.requestId! } })).errorCode).toBe('MONTH_LIMIT');

    await save(admin, { limits: { monthlyUsd: null, outletDailyUsd: 0 } }).expect(200);
    const capped = await askExplain(outletIds.a);
    expect(capped).toMatchObject({ ok: false, code: 'AI_LIMIT' });
    expect((await prisma.client.aiRequest.findUniqueOrThrow({ where: { id: capped.requestId! } })).errorCode).toBe('OUTLET_LIMIT');
    // ECCS's own work at the same outlet counts against the overall limit only.
    const own = await ai.run({
      feature: 'inspection-summary',
      model: ai.modelFor('inspection-summary'),
      instructions: 'e2e',
      text: 'e2e',
      answer: { schema: {}, check: { safeParse: (value: unknown) => ({ success: true, data: value }) } as never },
      maxOutputTokens: 10,
      who: whoAt(outletIds.a),
      facts: { outlet: 'E2E', score: 90, outOf: 100, findings: [] },
    });
    expect(own.ok).toBe(true);
    expect(fake.calls.map((call) => call.model)).toEqual(['claude-sonnet-5-5']);
    await save(admin, { limits: { outletDailyUsd: 50 } }).expect(200);
  });

  describe("the overview, the log and the CSV, for a throwaway outlet's own rows", () => {
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    const rows: { key: string; data: Record<string, unknown> }[] = [];

    beforeAll(async () => {
      const outletId = outletIds.b;
      const base = { organizationId, outletId, userId: adminId };
      // Two days: a few seconds ago, and a day ago (yesterday in India, whatever the hour).
      const recent = at(0.1);
      const dayAgo = at(24 * 60);
      rows.push(
        { key: 'nudge1', data: { ...base, feature: 'photo-check', model: 'claude-haiku-5-5', status: 'OK', costMicroUsd: 1000, inputTokens: 900, outputTokens: 40, durationMs: 800, outcome: 'ACCEPTED', source: 'RESTAURANT_APP', createdAt: recent } },
        { key: 'nudge2', data: { ...base, feature: 'photo-check', model: 'claude-haiku-5-5', status: 'OK', costMicroUsd: 1500, inputTokens: 950, outputTokens: 45, durationMs: 1200, outcome: 'DISCARDED', source: 'RESTAURANT_APP', createdAt: recent } },
        { key: 'buddy', data: { ...base, feature: 'buddy', model: 'claude-sonnet-5-5', status: 'OK', costMicroUsd: 5000, inputTokens: 1300, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 200, durationMs: 3000, source: 'RESTAURANT_APP', createdAt: dayAgo } },
        { key: 'capped', data: { ...base, feature: 'explain-score', model: 'claude-haiku-5-5', status: 'LIMIT', errorCode: 'OUTLET_LIMIT', costMicroUsd: 0, source: 'RESTAURANT_APP', createdAt: recent } },
        { key: 'failed', data: { ...base, feature: 'licence-reader', model: 'claude-haiku-5-5', status: 'ERROR', errorCode: 'TIMEOUT', costMicroUsd: 200, inputTokens: 1700, durationMs: 45000, source: 'CONSOLE', createdAt: recent } },
        { key: 'writeUp', data: { ...base, feature: 'inspection-summary', model: 'claude-sonnet-5-5', status: 'OK', costMicroUsd: 7000, inputTokens: 1500, outputTokens: 300, durationMs: 9000, source: 'SUPERVISOR_APP', createdAt: recent } },
      );
      for (const row of rows) made.aiRows.push((await prisma.client.aiRequest.create({ data: row.data as never })).id);
    });

    it("sums exactly the outlet's rows: cards, helpers, the outlet, ECCS's own use, models, the days, where it ran", async () => {
      const view = await overview({ period: '7d', outlet: outletIds.b });
      expect(view.cards.spent).toEqual({ usd: 0.0147, requests: 6 });
      expect(view.cards.refused).toEqual({ requests: 1, outletsCapped: 1 });
      // Today against the outlet's own cap, with one outlet in view.
      expect(view.cards.today).toMatchObject({ usd: 0.0097, limitUsd: 50, against: 'outlet' });

      const helper = (feature: string) => view.helpers.find((row) => row.feature === feature)!;
      expect(helper('photo-check')).toMatchObject({ requests: 2, costUsd: 0.0025, tries: 2, failed: 0, refused: 0, medianMs: 1000, outcomes: { accepted: 1, edited: 0, discarded: 1, helpful: 0, notHelpful: 0 } });
      expect(helper('buddy')).toMatchObject({ requests: 1, costUsd: 0.005, tries: 1 });
      expect(helper('explain-score')).toMatchObject({ requests: 1, costUsd: 0, tries: 0, refused: 1 });
      expect(helper('licence-reader')).toMatchObject({ requests: 1, tries: 1, failed: 1, medianMs: null });
      expect(helper('inspection-summary')).toMatchObject({ requests: 1, costUsd: 0.007, share: 48 });
      // Every helper is listed, the costliest first.
      expect(view.helpers).toHaveLength(11);
      expect(view.helpers[0]!.feature).toBe('inspection-summary');

      // The outlet's row leaves out ECCS's own work, which is ECCS's own use.
      expect(view.outlets).toHaveLength(1);
      expect(view.outlets[0]).toMatchObject({ outletId: outletIds.b, requests: 5, costUsd: 0.0077, plan: null, invoicedPaise: 0, ofPayPercent: null, top: ['buddy', 'photo-check'] });
      expect(view.outlets[0]!.capDays).toEqual([indiaDate()]);
      expect(view.eccsOwn).toEqual({ requests: 1, costUsd: 0.007, top: ['inspection-summary'] });

      expect(view.models).toEqual([
        { model: 'claude-sonnet-5-5', requests: 2, inputTokens: 2800, outputTokens: 500, cacheReadTokens: 300, cacheWriteTokens: 0, costUsd: 0.012 },
        { model: 'claude-haiku-5-5', requests: 4, inputTokens: 3550, outputTokens: 85, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.0027 },
      ]);
      expect(Object.fromEntries(view.bySource.map((entry) => [entry.source, entry.usd]))).toEqual({ SUPERVISOR_APP: 0.007, RESTAURANT_APP: 0.0075, CONSOLE: 0.0002 });

      // Two weeks of days ending today; today's limit day is the outlet's own cap.
      expect(view.daily.days).toHaveLength(14);
      const lastTwo = view.daily.days.slice(-2);
      expect(lastTwo.map((day) => day.date)).toEqual([addDays(indiaDate(), -1), indiaDate()]);
      expect(lastTwo.map((day) => day.usd)).toEqual([0.005, 0.0097]);
      expect(lastTwo.map((day) => day.limitHit)).toEqual([false, true]);
      expect(view.daily.days.reduce((sum, day) => sum + day.requests, 0)).toBe(6);
    });

    it('narrows to the filters chosen', async () => {
      const spent = async (filters: Record<string, string>) => (await overview({ period: '7d', outlet: outletIds.b, ...filters })).cards.spent;
      expect(await spent({ feature: 'photo-check' })).toEqual({ usd: 0.0025, requests: 2 });
      expect(await spent({ result: 'limit' })).toEqual({ usd: 0, requests: 1 });
      expect(await spent({ result: 'answered,failed' })).toEqual({ usd: 0.0147, requests: 5 });
      expect(await spent({ source: 'CONSOLE' })).toEqual({ usd: 0.0002, requests: 1 });
      expect(await spent({ model: 'claude-sonnet-5-5' })).toEqual({ usd: 0.012, requests: 2 });
      expect(await spent({ period: 'today' })).toEqual({ usd: 0.0097, requests: 5 });
      expect(await spent({ org: organizationId, feature: 'buddy' })).toEqual({ usd: 0.005, requests: 1 });
      // A day with nothing.
      const before = addDays(indiaDate(), -9);
      expect(await spent({ period: 'custom', from: before, to: before })).toEqual({ usd: 0, requests: 0 });
      // The filter menus list the outlet with its count.
      const view = await overview({ period: '7d', outlet: outletIds.b });
      expect(view.facets.outlets.find((option) => option.value === outletIds.b)).toMatchObject({ count: 6, label: 'E2E AI usage outlet B' });
      await http().get('/ai/overview').query({ feature: 'no-such-helper' }).set(bearer(admin)).expect(400);
    });

    it('lists the requests newest first, a page at a time, with who asked', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 4; page += 1) {
        const body = (await http().get('/ai/requests').query({ period: '7d', outlet: outletIds.b, limit: '4', ...(cursor && { cursor }) }).set(bearer(ops)).expect(200)).body as AiRequestPageDto;
        expect(body.total).toBe(6);
        seen.push(...body.entries.map((entry) => entry.id));
        if (page === 0) expect(body.entries[0]).toMatchObject({ outletName: 'E2E AI usage outlet B', person: { role: 'Super Admin' } });
        cursor = body.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(new Set(seen)).toEqual(new Set(made.aiRows.slice(-6)));
      expect(seen.at(-1)).toBe(made.aiRows.at(-4));
    });

    it('exports the rows as CSV, with no words of any prompt', async () => {
      const file = await http().get('/ai/requests/export').query({ period: '7d', outlet: outletIds.b }).set(bearer(admin)).expect(200);
      const lines = (file.text as string).replace(/^﻿/, '').trim().split('\r\n');
      expect(lines[0]).toMatch(/^Time \(India\),Time \(UTC\),Helper,Model,Where it runs/);
      expect(lines).toHaveLength(7);
      expect(file.text).toContain('Camera nudge');
      expect(file.text).toContain('Outlet\'s daily limit');
      expect(file.headers['x-export-rows']).toBe('6');

      // Outlet A's requests went through the fake engine with real instructions: none of their words is in the file.
      const other = await http().get('/ai/requests/export').query({ period: '7d', outlet: outletIds.a }).set(bearer(admin)).expect(200);
      expect(other.text.split('\r\n').length).toBeGreaterThan(3);
      expect(other.text).not.toContain(LICENCE_READER_INSTRUCTIONS.slice(0, 40));
      expect(other.text).not.toContain('Read the details off this document');
    });
  });

  it('puts every change in the activity log with what changed from and to, and logs an export', async () => {
    made.logRowsBefore = new Set(activity.recordedForTest());
    activity.setForTest({ on: true });
    try {
      await save(admin, { warnings: { dayPercent: 70, creditUnderUsd: 1000 } }).expect(200);
      await http().get('/ai/requests/export').query({ period: 'today', outlet: outletIds.b }).set(bearer(admin)).expect(200);
      await activity.flush();
      const rows = await prisma.client.activityLog.findMany({ where: { id: { in: activity.recordedForTest().filter((id) => !made.logRowsBefore.has(id)) } } });
      const changed = rows.find((row) => row.action === 'ai.settings.changed');
      expect(changed).toMatchObject({ entityType: 'aiSettings', result: 'SUCCESS', actorUserId: adminId });
      expect((changed!.details as { changes: string[] }).changes).toEqual(['Warn when a day passes: 80% → 70%', 'Warn when credit falls under: US$20.00 → US$1000.00']);
      expect(rows.find((row) => row.action === 'ai.log.exported')?.details).toMatchObject({ rows: expect.any(Number), filters: ['outlet', 'period'] });
    } finally {
      activity.setForTest({ on: false });
    }
    // The page shows who changed the warnings, and the credit warning is now true (under US$1000 left).
    const settings = (await http().get('/ai/settings').set(bearer(ops)).expect(200)).body as AiSettingsDto;
    expect(settings.sections.warnings).toMatchObject({ by: settings.history[0]!.by });
    expect(settings.history[0]!.changes.map((change) => change.label)).toEqual(['Warn when a day passes', 'Warn when credit falls under']);
    const alerts = (await http().get('/ai/alerts').set(bearer(admin)).expect(200)).body as { warnings: { kind: string }[] };
    expect(alerts.warnings.map((warning) => warning.kind)).toContain('CREDIT');
  });
});
