// Licences and the document vault. Runs against the local database with the
// sample seed loaded and local object storage running. Uses the Deccan
// Biryani outlet and removes what it creates.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000001', supervisor: '+919000000003' };
const DEVICE = 'e2e-licences';
const PDF = Buffer.from('%PDF-1.4\n% e2e sample licence document\n%%EOF\n');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e scanned licence')]);

type Licence = {
  id: string;
  type: string;
  name: string | null;
  expiresOn: string;
  daysLeft: number;
  state: string;
  file: { path: string; mimeType: string } | null;
  [key: string]: unknown;
};
type Doc = { id: string; category: string; title: string; file: { path: string; mimeType: string }; uploadedByEccs: boolean; [key: string]: unknown };

/** A date this many days from today in India, as YYYY-MM-DD. */
const inDays = (days: number) => indiaDate(new Date(Date.now() + days * 86_400_000));

describe('Licences and document vault (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let otherOutletId: string;
  let owner: string;
  let chef: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanUp() {
    const db = prisma.client;
    await db.licence.deleteMany({ where: { outletId, name: { startsWith: 'E2E', mode: 'insensitive' } } });
    await db.document.deleteMany({ where: { outletId } });
    await db.attachment.deleteMany({ where: { outletId, kind: 'DOCUMENT' } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
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

  const upload = (token: string, file: Buffer, filename: string, kind = 'DOCUMENT', forOutlet = outletId) =>
    http()
      .post('/attachments')
      .set(bearer(token))
      .field('outletId', forOutlet)
      .field('kind', kind)
      .attach('file', file, { filename, contentType: 'application/octet-stream' });

  const uploadId = async (token: string, file = PDF, filename = 'licence.pdf') =>
    (await upload(token, file, filename).expect(201)).body.id as string;

  const licences = async (token: string, query: Record<string, string> = {}): Promise<Licence[]> =>
    (await http().get('/licences').query({ outletId, ...query }).set(bearer(token)).expect(200)).body;

  const documents = async (token: string): Promise<Doc[]> =>
    (await http().get('/documents').query({ outletId }).set(bearer(token)).expect(200)).body;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const outlets = await prisma.client.outlet.findMany({ where: { code: { in: Object.values(CODES) } } });
    outletId = outlets.find((o) => o.code === CODES.kukatpally)!.id;
    otherOutletId = outlets.find((o) => o.code === CODES.jubilee)!.id;
    await cleanUp();

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    chef = await pinLogin(CODES.kukatpally, PINS.chef);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('licences', () => {
    it('shows the seeded licences soonest expiry first, with how close each is to expiring', async () => {
      const list = await licences(owner);
      expect(list.map((l) => l.type)).toEqual(['FSSAI', 'FIRE_NOC', 'TRADE_LICENCE']);
      // The sample FSSAI licence expires within the 60-day warning period; the others are further out.
      expect(list[0]).toMatchObject({ state: 'EXPIRING', outletName: 'Deccan Biryani House, Kukatpally', file: null });
      expect(list[0]!.daysLeft).toBeGreaterThan(0);
      expect(list[0]!.daysLeft).toBeLessThanOrEqual(60);
      expect(list.slice(1).every((l) => l.state === 'VALID')).toBe(true);
    });

    it('is closed to the head chef and to other restaurants', async () => {
      await http().get('/licences').query({ outletId }).set(bearer(chef)).expect(403);
      await http().get('/documents').query({ outletId }).set(bearer(chef)).expect(403);
      expect(await licences(otherManager)).toEqual([]);
      await http().get('/documents').query({ outletId }).set(bearer(otherManager)).expect(403);
    });

    it('lets the owner add a licence with a PDF, and serves the PDF back', async () => {
      const attachmentId = await uploadId(owner);
      const created = await http()
        .post('/licences')
        .set(bearer(owner))
        .send({ outletId, type: 'OTHER', name: 'E2E Music licence', number: 'PPL-123', expiresOn: inDays(200), attachmentId })
        .expect(201);
      const licence = created.body as Licence;
      expect(licence).toMatchObject({ type: 'OTHER', name: 'E2E Music licence', state: 'VALID', daysLeft: 200 });
      expect(licence.file).toMatchObject({ mimeType: 'application/pdf' });

      const file = await http().get(licence.file!.path).buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);

      // The file also appears in the vault, filed as a licence.
      expect(await documents(owner)).toEqual([expect.objectContaining({ category: 'licence', title: 'E2E Music licence', uploadedByEccs: false })]);
    });

    it('checks what is entered', async () => {
      const valid = { outletId, type: 'FIRE_NOC', expiresOn: inDays(30) };
      const post = (body: Record<string, unknown>) => http().post('/licences').set(bearer(owner)).send(body);
      await post({ ...valid, expiresOn: '31/12/2027' }).expect(400);
      await post({ ...valid, expiresOn: '2027-02-31' }).expect(400); // not a real date
      await post({ ...valid, type: 'OTHER' }).expect(400); // an "other" licence needs a name
      await post({ ...valid, type: 'DRIVING' }).expect(400);
      await post({ ...valid, outletId: otherOutletId }).expect(403);
      await post({ ...valid, attachmentId: 'made-up' }).expect(400);
      await http().post('/licences').set(bearer(chef)).send(valid).expect(403);
    });

    it('marks licences as expiring or expired, and can list only those needing attention', async () => {
      const add = async (name: string, expiresOn: string) =>
        (await http().post('/licences').set(bearer(owner)).send({ outletId, type: 'OTHER', name, expiresOn }).expect(201)).body as Licence;

      expect(await add('E2E Expired yesterday', inDays(-1))).toMatchObject({ state: 'EXPIRED', daysLeft: -1 });
      expect(await add('E2E Expires today', inDays(0))).toMatchObject({ state: 'EXPIRING', daysLeft: 0 });
      expect(await add('E2E Just inside', inDays(60))).toMatchObject({ state: 'EXPIRING', daysLeft: 60 });
      expect(await add('E2E Just outside', inDays(61))).toMatchObject({ state: 'VALID', daysLeft: 61 });

      const attention = await licences(owner, { attention: '1' });
      expect(attention.every((l) => l.state !== 'VALID')).toBe(true);
      expect(attention.map((l) => l.name)).toEqual(
        expect.arrayContaining(['E2E Expired yesterday', 'E2E Expires today', 'E2E Just inside', 'FSSAI licence']),
      );
      expect(attention.map((l) => l.name)).not.toContain('E2E Just outside');
      // Most urgent first.
      expect(attention[0]!.name).toBe('E2E Expired yesterday');
    });

    it('renews a licence: new expiry date, and the new copy replaces the old one', async () => {
      const expired = (await licences(owner)).find((l) => l.name === 'E2E Expired yesterday')!;
      // Give it a first copy, then renew with a second.
      const firstCopy = await uploadId(owner);
      const before = await http().patch(`/licences/${expired.id}`).set(bearer(owner)).send({ attachmentId: firstCopy }).expect(200);
      const oldPath = (before.body as Licence).file!.path;
      await http().get(oldPath).expect(200);
      const copiesBefore = (await documents(owner)).filter((d) => d.title === 'E2E Expired yesterday').length;
      expect(copiesBefore).toBe(1);

      const attachmentId = await uploadId(owner, JPEG, 'renewed.jpg');
      const renewed = await http()
        .patch(`/licences/${expired.id}`)
        .set(bearer(owner))
        .send({ expiresOn: inDays(365), attachmentId })
        .expect(200);
      expect(renewed.body).toMatchObject({ state: 'VALID', daysLeft: 365, file: { mimeType: 'image/jpeg' } });

      // Still one copy in the vault, and it is the new one; the old file is gone.
      const copies = (await documents(owner)).filter((d) => d.title === 'E2E Expired yesterday');
      expect(copies).toEqual([expect.objectContaining({ file: expect.objectContaining({ mimeType: 'image/jpeg' }) })]);
      await http().get(oldPath).expect(404);

      await http().patch(`/licences/${expired.id}`).set(bearer(otherManager)).send({ expiresOn: inDays(1) }).expect(404);
      await http().patch(`/licences/${expired.id}`).set(bearer(chef)).send({ expiresOn: inDays(1) }).expect(403);
    });

    it('replaces the existing licence when the same kind is added again', async () => {
      const fire = (await licences(owner)).find((l) => l.type === 'FIRE_NOC')!;
      const original = { number: fire.number as string | null, expiresOn: fire.expiresOn };
      const countBefore = (await licences(owner)).length;

      const attachmentId = await uploadId(owner);
      const added = await http()
        .post('/licences')
        .set(bearer(owner))
        .send({ outletId, type: 'FIRE_NOC', number: 'E2E-FIRE-NEW', expiresOn: inDays(400), attachmentId })
        .expect(201);
      // Same entry, updated: not a second fire NOC.
      expect(added.body).toMatchObject({ id: fire.id, number: 'E2E-FIRE-NEW', daysLeft: 400, file: { mimeType: 'application/pdf' } });
      expect((await licences(owner)).length).toBe(countBefore);
      expect((await licences(owner)).filter((l) => l.type === 'FIRE_NOC')).toHaveLength(1);

      // Adding it yet again with a newer copy leaves exactly one copy in the vault.
      const newer = await uploadId(owner, JPEG, 'fire-newer.jpg');
      await http().post('/licences').set(bearer(owner)).send({ outletId, type: 'FIRE_NOC', expiresOn: inDays(500), attachmentId: newer }).expect(201);
      expect((await documents(owner)).filter((d) => d.title === 'Fire NOC')).toEqual([
        expect.objectContaining({ file: expect.objectContaining({ mimeType: 'image/jpeg' }) }),
      ]);

      // "Other" licences are matched by name, ignoring case; a different name is a different licence.
      const sameName = await http().post('/licences').set(bearer(owner)).send({ outletId, type: 'OTHER', name: 'e2e music LICENCE', expiresOn: inDays(10) }).expect(201);
      expect((await licences(owner)).filter((l) => l.name?.toLowerCase() === 'e2e music licence')).toHaveLength(1);
      expect(sameName.body.daysLeft).toBe(10);
      await http().post('/licences').set(bearer(owner)).send({ outletId, type: 'OTHER', name: 'E2E Liquor licence', expiresOn: inDays(10) }).expect(201);
      expect((await licences(owner)).length).toBe(countBefore + 1);

      // Put the sample fire NOC back as it was.
      await prisma.client.licence.update({
        where: { id: fire.id },
        data: { number: original.number, expiresOn: new Date(`${original.expiresOn}T00:00:00.000Z`), documentId: null },
      });
    });

    it('removes a licence but keeps its document', async () => {
      // The replacement test above re-added this one with different capitals, which renamed it.
      const isMusic = (l: Licence) => l.name?.toLowerCase() === 'e2e music licence';
      const music = (await licences(owner)).find(isMusic)!;
      await http().delete(`/licences/${music.id}`).set(bearer(otherManager)).expect(404);
      await http().delete(`/licences/${music.id}`).set(bearer(owner)).expect(204);
      expect((await licences(owner)).some(isMusic)).toBe(false);
      expect((await documents(owner)).map((d) => d.title)).toContain('E2E Music licence');
    });
  });

  describe('uploads', () => {
    it('accepts PDFs and images as documents, and nothing else', async () => {
      await upload(owner, PDF, 'a.pdf').expect(201);
      await upload(owner, JPEG, 'a.jpg').expect(201);
      await upload(owner, Buffer.from('MZ this is a program'), 'a.pdf').expect(400);
      await upload(owner, Buffer.from('<html>hello</html>'), 'a.pdf').expect(400);
    });

    it('does not accept a PDF as a checklist or issue photo', async () => {
      await upload(owner, PDF, 'a.pdf', 'PROOF').expect(400);
    });

    it('only lets people who manage documents upload them', async () => {
      await upload(chef, PDF, 'a.pdf').expect(403);
      await upload(otherManager, PDF, 'a.pdf').expect(403);
      await upload(supervisor, PDF, 'a.pdf').expect(403);
    });
  });

  describe('document vault', () => {
    it('lets the owner file a document, and rejects a file that is not theirs to file', async () => {
      const attachmentId = await uploadId(owner);
      const list = (
        await http()
          .post('/documents')
          .set(bearer(owner))
          .send({ outletId, category: 'certificate', title: 'E2E Water test report', attachmentId })
          .expect(201)
      ).body as Doc[];
      expect(list[0]).toMatchObject({ category: 'certificate', title: 'E2E Water test report', uploadedByEccs: false });

      // The same upload cannot be filed twice, and a photo taken for a checklist cannot be filed as a document.
      await http().post('/documents').set(bearer(owner)).send({ outletId, category: 'other', title: 'E2E Again', attachmentId }).expect(400);
      const photo = (await upload(owner, JPEG, 'p.jpg', 'PROOF').expect(201)).body.id as string;
      await http().post('/documents').set(bearer(owner)).send({ outletId, category: 'other', title: 'E2E Photo', attachmentId: photo }).expect(400);
      await http().post('/documents').set(bearer(owner)).send({ outletId, category: 'licence', title: 'E2E Direct', attachmentId }).expect(400);
      await prisma.client.attachment.delete({ where: { id: photo } });
    });

    it('lets ECCS staff add a licence and a document for a restaurant', async () => {
      const licenceFile = await uploadId(admin);
      const licence = await http()
        .post('/licences')
        .set(bearer(admin))
        .send({ outletId, type: 'PEST_CONTROL', name: 'E2E Pest control contract', expiresOn: inDays(90), attachmentId: licenceFile })
        .expect(201);
      expect(licence.body).toMatchObject({ type: 'PEST_CONTROL', state: 'VALID' });

      const reportFile = await uploadId(admin, JPEG, 'report.jpg');
      await http()
        .post('/documents')
        .set(bearer(admin))
        .send({ outletId, category: 'report', title: 'E2E Deep clean report', attachmentId: reportFile })
        .expect(201);

      // The restaurant sees both, marked as uploaded by ECCS.
      const seen = await documents(owner);
      expect(seen.filter((d) => d.uploadedByEccs).map((d) => d.title)).toEqual(
        expect.arrayContaining(['E2E Pest control contract', 'E2E Deep clean report']),
      );
      expect((await licences(owner)).map((l) => l.name)).toContain('E2E Pest control contract');
    });

    it('shows ECCS which licences need attention across all clients', async () => {
      const all = (await http().get('/licences').query({ attention: '1' }).set(bearer(admin)).expect(200)).body as Licence[];
      const organisations = new Set(all.map((l) => l.organizationName));
      // Every sample outlet has an FSSAI licence inside the warning period.
      expect(organisations).toEqual(new Set(['Deccan Biryani House', 'Spice Route Kitchens']));
      expect(all.every((l) => l.state !== 'VALID')).toBe(true);
    });

    it('lets a supervisor look but not change', async () => {
      expect((await licences(supervisor)).length).toBeGreaterThan(0);
      await http().post('/licences').set(bearer(supervisor)).send({ outletId, type: 'FIRE_NOC', expiresOn: inDays(10) }).expect(403);
    });

    it('removes a document, leaving any licence that used it without a file', async () => {
      const pest = (await licences(owner)).find((l) => l.name === 'E2E Pest control contract')!;
      expect(pest.file).not.toBeNull();
      const doc = (await documents(owner)).find((d) => d.title === 'E2E Pest control contract')!;

      await http().delete(`/documents/${doc.id}`).set(bearer(chef)).expect(403);
      await http().delete(`/documents/${doc.id}`).set(bearer(otherManager)).expect(404);
      const remaining = (await http().delete(`/documents/${doc.id}`).set(bearer(owner)).expect(200)).body as Doc[];
      expect(remaining.map((d) => d.id)).not.toContain(doc.id);

      expect((await licences(owner)).find((l) => l.id === pest.id)!.file).toBeNull();
    });
  });
});
