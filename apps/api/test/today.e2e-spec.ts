// Today, the console's home (Stage I, step 2; 20 Oct 2026): GET /today, Remind and Close the
// day. Each Needs you kind is made to appear with records of a throwaway restaurant, then made
// to leave by doing its work through the real routes (placing the booking, giving the visit a
// Supervisor, the Owner's sign-off, approving the report, paying the invoice, picking the issue
// up); a new outlet stuck past 24 hours by moving its creation time. Most of it runs on a day
// about nine months ahead, through the test clock (`?at=`, honoured only under NODE_ENV=test),
// where no sample or plan visit falls. Also: a Supervisor sees only their own day, a BDE is
// refused, Remind once a day, and Close the day once, warning with open lines, for the Super
// Admin and the Ops Manager only. Everything made is removed by the ids recorded here.

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { addDays, boardWeekday, type DayClosedDto, type TodayDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { sha256 } from './../src/auth/auth.crypto.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const MARK = 'TDE2E';
const DEVICE = 'e2e-today';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003', bde: '+919000000004' };
const OWNER_PHONE = '+919199900411';
const HOUR = 3_600_000;

describe('Today (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = { admin: '', ops: '', supervisor: '', bde: '', owner: '' };
  let supervisorId = '';
  let adminId = '';
  let opsName = '';
  let outletId = '';
  let organizationId = '';
  let pestItemId = '';

  // A weekday about nine months ahead: past the days plan visits are made for, inside the 365 days a visit may be put on.
  let day = addDays(indiaDate(), 280);
  while (boardWeekday(day) === null) day = addDays(day, 1);
  const at = (date: string, time = '09:10') => `${date}T${time}:00.000+05:30`;

  // Everything made here, by id.
  const made = {
    visits: [] as string[],
    bookings: [] as string[],
    leads: [] as string[],
    issues: [] as string[],
    invoices: [] as string[],
    payments: [] as string[],
    dayCloses: [] as string[],
    userIds: [] as string[],
    sessionIds: [] as string[],
    challengeIds: [] as string[],
  };

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const db = () => prisma.client;

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const challenge = await db().otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (challenge) made.challengeIds.push(challenge.id);
    const body = (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body;
    const session = await db().session.findUnique({ where: { tokenHash: sha256(body.token as string) }, select: { id: true } });
    if (session) made.sessionIds.push(session.id);
    return body.token as string;
  }

  const today = async (token: string, when?: string): Promise<TodayDto> =>
    (await http().get('/today').query(when ? { at: when } : {}).set(bearer(token)).expect(200)).body;
  const keys = (page: TodayDto) => page.needsYou.map((item) => item.key);
  const itemOf = (page: TodayDto, key: string) => page.needsYou.find((item) => item.key === key);

  async function addVisit(date: string, input: { supervisorId?: string | null; serviceCode?: string; slot?: string } = {}): Promise<string> {
    const body = { outletId, serviceCode: input.serviceCode ?? 'PEST', date, slot: input.slot ?? '1000', supervisorId: input.supervisorId ?? null };
    const response = await http().post('/visits').set(bearer(tokens.ops)).send(body).expect(201);
    made.visits.push(response.body.id as string);
    return response.body.id as string;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    tokens.admin = await otpLogin(PHONES.admin);
    tokens.ops = await otpLogin(PHONES.ops);
    tokens.supervisor = await otpLogin(PHONES.supervisor);
    tokens.bde = await otpLogin(PHONES.bde);
    supervisorId = (await db().user.findUniqueOrThrow({ where: { phone: PHONES.supervisor } })).id;
    adminId = (await db().user.findUniqueOrThrow({ where: { phone: PHONES.admin } })).id;
    opsName = (await http().get('/auth/me').set(bearer(tokens.ops)).expect(200)).body.name as string;

    // The throwaway restaurant, onboarded as the console does it; its Owner logs in once.
    const created = await http()
      .post('/organizations')
      .set(bearer(tokens.admin))
      .send({ name: `${MARK} Tiffins`, ownerName: `${MARK} Owner`, ownerPhone: OWNER_PHONE, outletName: `${MARK} Tiffins, Madhapur`, outletAddress: 'Madhapur Main Road' })
      .expect(201);
    organizationId = created.body.id as string;
    made.userIds.push(created.body.owners[0].id as string);
    outletId = created.body.outlets[0].id as string;
    tokens.owner = await otpLogin(OWNER_PHONE);

    const catalog = (await http().get('/services/catalog').set(bearer(tokens.owner)).expect(200)).body as { id: string; serviceCode: string }[];
    pestItemId = catalog.find((item) => item.serviceCode === 'PEST')!.id;
  }, 60_000);

  afterAll(async () => {
    const visits = { in: made.visits };
    // Every step is tried even if one before it fails, so a failed test never leaves the rest behind.
    const failures: unknown[] = [];
    const step = async (work: () => Promise<unknown>) => {
      await work().catch((error: unknown) => failures.push(error));
    };
    await step(() => db().notification.deleteMany({ where: { userId: { in: made.userIds } } }));
    // A payment is found by its invoice too, in case the test stopped before keeping its id.
    await step(() => db().payment.deleteMany({ where: { OR: [{ id: { in: made.payments } }, { invoiceId: { in: made.invoices } }] } }));
    await step(() => db().invoice.deleteMany({ where: { id: { in: made.invoices } } }));
    await step(() => db().dayClose.deleteMany({ where: { id: { in: made.dayCloses } } }));
    await step(() => db().issueComment.deleteMany({ where: { issueId: { in: made.issues } } }));
    await step(() => db().issue.deleteMany({ where: { id: { in: made.issues } } }));
    await step(() => db().certificate.deleteMany({ where: { jobId: visits } }));
    await step(() => db().attachment.deleteMany({ where: { jobId: visits } }));
    await step(() => db().serviceReport.deleteMany({ where: { jobId: visits } }));
    await step(() => db().job.deleteMany({ where: { id: visits } }));
    await step(() => db().booking.deleteMany({ where: { id: { in: made.bookings } } }));
    await step(() => db().lead.deleteMany({ where: { id: { in: made.leads } } }));
    await step(() => db().legalAcceptance.deleteMany({ where: { userId: { in: made.userIds } } }));
    await step(() => db().session.deleteMany({ where: { OR: [{ id: { in: made.sessionIds } }, { userId: { in: made.userIds } }] } }));
    if (organizationId) await step(() => db().linkedDevice.deleteMany({ where: { organizationId } }));
    await step(() => db().otpChallenge.deleteMany({ where: { id: { in: made.challengeIds } } }));
    if (outletId) {
      await step(() => db().staffMember.deleteMany({ where: { outletId } }));
      await step(() => db().hygieneScoreSnapshot.deleteMany({ where: { outletId } }));
      await step(() => db().publicProfile.deleteMany({ where: { outletId } }));
    }
    await step(() => db().user.deleteMany({ where: { id: { in: made.userIds } } }));
    // The outlet takes its onboarding record with it.
    if (outletId) await step(() => db().outlet.deleteMany({ where: { id: outletId } }));
    if (organizationId) await step(() => db().organization.deleteMany({ where: { id: organizationId } }));
    await app.close();
    if (failures.length > 0) throw failures[0];
  });

  it('is refused to a BDE, who has no Today', async () => {
    await http().get('/today').set(bearer(tokens.bde)).expect(403);
    await http().post('/today/close').set(bearer(tokens.bde)).send({ date: day }).expect(403);
    await http().post(`/visits/${randomUUID()}/remind-sign-off`).set(bearer(tokens.bde)).expect(403);
  });

  it("lists the day's visits and free checks in time order, with one badge and the capacity", async () => {
    await addVisit(day, { slot: '1400', serviceCode: 'WATER_TEST' });
    const lead = await db().lead.create({
      data: { businessName: `${MARK} Dosa Corner`, area: 'Kondapur', source: 'FIELD_VISIT', ownerId: adminId, stage: 'CHECK_BOOKED', checkAt: new Date(at(day, '11:00')), checkWith: 'Sana' },
    });
    made.leads.push(lead.id);

    const page = await today(tokens.ops, at(day));
    expect(page).toMatchObject({ date: day, scope: 'office' });
    expect(page.visits.map((row) => [row.kind, row.time, row.outletName])).toEqual([
      ['FREE_CHECK', '11:00', `${MARK} Dosa Corner`],
      ['VISIT', '14:00', `${MARK} Tiffins, Madhapur`],
    ]);
    expect(page.visits[0]).toMatchObject({ id: lead.id, serviceName: 'Free check', supervisorName: 'Sana', badge: { kind: 'FREE_CHECK', label: 'Free check' } });
    // A partner's service, with no Supervisor yet.
    expect(page.visits[1]).toMatchObject({ supervisorName: null, badge: { kind: 'PARTNER', label: 'Partner' } });
    expect(page.capacity).toMatchObject({ booked: 1 });
    expect(page.headline).toMatch(/^1 visit, 1 free check\. \d+ things? needs? you\.$/);
  });

  it("brings in today's and tomorrow's visits with no Supervisor, and drops one once it has one", async () => {
    const first = made.visits[0]!;
    const tomorrow = await addVisit(addDays(day, 1));
    const later = await addVisit(addDays(day, 2));
    let page = await today(tokens.ops, at(day));
    expect(itemOf(page, `VISIT_NO_SUPERVISOR:${first}`)).toMatchObject({ dueToday: true, button: 'Assign', target: { kind: 'VISIT', visitId: first } });
    expect(itemOf(page, `VISIT_NO_SUPERVISOR:${tomorrow}`)).toMatchObject({ dueToday: false });
    expect(keys(page)).not.toContain(`VISIT_NO_SUPERVISOR:${later}`);
    // Most urgent first: today's visit before tomorrow's.
    expect(keys(page).indexOf(`VISIT_NO_SUPERVISOR:${first}`)).toBeLessThan(keys(page).indexOf(`VISIT_NO_SUPERVISOR:${tomorrow}`));

    await http().patch(`/visits/${first}`).set(bearer(tokens.ops)).send({ supervisorId }).expect(200);
    page = await today(tokens.ops, at(day));
    expect(keys(page)).not.toContain(`VISIT_NO_SUPERVISOR:${first}`);
    expect(page.visits.find((row) => row.id === first)?.supervisorName).toBeTruthy();
  });

  it('brings in a booking not placed after 4 hours, and drops it once placed', async () => {
    const booked = await http()
      .post('/bookings')
      .set(bearer(tokens.owner))
      // A restaurant can ask only so far ahead; the office places it on the test day.
      .send({ outletId, catalogItemId: pestItemId, preferredDate: addDays(indiaDate(), 7), preferredSlot: '1000' })
      .expect(201);
    const bookingId = booked.body.id as string;
    made.bookings.push(bookingId);
    const requestedAt = new Date(booked.body.createdAt as string).getTime();
    const key = `BOOKING_WAITING:${bookingId}`;

    expect(keys(await today(tokens.ops, new Date(requestedAt + 3 * HOUR).toISOString()))).not.toContain(key);
    const page = await today(tokens.ops, new Date(requestedAt + 5 * HOUR).toISOString());
    expect(itemOf(page, key)).toMatchObject({ title: `${MARK} Tiffins, Madhapur: a booking waiting for a slot`, button: 'Place', target: { kind: 'WAITING' } });
    // Bookings are the office's to place.
    expect(keys(await today(tokens.supervisor, new Date(requestedAt + 5 * HOUR).toISOString()))).not.toContain(key);

    const placed = await http().post(`/bookings/${bookingId}/confirm`).set(bearer(tokens.ops)).send({ date: day, slot: '1000', supervisorId }).expect(200);
    made.visits.push(placed.body.visitId as string);
    expect(keys(await today(tokens.ops, new Date(requestedAt + 5 * HOUR).toISOString()))).not.toContain(key);
  });

  it('brings in a sign-off after 2 days, reminds once a day, and gives way to the report, which leaves once approved', async () => {
    const finishedOn = addDays(day, -3);
    const visitId = await addVisit(finishedOn, { supervisorId, serviceCode: 'OIL_TEST' });
    await db().job.update({ where: { id: visitId }, data: { status: 'COMPLETED', completedAt: new Date(at(finishedOn, '12:00')) } });
    const signOffKey = `SIGN_OFF_WAITING:${visitId}`;

    // A day after it was finished it does not need anyone yet; three days after, it does.
    expect(keys(await today(tokens.ops, at(addDays(finishedOn, 1))))).not.toContain(signOffKey);
    let page = await today(tokens.ops, at(day));
    expect(itemOf(page, signOffKey)).toMatchObject({ button: 'Remind', remindedAt: null, detail: 'Frying oil test. Waiting 3 days.' });

    // Remind: once a day per visit, to the outlet's Owner and Managers, with the existing notification.
    const reminded = await http().post(`/visits/${visitId}/remind-sign-off`).query({ at: at(day) }).set(bearer(tokens.ops)).expect(200);
    expect(reminded.body).toMatchObject({ visitId, told: 1 });
    const told = await db().notification.findMany({ where: { userId: { in: made.userIds }, type: 'SIGN_OFF_WAITING' } });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ userId: made.userIds[0], dedupeKey: `sign-off-reminded:${visitId}:${day}` });
    page = await today(tokens.ops, at(day, '11:00'));
    expect(itemOf(page, signOffKey)?.remindedAt).toBe(new Date(at(day)).toISOString());
    const again = await http().post(`/visits/${visitId}/remind-sign-off`).query({ at: at(day, '15:00') }).set(bearer(tokens.ops)).expect(409);
    expect(again.body.message).toBe('The restaurant was reminded today at 9:10 am');
    // The next day it may be reminded again; the Supervisor whose visit it is may too.
    await http().post(`/visits/${visitId}/remind-sign-off`).query({ at: at(addDays(day, 1)) }).set(bearer(tokens.ops)).expect(200);
    await http().post(`/visits/${visitId}/remind-sign-off`).query({ at: at(addDays(day, 2)) }).set(bearer(tokens.supervisor)).expect(200);
    expect(await db().notification.count({ where: { userId: { in: made.userIds }, type: 'SIGN_OFF_WAITING' } })).toBe(3);
    expect(keys(await today(tokens.supervisor, at(day)))).toContain(signOffKey);

    // The Owner signs off: the sign-off leaves, and the report now waits for ECCS.
    await http().post(`/visits/${visitId}/sign-off`).set(bearer(tokens.owner)).send({ rating: 5 }).expect(200);
    page = await today(tokens.ops, at(day));
    expect(keys(page)).not.toContain(signOffKey);
    expect(itemOf(page, `REPORT_TO_APPROVE:${visitId}`)).toMatchObject({ button: 'Approve', target: { kind: 'VISIT', visitId } });
    // Approving reports is the office's.
    expect(keys(await today(tokens.supervisor, at(day)))).not.toContain(`REPORT_TO_APPROVE:${visitId}`);
    await http().post(`/visits/${visitId}/remind-sign-off`).query({ at: at(addDays(day, 3)) }).set(bearer(tokens.ops)).expect(409);

    await http().post(`/visits/${visitId}/approve-report`).set(bearer(tokens.ops)).expect(200);
    expect(keys(await today(tokens.ops, at(day)))).not.toContain(`REPORT_TO_APPROVE:${visitId}`);
  });

  it('brings in an overdue invoice where the crew is today, and drops it once paid; payments entered today are counted', async () => {
    const invoice = await db().invoice.create({
      data: {
        organizationId,
        outletId,
        number: `${MARK}-${randomUUID().slice(0, 8)}`,
        issueDate: new Date(`${addDays(day, -24)}T00:00:00.000Z`),
        dueDate: new Date(`${addDays(day, -9)}T00:00:00.000Z`),
        status: 'ISSUED',
        subtotalPaise: 600_000,
        cgstPaise: 54_000,
        sgstPaise: 54_000,
        totalPaise: 708_000,
      },
    });
    made.invoices.push(invoice.id);
    const key = `INVOICE_OVERDUE_VISIT_TODAY:${invoice.id}`;

    const page = await today(tokens.ops, at(day));
    expect(itemOf(page, key)).toMatchObject({
      title: `${MARK} Tiffins, Madhapur: invoice overdue, 9 days`,
      detail: '₹7,080 due. The crew is there today at 10 am; ask the manager.',
      dueToday: true,
      button: 'Open invoice',
    });
    // The day's rows at that outlet carry the warning, before the partner badge.
    expect(page.visits.filter((row) => row.kind === 'VISIT').every((row) => row.badge?.label === 'Invoice overdue 9 days')).toBe(true);
    // Money is the office's: a Supervisor sees neither the item nor the warning.
    const own = await today(tokens.supervisor, at(day));
    expect(keys(own)).not.toContain(key);
    expect(own.visits.some((row) => row.badge?.kind === 'WARNING')).toBe(false);

    const payments = async () => (await today(tokens.ops)).close.lines.find((line) => line.key === 'PAYMENTS')!;
    const counted = (words: string) => {
      const found = /^(\d+) payments? entered today, ₹([\d,]+)$/.exec(words);
      return found ? { count: Number(found[1]), rupees: Number(found[2]!.replace(/,/g, '')) } : { count: 0, rupees: 0 };
    };
    const before = counted((await payments()).words);

    const paid = await http()
      .post(`/invoices/${invoice.id}/payments/manual`)
      .set(bearer(tokens.ops))
      .send({ method: 'cash', amountPaise: 708_000, paidOn: indiaDate() })
      .expect(200);
    made.payments.push(paid.body.payment.id as string);
    expect(keys(await today(tokens.ops, at(day)))).not.toContain(key);

    const after = await payments();
    expect(after.state).toBe('KNOWN');
    expect(counted(after.words)).toEqual({ count: before.count + 1, rupees: before.rupees + 7_080 });
  });

  it('brings in an issue nobody picked up after 2 days, for the Supervisor of the outlet too, and drops it once picked up', async () => {
    const raised = await http()
      .post('/issues')
      .set(bearer(tokens.owner))
      .send({ outletId, category: 'PEST_SIGHTING', description: `${MARK}: cockroaches near the store` })
      .expect(201);
    const issueId = raised.body.id as string;
    made.issues.push(issueId);
    await db().issue.update({ where: { id: issueId }, data: { createdAt: new Date(at(addDays(day, -3))) } });
    const key = `ISSUE_NOT_PICKED_UP:${issueId}`;

    expect(keys(await today(tokens.ops, at(addDays(day, -2))))).not.toContain(key);
    expect(itemOf(await today(tokens.ops, at(day)), key)).toMatchObject({ detail: 'Pest sighting. Open 3 days.', button: 'Open', target: { kind: 'ISSUE', issueId } });
    // The Supervisor visits this outlet, so the issue is theirs to see.
    expect(keys(await today(tokens.supervisor, at(day)))).toContain(key);

    await http().patch(`/issues/${issueId}`).set(bearer(tokens.ops)).send({ status: 'IN_PROGRESS' }).expect(200);
    expect(keys(await today(tokens.ops, at(day)))).not.toContain(key);
  });

  it('brings in a new outlet not live 24 hours after being added, until it leaves the New outlets tab', async () => {
    const key = `OUTLET_STUCK:${outletId}`;
    const addedAgo = async (hours: number) => {
      const when = new Date(Date.now() - hours * HOUR);
      await db().outlet.update({ where: { id: outletId }, data: { createdAt: when } });
      await db().outletOnboarding.updateMany({ where: { outletId }, data: { startedAt: when } });
    };
    expect(keys(await today(tokens.ops))).not.toContain(key);
    await addedAgo(30);
    expect(itemOf(await today(tokens.ops), key)).toMatchObject({ button: 'Act', target: { kind: 'NEW_OUTLETS' } });
    expect(keys(await today(tokens.supervisor))).not.toContain(key);
    // On day 11 it is an ordinary outlet again.
    await addedAgo(11 * 24);
    expect(keys(await today(tokens.ops))).not.toContain(key);
  });

  it("gives a Supervisor only their own visits and items, with no capacity, Also today or Close button", async () => {
    const unassigned = await addVisit(day);
    const page = await today(tokens.supervisor, at(day));
    expect(page.scope).toBe('own');
    expect(page.capacity).toBeNull();
    expect(page.alsoToday).toEqual([]);
    expect(page.visits.every((row) => row.kind === 'VISIT')).toBe(true);
    expect(page.visits.map((row) => row.id)).not.toContain(unassigned);
    const theirs = await db().job.findMany({ where: { id: { in: page.visits.map((row) => row.id) } }, select: { supervisorId: true } });
    expect(theirs.every((row) => row.supervisorId === supervisorId)).toBe(true);
    expect(page.needsYou.every((item) => item.kind === 'SIGN_OFF_WAITING' || item.kind === 'ISSUE_NOT_PICKED_UP')).toBe(true);
    expect(page.headline).not.toContain('free check');
    expect(page.close.canClose).toBe(false);
    expect(page.close.lines.map((line) => line.key)).toEqual(['VISITS_FINISHED', 'REPORTS_IN', 'SIGN_OFFS']);
  });

  it('closes the day once, warning with open lines, for the Super Admin and the Ops Manager only', async () => {
    let page = await today(tokens.ops, at(day));
    expect(page.close).toMatchObject({ shownFully: false, closed: null, canClose: true });
    expect(page.close.lines.map((line) => line.key)).toEqual(['VISITS_FINISHED', 'REPORTS_IN', 'SIGN_OFFS', 'PAYMENTS', 'TOMORROW_SUPERVISORS']);
    const finished = page.close.lines.find((line) => line.key === 'VISITS_FINISHED')!;
    expect(finished.state).toBe('OPEN');
    expect(finished.words).toMatch(/^0 of \d+ finished · to finish: /);
    expect(page.close.lines.find((line) => line.key === 'TOMORROW_SUPERVISORS')).toMatchObject({ state: 'OPEN' });
    expect((await today(tokens.ops, at(day, '16:00'))).close.shownFully).toBe(true);

    await http().post('/today/close').query({ at: at(day, '18:42') }).set(bearer(tokens.supervisor)).send({ date: day }).expect(403);
    // Only today can be closed.
    await http().post('/today/close').query({ at: at(day, '18:42') }).set(bearer(tokens.ops)).send({ date: addDays(day, 1) }).expect(409);

    const closed = (await http().post('/today/close').query({ at: at(day, '18:42') }).set(bearer(tokens.ops)).send({ date: day }).expect(201)).body as DayClosedDto;
    made.dayCloses.push((await db().dayClose.findUniqueOrThrow({ where: { date: new Date(`${day}T00:00:00.000Z`) } })).id);
    expect(closed).toMatchObject({ date: day, closedAt: new Date(at(day, '18:42')).toISOString(), closedByName: opsName });
    // It warns and does not refuse: the open lines are kept as they read then.
    expect(closed.openLines.map((line) => line.key)).toEqual(expect.arrayContaining(['VISITS_FINISHED', 'TOMORROW_SUPERVISORS']));

    page = await today(tokens.ops, at(day, '19:00'));
    expect(page.close.closed).toMatchObject({ closedByName: opsName });
    const twice = await http().post('/today/close').query({ at: at(day, '19:00') }).set(bearer(tokens.admin)).send({ date: day }).expect(409);
    expect(twice.body.message).toBe(`This day was closed at 6:42 pm by ${opsName}`);

    // The Super Admin closes another day.
    const other = addDays(day, 5);
    await http().post('/today/close').query({ at: at(other, '18:00') }).set(bearer(tokens.admin)).send({ date: other }).expect(201);
    made.dayCloses.push((await db().dayClose.findUniqueOrThrow({ where: { date: new Date(`${other}T00:00:00.000Z`) } })).id);
  });
});
