// Billing: GST invoices raised for booked visits and for plan cycles, their
// numbering, voiding, sample and hand-recorded payments, what is due, who may
// see and do what, and the invoice PDF filed in the outlet's documents.
// Runs against the local database with the sample seed loaded and local object
// storage running. Everything it changes is a throwaway it creates itself (a
// client, two outlets, their people, their plans and visits) and removes again.

import { writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { invoiceDueDate, invoiceNumberPrefix } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { vi } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { BillingService } from './../src/billing/billing.service.js';
import { SUPPLIER } from './../src/billing/supplier.js';
import { CertificatePdfService } from './../src/certificates/certificate-pdf.service.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PdfPrinterService } from './../src/pdf/pdf-printer.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { ReportPdfService } from './../src/services/report-pdf.service.js';

const MARK = 'E2E Billing';
const DEVICE = 'e2e-billing';
const SAMPLE = { code: 'SPICE-JH2K7M', managerPin: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003', owner: '+919199900021' };
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e billing photo bytes')]);
const GSTIN = { telangana: '36AAACE2710B1Z4', karnataka: '29AAACE2710B1Z9' };

type Line = {
  description: string;
  sacCode: string;
  quantity: number;
  unitPricePaise: number;
  gstRatePercent: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};
type Payment = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountPaise: number;
  method: string;
  status: string;
  gateway: string | null;
  reference: string | null;
  failureReason: string | null;
  paidAt: string | null;
  recordedByName: string | null;
};
type Summary = {
  id: string;
  number: string;
  kind: string;
  organizationId: string;
  outletId: string | null;
  description: string;
  issueDate: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  overdueDays: number;
};
type Invoice = Summary & {
  billTo: { name: string; legalName: string | null; gstin: string | null; address: string | null; stateCode: string | null };
  placeOfSupply: string;
  interState: boolean;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  amountInWords: string;
  lines: Line[];
  payments: Payment[];
  voidedAt: string | null;
  voidReason: string | null;
  visitId: string | null;
  pdfReady: boolean;
};
type DuesLine = { duePaise: number; overduePaise: number; unpaidCount: number; overdueCount: number; oldestOverdueDays: number; oldestDueDate: string | null };
type Dues = DuesLine & {
  clients: (DuesLine & { organizationId: string })[];
  outlets: (DuesLine & { outletId: string })[];
};
type Result = { payment: Payment; invoice: Invoice };
type Visit = { id: string; status: string; tasks: { itemId: string }[] };

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const sequence = (number: string) => Number(number.slice(-5));

describe('Billing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let billing: BillingService;
  let organizationId: string;
  let outletId: string;
  let outletCode: string;
  let otherOutletId: string;
  let owner: string;
  let manager: string;
  let chef: string;
  let admin: string;
  let supervisor: string;
  let otherManager: string;
  let pestItem: { id: string; pricePaise: number };
  let planId: string;
  let subscriptionId: string;
  /** The invoice of a booked visit (CGST + SGST): paid in the app by the sample payment. */
  let visitInvoice: Invoice;
  let visitId: string;
  /** The invoice of a second booked visit, raised while the client was in Karnataka (IGST): made void. */
  let interStateInvoice: Invoice;
  /** The invoice of the plan's first cycle: paid in part by hand, the rest in the app. */
  let planInvoice: Invoice;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = () => indiaDate();

  async function cleanUp() {
    const db = prisma.client;
    const ours = { name: { startsWith: MARK } };
    const outlets = { outlet: { organization: ours } };
    await db.payment.deleteMany({ where: { invoice: { organization: ours } } });
    await db.invoice.deleteMany({ where: { organization: ours } });
    await db.document.deleteMany({ where: outlets });
    await db.attachment.deleteMany({ where: outlets });
    await db.certificate.deleteMany({ where: outlets });
    await db.serviceReport.deleteMany({ where: { job: outlets } });
    await db.signOff.deleteMany({ where: { job: outlets } });
    await db.jobTaskResponse.deleteMany({ where: { job: outlets } });
    await db.job.deleteMany({ where: outlets });
    await db.booking.deleteMany({ where: outlets });
    await db.serviceSchedule.deleteMany({ where: outlets });
    await db.subscription.deleteMany({ where: outlets });
    // Daily checklists and scores are handed to an outlet the first time anything asks for them.
    await db.checklistRun.deleteMany({ where: outlets });
    await db.outletChecklist.deleteMany({ where: outlets });
    await db.hygieneScoreSnapshot.deleteMany({ where: outlets });
    // The throwaway client: its people first (their sessions and notifications go with them), then the rest.
    await db.user.deleteMany({ where: { memberships: { some: { OR: [{ organization: ours }, { outlet: { organization: ours } }] } } } });
    await db.user.deleteMany({ where: { phone: PHONES.owner } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { OR: [{ name: DEVICE }, { organization: ours }] } });
    await db.outlet.deleteMany({ where: { organization: ours } });
    await db.organization.deleteMany({ where: ours });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
    await db.$executeRaw`DELETE FROM "Notification" WHERE "data"::text ILIKE ${`%${MARK}%`} OR "body" ILIKE ${`%${MARK}%`}`;
  }

  async function otpLogin(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    return (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body as {
      token: string;
    };
  }
  async function pinLogin(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    return (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200)).body.token as string;
  }
  /** ECCS adds a person at the throwaway outlet; they log in with the PIN they are given. */
  async function addPerson(role: 'MANAGER' | 'HEAD_CHEF'): Promise<string> {
    const person = await http()
      .post('/restaurant-users')
      .set(bearer(admin))
      .send({ name: `${MARK} ${role}`, role, outletId })
      .expect(201);
    return pinLogin(outletCode, person.body.pin as string);
  }

  const list = async (token: string, query: Record<string, string> = {}): Promise<Summary[]> =>
    (await http().get('/invoices').query(query).set(bearer(token)).expect(200)).body;
  const get = async (token: string, id: string): Promise<Invoice> =>
    (await http().get(`/invoices/${id}`).set(bearer(token)).expect(200)).body;
  const dues = async (token: string, query: Record<string, string> = {}): Promise<Dues> =>
    (await http().get('/invoices/dues').query(query).set(bearer(token)).expect(200)).body;
  const pdf = (token: string, id: string) => http().post(`/invoices/${id}/pdf`).set(bearer(token));
  const voidIt = (token: string, id: string, body: Record<string, unknown> = { reason: `${MARK}: raised by mistake` }) =>
    http().post(`/invoices/${id}/void`).set(bearer(token)).send(body);
  const start = (token: string, id: string, body: Record<string, unknown> = { method: 'upi' }) =>
    http().post(`/invoices/${id}/payments`).set(bearer(token)).send(body);
  const confirm = (token: string, paymentId: string, body: Record<string, unknown> = { outcome: 'success' }) =>
    http().post(`/payments/${paymentId}/confirm`).set(bearer(token)).send(body);
  const record = (token: string, id: string, body: Record<string, unknown>) =>
    http().post(`/invoices/${id}/payments/manual`).set(bearer(token)).send(body);
  const mine = (invoices: Summary[]) => invoices.filter((invoice) => invoice.organizationId === organizationId);

  const download = async (path: string): Promise<Buffer> =>
    (
      await http()
        .get(path)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200)
        .expect('Content-Type', /application\/pdf/)
    ).body as Buffer;
  /** The words printed in a PDF, with runs of spaces closed up. */
  const textOf = async (file: Buffer): Promise<string> => {
    const { extractText } = await import('unpdf');
    return (await extractText(new Uint8Array(file), { mergePages: true })).text.replace(/\s+/g, ' ');
  };

  /** Takes a visit that is in the diary for today to the point where ECCS can approve its report. */
  async function doAndSignOff(id: string) {
    const started = (await http().post(`/visits/${id}/check-in`).set(bearer(admin)).send({}).expect(200)).body as Visit;
    for (const task of started.tasks) {
      await http().put(`/visits/${id}/tasks/${task.itemId}`).set(bearer(admin)).send({ done: true }).expect(200);
    }
    await http()
      .post(`/visits/${id}/photos`)
      .set(bearer(admin))
      .field('kind', 'AFTER')
      .attach('file', PHOTO, { filename: 'visit.jpg', contentType: 'image/jpeg' })
      .expect(200);
    await http().post(`/visits/${id}/complete`).set(bearer(admin)).expect(200);
    await http().post(`/visits/${id}/sign-off`).set(bearer(owner)).send({ rating: 5 }).expect(200);
  }
  /** The Owner books a one-time pest control visit, ECCS confirms it for today, it is done and signed off. */
  async function bookedVisitReadyForApproval(): Promise<{ visitId: string; bookingId: string }> {
    const booking = await http()
      .post('/bookings')
      .set(bearer(owner))
      .send({ outletId, catalogItemId: pestItem.id, preferredDate: today(), preferredSlot: '1000' })
      .expect(201);
    const confirmed = await http()
      .post(`/bookings/${booking.body.id}/confirm`)
      .set(bearer(admin))
      .send({ date: today(), slot: '1000' })
      .expect(200);
    const id = confirmed.body.visitId as string;
    await doAndSignOff(id);
    return { visitId: id, bookingId: booking.body.id as string };
  }
  const approve = (id: string) => http().post(`/visits/${id}/approve-report`).set(bearer(admin));
  const invoicesOf = (where: Record<string, unknown>) => prisma.client.invoice.findMany({ where, orderBy: { number: 'asc' } });

  /** Puts the plan's subscription on the cycle starting on `start`, as the subscriptions' own renewal would. */
  const setCycle = (id: string, start: string, end: string) =>
    prisma.client.subscription.update({
      where: { id },
      data: { currentPeriodStart: toDbDate(start), currentPeriodEnd: toDbDate(end), nextBillingDate: toDbDate(addDays(end, 1)) },
    });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    billing = app.get(BillingService);
    await cleanUp();

    // The report and certificate PDFs normally made in the background on approval each start a
    // browser; they are held back here. (The invoice's own background PDF is off under tests.)
    vi.spyOn(app.get(ReportPdfService), 'ensureLater').mockImplementation(() => undefined);
    vi.spyOn(app.get(CertificatePdfService), 'ensureLater').mockImplementation(() => undefined);

    admin = (await otpLogin(PHONES.admin)).token;
    supervisor = (await otpLogin(PHONES.supervisor)).token;
    otherManager = await pinLogin(SAMPLE.code, SAMPLE.managerPin);

    // The throwaway client, made the way the console makes one, registered for GST in Telangana.
    const created = await http()
      .post('/organizations')
      .set(bearer(admin))
      .send({
        name: `${MARK} Client`,
        legalName: `${MARK} Foods Pvt Ltd`,
        gstin: GSTIN.telangana,
        ownerName: `${MARK} Owner`,
        ownerPhone: PHONES.owner,
        outletName: `${MARK} Outlet`,
        outletAddress: '1 Test Road',
        pincode: '500001',
      })
      .expect(201);
    organizationId = created.body.id;
    outletId = created.body.outlets[0].id;
    outletCode = created.body.outlets[0].code;
    await prisma.client.organization.update({ where: { id: organizationId }, data: { billingAddress: '1 Test Road, Hyderabad 500001' } });
    otherOutletId = (
      await prisma.client.outlet.create({
        data: { organizationId, name: `${MARK} Second outlet`, code: 'E2EBI-LL0002', address: '2 Test Road' },
      })
    ).id;

    owner = (await otpLogin(PHONES.owner)).token;
    manager = await addPerson('MANAGER');
    chef = await addPerson('HEAD_CHEF');

    const pest = await prisma.client.serviceCatalogItem.findFirstOrThrow({
      where: { isActive: true, serviceType: { code: 'PEST' } },
      select: { id: true, pricePaise: true },
    });
    pestItem = pest;
    planId = (await prisma.client.plan.findUniqueOrThrow({ where: { code: 'ESSENTIAL' } })).id;
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    vi.restoreAllMocks();
    await app.close();
  });

  describe('a booked one-time visit', () => {
    let bookingId: string;

    it('has no invoice before ECCS approves its report', async () => {
      ({ visitId, bookingId } = await bookedVisitReadyForApproval());
      expect(await invoicesOf({ bookingId })).toHaveLength(0);
      expect(mine(await list(owner))).toHaveLength(0);
      expect(await dues(owner)).toMatchObject({ duePaise: 0, unpaidCount: 0, oldestDueDate: null, outlets: [], clients: [] });
    });

    it('is invoiced when ECCS approves: issued, numbered, with CGST and SGST for a buyer in Telangana', async () => {
      await approve(visitId).expect(200);
      const [row] = await invoicesOf({ bookingId });
      visitInvoice = await get(owner, row!.id);

      const price = pestItem.pricePaise;
      const half = Math.round((price * 9) / 100);
      expect(visitInvoice).toMatchObject({
        kind: 'VISIT',
        status: 'ISSUED',
        organizationId,
        outletId,
        visitId,
        issueDate: today(),
        dueDate: invoiceDueDate(today()),
        periodStart: null,
        placeOfSupply: '36',
        interState: false,
        subtotalPaise: price,
        cgstPaise: half,
        sgstPaise: half,
        igstPaise: 0,
        totalPaise: price + 2 * half,
        paidPaise: 0,
        duePaise: price + 2 * half,
        overdueDays: 0,
        payments: [],
      });
      // Sequential within the financial year, and no longer than GST allows.
      expect(visitInvoice.number.startsWith(invoiceNumberPrefix(today()))).toBe(true);
      expect(visitInvoice.number).toMatch(/^ECCS\/\d{2}-\d{2}\/\d{5}$/);
      expect(visitInvoice.number.length).toBeLessThanOrEqual(16);
      expect(visitInvoice.amountInWords).toMatch(/^Rupees .+ Only$/);
      // The buyer as printed, taken from the client as it is today.
      expect(visitInvoice.billTo).toEqual({
        name: `${MARK} Client`,
        legalName: `${MARK} Foods Pvt Ltd`,
        gstin: GSTIN.telangana,
        address: '1 Test Road, Hyderabad 500001',
        stateCode: '36',
      });
      expect(visitInvoice.lines).toHaveLength(1);
      expect(visitInvoice.lines[0]).toMatchObject({
        sacCode: '998531',
        quantity: 1,
        unitPricePaise: price,
        gstRatePercent: 18,
        taxablePaise: price,
        cgstPaise: half,
        sgstPaise: half,
        igstPaise: 0,
        totalPaise: price + 2 * half,
      });
      expect(visitInvoice.lines[0]!.description).toContain('Pest control');
      expect(visitInvoice.lines[0]!.description).toContain(`${MARK} Outlet`);
    });

    it('is never invoiced twice', async () => {
      await approve(visitId).expect(409);
      const again = await Promise.all([billing.billVisit(visitId), billing.billVisit(visitId), billing.billVisit(visitId)]);
      expect(again).toEqual([visitInvoice.id, visitInvoice.id, visitInvoice.id]);
      expect(await invoicesOf({ bookingId })).toHaveLength(1);
    });

    it('never fails the approval, and is charged IGST when the buyer is in another State', async () => {
      const unlucky = await bookedVisitReadyForApproval();
      const broken = vi.spyOn(billing, 'billVisit').mockRejectedValueOnce(new Error('the database blinked'));
      expect((await approve(unlucky.visitId).expect(200)).body).toMatchObject({ status: 'APPROVED' });
      broken.mockRestore();
      expect(await invoicesOf({ bookingId: unlucky.bookingId })).toHaveLength(0);

      // Meanwhile the client registers in Karnataka. Raised afterwards, the invoice takes the next number.
      await prisma.client.organization.update({ where: { id: organizationId }, data: { gstin: GSTIN.karnataka, stateCode: '29' } });
      const id = await billing.billVisit(unlucky.visitId);
      interStateInvoice = await get(admin, id!);
      const price = pestItem.pricePaise;
      const igst = Math.round((price * 18) / 100);
      expect(interStateInvoice).toMatchObject({
        status: 'ISSUED',
        placeOfSupply: '29',
        interState: true,
        subtotalPaise: price,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: igst,
        totalPaise: price + igst,
      });
      expect(interStateInvoice.lines[0]).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: igst });
      expect(interStateInvoice.billTo).toMatchObject({ gstin: GSTIN.karnataka, stateCode: '29' });
      expect(sequence(interStateInvoice.number)).toBe(sequence(visitInvoice.number) + 1);

      // Back to Telangana, and to no State on record at all: an invoice already issued stays as it was printed.
      await prisma.client.organization.update({ where: { id: organizationId }, data: { gstin: null, stateCode: null } });
      expect(await get(admin, interStateInvoice.id)).toMatchObject({ interState: true, igstPaise: igst, billTo: { stateCode: '29' } });
      expect((await get(admin, visitInvoice.id)).billTo).toMatchObject({ gstin: GSTIN.telangana, stateCode: '36' });
    });

    it('is not invoiced when it belongs to a plan, or was added by ECCS with no booking', async () => {
      const pest = await prisma.client.serviceType.findUniqueOrThrow({ where: { code: 'PEST' } });
      const added = await http()
        .post('/visits')
        .set(bearer(admin))
        .send({ outletId, serviceCode: 'PEST', date: today(), slot: '1000', supervisorId: null })
        .expect(201);
      // A plan's visit: one that came from a recurring schedule. (The schedule is switched off so nothing fills the diary from it.)
      const schedule = await prisma.client.serviceSchedule.create({
        data: { outletId, serviceTypeId: pest.id, intervalDays: 15, nextDueDate: toDbDate(addDays(today(), 400)), isActive: false },
      });
      const planned = await prisma.client.job.create({
        data: { outletId, serviceTypeId: pest.id, scheduleId: schedule.id, plannedFor: toDbDate(today()), scheduledDate: toDbDate(today()), scheduledSlot: '1000' },
      });

      const before = await prisma.client.invoice.count({ where: { organizationId } });
      for (const id of [added.body.id as string, planned.id]) {
        await doAndSignOff(id);
        expect((await approve(id).expect(200)).body).toMatchObject({ status: 'APPROVED' });
        expect(await billing.billVisit(id)).toBeNull();
      }
      expect(await billing.billVisit('no-such-visit')).toBeNull();
      expect(await prisma.client.invoice.count({ where: { organizationId } })).toBe(before);
    });
  });

  describe('a plan', () => {
    const cycle = () => ({ start: today(), end: addDays(today(), 30) });

    it('is invoiced once per cycle, in advance, for the price agreed with the outlet', async () => {
      // An outlet on the Essential plan at a price of its own, on a cycle that begins today.
      // (Subscriptions belong to the other half of this work; the test writes one as that half would.)
      const subscription = await prisma.client.subscription.create({
        data: {
          outletId,
          planId,
          status: 'ACTIVE',
          startDate: toDbDate(cycle().start),
          pricePaise: 550_000,
          billingCycle: 'MONTHLY',
          currentPeriodStart: toDbDate(cycle().start),
          currentPeriodEnd: toDbDate(cycle().end),
          nextBillingDate: toDbDate(addDays(cycle().end, 1)),
        },
      });
      subscriptionId = subscription.id;

      const first = await billing.billDue(today(), outletId);
      expect(first.raised).toBe(1);
      planInvoice = await get(owner, first.invoiceIds[0]!);
      // No State on record now: charged as a buyer in ECCS's own State.
      expect(planInvoice).toMatchObject({
        kind: 'SUBSCRIPTION',
        status: 'ISSUED',
        outletId,
        visitId: null,
        issueDate: today(),
        dueDate: invoiceDueDate(today()),
        periodStart: cycle().start,
        periodEnd: cycle().end,
        placeOfSupply: '36',
        interState: false,
        subtotalPaise: 550_000,
        cgstPaise: 49_500,
        sgstPaise: 49_500,
        igstPaise: 0,
        totalPaise: 649_000,
        amountInWords: 'Rupees Six Thousand Four Hundred Ninety Only',
        billTo: { gstin: null, stateCode: null },
      });
      expect(planInvoice.lines[0]!.description).toContain('Essential plan');
      expect(planInvoice.lines[0]).toMatchObject({ gstRatePercent: 18, quantity: 1 });
      expect(sequence(planInvoice.number)).toBe(sequence(interStateInvoice.number) + 1);

      // Run again, as the timer does every few hours, or for this subscription alone: nothing more.
      expect((await billing.billDue(today(), outletId)).raised).toBe(0);
      expect(await billing.billSubscription(subscriptionId)).toBe(planInvoice.id);
      expect(await invoicesOf({ subscriptionId })).toHaveLength(1);
    });

    it('is not invoiced before its cycle begins, while paused, or with no price', async () => {
      const waiting = await prisma.client.subscription.create({
        data: {
          outletId: otherOutletId,
          planId,
          status: 'ACTIVE',
          startDate: toDbDate(addDays(today(), 1)),
          pricePaise: 600_000,
          billingCycle: 'MONTHLY',
          currentPeriodStart: toDbDate(addDays(today(), 1)),
          currentPeriodEnd: toDbDate(addDays(today(), 31)),
        },
      });
      const expectNone = async () => {
        expect((await billing.billDue(today(), otherOutletId)).raised).toBe(0);
        expect(await billing.billSubscription(waiting.id)).toBeNull();
      };
      await expectNone();

      const begun = { currentPeriodStart: toDbDate(today()), currentPeriodEnd: toDbDate(addDays(today(), 30)) };
      await prisma.client.subscription.update({ where: { id: waiting.id }, data: { ...begun, status: 'PAUSED' } });
      await expectNone();
      await prisma.client.subscription.update({ where: { id: waiting.id }, data: { status: 'CANCELLED' } });
      await expectNone();
      // One from before prices were kept on the subscription, not yet filled in.
      await prisma.client.subscription.update({ where: { id: waiting.id }, data: { status: 'ACTIVE', pricePaise: null } });
      await expectNone();
      expect(await billing.billSubscription('no-such-subscription')).toBeNull();

      // Active, begun and priced: now it is, and the second outlet has an invoice of its own.
      await prisma.client.subscription.update({ where: { id: waiting.id }, data: { pricePaise: 600_000 } });
      expect((await billing.billDue(today(), otherOutletId)).raised).toBe(1);
    });

    it('numbers within the financial year, starting again on 1 April', async () => {
      const lastOfThisYear = sequence((await invoicesOf({ number: { startsWith: invoiceNumberPrefix(today()) } })).at(-1)!.number);
      // A year that is certainly not in use yet, so the count of its invoices is known.
      const nextPrefix = invoiceNumberPrefix('2031-04-01');
      expect(nextPrefix).toBe('ECCS/31-32/');
      expect(await prisma.client.invoice.count({ where: { number: { startsWith: nextPrefix } } })).toBe(0);

      // The cycle that begins on 31 March is the last invoice of one financial year…
      await setCycle(subscriptionId, '2031-03-31', '2031-04-29');
      const march = await get(admin, (await billing.billSubscription(subscriptionId, '2031-03-31'))!);
      expect(march.number.startsWith('ECCS/30-31/')).toBe(true);
      expect(march).toMatchObject({ issueDate: '2031-03-31', dueDate: '2031-04-07', periodStart: '2031-03-31' });

      // …and the one that begins on 1 April is the first of the next.
      await setCycle(subscriptionId, '2031-04-01', '2031-04-30');
      const april = await get(admin, (await billing.billSubscription(subscriptionId, '2031-04-01'))!);
      expect(april.number).toBe('ECCS/31-32/00001');
      await setCycle(subscriptionId, '2031-05-01', '2031-05-31');
      const may = await get(admin, (await billing.billSubscription(subscriptionId, '2031-05-01'))!);
      expect(may.number).toBe('ECCS/31-32/00002');

      // This year's numbers carry on from where they were.
      await setCycle(subscriptionId, addDays(today(), -40), addDays(today(), -10));
      const earlier = await get(admin, (await billing.billSubscription(subscriptionId))!);
      expect(earlier.number.startsWith(invoiceNumberPrefix(today()))).toBe(true);
      expect(sequence(earlier.number)).toBe(lastOfThisYear + 1);

      // Those three were only for the numbering.
      for (const invoice of [march, april, may]) {
        await prisma.client.invoice.delete({ where: { id: invoice.id } });
      }
      await setCycle(subscriptionId, today(), addDays(today(), 30));
    });

    it('gives two invoices raised at the same moment different numbers', async () => {
      const second = await prisma.client.subscription.findFirstOrThrow({ where: { outletId: otherOutletId } });
      await setCycle(subscriptionId, addDays(today(), 31), addDays(today(), 61));
      await setCycle(second.id, addDays(today(), 31), addDays(today(), 61));
      const at = addDays(today(), 31);
      const ids = await Promise.all([
        billing.billSubscription(subscriptionId, at),
        billing.billSubscription(second.id, at),
        billing.billSubscription(subscriptionId, at),
        billing.billSubscription(second.id, at),
      ]);
      expect(new Set(ids).size).toBe(2);
      const numbers = (await prisma.client.invoice.findMany({ where: { id: { in: ids as string[] } } })).map((invoice) => invoice.number);
      expect(new Set(numbers).size).toBe(2);
      // Only for the numbering, like the ones above.
      await prisma.client.invoice.deleteMany({ where: { id: { in: ids as string[] } } });
      await setCycle(subscriptionId, today(), addDays(today(), 30));
      await setCycle(second.id, today(), addDays(today(), 30));
    });
  });

  describe('who may see and do what', () => {
    it('shows the Owner every invoice of the client, the newest first', async () => {
      const all = mine(await list(owner));
      expect(all.map((invoice) => invoice.id)).toEqual(expect.arrayContaining([visitInvoice.id, interStateInvoice.id, planInvoice.id]));
      expect(all.some((invoice) => invoice.outletId === otherOutletId)).toBe(true);
      expect(all.map((invoice) => invoice.issueDate)).toEqual(all.map((invoice) => invoice.issueDate).sort().reverse());
      // Narrowed by outlet and by status.
      expect((await list(owner, { outletId: otherOutletId })).every((invoice) => invoice.outletId === otherOutletId)).toBe(true);
      expect(await list(owner, { status: 'PAID' })).toEqual([]);
      await http().get('/invoices').query({ status: 'NOPE' }).set(bearer(owner)).expect(400);
    });

    it('shows the Manager the invoices of their own outlet only, to read', async () => {
      const theirs = await list(manager);
      expect(theirs.length).toBeGreaterThanOrEqual(3);
      expect(theirs.every((invoice) => invoice.outletId === outletId)).toBe(true);
      await get(manager, planInvoice.id);
      const elsewhere = mine(await list(owner)).find((invoice) => invoice.outletId === otherOutletId)!;
      await http().get(`/invoices/${elsewhere.id}`).set(bearer(manager)).expect(404);
      await pdf(manager, elsewhere.id).expect(404);
      expect((await dues(manager)).outlets.map((entry) => entry.outletId)).toEqual([outletId]);

      // Reading only: paying is the Owner's, everything else ECCS's.
      await start(manager, planInvoice.id).expect(403);
      await record(manager, planInvoice.id, { method: 'cash', amountPaise: 100, paidOn: today() }).expect(403);
      await voidIt(manager, planInvoice.id).expect(403);
      await http().post('/invoices/raise-due').set(bearer(manager)).expect(403);
      await http().get('/invoices/totals').set(bearer(manager)).expect(403);
    });

    it('shows ECCS admins everything, by client', async () => {
      const all = await list(admin, { organizationId });
      expect(all).toHaveLength(mine(await list(owner)).length);
      expect((await list(admin)).length).toBeGreaterThanOrEqual(all.length);
      await get(admin, visitInvoice.id);
    });

    it('keeps them from the Head Chef, the Supervisor, another restaurant and anyone not logged in', async () => {
      for (const token of [chef, supervisor]) {
        await http().get('/invoices').set(bearer(token)).expect(403);
        await http().get('/invoices/dues').set(bearer(token)).expect(403);
        await http().get(`/invoices/${visitInvoice.id}`).set(bearer(token)).expect(403);
        await pdf(token, visitInvoice.id).expect(403);
        await start(token, visitInvoice.id).expect(403);
        await record(token, visitInvoice.id, { method: 'cash', amountPaise: 100, paidOn: today() }).expect(403);
        await voidIt(token, visitInvoice.id).expect(403);
        await http().post('/invoices/raise-due').set(bearer(token)).expect(403);
      }
      expect(mine(await list(otherManager))).toEqual([]);
      expect(await list(otherManager, { outletId })).toEqual([]);
      await http().get(`/invoices/${visitInvoice.id}`).set(bearer(otherManager)).expect(404);
      await pdf(otherManager, visitInvoice.id).expect(404);
      expect((await dues(otherManager, { outletId })).duePaise).toBe(0);

      await http().get('/invoices').expect(401);
      await http().get(`/invoices/${visitInvoice.id}`).expect(401);
      await http().post(`/invoices/${visitInvoice.id}/payments`).send({ method: 'upi' }).expect(401);
      await http().get('/invoices/no-such-invoice').set(bearer(admin)).expect(404);
    });

    it('lets only ECCS admins raise what is due, from the console button', async () => {
      await http().post('/invoices/raise-due').set(bearer(owner)).expect(403);
      // The button runs for every outlet; here it is kept to the throwaway one so the sample clients are left alone.
      const everything = billing.billDue.bind(billing);
      const narrowed = vi.spyOn(billing, 'billDue').mockImplementation((asOf?: string) => everything(asOf, outletId));
      expect((await http().post('/invoices/raise-due').set(bearer(admin)).expect(200)).body).toEqual({ raised: 0 });
      expect(narrowed).toHaveBeenCalledTimes(1);
      narrowed.mockRestore();
    });
  });

  describe('the invoice as a PDF', () => {
    const filed = async (number: string) =>
      ((await http().get('/documents').query({ outletId }).set(bearer(owner)).expect(200)).body as { title: string; category: string }[]).filter(
        (document) => document.title.includes(number),
      );

    it('can be made later when making it fails, the invoice staying on record', async () => {
      expect(visitInvoice.pdfReady).toBe(false);
      const printer = vi.spyOn(app.get(PdfPrinterService), 'print').mockRejectedValueOnce(new Error('no browser'));
      await pdf(owner, visitInvoice.id).expect(500);
      printer.mockRestore();
      expect(await filed(visitInvoice.number)).toHaveLength(0);
      expect((await get(owner, visitInvoice.id)).pdfReady).toBe(false);
    });

    it('carries every particular a tax invoice must, and is filed in the outlet’s documents under Invoice', async () => {
      const link = (await pdf(owner, visitInvoice.id).expect(200)).body as { path: string };
      const file = await download(link.path);
      expect(file.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      // A copy to look at, when asked for: INVOICE_PDF_SAMPLE=<where to put it>.
      if (process.env.INVOICE_PDF_SAMPLE) writeFileSync(process.env.INVOICE_PDF_SAMPLE, file);

      const text = await textOf(file);
      for (const particular of [
        'Tax invoice',
        SUPPLIER.legalName,
        SUPPLIER.gstin,
        'Telangana (36)',
        visitInvoice.number,
        'Invoice date',
        `${MARK} Foods Pvt Ltd`,
        GSTIN.telangana,
        '1 Test Road, Hyderabad 500001',
        'Place of supply',
        '998531',
        'Pest control',
        'Taxable value',
        'CGST',
        'SGST',
        '9%',
        visitInvoice.amountInWords,
        'Reverse charge',
        'Authorised signatory',
        `For ${SUPPLIER.legalName}`,
        'Balance due',
      ]) {
        expect(text).toContain(particular);
      }
      expect(text).not.toContain('IGST');
      expect(text).not.toContain('PAID');
      expect(text).not.toContain('VOID');

      // Asking again gives the same file, not a second copy, to everyone who may read the invoice.
      const again = (await pdf(admin, visitInvoice.id).expect(200)).body as { path: string };
      expect(again.path.split('?')[0]).toBe(link.path.split('?')[0]);
      await pdf(manager, visitInvoice.id).expect(200);
      const documents = await filed(visitInvoice.number);
      expect(documents).toHaveLength(1);
      expect(documents[0]).toMatchObject({ category: 'invoice' });
      expect((await get(owner, visitInvoice.id)).pdfReady).toBe(true);
    }, 60_000);
  });

  describe('paying in the app with the sample payment', () => {
    let failed: Payment;
    let paid: Payment;

    it('starts a pending payment for everything that is due, and carries on with it if started again', async () => {
      await start(owner, visitInvoice.id, { method: 'cheque' }).expect(400);
      await start(owner, visitInvoice.id, {}).expect(400);
      const session = (await start(owner, visitInvoice.id, { method: 'card' }).expect(200)).body as { payment: Payment; gateway: string };
      expect(session.gateway).toBe('sample');
      expect(session.payment).toMatchObject({
        invoiceId: visitInvoice.id,
        invoiceNumber: visitInvoice.number,
        amountPaise: visitInvoice.duePaise,
        method: 'card',
        status: 'PENDING',
        gateway: 'sample',
        reference: null,
        paidAt: null,
      });
      // Changing their mind about how to pay does not start a second one.
      const again = (await start(owner, visitInvoice.id, { method: 'upi' }).expect(200)).body as { payment: Payment };
      expect(again.payment).toMatchObject({ id: session.payment.id, method: 'upi', status: 'PENDING' });
      failed = again.payment;

      // Nothing is paid yet, and the restaurant is not shown a payment that was only started.
      expect(await get(owner, visitInvoice.id)).toMatchObject({ status: 'ISSUED', paidPaise: 0, payments: [], pdfReady: true });
      expect((await get(admin, visitInvoice.id)).payments).toHaveLength(1);
    });

    it('can be made to fail, which changes nothing on the invoice', async () => {
      await confirm(manager, failed.id).expect(403);
      await confirm(otherManager, failed.id).expect(404);
      await confirm(owner, 'no-such-payment').expect(404);

      const result = (await confirm(owner, failed.id, { outcome: 'fail' }).expect(200)).body as Result;
      expect(result.payment).toMatchObject({ id: failed.id, status: 'FAILED', reference: null, paidAt: null });
      expect(result.payment.failureReason).toEqual(expect.any(String));
      expect(result.invoice).toMatchObject({ status: 'ISSUED', paidPaise: 0, duePaise: visitInvoice.duePaise, pdfReady: true });

      // A failed payment stays failed, whatever is sent afterwards.
      const replay = (await confirm(owner, failed.id, { outcome: 'success' }).expect(200)).body as Result;
      expect(replay.payment).toMatchObject({ status: 'FAILED' });
      expect(replay.invoice).toMatchObject({ status: 'ISSUED', paidPaise: 0 });
    });

    it('marks the invoice paid when it succeeds, once, however often that is sent', async () => {
      const session = (await start(owner, visitInvoice.id, { method: 'upi' }).expect(200)).body as { payment: Payment };
      expect(session.payment.id).not.toBe(failed.id);

      // The same confirmation sent three times at once, as a phone with a poor signal might.
      const results = (await Promise.all([confirm(owner, session.payment.id), confirm(owner, session.payment.id), confirm(owner, session.payment.id)])).map(
        (response) => {
          expect(response.status).toBe(200);
          return response.body as Result;
        },
      );
      for (const result of results) {
        expect(result.payment).toMatchObject({ status: 'SUCCEEDED', amountPaise: visitInvoice.totalPaise, method: 'upi', gateway: 'sample' });
      }
      paid = results[0]!.payment;
      expect(paid.reference).toMatch(/^SAMPLE-[0-9A-F]{10}$/);
      expect(paid.paidAt).toEqual(expect.any(String));

      // Sent again later, even as a failure: nothing changes, and the reference is the one already given.
      const replay = (await confirm(owner, paid.id, { outcome: 'fail' }).expect(200)).body as Result;
      expect(replay.payment).toMatchObject({ status: 'SUCCEEDED', reference: paid.reference, paidAt: paid.paidAt });

      const invoice = await get(owner, visitInvoice.id);
      expect(invoice).toMatchObject({ status: 'PAID', paidPaise: visitInvoice.totalPaise, duePaise: 0, overdueDays: 0 });
      expect(invoice.payments.map((payment) => payment.status).sort()).toEqual(['FAILED', 'SUCCEEDED']);
      expect(await prisma.client.payment.count({ where: { invoiceId: visitInvoice.id, status: 'SUCCEEDED' } })).toBe(1);
      expect(await list(owner, { status: 'PAID' })).toHaveLength(1);
    });

    it('gives a receipt to those who may read the invoice', async () => {
      const receipt = (await http().get(`/payments/${paid.id}`).set(bearer(owner)).expect(200)).body as Result;
      expect(receipt.payment).toMatchObject({ id: paid.id, status: 'SUCCEEDED', reference: paid.reference, invoiceNumber: visitInvoice.number });
      expect(receipt.invoice).toMatchObject({ id: visitInvoice.id, status: 'PAID', duePaise: 0 });
      await http().get(`/payments/${paid.id}`).set(bearer(manager)).expect(200);
      await http().get(`/payments/${paid.id}`).set(bearer(otherManager)).expect(404);
      await http().get(`/payments/${paid.id}`).set(bearer(chef)).expect(403);
    });

    it('takes nothing more on a paid invoice, which can no longer be made void', async () => {
      await start(owner, visitInvoice.id).expect(409);
      await record(admin, visitInvoice.id, { method: 'cash', amountPaise: 100, paidOn: today() }).expect(409);
      await voidIt(admin, visitInvoice.id).expect(409);
      expect(await get(admin, visitInvoice.id)).toMatchObject({ status: 'PAID', voidedAt: null });
    });

    it('makes the PDF again with the PAID mark, in place of the old one', async () => {
      // The payment made the PDF on file out of date.
      expect((await get(owner, visitInvoice.id)).pdfReady).toBe(false);
      const link = (await pdf(owner, visitInvoice.id).expect(200)).body as { path: string };
      const file = await download(link.path);
      if (process.env.INVOICE_PDF_SAMPLE) writeFileSync(process.env.INVOICE_PDF_SAMPLE.replace(/\.pdf$/i, '-paid.pdf'), file);
      const text = await textOf(file);
      expect(text).toContain('PAID');
      expect(text).toContain('Paid in full on');
      expect(text).toContain(paid.reference!);
      expect(text).toContain('Payments received');

      const documents = (await http().get('/documents').query({ outletId }).set(bearer(owner)).expect(200)).body as { title: string; category: string }[];
      const forThis = documents.filter((document) => document.title.includes(visitInvoice.number));
      expect(forThis).toHaveLength(1);
      expect(forThis[0]).toMatchObject({ category: 'invoice', title: `Tax invoice ${visitInvoice.number} (paid)` });
      expect((await get(owner, visitInvoice.id)).pdfReady).toBe(true);
    }, 60_000);
  });

  describe('a payment recorded by ECCS', () => {
    const paymentId = '7d0c1a52-3f1e-4b6a-9a51-e2e0b1111001';

    it('needs an amount, a date that is not in the future, and a reference unless it was cash', async () => {
      const good = { method: 'bank-transfer', amountPaise: 200_000, paidOn: today(), reference: 'UTR0001' };
      await record(admin, planInvoice.id, { ...good, amountPaise: 0 }).expect(400);
      await record(admin, planInvoice.id, { ...good, amountPaise: 10.5 }).expect(400);
      await record(admin, planInvoice.id, { ...good, method: 'card' }).expect(400);
      await record(admin, planInvoice.id, { ...good, reference: '' }).expect(400);
      await record(admin, planInvoice.id, { ...good, paidOn: addDays(today(), 1) }).expect(400);
      await record(admin, planInvoice.id, { ...good, paidOn: 'yesterday' }).expect(400);
      await record(owner, planInvoice.id, good).expect(403);
      await record(admin, 'no-such-invoice', good).expect(404);
      expect(await get(admin, planInvoice.id)).toMatchObject({ status: 'ISSUED', paidPaise: 0 });
    });

    it('may be part of what is due, and saving the same form twice records it once', async () => {
      const body = { id: paymentId, method: 'bank-transfer', amountPaise: 200_000, paidOn: addDays(today(), -1), reference: 'UTR0001' };
      const result = (await record(admin, planInvoice.id, body).expect(200)).body as Result;
      expect(result.payment).toMatchObject({
        id: paymentId,
        status: 'SUCCEEDED',
        gateway: 'manual',
        method: 'bank-transfer',
        amountPaise: 200_000,
        reference: 'UTR0001',
      });
      expect(indiaDate(new Date(result.payment.paidAt!))).toBe(addDays(today(), -1));
      // ECCS sees who recorded it; the restaurant does not.
      expect(result.payment.recordedByName).toEqual(expect.any(String));
      expect(result.invoice).toMatchObject({ status: 'PARTIALLY_PAID', paidPaise: 200_000, duePaise: 449_000 });

      const again = (await record(admin, planInvoice.id, body).expect(200)).body as Result;
      expect(again.invoice).toMatchObject({ status: 'PARTIALLY_PAID', paidPaise: 200_000 });
      expect(await prisma.client.payment.count({ where: { invoiceId: planInvoice.id } })).toBe(1);
      // The same id cannot be used on another invoice.
      await record(admin, interStateInvoice.id, body).expect(409);

      const seen = await get(owner, planInvoice.id);
      expect(seen.payments).toHaveLength(1);
      expect(seen.payments[0]).toMatchObject({ amountPaise: 200_000, recordedByName: null });
    });

    it('is refused when it is more than what is due', async () => {
      const response = await record(admin, planInvoice.id, { method: 'cash', amountPaise: 449_001, paidOn: today() }).expect(400);
      expect(response.body.message).toContain('4,490.00');
      expect(await get(admin, planInvoice.id)).toMatchObject({ status: 'PARTIALLY_PAID', paidPaise: 200_000 });

      // Cash for part of the rest, with no reference.
      const cash = (await record(admin, planInvoice.id, { method: 'cash', amountPaise: 49_000, paidOn: today() }).expect(200)).body as Result;
      expect(cash.payment).toMatchObject({ method: 'cash', reference: null });
      expect(cash.invoice).toMatchObject({ status: 'PARTIALLY_PAID', paidPaise: 249_000, duePaise: 400_000 });
    });

    it('leaves the rest to be paid in the app, which then pays exactly what is left', async () => {
      await voidIt(admin, planInvoice.id).expect(409);
      const session = (await start(owner, planInvoice.id, { method: 'netbanking' }).expect(200)).body as { payment: Payment };
      expect(session.payment.amountPaise).toBe(400_000);

      // ECCS records the last of it by cheque before the Owner finishes: the app's payment no longer fits and fails.
      await record(admin, planInvoice.id, { method: 'cheque', amountPaise: 100_000, paidOn: today(), reference: '000123' }).expect(200);
      const late = (await confirm(owner, session.payment.id).expect(200)).body as Result;
      expect(late.payment).toMatchObject({ status: 'FAILED' });
      expect(late.invoice).toMatchObject({ status: 'PARTIALLY_PAID', paidPaise: 349_000, duePaise: 300_000 });

      const rest = (await start(owner, planInvoice.id, { method: 'upi' }).expect(200)).body as { payment: Payment };
      expect(rest.payment.amountPaise).toBe(300_000);
      const done = (await confirm(owner, rest.payment.id).expect(200)).body as Result;
      expect(done.invoice).toMatchObject({ status: 'PAID', paidPaise: 649_000, duePaise: 0 });
      expect(done.invoice.payments.filter((payment) => payment.status === 'SUCCEEDED')).toHaveLength(4);
    });
  });

  describe('making an invoice void', () => {
    let replacement: Invoice;

    it('is for ECCS admins, with a reason', async () => {
      await voidIt(owner, interStateInvoice.id).expect(403);
      await voidIt(admin, interStateInvoice.id, {}).expect(400);
      await voidIt(admin, interStateInvoice.id, { reason: ' ' }).expect(400);
      await voidIt(admin, 'no-such-invoice').expect(404);
      await http().post(`/invoices/${interStateInvoice.id}/raise-again`).set(bearer(admin)).expect(409);
    });

    it('keeps the invoice and its number on record, owing nothing, and stops a payment that was started', async () => {
      const session = (await start(owner, interStateInvoice.id).expect(200)).body as { payment: Payment };
      const voided = (await voidIt(admin, interStateInvoice.id, { reason: `${MARK}: wrong State` }).expect(200)).body as Invoice;
      expect(voided).toMatchObject({
        id: interStateInvoice.id,
        number: interStateInvoice.number,
        status: 'VOID',
        voidReason: `${MARK}: wrong State`,
        totalPaise: interStateInvoice.totalPaise,
        duePaise: 0,
        overdueDays: 0,
      });
      expect(voided.voidedAt).toEqual(expect.any(String));
      await voidIt(admin, interStateInvoice.id).expect(409);

      // The payment the Owner had open cannot go through any more, and nothing new can be started.
      const late = (await confirm(owner, session.payment.id).expect(200)).body as Result;
      expect(late.payment).toMatchObject({ status: 'FAILED' });
      expect(late.invoice).toMatchObject({ status: 'VOID', paidPaise: 0 });
      await start(owner, interStateInvoice.id).expect(409);
      await record(admin, interStateInvoice.id, { method: 'cash', amountPaise: 100, paidOn: today() }).expect(409);

      // Still listed, for the restaurant too, and not counted in what is due.
      expect((await list(owner, { status: 'VOID' })).map((invoice) => invoice.id)).toEqual([interStateInvoice.id]);
    });

    it('lets the same visit be invoiced again, under a new number, once', async () => {
      await http().post(`/invoices/${interStateInvoice.id}/raise-again`).set(bearer(owner)).expect(403);
      const newest = sequence((await invoicesOf({ number: { startsWith: invoiceNumberPrefix(today()) } })).at(-1)!.number);
      replacement = (await http().post(`/invoices/${interStateInvoice.id}/raise-again`).set(bearer(admin)).expect(200)).body as Invoice;
      expect(replacement.id).not.toBe(interStateInvoice.id);
      expect(sequence(replacement.number)).toBe(newest + 1);
      // The client has no State on record now, so this one is charged CGST and SGST.
      expect(replacement).toMatchObject({ status: 'ISSUED', kind: 'VISIT', interState: false, igstPaise: 0, visitId: interStateInvoice.visitId });

      // Asked for again, the answer is the one that replaced it.
      const again = (await http().post(`/invoices/${interStateInvoice.id}/raise-again`).set(bearer(admin)).expect(200)).body as Invoice;
      expect(again.id).toBe(replacement.id);
      expect(await prisma.client.invoice.count({ where: { bookingId: { not: null }, organizationId, status: { not: 'VOID' } } })).toBe(2);
    });

    it('lets a void cycle of a plan be invoiced again by the next run', async () => {
      const second = await prisma.client.subscription.findFirstOrThrow({ where: { outletId: otherOutletId } });
      const [first] = await invoicesOf({ subscriptionId: second.id });
      await voidIt(admin, first!.id).expect(200);
      const run = await billing.billDue(today(), otherOutletId);
      expect(run.raised).toBe(1);
      expect(run.invoiceIds[0]).not.toBe(first!.id);
      expect((await billing.billDue(today(), otherOutletId)).raised).toBe(0);
      const all = await invoicesOf({ subscriptionId: second.id });
      expect(all.map((invoice) => invoice.status)).toEqual(['VOID', 'ISSUED']);
      expect(new Set(all.map((invoice) => invoice.number)).size).toBe(2);
    });

    it('prints VOID on the PDF', async () => {
      const link = (await pdf(admin, interStateInvoice.id).expect(200)).body as { path: string };
      const file = await download(link.path);
      if (process.env.INVOICE_PDF_SAMPLE) writeFileSync(process.env.INVOICE_PDF_SAMPLE.replace(/\.pdf$/i, '-void.pdf'), file);
      const text = await textOf(file);
      expect(text).toContain('VOID');
      expect(text).toContain(`${MARK}: wrong State`);
      // It was raised for a buyer in Karnataka: IGST, and no CGST or SGST.
      expect(text).toContain('IGST');
      expect(text).toContain('Karnataka (29)');
      expect(text).not.toContain('CGST');
      expect(text).not.toContain('Balance due');
    }, 60_000);
  });

  describe('what is due', () => {
    it('adds up the unpaid invoices by outlet and by client, with how overdue the oldest is', async () => {
      // Unpaid now: the replacement visit invoice and the earlier plan cycle at the first outlet, one plan invoice at the second.
      const unpaid = mine(await list(owner)).filter((invoice) => invoice.duePaise > 0);
      expect(unpaid).toHaveLength(3);
      const total = unpaid.reduce((sum, invoice) => sum + invoice.duePaise, 0);
      expect(await dues(owner)).toMatchObject({ duePaise: total, unpaidCount: 3, overduePaise: 0, overdueCount: 0, oldestOverdueDays: 0 });

      // Two of them fall overdue: one by 10 days at the first outlet, one by 3 at the second.
      const here = unpaid.filter((invoice) => invoice.outletId === outletId);
      const there = unpaid.find((invoice) => invoice.outletId === otherOutletId)!;
      await prisma.client.invoice.update({ where: { id: here[0]!.id }, data: { dueDate: toDbDate(addDays(today(), -10)) } });
      await prisma.client.invoice.update({ where: { id: there.id }, data: { dueDate: toDbDate(addDays(today(), -3)) } });
      // Due today is not overdue yet.
      await prisma.client.invoice.update({ where: { id: here[1]!.id }, data: { dueDate: toDbDate(today()) } });

      const all = await dues(owner);
      expect(all).toMatchObject({
        duePaise: total,
        unpaidCount: 3,
        overduePaise: here[0]!.duePaise + there.duePaise,
        overdueCount: 2,
        oldestOverdueDays: 10,
        oldestDueDate: addDays(today(), -10),
      });
      expect(all.clients).toHaveLength(1);
      expect(all.clients[0]).toMatchObject({ organizationId, duePaise: total, overdueCount: 2, oldestOverdueDays: 10 });
      // The outlet that has owed longest comes first.
      expect(all.outlets.map((entry) => entry.outletId)).toEqual([outletId, otherOutletId]);
      expect(all.outlets[0]).toMatchObject({ duePaise: here[0]!.duePaise + here[1]!.duePaise, unpaidCount: 2, overdueCount: 1, oldestOverdueDays: 10 });
      expect(all.outlets[1]).toMatchObject({ duePaise: there.duePaise, unpaidCount: 1, overdueCount: 1, oldestOverdueDays: 3 });

      // One outlet's alone, as the app's Home asks for it.
      expect(await dues(owner, { outletId: otherOutletId })).toMatchObject({ duePaise: there.duePaise, unpaidCount: 1, oldestOverdueDays: 3 });
      expect(await dues(manager)).toMatchObject({ duePaise: here[0]!.duePaise + here[1]!.duePaise, unpaidCount: 2, oldestOverdueDays: 10 });

      // The invoices themselves say so too.
      expect(await get(owner, here[0]!.id)).toMatchObject({ overdueDays: 10, status: 'ISSUED' });
      expect(await get(owner, here[1]!.id)).toMatchObject({ overdueDays: 0 });
    });

    it('gives ECCS the same by client, and the totals for the top of its page', async () => {
      const all = await dues(admin);
      const client = all.clients.find((entry) => entry.organizationId === organizationId)!;
      expect(client).toMatchObject({ unpaidCount: 3, overdueCount: 2, oldestOverdueDays: 10 });
      expect(all.duePaise).toBeGreaterThanOrEqual(client.duePaise);

      const totals = (await http().get('/invoices/totals').set(bearer(admin)).expect(200)).body as {
        duePaise: number;
        unpaidCount: number;
        overduePaise: number;
        overdueCount: number;
        collectedThisMonthPaise: number;
      };
      expect(totals).toMatchObject({ duePaise: all.duePaise, unpaidCount: all.unpaidCount, overduePaise: all.overduePaise, overdueCount: all.overdueCount });
      // Everything this suite collected today, bar the transfer dated yesterday, which may fall in last month.
      const collectedToday = visitInvoice.totalPaise + 49_000 + 100_000 + 300_000;
      expect(totals.collectedThisMonthPaise).toBeGreaterThanOrEqual(collectedToday);
      await http().get('/invoices/totals').set(bearer(owner)).expect(403);
    });
  });
});
