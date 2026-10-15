// Sales and the CRM (15 Oct 2026): who may read and change what (the Super Admin and
// the Ops Manager every lead, a BDE only their own, the Supervisor and restaurant users
// nothing); logging a step moves a lead right and never left; First job and On a plan
// come from the app's own data once a lead is linked to its client; quotes, their public
// page and the record of the owner opening them; Do today and stale leads from known
// rows; the dashboard's figures; the sample sales loading once and coming out in one go.
//
// Runs against the local database with the sample seed loaded, and the sample sales
// (pnpm sales:sample) loaded or not. Everything is a throwaway it creates itself (three
// BDE logins, a client with an outlet, visits, a sign-off, a plan, leads, steps, quotes,
// a target) and removes again; the figures are read for its own BDEs only, so the
// founder's leads never change them. The sample loading is tried inside a transaction
// that is rolled back, so the founder's sample sales are never changed.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { loadSalesSample, removeSalesSample } from '@eccs/db';
import { addDays, indiaMoment, weekStartOf, type LeadDetailDto, type LeadListDto, type QuoteDto, type QuoteOptionDto, type SalesOverviewDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const MARK = 'E2E Sales';
const DEVICE = 'e2e-sales';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003' };
const BDE_PHONES = { one: '+919199900081', two: '+919199900082', three: '+919199900083' };
const OWNER = { code: 'SPICE-JH2K7M', pin: '2580' };
const OUTLET_CODE = 'E2ESALES-0001';
const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

class Rollback extends Error {}

describe('Sales (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let ops: string;
  let supervisor: string;
  let owner: string;
  const bde = { one: '', two: '', three: '' };
  const bdeId = { one: '', two: '', three: '' };
  let organizationId: string;
  let outletId: string;
  let serviceTypeId: string;
  let options: QuoteOptionDto[];
  let floorsBefore: { floorLeads: number; floorChecks: number; floorFirstJobs: number; floorPlans: number } | null = null;

  const today = indiaDate();
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const daysAgo = (days: number, time = '10:00') => indiaMoment(addDays(today, -days), time);

  async function otpLogin(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    return (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body.token as string;
  }
  async function pinLogin(code: string, pin: string) {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    return (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200)).body.token as string;
  }

  const addLead = async (token: string, body: Record<string, unknown> & { businessName: string }): Promise<LeadDetailDto> =>
    (await http().post('/sales/leads').set(bearer(token)).send({ source: 'FIELD_VISIT', ...body, businessName: `${MARK} ${body.businessName}` }).expect(201)).body;
  const step = async (token: string, leadId: string, body: Record<string, unknown>, status = 201): Promise<LeadDetailDto> =>
    (await http().post(`/sales/leads/${leadId}/steps`).set(bearer(token)).send(body).expect(status)).body;
  const lead = async (token: string, leadId: string): Promise<LeadDetailDto> => (await http().get(`/sales/leads/${leadId}`).set(bearer(token)).expect(200)).body;
  const tokenOf = (quote: QuoteDto) => quote.link.split('/q/')[1]!;
  const service = () => options.find((option) => option.kind === 'SERVICE')!;
  const plan = () => options.find((option) => option.kind === 'PLAN')!;

  async function cleanUp() {
    const db = prisma.client;
    const ours = { name: { startsWith: MARK } };
    await db.lead.deleteMany({ where: { businessName: { startsWith: MARK } } });
    await db.job.deleteMany({ where: { outlet: { organization: ours } } });
    await db.subscription.deleteMany({ where: { outlet: { organization: ours } } });
    await db.outlet.deleteMany({ where: { organization: ours } });
    await db.organization.deleteMany({ where: ours });
    const users = await db.user.findMany({ where: { phone: { in: Object.values(BDE_PHONES) } }, select: { id: true } });
    await db.salesTarget.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { userId: { in: users.map((user) => user.id) } }] } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: [...Object.values(PHONES), ...Object.values(BDE_PHONES)] } } });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();
    const db = prisma.client;
    floorsBefore = await db.salesSettings.findUnique({ where: { id: 'default' }, select: { floorLeads: true, floorChecks: true, floorFirstJobs: true, floorPlans: true } });

    for (const key of ['one', 'two', 'three'] as const) {
      const user = await db.user.create({ data: { phone: BDE_PHONES[key], name: `${MARK} BDE ${key}`, memberships: { create: [{ role: 'BDE' }] } } });
      bdeId[key] = user.id;
      bde[key] = await otpLogin(BDE_PHONES[key]);
    }
    admin = await otpLogin(PHONES.admin);
    ops = await otpLogin(PHONES.ops);
    supervisor = await otpLogin(PHONES.supervisor);
    owner = await pinLogin(OWNER.code, OWNER.pin);

    const organization = await db.organization.create({ data: { name: `${MARK} Client`, stateCode: '36' } });
    organizationId = organization.id;
    outletId = (await db.outlet.create({ data: { organizationId, name: `${MARK} Outlet`, code: OUTLET_CODE, address: 'Road No. 2, Banjara Hills' } })).id;
    serviceTypeId = (await db.serviceType.findFirstOrThrow({ select: { id: true } })).id;
    options = (await http().get('/sales/quote-options').set(bearer(admin)).expect(200)).body;
  }, 90_000);

  afterAll(async () => {
    const db = prisma.client;
    if (floorsBefore) await db.salesSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...floorsBefore }, update: floorsBefore });
    else await db.salesSettings.deleteMany({ where: { id: 'default' } });
    await cleanUp();
    await app.close();
  });

  // ───────────────────────── Who may read and change what ─────────────────────────

  describe('access', () => {
    it('refuses the Supervisor, restaurant users and anyone not logged in', async () => {
      for (const token of [supervisor, owner]) {
        await http().get('/sales/overview').set(bearer(token)).expect(403);
        await http().get('/sales/leads').set(bearer(token)).expect(403);
        await http().get('/sales/do-today').set(bearer(token)).expect(403);
        await http().post('/sales/leads').set(bearer(token)).send({ businessName: `${MARK} Refused`, source: 'FIELD_VISIT' }).expect(403);
      }
      await http().get('/sales/overview').expect(401);
      await http().get('/sales/overview').set(bearer(admin)).expect(200);
      await http().get('/sales/overview').set(bearer(ops)).expect(200);
      expect(await prisma.client.lead.count({ where: { businessName: `${MARK} Refused` } })).toBe(0);
    });

    it('lets a BDE add, read and change only their own leads, and always own what they add', async () => {
      const mine = await addLead(bde.one, { businessName: 'Own Lead', ownerId: bdeId.two, contactPhone: '98765 43210' });
      expect(mine).toMatchObject({ ownerId: bdeId.one, stage: 'NEW', status: 'OPEN', contactPhone: '+919876543210' });
      expect(mine.owners).toEqual([]);
      await http().get(`/sales/leads/${mine.id}`).set(bearer(bde.one)).expect(200);
      // Another BDE cannot see, change or work it: to them it does not exist.
      await http().get(`/sales/leads/${mine.id}`).set(bearer(bde.two)).expect(404);
      await http().patch(`/sales/leads/${mine.id}`).set(bearer(bde.two)).send({ area: 'Abids' }).expect(404);
      await http().post(`/sales/leads/${mine.id}/steps`).set(bearer(bde.two)).send({ kind: 'CALL' }).expect(404);
      const theirs = (await http().get('/sales/leads').set(bearer(bde.two)).expect(200)).body as LeadListDto;
      expect(theirs.leads.some((entry) => entry.id === mine.id)).toBe(false);
      expect(theirs.owners.map((person) => person.id)).toEqual([bdeId.two]);
      // A BDE's own page is always their own, whoever they ask for.
      const page = (await http().get('/sales/overview').query({ owner: bdeId.one }).set(bearer(bde.two)).expect(200)).body as SalesOverviewDto;
      expect(page.owner).toBe(bdeId.two);
      // The Super Admin and the Ops Manager reach it, and may hand it on; the BDE may not.
      await http().get(`/sales/leads/${mine.id}`).set(bearer(ops)).expect(200);
      await http().patch(`/sales/leads/${mine.id}`).set(bearer(bde.one)).send({ ownerId: bdeId.two }).expect(403);
      const handed = (await http().patch(`/sales/leads/${mine.id}`).set(bearer(admin)).send({ ownerId: bdeId.two }).expect(200)).body as LeadDetailDto;
      expect(handed.ownerId).toBe(bdeId.two);
      await http().get(`/sales/leads/${mine.id}`).set(bearer(bde.one)).expect(404);
    });

    it('keeps clients and targets away from a BDE, and targets away from the Ops Manager', async () => {
      const mine = await addLead(bde.one, { businessName: 'No Client For BDE' });
      await http().put(`/sales/leads/${mine.id}/client`).set(bearer(bde.one)).send({ organizationId }).expect(403);
      await http().put('/sales/targets/floors').set(bearer(bde.one)).send({ leads: 1, checks: 1, firstJobs: 1, plans: 0 }).expect(403);
      await http().put('/sales/targets/floors').set(bearer(ops)).send({ leads: 1, checks: 1, firstJobs: 1, plans: 0 }).expect(403);
      await http().put(`/sales/targets/${bdeId.one}`).set(bearer(ops)).send({ weekStart: weekStartOf(today), leads: 5 }).expect(403);
      // Nothing else in the app is open to a BDE.
      await http().get('/organizations').set(bearer(bde.one)).expect(403);
      await http().get('/finance/overview').query({ from: today, to: today }).set(bearer(bde.one)).expect(403);
      await http().get('/visits').set(bearer(bde.one)).expect(403);
    });

    it('refuses a bad phone number and a referrer on a field visit, and adds a lead sent twice once', async () => {
      await http().post('/sales/leads').set(bearer(bde.one)).send({ businessName: `${MARK} Bad`, source: 'FIELD_VISIT', contactPhone: '12345' }).expect(400);
      await http().post('/sales/leads').set(bearer(bde.one)).send({ businessName: `${MARK} Bad`, source: 'FIELD_VISIT', referrerName: 'Chef' }).expect(400);
      const id = crypto.randomUUID();
      await addLead(bde.one, { id, businessName: 'Twice' });
      await addLead(bde.one, { id, businessName: 'Twice' });
      expect(await prisma.client.lead.count({ where: { businessName: `${MARK} Twice` } })).toBe(1);
    });
  });

  // ───────────────────────── Stages move by themselves ─────────────────────────

  describe('stages', () => {
    it('moves right as steps are logged, never left, and records the move on the timeline', async () => {
      const start = await addLead(bde.one, { businessName: 'Stages', contactPhone: '9876500001' });
      expect((await step(bde.one, start.id, { kind: 'NOTE', note: 'Met the manager' })).stage).toBe('NEW');
      const called = await step(bde.one, start.id, { kind: 'CALL' });
      expect(called.stage).toBe('CONTACTED');
      expect(called.activities[0]).toMatchObject({ kind: 'CALL', fromStage: 'NEW', toStage: 'CONTACTED' });
      const checkAt = indiaMoment(addDays(today, 1), '11:00').toISOString();
      const booked = await step(bde.one, start.id, { kind: 'CHECK_BOOKED', checkAt, checkWith: 'Naveen' });
      expect(booked).toMatchObject({ stage: 'CHECK_BOOKED', checkWith: 'Naveen' });
      expect(booked.checkAt).toBe(checkAt);
      const done = await step(bde.one, start.id, { kind: 'CHECK_DONE', findings: 3 });
      expect(done).toMatchObject({ stage: 'CHECK_DONE', checkFindings: 3, checkAt: null });
      // A call after the check leaves it where it is.
      expect((await step(bde.one, start.id, { kind: 'CALL' })).stage).toBe('CHECK_DONE');
      const quote = (await http().post(`/sales/leads/${start.id}/quotes`).set(bearer(bde.one)).send({ lines: [{ kind: 'SERVICE', refId: service().refId, quantity: 1 }] }).expect(201)).body as QuoteDto;
      expect((await lead(bde.one, start.id)).stage).toBe('CHECK_DONE');
      const sent = (await http().post(`/sales/quotes/${quote.id}/send`).set(bearer(bde.one)).expect(200)).body;
      expect(sent.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919876500001\?text=/);
      expect(decodeURIComponent(sent.whatsappUrl)).toContain(`/q/${tokenOf(quote)}`);
      const quoted = await lead(bde.one, start.id);
      expect(quoted.stage).toBe('QUOTED');
      expect(quoted.activities[0]).toMatchObject({ kind: 'QUOTE_SENT', toStage: 'QUOTED', quoteNumber: quote.number });
      // A step ahead of time is refused.
      await step(bde.one, start.id, { kind: 'CALL', at: new Date(Date.now() + 3_600_000).toISOString() }, 400);
    });

    it('parks a lead until a date, brings it back when a step is logged, and loses and reopens it at the stage it had', async () => {
      const start = await addLead(bde.one, { businessName: 'Parked' });
      await step(bde.one, start.id, { kind: 'VISIT' });
      await http().post(`/sales/leads/${start.id}/park`).set(bearer(bde.one)).send({ until: today, reason: 'after Diwali' }).expect(400);
      const parked = (await http().post(`/sales/leads/${start.id}/park`).set(bearer(bde.one)).send({ until: addDays(today, 10), reason: 'after Diwali' }).expect(200)).body as LeadDetailDto;
      expect(parked).toMatchObject({ status: 'PARKED', parkedReason: 'after Diwali', parkedUntil: addDays(today, 10), stage: 'CONTACTED' });
      const back = await step(bde.one, start.id, { kind: 'CALL' });
      expect(back).toMatchObject({ status: 'OPEN', parkedUntil: null, stage: 'CONTACTED' });
      expect(back.activities.map((entry) => entry.kind).slice(0, 2)).toEqual(['CALL', 'REOPENED']);
      const lost = (await http().post(`/sales/leads/${start.id}/lose`).set(bearer(bde.one)).send({ reason: 'went with another vendor' }).expect(200)).body as LeadDetailDto;
      expect(lost).toMatchObject({ status: 'LOST', lostReason: 'went with another vendor' });
      await http().post(`/sales/leads/${start.id}/park`).set(bearer(bde.one)).send({ until: addDays(today, 5), reason: 'x' }).expect(409);
      const reopened = (await http().post(`/sales/leads/${start.id}/reopen`).set(bearer(bde.one)).expect(200)).body as LeadDetailDto;
      expect(reopened).toMatchObject({ status: 'OPEN', stage: 'CONTACTED', lostReason: null });
      await http().post(`/sales/leads/${start.id}/reopen`).set(bearer(bde.one)).expect(409);
    });

    it('clears a next step that was due once the next step is logged', async () => {
      const start = await addLead(bde.one, { businessName: 'Next Step' });
      const due = (await http().patch(`/sales/leads/${start.id}`).set(bearer(bde.one)).send({ nextAction: 'Call back', nextActionAt: daysAgo(2).toISOString() }).expect(200)).body as LeadDetailDto;
      expect(due.stale).toMatchObject({ reason: 'NEXT_ACTION_PASSED', days: 2 });
      expect(due.toDo).toMatchObject({ bucket: 'OVERDUE', kind: 'NEXT_ACTION_OVERDUE', days: 2 });
      const after = await step(bde.one, start.id, { kind: 'CALL', nextAction: 'Book the free check', nextActionAt: indiaMoment(addDays(today, 2), '12:00').toISOString() });
      expect(after).toMatchObject({ nextAction: 'Book the free check', stale: null });
      const cleared = await step(bde.one, start.id, { kind: 'NOTE', note: 'Owner busy this week' });
      expect(cleared.nextAction).toBe('Book the free check');
    });
  });

  // ───────────────────────── First job and On a plan from the app ─────────────────────────

  describe('from the app', () => {
    it('makes a linked lead a First job from its client’s approved visit, then On a plan from its plan, and never moves it back', async () => {
      const db = prisma.client;
      const start = await addLead(bde.one, { businessName: 'Becomes Client', area: 'Banjara Hills' });
      await step(bde.one, start.id, { kind: 'VISIT' });
      const quote = (await http().post(`/sales/leads/${start.id}/quotes`).set(bearer(bde.one)).send({ lines: [{ kind: 'SERVICE', refId: service().refId, quantity: 2 }] }).expect(201)).body as QuoteDto;
      await http().post(`/sales/quotes/${quote.id}/send`).set(bearer(bde.one)).expect(200);
      // A visit approved before the lead was logged does not count.
      await db.job.create({ data: { outletId, serviceTypeId, scheduledDate: new Date(`${addDays(today, -3)}T00:00:00Z`), status: 'APPROVED', approvedAt: daysAgo(3), completedAt: daysAgo(3) } });
      const linked = (await http().put(`/sales/leads/${start.id}/client`).set(bearer(admin)).send({ organizationId }).expect(200)).body as LeadDetailDto;
      expect(linked).toMatchObject({ stage: 'QUOTED', organization: { id: organizationId }, wonAt: null });
      expect(linked.activities[0]).toMatchObject({ kind: 'LINKED' });

      const done = new Date();
      const job = await db.job.create({ data: { outletId, serviceTypeId, scheduledDate: new Date(`${today}T00:00:00Z`), status: 'APPROVED', approvedAt: done, completedAt: done } });
      await db.signOff.create({ data: { jobId: job.id, signerName: 'E2E Manager', signedAt: done, rating: 5 } });
      const firstJob = await lead(bde.one, start.id);
      expect(firstJob.stage).toBe('FIRST_JOB');
      expect(firstJob.wonAt).toBe(done.toISOString());
      const won = firstJob.activities.find((entry) => entry.kind === 'WON')!;
      // Worth what the quote said before GST, with the restaurant's rating and a same-day sign-off.
      expect(won).toMatchObject({ toStage: 'FIRST_JOB', amountPaise: quote.subtotalPaise, rating: 5, byName: null });
      expect(firstJob.toDo).toMatchObject({ kind: 'OFFER_PLAN', action: 'SEND_PLAN' });

      const offered = plan();
      await db.subscription.create({ data: { outletId, planId: offered.refId, status: 'ACTIVE', startDate: new Date(`${today}T00:00:00Z`), pricePaise: offered.unitPaise, billingCycle: 'MONTHLY' } });
      const onPlan = await lead(bde.one, start.id);
      expect(onPlan.stage).toBe('ON_PLAN');
      expect(onPlan.planAt).not.toBeNull();
      const wins = onPlan.activities.filter((entry) => entry.kind === 'WON').map((entry) => [entry.toStage, entry.amountPaise]);
      expect(wins).toHaveLength(2);
      expect(wins).toEqual(
        expect.arrayContaining([
          ['ON_PLAN', offered.unitPaise],
          ['FIRST_JOB', quote.subtotalPaise],
        ]),
      );
      // The plan ending does not move the lead back.
      await db.subscription.updateMany({ where: { outletId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
      expect((await lead(bde.one, start.id)).stage).toBe('ON_PLAN');
      // Reading again writes nothing twice.
      expect(await db.leadActivity.count({ where: { leadId: start.id, kind: 'WON' } })).toBe(2);
    });
  });

  // ───────────────────────── Quotes and their public page ─────────────────────────

  describe('quotes', () => {
    let leadId: string;
    let quote: QuoteDto;

    beforeAll(async () => {
      leadId = (await addLead(bde.one, { businessName: 'Quote Owner', contactName: 'Faisal' })).id;
    });

    it('prices a quote from the catalogue and refuses what is not offered', async () => {
      await http().post(`/sales/leads/${leadId}/quotes`).set(bearer(bde.one)).send({ lines: [{ kind: 'SERVICE', refId: crypto.randomUUID(), quantity: 1 }] }).expect(400);
      await http().post(`/sales/leads/${leadId}/quotes`).set(bearer(bde.one)).send({ lines: [] }).expect(400);
      quote = (
        await http()
          .post(`/sales/leads/${leadId}/quotes`)
          .set(bearer(bde.one))
          .send({ lines: [{ kind: 'SERVICE', refId: service().refId, quantity: 2 }, { kind: 'PLAN', refId: plan().refId, quantity: 1 }] })
          .expect(201)
      ).body;
      const subtotal = service().unitPaise * 2 + plan().unitPaise;
      expect(quote).toMatchObject({ status: 'DRAFT', subtotalPaise: subtotal, openCount: 0 });
      expect(quote.number).toMatch(/^Q-\d{4}-\d{4}$/);
      expect(quote.totalPaise).toBe(subtotal + quote.gstPaise);
      expect(tokenOf(quote).length).toBeGreaterThanOrEqual(30);
    });

    it('shows no public page for a draft, and lets a draft be removed but not a sent quote', async () => {
      await http().get(`/public/quotes/${tokenOf(quote)}`).expect(404);
      const spare = (await http().post(`/sales/leads/${leadId}/quotes`).set(bearer(bde.one)).send({ lines: [{ kind: 'SERVICE', refId: service().refId, quantity: 1 }] }).expect(201)).body as QuoteDto;
      await http().delete(`/sales/quotes/${spare.id}`).set(bearer(bde.one)).expect(204);
      await http().post(`/sales/quotes/${quote.id}/send`).set(bearer(bde.one)).expect(200);
      await http().delete(`/sales/quotes/${quote.id}`).set(bearer(bde.one)).expect(409);
      // Another BDE cannot send or remove it.
      await http().post(`/sales/quotes/${quote.id}/send`).set(bearer(bde.two)).expect(404);
    });

    it('shows the sent quote to anyone with the link, not to search engines, and nothing for a wrong link', async () => {
      const page = await http().get(`/public/quotes/${tokenOf(quote)}`).expect(200);
      expect(page.headers['x-robots-tag']).toContain('noindex');
      expect(page.body).toMatchObject({ number: quote.number, businessName: `${MARK} Quote Owner`, contactName: 'Faisal', totalPaise: quote.totalPaise, subtotalPaise: quote.subtotalPaise });
      expect(page.body.cgstPaise + page.body.sgstPaise).toBe(quote.gstPaise);
      expect(page.body.lines).toHaveLength(2);
      expect(page.body.supplier.isSample).toBe(true);
      await http().get('/public/quotes/not-a-real-token-at-all').expect(404);
      await http().get('/public/quotes/bad').expect(404);
    });

    it('records the owner opening it once in thirty minutes, never a link-preview robot, without counting as a follow-up', async () => {
      const db = prisma.client;
      const before = await lead(bde.one, leadId);
      const opened = (agent: string) => http().post(`/public/quotes/${tokenOf(quote)}/opened`).send({ agent }).expect(200);
      expect((await opened('WhatsApp/2.24.20.79 A')).body).toEqual({ recorded: false });
      expect((await opened(CHROME)).body).toEqual({ recorded: true });
      expect((await opened(CHROME)).body).toEqual({ recorded: false });
      let after = await lead(bde.one, leadId);
      expect(after.quotes.find((entry) => entry.id === quote.id)).toMatchObject({ openCount: 1 });
      expect(after.activities[0]).toMatchObject({ kind: 'QUOTE_OPENED', quoteNumber: quote.number, byName: null });
      expect(after.lastActivityAt).toBe(before.lastActivityAt);
      // Half an hour later it counts again.
      await db.quote.update({ where: { id: quote.id }, data: { lastOpenedAt: new Date(Date.now() - 31 * 60_000) } });
      expect((await opened(CHROME)).body).toEqual({ recorded: true });
      after = await lead(bde.one, leadId);
      expect(after.quotes.find((entry) => entry.id === quote.id)).toMatchObject({ openCount: 2 });
      expect(after.close?.signals.map((signal) => signal.words)).toContain('quote opened twice');
      await http().post('/public/quotes/not-a-real-token-at-all/opened').send({ agent: CHROME }).expect(404);
    });
  });

  // ───────────────────────── Do today and stale leads ─────────────────────────

  describe('Do today and stale', () => {
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      const db = prisma.client;
      for (const name of ['Parked Due', 'Check Today', 'Check No Quote', 'Contacted Quiet', 'Opened No Reply']) ids[name] = (await addLead(bde.two, { businessName: name, contactPhone: '9876500002' })).id;
      const set = (name: string, data: Parameters<typeof db.lead.update>[0]['data']) => db.lead.update({ where: { id: ids[name] }, data });
      await set('Parked Due', { stage: 'CONTACTED', status: 'PARKED', parkedAt: daysAgo(20), parkedUntil: new Date(`${addDays(today, -4)}T00:00:00Z`), parkedReason: 'after Diwali', lastActivityAt: daysAgo(20), createdAt: daysAgo(25) });
      await set('Check Today', { stage: 'CHECK_BOOKED', checkAt: indiaMoment(today, '23:30'), checkWith: 'Naveen' });
      await set('Check No Quote', { stage: 'CHECK_DONE', checkDoneAt: daysAgo(8), checkFindings: 4, lastActivityAt: daysAgo(8), createdAt: daysAgo(10) });
      await set('Contacted Quiet', { stage: 'CONTACTED', lastActivityAt: daysAgo(9), createdAt: daysAgo(12) });
      await set('Opened No Reply', { stage: 'QUOTED', lastActivityAt: daysAgo(5), createdAt: daysAgo(12) });
      await db.quote.create({
        data: { leadId: ids['Opened No Reply']!, number: `E2E-SALES-${Date.now()}`, lines: [], subtotalPaise: 800_000, gstPaise: 144_000, totalPaise: 944_000, status: 'SENT', token: `e2esales${Date.now()}`, sentAt: daysAgo(5), openCount: 2, firstOpenedAt: daysAgo(3), lastOpenedAt: daysAgo(2) },
      });
    });

    it('lists the day’s to-dos from each lead’s stage, overdue first', async () => {
      const items = ((await http().get('/sales/do-today').set(bearer(bde.two)).expect(200)).body.items as { leadId: string; kind: string; bucket: string; days: number | null; time: string | null; line: string; ownerName: string }[]).filter(
        (item) => Object.values(ids).includes(item.leadId),
      );
      expect(items.map((item) => item.kind)).toEqual(['PARKED_DUE', 'QUOTE_NO_REPLY', 'CHECK_TODAY', 'QUOTE_NOT_SENT']);
      expect(items[0]).toMatchObject({ bucket: 'OVERDUE', days: 4, line: `Parked on ${new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${addDays(today, -20)}T00:00:00Z`))}, "after Diwali". Date passed.` });
      expect(items[1]).toMatchObject({ bucket: 'OVERDUE', days: 3 });
      expect(items[1]!.line).toContain('Owner opened it twice, no reply.');
      expect(items[2]).toMatchObject({ bucket: 'TODAY', time: '23:30', line: 'Free check with Naveen. Scorecard on the phone.' });
      expect(items[3]).toMatchObject({ bucket: 'TODAY', time: null, ownerName: `${MARK} BDE two` });
      // The Super Admin sees them too; another BDE does not.
      const all = (await http().get('/sales/do-today').set(bearer(admin)).expect(200)).body.items as { leadId: string }[];
      expect(Object.values(ids).every((id) => id === ids['Contacted Quiet'] || all.some((item) => item.leadId === id))).toBe(true);
      const other = (await http().get('/sales/do-today').set(bearer(bde.three)).expect(200)).body.items as { leadId: string }[];
      expect(other.some((item) => Object.values(ids).includes(item.leadId))).toBe(false);
    });

    it('lists stale leads with the reason, and drops one as soon as its next step is logged', async () => {
      const stale = (await http().get('/sales/leads').query({ state: 'stale' }).set(bearer(bde.two)).expect(200)).body as LeadListDto;
      const reasons = Object.fromEntries(stale.leads.filter((entry) => Object.values(ids).includes(entry.id)).map((entry) => [entry.businessName.replace(`${MARK} `, ''), entry.stale]));
      expect(reasons['Parked Due']).toMatchObject({ reason: 'NURTURE_DATE_PASSED', days: 4, words: 'nurture date passed 4 days ago' });
      expect(reasons['Check No Quote']).toMatchObject({ reason: 'CHECK_NO_QUOTE', words: 'no quote sent, 8 days' });
      expect(reasons['Contacted Quiet']).toMatchObject({ reason: 'NO_NEXT_STEP', words: 'no next step set, 9 days' });
      expect(reasons['Opened No Reply']).toMatchObject({ reason: 'QUOTE_NO_CONTACT', words: 'no contact for 5 days' });
      expect(reasons['Check Today']).toBeUndefined();
      await step(bde.two, ids['Contacted Quiet']!, { kind: 'CALL' });
      const after = (await http().get('/sales/leads').query({ state: 'stale' }).set(bearer(bde.two)).expect(200)).body as LeadListDto;
      expect(after.leads.some((entry) => entry.id === ids['Contacted Quiet'])).toBe(false);
    });

    it('filters the list by stage, state and search', async () => {
      const parked = (await http().get('/sales/leads').query({ state: 'parked' }).set(bearer(bde.two)).expect(200)).body as LeadListDto;
      expect(parked.leads.map((entry) => entry.id)).toEqual([ids['Parked Due']]);
      const quoted = (await http().get('/sales/leads').query({ stage: 'QUOTED' }).set(bearer(bde.two)).expect(200)).body as LeadListDto;
      expect(quoted.leads.map((entry) => entry.id)).toEqual([ids['Opened No Reply']]);
      const found = (await http().get('/sales/leads').query({ q: 'check today' }).set(bearer(bde.two)).expect(200)).body as LeadListDto;
      expect(found.leads.map((entry) => entry.id)).toEqual([ids['Check Today']]);
    });
  });

  // ───────────────────────── The dashboard's figures ─────────────────────────

  describe('figures', () => {
    it('works out the cards, stages, BDE targets, growth and sources from known rows', async () => {
      const db = prisma.client;
      const weekStart = weekStartOf(today);
      const lastWeek = addDays(weekStart, -3);
      const make = async (name: string, data: Record<string, unknown>) => (await addLead(bde.three, { businessName: name, ...data })).id;
      const fresh = await make('Figures New', {});
      const referral = await make('Figures Referral', { source: 'CHEF_REFERRAL', referrerName: 'Chef Raju' });
      const job = await make('Figures Job', {});
      const onPlan = await make('Figures Plan', { source: 'DRIVE' });
      const parked = await make('Figures Parked', {});
      const lost = await make('Figures Lost', {});
      // Two won this week, by hand as the sample does (no client): a first job worth ₹5,000 and a plan worth ₹6,000.
      await step(bde.three, job, { kind: 'CHECK_DONE', findings: 2 });
      await db.lead.update({ where: { id: job }, data: { stage: 'FIRST_JOB', wonAt: new Date() } });
      await db.leadActivity.create({ data: { leadId: job, kind: 'WON', at: new Date(), toStage: 'FIRST_JOB', amountPaise: 500_000 } });
      await db.lead.update({ where: { id: onPlan }, data: { stage: 'ON_PLAN', wonAt: new Date(), planAt: new Date() } });
      await db.leadActivity.create({ data: { leadId: onPlan, kind: 'WON', at: new Date(), toStage: 'ON_PLAN', amountPaise: 600_000 } });
      await http().post(`/sales/leads/${parked}/park`).set(bearer(bde.three)).send({ until: addDays(today, 7), reason: 'budget next month' }).expect(200);
      await http().post(`/sales/leads/${lost}/lose`).set(bearer(bde.three)).send({ reason: 'closed down' }).expect(200);
      // One lead from last week, so the week's count is not everything.
      await db.lead.update({ where: { id: fresh }, data: { createdAt: indiaMoment(lastWeek, '11:00') } });

      const page = (await http().get('/sales/overview').query({ owner: bdeId.three }).set(bearer(admin)).expect(200)).body as SalesOverviewDto;
      const sameMonth = lastWeek.slice(0, 7) === today.slice(0, 7);
      expect(page.owner).toBe(bdeId.three);
      expect(referral).toBeTruthy();
      expect(page.cards.leads).toMatchObject({ week: 5, month: sameMonth ? 6 : 5, referrals: 1 });
      expect(page.cards.leads.spark).toHaveLength(4);
      expect(page.cards.leads.spark[3]).toBe(5);
      expect(page.cards.won).toMatchObject({ weekPaise: 1_100_000, firstJobs: 2, plans: 1, monthPaise: 1_100_000 });
      expect(page.headline).toMatchObject({ firstJobs: 2, plans: 1, toDo: page.doToday.length });
      // Two customers won, neither linked to a client: a kitchen each.
      expect(page.cards.customers).toMatchObject({ week: 2, payingKitchens: 2, people: 0 });
      // Of the one lead with a check done, one became a customer; two customers of six leads.
      expect(page.cards.conversion).toMatchObject({ checkToPaid: 100, leadToCustomer: 33, quoteToWin: null });
      expect(page.stages).toMatchObject({ open: 4, parked: 1, lostThisMonth: 1 });
      expect(page.stages.counts).toMatchObject({ NEW: 2, FIRST_JOB: 1, ON_PLAN: 1 });
      // This month's first jobs by where they came from.
      expect(page.sources).toHaveLength(2);
      expect(page.sources).toEqual(expect.arrayContaining([{ source: 'FIELD_VISIT', count: 1 }, { source: 'DRIVE', count: 1 }]));
      expect(page.firstJobsThisMonth).toBe(2);
      expect(page.growth.weeks.at(-1)).toMatchObject({ current: true, wonPaise: 1_100_000, payingKitchens: 2 });
      expect(page.growth.plans.count).toBe(1);
      expect(page.growth.forecastDate.slice(5)).toBe('12-31');

      // This week by BDE: with no history the targets are the floors, and one set by hand replaces its figure.
      await http().put('/sales/targets/floors').set(bearer(admin)).send({ leads: 4, checks: 1, firstJobs: 1, plans: 0 }).expect(200);
      await http().put(`/sales/targets/${bdeId.three}`).set(bearer(admin)).send({ weekStart, checks: 9 }).expect(200);
      const targeted = (await http().get('/sales/overview').query({ owner: bdeId.three }).set(bearer(admin)).expect(200)).body as SalesOverviewDto;
      const row = targeted.byBde.find((entry) => entry.userId === bdeId.three)!;
      expect(row.actual).toEqual({ leads: 5, checks: 1, firstJobs: 2, plans: 1 });
      expect(row.targets).toEqual({ leads: 4, checks: 9, firstJobs: 1, plans: 0 });
      expect(row.overridden).toEqual(['checks']);
      expect(targeted.floors).toEqual({ leads: 4, checks: 1, firstJobs: 1, plans: 0 });
      // Setting the figure back to null returns it to the suggestion.
      expect((await http().put(`/sales/targets/${bdeId.three}`).set(bearer(admin)).send({ weekStart, checks: null }).expect(200)).body).toEqual({ saved: false });
      await http().put(`/sales/targets/${bdeId.three}`).set(bearer(admin)).send({ weekStart: addDays(weekStart, 1), checks: 9 }).expect(400);

      // Everyone's page includes them.
      const everyone = (await http().get('/sales/overview').set(bearer(admin)).expect(200)).body as SalesOverviewDto;
      expect(everyone.owner).toBeNull();
      expect(everyone.cards.won.weekPaise).toBeGreaterThanOrEqual(1_100_000);
      expect(everyone.owners.some((person) => person.id === bdeId.three && person.isBde)).toBe(true);
    });
  });

  // ───────────────────────── The sample sales ─────────────────────────

  describe('sample rows', () => {
    it('load once, never doubling, and come out in one go leaving real leads alone', async () => {
      const db = prisma.client;
      const real = await addLead(bde.one, { businessName: 'Real Lead Kept' });
      const before = await db.lead.count({ where: { isSample: true } });
      await expect(
        db.$transaction(
          async (tx) => {
            await removeSalesSample(tx);
            const first = await loadSalesSample(tx);
            expect(first.leads).toBeGreaterThan(140);
            expect(first.quotes).toBeGreaterThan(40);
            expect(first.activities).toBeGreaterThan(first.leads * 3);
            const counts = { leads: await tx.lead.count({ where: { isSample: true } }), steps: await tx.leadActivity.count({ where: { isSample: true } }) };
            // Every quote the sample sends is there (none lost to a clashing number).
            expect(await tx.leadActivity.count({ where: { isSample: true, kind: 'QUOTE_SENT', quoteId: null } })).toBe(0);
            const second = await loadSalesSample(tx);
            expect(second).toEqual({ bdes: 0, leads: 0, activities: 0, quotes: 0, targets: 0 });
            expect(await tx.lead.count({ where: { isSample: true } })).toBe(counts.leads);
            expect(await tx.leadActivity.count({ where: { isSample: true } })).toBe(counts.steps);
            // Every sample lead says so, its number is in the made-up form, and the design's leads are there.
            const leads = await tx.lead.findMany({ where: { isSample: true }, select: { businessName: true, contactPhone: true, stage: true, status: true } });
            for (const row of leads) {
              expect(row.businessName).toMatch(/\(sample\)$/);
              expect(row.contactPhone).toMatch(/^\+91900002\d{4}$/);
            }
            expect(leads.find((row) => row.businessName === 'Mehfil Biryani (sample)')).toMatchObject({ status: 'PARKED' });
            expect(new Set(leads.map((row) => row.stage)).size).toBe(7);
            expect(leads.filter((row) => row.status === 'LOST').length).toBeGreaterThan(5);
            // The three sample BDEs log in with ECCS numbers.
            expect(await tx.user.count({ where: { phone: { in: ['+919000000004', '+919000000005', '+919000000006'] }, memberships: { some: { role: 'BDE' } } } })).toBe(3);
            const removed = await removeSalesSample(tx);
            expect(removed.leads).toBe(counts.leads);
            expect(await tx.lead.count({ where: { isSample: true } })).toBe(0);
            expect(await tx.leadActivity.count({ where: { isSample: true } })).toBe(0);
            expect(await tx.user.count({ where: { phone: { in: ['+919000000004', '+919000000005', '+919000000006'] } } })).toBe(0);
            expect(await tx.lead.count({ where: { id: real.id } })).toBe(1);
            throw new Rollback();
          },
          { timeout: 60_000 },
        ),
      ).rejects.toBeInstanceOf(Rollback);
      expect(await db.lead.count({ where: { isSample: true } })).toBe(before);
    });
  });
});
