// Service certificates: issued when ECCS approves the report of a visit whose
// kind of service carries one, who may read them, how long they are valid, and
// the PDF filed in the outlet's documents. Runs against the local database with
// the sample seed loaded and local object storage running. Uses the Deccan
// Biryani outlet and removes what it creates.

import { writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { certificateValidUntil } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { vi } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { CertificatePdfService } from './../src/certificates/certificate-pdf.service.js';
import { CertificatesService } from './../src/certificates/certificates.service.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PdfPrinterService } from './../src/pdf/pdf-printer.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { ReportPdfService } from './../src/services/report-pdf.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-certificates';
const MARK = 'e2e certificates';
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e certificate photo bytes')]);

type VisitCertificate = { id: string; number: string; validFrom: string; validUntil: string; state: string; daysLeft: number };
type Visit = { id: string; status: string; reportNumber: string | null; tasks: { itemId: string }[]; certificate: VisitCertificate | null };
type Certificate = VisitCertificate & {
  outletId: string;
  outletName: string;
  organizationName: string;
  serviceCode: string;
  serviceName: Record<string, string>;
  visitId: string | null;
  reportNumber: string | null;
  issuedAt: string;
  pdfReady: boolean;
};
type Kind = { code: string; issuesCertificate: boolean; certificateValidDays: number | null; certificateCount: number };

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000);

describe('Certificates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let certificates: CertificatesService;
  let pdfLater: ReturnType<typeof vi.spyOn>;
  let outletId: string;
  let chef: string;
  let owner: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  /** A kind of service that carries a certificate, how long for, and one that does not. */
  let issuing: { code: string; days: number };
  let plainCode: string;
  /** The Supervisor's pest-control visit and its certificate. */
  let visitId: string;
  let certificate: VisitCertificate;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = () => indiaDate();

  async function cleanUp() {
    const db = prisma.client;
    const jobs = { notes: MARK };
    await db.document.deleteMany({ where: { attachment: { job: jobs } } });
    await db.attachment.deleteMany({ where: { job: jobs } });
    await db.certificate.deleteMany({ where: { job: jobs } });
    await db.serviceReport.deleteMany({ where: { job: jobs } });
    await db.signOff.deleteMany({ where: { job: jobs } });
    await db.jobTaskResponse.deleteMany({ where: { job: jobs } });
    await db.job.deleteMany({ where: jobs });
    await db.notification.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  }
  // Notifications written while this suite ran are removed with the rest.
  let startedAt = new Date();

  async function pinLogin(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return session.body.token as string;
  }

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const session = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE })
      .expect(200);
    return session.body.token as string;
  }

  const getVisit = async (token: string, id: string): Promise<Visit> =>
    (await http().get(`/visits/${id}`).set(bearer(token)).expect(200)).body;
  const approve = (token: string, id: string) => http().post(`/visits/${id}/approve-report`).set(bearer(token));
  const list = async (token: string, query: Record<string, string> = {}): Promise<Certificate[]> =>
    (await http().get('/certificates').query(query).set(bearer(token)).expect(200)).body;
  const pdf = (token: string, id: string) => http().post(`/certificates/${id}/pdf`).set(bearer(token));
  const remake = (token: string, id: string) => http().post(`/certificates/${id}/pdf/remake`).set(bearer(token));
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

  /**
   * A visit of the given kind taken to the point where ECCS can approve its report:
   * put in the diary for today, done by `recorder`, and signed off by the Owner.
   */
  async function visitReadyForApproval(serviceCode: string, recorder: string, assignTo: string | null): Promise<string> {
    const created = await http()
      .post('/visits')
      .set(bearer(admin))
      .send({ outletId, serviceCode, date: today(), slot: '1000', supervisorId: assignTo })
      .expect(201);
    const id = (created.body as Visit).id;
    await prisma.client.job.update({ where: { id }, data: { notes: MARK } });

    const started = (await http().post(`/visits/${id}/check-in`).set(bearer(recorder)).send({}).expect(200)).body as Visit;
    for (const task of started.tasks) {
      await http().put(`/visits/${id}/tasks/${task.itemId}`).set(bearer(recorder)).send({ done: true }).expect(200);
    }
    await http()
      .post(`/visits/${id}/photos`)
      .set(bearer(recorder))
      .field('kind', 'AFTER')
      .attach('file', PHOTO, { filename: 'visit.jpg', contentType: 'image/jpeg' })
      .expect(200);
    await http().post(`/visits/${id}/complete`).set(bearer(recorder)).expect(200);
    await http().post(`/visits/${id}/sign-off`).set(bearer(owner)).send({ rating: 5 }).expect(200);
    return id;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    certificates = app.get(CertificatesService);

    // Each PDF needs a browser started, which is slow. The PDFs normally made in the background
    // on approval are held back here, so only the ones a test asks for by name are made.
    vi.spyOn(app.get(ReportPdfService), 'ensureLater').mockImplementation(() => undefined);
    pdfLater = vi.spyOn(app.get(CertificatePdfService), 'ensureLater').mockImplementation(() => undefined);

    outletId = (await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } })).id;
    startedAt = new Date(Date.now() + 365 * 86_400_000); // nothing of anyone's is removed by the first clean-up
    await cleanUp();
    startedAt = new Date();

    const pest = await prisma.client.serviceType.findUniqueOrThrow({ where: { code: 'PEST' } });
    expect(pest.issuesCertificate).toBe(true);
    issuing = { code: pest.code, days: pest.certificateValidDays! };
    plainCode = (await prisma.client.serviceType.findFirstOrThrow({ where: { issuesCertificate: false, isActive: true } })).code;

    chef = await pinLogin(CODES.kukatpally, PINS.chef);
    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
    supervisorId = (await http().get('/auth/me').set(bearer(supervisor)).expect(200)).body.id;
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    vi.restoreAllMocks();
    await app.close();
  });

  describe('issuing', () => {
    it('does not exist before ECCS approves the report', async () => {
      visitId = await visitReadyForApproval(issuing.code, supervisor, supervisorId);
      for (const token of [owner, admin, supervisor]) expect((await getVisit(token, visitId)).certificate).toBeNull();
      expect((await list(owner, { outletId })).filter((entry) => entry.visitId === visitId)).toHaveLength(0);
    });

    it('is issued when ECCS approves, numbered and valid from the day of the visit', async () => {
      const approved = (await approve(admin, visitId).expect(200)).body as Visit;
      expect(approved.status).toBe('APPROVED');
      expect(approved.certificate).not.toBeNull();
      certificate = approved.certificate!;

      expect(certificate.number).toMatch(new RegExp(`^CERT-${today().slice(0, 4)}-\\d{5}$`));
      expect(certificate.validFrom).toBe(today());
      expect(certificate.validUntil).toBe(certificateValidUntil(today(), issuing.days));
      expect(certificate).toMatchObject({ state: 'VALID', daysLeft: issuing.days });
      // Its PDF is started straight away, in the background.
      expect(pdfLater).toHaveBeenCalledWith(certificate.id);

      // The visit carries it for everyone who may read the visit.
      for (const token of [owner, admin, supervisor]) {
        expect((await getVisit(token, visitId)).certificate).toMatchObject({ id: certificate.id, number: certificate.number });
      }
    });

    it('is not issued twice for one visit', async () => {
      await approve(admin, visitId).expect(409);
      // Asked for again, even twice at the same moment, the answer is the one already issued.
      const again = await Promise.all([certificates.issueForVisit(visitId), certificates.issueForVisit(visitId)]);
      expect(again).toEqual([certificate.id, certificate.id]);
      expect(await prisma.client.certificate.count({ where: { jobId: visitId } })).toBe(1);
    });

    it('is not issued for a kind of service that carries none', async () => {
      const plain = await visitReadyForApproval(plainCode, admin, null);
      const approved = (await approve(admin, plain).expect(200)).body as Visit;
      expect(approved).toMatchObject({ status: 'APPROVED', certificate: null });
      expect(await certificates.issueForVisit(plain)).toBeNull();
      expect(await prisma.client.certificate.count({ where: { jobId: plain } })).toBe(0);
    });

    it('never fails the approval, and can be issued afterwards', async () => {
      const unlucky = await visitReadyForApproval(issuing.code, admin, null);
      const broken = vi.spyOn(certificates, 'issueForVisit').mockRejectedValueOnce(new Error('the database blinked'));
      const approved = (await approve(admin, unlucky).expect(200)).body as Visit;
      broken.mockRestore();
      expect(approved).toMatchObject({ status: 'APPROVED', certificate: null });

      // Issued later, it takes the next number after the first one.
      const id = await certificates.issueForVisit(unlucky);
      const issued = (await getVisit(admin, unlucky)).certificate!;
      expect(issued.id).toBe(id);
      expect(Number(issued.number.slice(-5))).toBe(Number(certificate.number.slice(-5)) + 1);
    });

    it('is not issued for a visit whose report is not approved', async () => {
      const waiting = await visitReadyForApproval(issuing.code, admin, null);
      expect(await certificates.issueForVisit(waiting)).toBeNull();
      expect(await certificates.issueForVisit('no-such-visit')).toBeNull();
    });
  });

  describe('who may read', () => {
    it('lists them for the restaurant’s Owner, by outlet, with what each is for', async () => {
      const mine = await list(owner, { outletId });
      const found = mine.find((entry) => entry.id === certificate.id)!;
      expect(found).toMatchObject({
        number: certificate.number,
        outletId,
        serviceCode: issuing.code,
        visitId,
        validFrom: certificate.validFrom,
        validUntil: certificate.validUntil,
        state: 'VALID',
        pdfReady: false,
      });
      expect(found.serviceName.en).toEqual(expect.any(String));
      expect(found.reportNumber).toMatch(/^SR-\d{4}-\d{5}$/);
      expect(found.outletName).toEqual(expect.any(String));
      // Newest first.
      expect(mine.map((entry) => entry.validFrom)).toEqual(mine.map((entry) => entry.validFrom).sort().reverse());

      expect((await http().get(`/certificates/${certificate.id}`).set(bearer(owner)).expect(200)).body).toMatchObject({
        id: certificate.id,
        number: certificate.number,
      });
    });

    it('shows ECCS admins every certificate', async () => {
      const all = await list(admin);
      expect(all.filter((entry) => entry.outletId === outletId && entry.validFrom === today()).length).toBeGreaterThanOrEqual(2);
      await http().get(`/certificates/${certificate.id}`).set(bearer(admin)).expect(200);
    });

    it('shows a Supervisor only the certificates of visits given to them', async () => {
      const theirs = await list(supervisor);
      expect(theirs.map((entry) => entry.id)).toContain(certificate.id);
      expect(theirs.every((entry) => entry.visitId !== null)).toBe(true);
      // The visit an admin recorded was never the Supervisor's.
      const notTheirs = (await list(admin)).find((entry) => entry.outletId === outletId && entry.id !== certificate.id && entry.validFrom === today())!;
      expect(theirs.map((entry) => entry.id)).not.toContain(notTheirs.id);
      await http().get(`/certificates/${notTheirs.id}`).set(bearer(supervisor)).expect(404);
      await pdf(supervisor, notTheirs.id).expect(404);
    });

    it('keeps them from another restaurant, the Head Chef and anyone not logged in', async () => {
      expect((await list(otherManager)).map((entry) => entry.id)).not.toContain(certificate.id);
      expect(await list(otherManager, { outletId })).toEqual([]);
      await http().get(`/certificates/${certificate.id}`).set(bearer(otherManager)).expect(404);
      await pdf(otherManager, certificate.id).expect(404);

      await http().get('/certificates').set(bearer(chef)).expect(403);
      await http().get(`/certificates/${certificate.id}`).set(bearer(chef)).expect(403);
      await pdf(chef, certificate.id).expect(403);

      await http().get('/certificates').expect(401);
      await http().get(`/certificates/${certificate.id}`).expect(401);
      await http().get('/certificates/no-such-certificate').set(bearer(admin)).expect(404);
    });
  });

  describe('validity', () => {
    const stateWith = async (validFrom: Date, validUntil: Date) => {
      await prisma.client.certificate.update({ where: { id: certificate.id }, data: { validFrom, validUntil } });
      const found = (await http().get(`/certificates/${certificate.id}`).set(bearer(owner)).expect(200)).body as Certificate;
      return { state: found.state, daysLeft: found.daysLeft };
    };

    it('goes from valid to expiring soon to expired as its last day comes and goes', async () => {
      // A 30-day certificate warns over its last 6 days.
      expect(await stateWith(addDays(today(), -10), addDays(today(), 20))).toEqual({ state: 'VALID', daysLeft: 20 });
      expect(await stateWith(addDays(today(), -24), addDays(today(), 6))).toEqual({ state: 'EXPIRING', daysLeft: 6 });
      // Still valid on its last day.
      expect(await stateWith(addDays(today(), -30), addDays(today(), 0))).toEqual({ state: 'EXPIRING', daysLeft: 0 });
      expect(await stateWith(addDays(today(), -31), addDays(today(), -1))).toEqual({ state: 'EXPIRED', daysLeft: -1 });
      // The visit shows the same.
      expect((await getVisit(owner, visitId)).certificate).toMatchObject({ state: 'EXPIRED', daysLeft: -1 });

      await prisma.client.certificate.update({
        where: { id: certificate.id },
        data: { validFrom: addDays(certificate.validFrom, 0), validUntil: addDays(certificate.validUntil, 0) },
      });
    });

    it('is set per kind of service in the Catalogue, by ECCS admins only', async () => {
      const kinds = ((await http().get('/catalog').set(bearer(admin)).expect(200)).body as { kinds: Kind[] }).kinds;
      const pest = kinds.find((kind) => kind.code === issuing.code)!;
      expect(pest).toMatchObject({ issuesCertificate: true, certificateValidDays: issuing.days });
      expect(pest.certificateCount).toBeGreaterThanOrEqual(2);
      const plain = kinds.find((kind) => kind.code === plainCode)!;
      expect(plain.issuesCertificate).toBe(false);

      const change = (token: string, code: string, body: Record<string, unknown>) =>
        http().patch(`/catalog/kinds/${code}`).set(bearer(token)).send(body);
      await change(owner, issuing.code, { certificateValidDays: 20 }).expect(403);
      await change(supervisor, issuing.code, { certificateValidDays: 20 }).expect(403);
      await change(admin, issuing.code, { certificateValidDays: 0 }).expect(400);
      await change(admin, issuing.code, { certificateValidDays: 1.5 }).expect(400);
      await change(admin, issuing.code, { certificateValidDays: 99999 }).expect(400);
      // A certificate must say how long it lasts.
      if (plain.certificateValidDays === null) await change(admin, plainCode, { issuesCertificate: true }).expect(400);

      // Saving what is already there changes nothing.
      const same = await change(admin, issuing.code, { issuesCertificate: true, certificateValidDays: String(issuing.days) }).expect(200);
      expect((same.body as { kinds: Kind[] }).kinds.find((kind) => kind.code === issuing.code)).toMatchObject({
        issuesCertificate: true,
        certificateValidDays: issuing.days,
      });
    });
  });

  describe('the certificate as a PDF', () => {
    const filed = async () =>
      ((await http().get('/documents').query({ outletId }).set(bearer(owner)).expect(200)).body as { title: string; category: string }[]).filter(
        (document) => document.title.startsWith(`Certificate ${certificate.number}:`),
      );

    it('can be made later when making it fails, the certificate staying on record', async () => {
      const printer = vi.spyOn(app.get(PdfPrinterService), 'print').mockRejectedValueOnce(new Error('no browser'));
      await pdf(owner, certificate.id).expect(500);
      printer.mockRestore();
      expect(await filed()).toHaveLength(0);
      expect((await list(owner, { outletId })).find((entry) => entry.id === certificate.id)).toMatchObject({ pdfReady: false });
    });

    it('is made when first opened and filed in the outlet’s documents under Certificate', async () => {
      const link = (await pdf(owner, certificate.id).expect(200)).body as { path: string };
      const file = await download(link.path);
      expect(file.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(file.length).toBeGreaterThan(5000);
      // A copy to look at, when asked for: CERTIFICATE_PDF_SAMPLE=<where to put it>.
      if (process.env.CERTIFICATE_PDF_SAMPLE) writeFileSync(process.env.CERTIFICATE_PDF_SAMPLE, file);

      // Asking again gives the same file, not a second copy.
      const again = (await pdf(admin, certificate.id).expect(200)).body as { path: string };
      expect(again.path.split('?')[0]).toBe(link.path.split('?')[0]);
      await pdf(supervisor, certificate.id).expect(200);

      const documents = await filed();
      expect(documents).toHaveLength(1);
      expect(documents[0]).toMatchObject({ category: 'certificate' });
      expect((await list(owner, { outletId })).find((entry) => entry.id === certificate.id)).toMatchObject({ pdfReady: true });
    }, 60_000);

    it('can be made again by ECCS admins only, in place of the old one', async () => {
      await remake(owner, certificate.id).expect(403);
      await remake(supervisor, certificate.id).expect(403);
      await remake(chef, certificate.id).expect(403);
      await remake(admin, 'no-such-certificate').expect(404);

      const before = (await pdf(owner, certificate.id).expect(200)).body as { path: string };
      const made = (await remake(admin, certificate.id).expect(200)).body as { path: string };
      expect(made.path.split('?')[0]).toBe(before.path.split('?')[0]);
      expect((await download(made.path)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      // Still one document in the vault, and the same number and dates.
      expect(await filed()).toHaveLength(1);
      expect((await http().get(`/certificates/${certificate.id}`).set(bearer(owner)).expect(200)).body).toMatchObject({
        number: certificate.number,
        validFrom: certificate.validFrom,
        validUntil: certificate.validUntil,
      });
    }, 60_000);
  });
});
