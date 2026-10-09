// The services added on 9 Oct 2026: that they are on offer and bookable, that a
// booked visit of a new kind ends in an invoice with the right tax code, the
// frying oil reading, result documents from partners, adding a kind of service
// from the console, the hood-and-duct certificate, and plans with new kinds.
//
// Runs against the local database with the sample seed and `pnpm services:load`
// done, and local object storage running. Everything happens at a throwaway
// client that is removed afterwards; the sample people and outlets are untouched.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { certificateValidUntil, readingVerdict, SERVICE_CATEGORIES } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { vi } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { CertificatePdfService } from './../src/certificates/certificate-pdf.service.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PdfPrinterService } from './../src/pdf/pdf-printer.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { ReportPdfService } from './../src/services/report-pdf.service.js';

const MARK = 'E2E NewServices';
const DEVICE = 'e2e-new-services';
const SAMPLE = { code: 'SPICE-JH2K7M', managerPin: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003', owner: '+919199900031' };
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e new services photo bytes')]);
const PDF = Buffer.from('%PDF-1.4\n% e2e new services lab report\n');

const NEW_CODES = ['RATING_READINESS', 'OIL_TEST', 'WATER_TEST', 'STAFF_MEDICAL', 'FSS_TRAINING', 'GREASE_TRAP', 'CHEMICAL_REFILL'];
const PARTNER_CODES = ['RATING_READINESS', 'WATER_TEST', 'STAFF_MEDICAL', 'FSS_TRAINING'];
const LANGUAGES = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr', 'bn', 'or', 'gu', 'pa', 'ur'];

type Text = Record<string, string>;
type Item = {
  id: string;
  serviceCode: string;
  name: Text;
  description: Text | null;
  pricePaise: number;
  category: string;
  partnerDelivered: boolean;
};
type Task = { itemId: string; label: Text; done: boolean | null; note: string | null; reading: { value: number | null; limit: number | null } | null };
type Visit = {
  id: string;
  status: string;
  serviceCode: string;
  tasks: Task[];
  partnerDelivered: boolean;
  partnerName: string | null;
  documents: { id: string; title: string; file: { path: string; mimeType: string } }[];
  canAttachDocument: boolean;
  certificate: { number: string; validFrom: string; validUntil: string } | null;
};
type Kind = {
  code: string;
  name: Text;
  category: string;
  sacCode: string;
  gstRatePercent: number;
  partnerDelivered: boolean;
  issuesCertificate: boolean;
  certificateValidDays: number | null;
  tasks: { id: string; readingLimit: number | null }[];
};
type Catalogue = { kinds: Kind[]; items: { id: string; serviceCode: string; name: Text }[] };

describe('New services (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let organizationId: string;
  let outletId: string;
  let owner: string;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  let otherManager: string;
  let catalog: Item[];
  /** The page handed to the PDF printer for the last report made, so its wording can be read. */
  let printed = '';

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = () => indiaDate();
  const itemOf = (code: string, name?: string) => {
    const found = catalog.find((item) => item.serviceCode === code && (!name || item.name.en === name));
    if (!found) throw new Error(`No bookable service of kind ${code}. Run "pnpm services:load" in packages/db.`);
    return found;
  };

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
    await db.checklistRun.deleteMany({ where: outlets });
    await db.outletChecklist.deleteMany({ where: outlets });
    await db.hygieneScoreSnapshot.deleteMany({ where: outlets });
    await db.user.deleteMany({ where: { memberships: { some: { OR: [{ organization: ours }, { outlet: { organization: ours } }] } } } });
    await db.user.deleteMany({ where: { phone: PHONES.owner } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { OR: [{ name: DEVICE }, { organization: ours }] } });
    await db.outlet.deleteMany({ where: { organization: ours } });
    await db.organization.deleteMany({ where: ours });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
    await db.$executeRaw`DELETE FROM "Notification" WHERE "data"::text ILIKE ${`%${MARK}%`} OR "body" ILIKE ${`%${MARK}%`}`;
    // The plan and the kind of service the tests add (plan lines go with their plan).
    await db.plan.deleteMany({ where: { name: { path: ['en'], string_starts_with: MARK } } });
    const kinds = await db.serviceType.findMany({
      where: { name: { path: ['en'], string_starts_with: MARK } },
      select: { id: true, checklistTemplateId: true },
    });
    for (const kind of kinds) {
      await db.serviceCatalogItem.deleteMany({ where: { serviceTypeId: kind.id } });
      await db.serviceType.delete({ where: { id: kind.id } });
      if (kind.checklistTemplateId) await db.checklistTemplate.delete({ where: { id: kind.checklistTemplateId } });
    }
  }

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    return (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body.token as string;
  }
  async function pinLogin(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    return (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200)).body.token as string;
  }

  const getVisit = async (token: string, id: string): Promise<Visit> => (await http().get(`/visits/${id}`).set(bearer(token)).expect(200)).body;
  const answer = (token: string, visitId: string, itemId: string, body: Record<string, unknown>) =>
    http().put(`/visits/${visitId}/tasks/${itemId}`).set(bearer(token)).send(body);
  const attach = (token: string, visitId: string, fields: Record<string, string>, file: Buffer = PDF, name = 'report.pdf') => {
    const call = http().post(`/visits/${visitId}/documents`).set(bearer(token));
    for (const [key, value] of Object.entries(fields)) call.field(key, value);
    return call.attach('file', file, { filename: name, contentType: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' });
  };

  /** The Owner books a service; ECCS confirms it for today and gives it to the Supervisor. */
  async function book(item: Item): Promise<{ visitId: string; bookingId: string }> {
    const booking = await http()
      .post('/bookings')
      .set(bearer(owner))
      .send({ outletId, catalogItemId: item.id, preferredDate: today(), preferredSlot: '1000' })
      .expect(201);
    const confirmed = await http()
      .post(`/bookings/${booking.body.id}/confirm`)
      .set(bearer(admin))
      .send({ date: today(), slot: '1000', supervisorId })
      .expect(200);
    return { visitId: confirmed.body.visitId as string, bookingId: booking.body.id as string };
  }
  /** Ticks every task still unanswered, adds the photo, finishes, and has the Owner sign off. */
  async function finishAndSignOff(visitId: string) {
    const visit = await getVisit(supervisor, visitId);
    for (const task of visit.tasks.filter((entry) => entry.done === null)) {
      await answer(supervisor, visitId, task.itemId, task.reading ? { done: true, value: 10 } : { done: true }).expect(200);
    }
    await http()
      .post(`/visits/${visitId}/photos`)
      .set(bearer(supervisor))
      .field('kind', 'AFTER')
      .attach('file', PHOTO, { filename: 'visit.jpg', contentType: 'image/jpeg' })
      .expect(200);
    await http().post(`/visits/${visitId}/complete`).set(bearer(supervisor)).expect(200);
    await http().post(`/visits/${visitId}/sign-off`).set(bearer(owner)).send({ rating: 5 }).expect(200);
  }
  const checkIn = (visitId: string) => http().post(`/visits/${visitId}/check-in`).set(bearer(supervisor)).send({}).expect(200);
  const approve = (visitId: string) => http().post(`/visits/${visitId}/approve-report`).set(bearer(admin));
  const invoiceOf = (bookingId: string) =>
    prisma.client.invoice.findFirstOrThrow({ where: { bookingId }, include: { lines: true } });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();

    // PDFs made in the background on approval each start a browser; they are held back. The one
    // report this suite asks for by name is "printed" by a stand-in that keeps the page to read.
    vi.spyOn(app.get(ReportPdfService), 'ensureLater').mockImplementation(() => undefined);
    vi.spyOn(app.get(CertificatePdfService), 'ensureLater').mockImplementation(() => undefined);
    vi.spyOn(app.get(PdfPrinterService), 'print').mockImplementation(async (html: string) => {
      printed = html;
      return Buffer.from('%PDF-1.4\n% e2e stand-in\n');
    });

    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    supervisorId = (await http().get('/auth/me').set(bearer(supervisor)).expect(200)).body.id;
    otherManager = await pinLogin(SAMPLE.code, SAMPLE.managerPin);

    const created = await http()
      .post('/organizations')
      .set(bearer(admin))
      .send({
        name: `${MARK} Client`,
        legalName: `${MARK} Foods Pvt Ltd`,
        gstin: '36AAACE2710B1Z4',
        ownerName: `${MARK} Owner`,
        ownerPhone: PHONES.owner,
        outletName: `${MARK} Outlet`,
        outletAddress: '1 Test Road',
        pincode: '500001',
      })
      .expect(201);
    organizationId = created.body.id;
    outletId = created.body.outlets[0].id;
    owner = await otpLogin(PHONES.owner);

    catalog = (await http().get('/services/catalog').set(bearer(owner)).expect(200)).body;
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    vi.restoreAllMocks();
    await app.close();
  });

  // ───────────────────────── On offer ─────────────────────────

  describe('the catalogue', () => {
    it('offers every new kind with a price, a heading, a description and all twelve languages', () => {
      for (const code of NEW_CODES) {
        const item = itemOf(code);
        expect(item.pricePaise).toBeGreaterThan(0);
        expect(SERVICE_CATEGORIES).toContain(item.category);
        expect(item.partnerDelivered).toBe(PARTNER_CODES.includes(code));
        for (const language of LANGUAGES) {
          expect(item.name[language], `${code} name in ${language}`).toBeTruthy();
          expect(item.description?.[language], `${code} description in ${language}`).toBeTruthy();
        }
      }
      // The four that were there before are still there, each under a heading.
      for (const code of ['PEST', 'DEEP_CLEAN', 'CHIMNEY', 'SAFETY_INSPECTION']) expect(itemOf(code).category).toBeTruthy();
      expect(itemOf('PEST').category).toBe('PEST');
      expect(itemOf('CHEMICAL_REFILL').category).toBe('SUPPLIES');
    });

    it('never says ECCS gives the FSSAI rating', () => {
      const text = itemOf('RATING_READINESS').description!.en!;
      expect(text).toMatch(/agency alone decides and gives the rating, not ECCS/);
    });

    it('gives each new kind 4 to 8 tasks in twelve languages, and the oil test its readings', async () => {
      const office = (await http().get('/catalog').set(bearer(admin)).expect(200)).body as Catalogue;
      for (const code of NEW_CODES) {
        const kind = office.kinds.find((entry) => entry.code === code)!;
        expect(kind.tasks.length).toBeGreaterThanOrEqual(4);
        expect(kind.tasks.length).toBeLessThanOrEqual(8);
      }
      const labels = await prisma.client.checklistItem.findMany({
        where: { template: { serviceTypes: { some: { code: { in: NEW_CODES } } } } },
        select: { label: true },
      });
      for (const { label } of labels) for (const language of LANGUAGES) expect((label as Text)[language]).toBeTruthy();

      const oil = office.kinds.find((entry) => entry.code === 'OIL_TEST')!;
      expect(oil.tasks.filter((task) => task.readingLimit === 25)).toHaveLength(4);
      // Goods, not a service: the chemicals refill carries an HSN code.
      expect(office.kinds.find((entry) => entry.code === 'CHEMICAL_REFILL')).toMatchObject({ sacCode: '3402', gstRatePercent: 18 });
      // Only ECCS's own work carries an ECCS certificate.
      expect(office.kinds.filter((entry) => NEW_CODES.includes(entry.code) && entry.issuesCertificate).map((entry) => entry.code)).toEqual(['GREASE_TRAP']);
    });
  });

  // ───────────────────────── A partner-delivered visit, through to its invoice ─────────────────────────

  describe('a booked water test', () => {
    let visitId: string;
    let bookingId: string;

    it('is booked like any other service and shows that a partner delivers it', async () => {
      ({ visitId, bookingId } = await book(itemOf('WATER_TEST')));
      const visit = await getVisit(owner, visitId);
      expect(visit).toMatchObject({ serviceCode: 'WATER_TEST', partnerDelivered: true, partnerName: null, documents: [], canAttachDocument: false });
    });

    it('takes no document before check-in, and none from the restaurant', async () => {
      await attach(supervisor, visitId, { title: 'Lab report' }).expect(409);
      await attach(owner, visitId, { title: 'Lab report' }).expect(403);
    });

    it('records the partner and files the result document in the outlet documents', async () => {
      await checkIn(visitId);
      const named = await http()
        .patch(`/visits/${visitId}/record`)
        .set(bearer(supervisor))
        .send({ partnerName: `${MARK} Labs` })
        .expect(200);
      expect((named.body as Visit).partnerName).toBe(`${MARK} Labs`);

      await attach(supervisor, visitId, {}).expect(400); // what it is must be said
      await attach(supervisor, visitId, { title: 'Chain of custody form' }, Buffer.from('plain text'), 'notes.pdf').expect(400);
      const withFile = (await attach(supervisor, visitId, { title: `${MARK} chain of custody form` }, PHOTO, 'form.jpg').expect(200)).body as Visit;
      expect(withFile.documents).toHaveLength(1);
      expect(withFile.documents[0]).toMatchObject({ title: `${MARK} chain of custody form`, file: { mimeType: 'image/jpeg' } });

      const vault = (await http().get('/documents').query({ outletId }).set(bearer(owner)).expect(200)).body as { title: string; category: string }[];
      expect(vault.find((document) => document.title === `${MARK} chain of custody form`)).toMatchObject({ category: 'report' });
      // The Owner sees it on the visit too, and can open it.
      const seen = await getVisit(owner, visitId);
      expect(seen.documents).toHaveLength(1);
      await http().get(seen.documents[0]!.file.path).expect(200);
      // Someone from another restaurant cannot reach the visit at all.
      await http().get(`/visits/${visitId}`).set(bearer(otherManager)).expect(404);
    });

    it('lets ECCS add the lab report after the visit is finished, but not the Supervisor', async () => {
      await finishAndSignOff(visitId);
      await attach(supervisor, visitId, { title: 'Late' }).expect(409);
      const later = (
        await attach(admin, visitId, { title: `${MARK} water test lab report`, partnerName: `${MARK} Labs Pvt Ltd` }).expect(200)
      ).body as Visit;
      expect(later.documents.map((document) => document.title)).toEqual([`${MARK} chain of custody form`, `${MARK} water test lab report`]);
      expect(later.documents[1]!.file.mimeType).toBe('application/pdf');
      expect(later.partnerName).toBe(`${MARK} Labs Pvt Ltd`);
    });

    it('lets only ECCS take a wrong document off again', async () => {
      const visit = await getVisit(admin, visitId);
      const wrong = visit.documents[0]!;
      await http().delete(`/visits/${visitId}/documents/${wrong.id}`).set(bearer(supervisor)).expect(403);
      const after = (await http().delete(`/visits/${visitId}/documents/${wrong.id}`).set(bearer(admin)).expect(200)).body as Visit;
      expect(after.documents.map((document) => document.title)).toEqual([`${MARK} water test lab report`]);
      expect(await prisma.client.document.count({ where: { id: wrong.id } })).toBe(0);
    });

    it('is invoiced on approval at the catalogue price, with the testing SAC and 18% GST, and no ECCS certificate', async () => {
      const approved = (await approve(visitId).expect(200)).body as Visit;
      expect(approved.status).toBe('APPROVED');
      expect(approved.certificate).toBeNull();

      const price = itemOf('WATER_TEST').pricePaise;
      const invoice = await invoiceOf(bookingId);
      expect(invoice.lines).toHaveLength(1);
      expect(invoice.lines[0]).toMatchObject({ sacCode: '998346', gstRatePercent: 18, amountPaise: price });
      expect(invoice.subtotalPaise).toBe(price);
      expect(invoice.totalPaise).toBe(price + Math.round(price * 0.18));

      // The partner is named on the report.
      await http().post(`/visits/${visitId}/report-pdf`).set(bearer(admin)).expect(200);
      expect(printed).toContain(`${MARK} Labs Pvt Ltd`);
    });
  });

  // ───────────────────────── The oil reading ─────────────────────────

  describe('a frying oil test', () => {
    let visitId: string;
    let bookingId: string;
    let fryers: Task[];
    let tick: Task;

    it('has a reading to take for each fryer, with the limit of 25', async () => {
      ({ visitId, bookingId } = await book(itemOf('OIL_TEST')));
      const visit = (await checkIn(visitId)).body as Visit;
      fryers = visit.tasks.filter((task) => task.reading);
      tick = visit.tasks.find((task) => !task.reading)!;
      expect(fryers).toHaveLength(4);
      for (const fryer of fryers) expect(fryer.reading).toEqual({ value: null, limit: 25 });
      expect(visit.partnerDelivered).toBe(false);
    });

    it('refuses a reading task without its number, and numbers that cannot be readings', async () => {
      const [first] = fryers;
      await answer(supervisor, visitId, first!.itemId, { done: true }).expect(400);
      await answer(supervisor, visitId, first!.itemId, { done: true, value: -1 }).expect(400);
      await answer(supervisor, visitId, first!.itemId, { done: true, value: 100.5 }).expect(400);
      await answer(supervisor, visitId, first!.itemId, { done: true, value: 24.95 }).expect(400);
      await answer(supervisor, visitId, first!.itemId, { done: true, value: 'high' }).expect(400);
      // A tick task takes no number, and "not done" still needs its reason.
      await answer(supervisor, visitId, tick.itemId, { done: true, value: 12 }).expect(400);
      await answer(supervisor, visitId, first!.itemId, { done: false }).expect(400);
      const untouched = await getVisit(supervisor, visitId);
      expect(untouched.tasks.every((task) => task.done === null)).toBe(true);
    });

    it('stores each reading, and a fryer the kitchen does not have is "not done" with a reason', async () => {
      await answer(supervisor, visitId, fryers[0]!.itemId, { done: true, value: 24.9 }).expect(200);
      await answer(supervisor, visitId, fryers[1]!.itemId, { done: true, value: 25 }).expect(200);
      await answer(supervisor, visitId, fryers[2]!.itemId, { done: true, value: 31 }).expect(200);
      // Corrected before finishing: the last answer stands.
      await answer(supervisor, visitId, fryers[2]!.itemId, { done: true, value: 25.1 }).expect(200);
      const visit = (await answer(supervisor, visitId, fryers[3]!.itemId, { done: false, note: 'Only three fryers' }).expect(200)).body as Visit;

      const read = (index: number) => visit.tasks.find((task) => task.itemId === fryers[index]!.itemId)!;
      expect(read(0)).toMatchObject({ done: true, reading: { value: 24.9, limit: 25 } });
      expect(read(1)).toMatchObject({ done: true, reading: { value: 25, limit: 25 } });
      expect(read(2)).toMatchObject({ done: true, reading: { value: 25.1, limit: 25 } });
      expect(read(3)).toMatchObject({ done: false, note: 'Only three fryers', reading: { value: null, limit: 25 } });

      // The one rule every screen uses: over only above 25; close from 20 up to and including 25.
      const verdicts = [0, 1, 2].map((index) => readingVerdict(read(index).reading!.value, read(index).reading!.limit));
      expect(verdicts).toEqual(['CLOSE', 'CLOSE', 'OVER']);
      expect(readingVerdict(19.9, 25)).toBe('WITHIN');
    });

    it('prints every reading on the report with its verdict in words', async () => {
      await finishAndSignOff(visitId);
      await approve(visitId).expect(200);
      await http().post(`/visits/${visitId}/report-pdf`).set(bearer(owner)).expect(200);

      const words = printed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      expect(words).toContain('24.9% · Close to the limit (limit 25%)');
      expect(words).toContain('25% · Close to the limit (limit 25%)');
      expect(words).toContain('25.1% · Over the limit: change the oil (limit 25%)');
      expect(words).toContain('Not done: Only three fryers');
      // The finished visit keeps its readings for the app and the console.
      const visit = await getVisit(owner, visitId);
      expect(visit.tasks.filter((task) => task.reading?.value != null).map((task) => task.reading!.value)).toEqual([24.9, 25, 25.1]);

      const invoice = await invoiceOf(bookingId);
      expect(invoice.lines[0]).toMatchObject({ sacCode: '998346', gstRatePercent: 18, amountPaise: itemOf('OIL_TEST').pricePaise });
    });
  });

  // ───────────────────────── Hood and duct cleaning ─────────────────────────

  describe('hood and duct cleaning', () => {
    it('is the existing chimney kind, and issues its dated certificate on approval', async () => {
      const item = itemOf('CHIMNEY', 'Hood and duct cleaning, full duct run, with certificate');
      const kind = await prisma.client.serviceType.findUniqueOrThrow({ where: { code: 'CHIMNEY' } });
      expect(kind.issuesCertificate).toBe(true);

      const { visitId, bookingId } = await book(item);
      await checkIn(visitId);
      await finishAndSignOff(visitId);
      const approved = (await approve(visitId).expect(200)).body as Visit;

      expect(approved.certificate).not.toBeNull();
      expect(approved.certificate!.number).toMatch(/^CERT-\d{4}-\d{5}$/);
      expect(approved.certificate!.validFrom).toBe(today());
      expect(approved.certificate!.validUntil).toBe(certificateValidUntil(today(), kind.certificateValidDays!));

      const invoice = await invoiceOf(bookingId);
      expect(invoice.lines[0]).toMatchObject({ sacCode: kind.sacCode, gstRatePercent: 18, amountPaise: item.pricePaise });
    });
  });

  // ───────────────────────── Adding a kind of service ─────────────────────────

  describe('adding a kind of service from the console', () => {
    const name = `${MARK} tank cleaning`;
    const code = 'E2E_NEWSERVICES_TANK_CLEANING';
    const body = { name, category: 'CLEANING', sacCode: '998534', gstRatePercent: 18 };
    const add = (token: string, input: Record<string, unknown>) => http().post('/catalog/kinds').set(bearer(token)).send(input);

    it('is for ECCS admins only', async () => {
      await add(owner, body).expect(403);
      await add(supervisor, body).expect(403);
      await http().post('/catalog/kinds').send(body).expect(401);
    });

    it('checks the name, the heading, the tax code, the rate and the certificate days', async () => {
      await add(admin, { ...body, name: ' ' }).expect(400);
      await add(admin, { ...body, name: '!!!' }).expect(400);
      await add(admin, { ...body, category: 'OTHER' }).expect(400);
      await add(admin, { ...body, category: undefined }).expect(400);
      await add(admin, { ...body, sacCode: '99' }).expect(400);
      await add(admin, { ...body, sacCode: '9985 33' }).expect(400);
      await add(admin, { ...body, sacCode: undefined }).expect(400);
      await add(admin, { ...body, gstRatePercent: -1 }).expect(400);
      await add(admin, { ...body, gstRatePercent: 41 }).expect(400);
      await add(admin, { ...body, gstRatePercent: '' }).expect(400);
      await add(admin, { ...body, issuesCertificate: true }).expect(400);
      await add(admin, { ...body, issuesCertificate: true, certificateValidDays: 0 }).expect(400);
      expect(await prisma.client.serviceType.count({ where: { code } })).toBe(0);
    });

    it('adds the kind with a code made from its name, and refuses the same name twice', async () => {
      // Typed into form boxes, the rate and the days arrive as text.
      const office = (
        await add(admin, { ...body, gstRatePercent: '18', partnerDelivered: false, issuesCertificate: true, certificateValidDays: '180' }).expect(201)
      ).body as Catalogue;
      expect(office.kinds.find((kind) => kind.code === code)).toMatchObject({
        name: { en: name },
        category: 'CLEANING',
        sacCode: '998534',
        gstRatePercent: 18,
        partnerDelivered: false,
        issuesCertificate: true,
        certificateValidDays: 180,
        tasks: [],
      });
      await add(admin, body).expect(409);
      // Nothing is bookable yet, so restaurants see nothing new.
      const offered = (await http().get('/services/catalog').set(bearer(owner)).expect(200)).body as Item[];
      expect(offered.some((item) => item.serviceCode === code)).toBe(false);
    });

    it('can then be given tasks and a bookable service, which restaurants see under its heading', async () => {
      await http().post(`/catalog/kinds/${code}/tasks`).set(bearer(admin)).send({ label: 'Tank emptied and scrubbed' }).expect(201);
      await http()
        .post('/catalog/items')
        .set(bearer(admin))
        .send({ serviceCode: code, name: `${MARK} tank cleaning, one tank`, priceRupees: 1000, durationMinutes: 60 })
        .expect(201);
      const offered = (await http().get('/services/catalog').set(bearer(owner)).expect(200)).body as Item[];
      expect(offered.find((item) => item.serviceCode === code)).toMatchObject({ category: 'CLEANING', partnerDelivered: false, pricePaise: 100_000 });
    });

    it('lets the office correct the tax code, the rate and the heading afterwards', async () => {
      const patch = (input: Record<string, unknown>) => http().patch(`/catalog/kinds/${code}`).set(bearer(admin)).send(input);
      await patch({ sacCode: 'abc' }).expect(400);
      await patch({ gstRatePercent: 99 }).expect(400);
      await http().patch(`/catalog/kinds/${code}`).set(bearer(supervisor)).send({ sacCode: '998533' }).expect(403);
      const office = (await patch({ sacCode: '998533', gstRatePercent: 5, category: 'TESTING', partnerDelivered: true }).expect(200)).body as Catalogue;
      expect(office.kinds.find((kind) => kind.code === code)).toMatchObject({ sacCode: '998533', gstRatePercent: 5, category: 'TESTING', partnerDelivered: true });
    });

    it('is invoiced with the code and rate the office set', async () => {
      const offered = (await http().get('/services/catalog').set(bearer(owner)).expect(200)).body as Item[];
      const { visitId, bookingId } = await book(offered.find((item) => item.serviceCode === code)!);
      await checkIn(visitId);
      await finishAndSignOff(visitId);
      await approve(visitId).expect(200);
      const invoice = await invoiceOf(bookingId);
      expect(invoice.lines[0]).toMatchObject({ sacCode: '998533', gstRatePercent: 5, amountPaise: 100_000 });
      expect(invoice.totalPaise).toBe(105_000);
    });
  });

  // ───────────────────────── Plans ─────────────────────────

  describe('a plan with new kinds of service', () => {
    it('can be made by ECCS and puts visits of those kinds in the diary', async () => {
      const plan = {
        name: `${MARK} plan`,
        description: 'Made by a test',
        priceRupees: 4000,
        billingCycle: 'MONTHLY',
        lines: [
          { serviceCode: 'GREASE_TRAP', intervalDays: 30 },
          { serviceCode: 'OIL_TEST', intervalDays: 15 },
        ],
      };
      await http().post('/subscription-plans').set(bearer(admin)).send(plan).expect(201);
      const row = await prisma.client.plan.findFirstOrThrow({ where: { name: { path: ['en'], equals: plan.name } } });

      await http().post(`/outlets/${outletId}/subscription`).set(bearer(admin)).send({ planCode: row.code }).expect(201);
      const visits = await prisma.client.job.findMany({
        where: { outletId, scheduleId: { not: null } },
        select: { serviceType: { select: { code: true } } },
      });
      const codes = new Set(visits.map((visit) => visit.serviceType.code));
      expect([...codes].sort()).toEqual(['GREASE_TRAP', 'OIL_TEST']);

      // Neither sample plan was given the new kinds.
      const samples = await prisma.client.planLine.count({
        where: { plan: { code: { in: ['ESSENTIAL', 'COMPLETE'] } }, serviceType: { code: { in: NEW_CODES } } },
      });
      expect(samples).toBe(0);
      expect(organizationId).toBeTruthy();
    });
  });
});
