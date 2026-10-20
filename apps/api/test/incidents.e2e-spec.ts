// Quality > Incidents (Stage I, step 3; 20 Oct 2026): adding one with its photos and a file
// through the usual upload, changing it, closing it with how it ended and reopening it, its PDF
// for an insurer or a lawyer, and Today's "Incident open". Only the Super Admin and the Ops
// Manager: a Supervisor and a BDE are refused. Everything happens at a throwaway restaurant and
// is removed by the ids recorded here (and written to E2E_STATE_FILE, when set, as it goes).
// INCIDENT_PDF_SAMPLE=<path> keeps a copy of the PDF.

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { addDays, type IncidentDto, type IncidentsDto, type TodayDto } from '@eccs/shared';
import { encode } from 'jpeg-js';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { sha256 } from './../src/auth/auth.crypto.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { StorageService } from './../src/storage/storage.service.js';

const MARK = 'INE2E';
const DEVICE = 'e2e-incidents';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003', bde: '+919000000004' };
const OWNER_PHONE = '+919199900521';

function jpeg(seed: number): Buffer {
  const width = 200;
  const height = 150;
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = (index * seed) % 256;
    data[index * 4 + 1] = (index * 3 + seed * 50) % 256;
    data[index * 4 + 2] = 120;
    data[index * 4 + 3] = 255;
  }
  return encode({ data, width, height }, 70).data;
}

/** A tiny real PDF (a clinic note). */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

describe('Incidents (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = { admin: '', ops: '', supervisor: '', bde: '', owner: '' };
  let outletId = '';
  let organizationId = '';
  let otherOutletId = '';
  let visitId = '';
  let incident: IncidentDto;

  const made = {
    incidents: [] as string[],
    attachments: [] as string[],
    visits: [] as string[],
    userIds: [] as string[],
    sessionIds: [] as string[],
    challengeIds: [] as string[],
  };
  const remember = <K extends keyof typeof made>(kind: K, ...ids: string[]) => {
    for (const id of ids) if (id && !made[kind].includes(id)) made[kind].push(id);
    if (process.env.E2E_STATE_FILE) writeFileSync(process.env.E2E_STATE_FILE, JSON.stringify({ spec: 'incidents', outletId, organizationId, made }, null, 2));
  };

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const db = () => prisma.client;

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const challenge = await db().otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (challenge) remember('challengeIds', challenge.id);
    const body = (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body;
    const session = await db().session.findUnique({ where: { tokenHash: sha256(body.token as string) }, select: { id: true } });
    if (session) remember('sessionIds', session.id);
    return body.token as string;
  }

  async function upload(target: string, file: Buffer, kind: 'PROOF' | 'DOCUMENT', name: string, type: string): Promise<string> {
    const response = await http().post('/attachments').set(bearer(tokens.ops)).field('outletId', target).field('kind', kind).attach('file', file, { filename: name, contentType: type }).expect(201);
    remember('attachments', response.body.id as string);
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

    const created = await http()
      .post('/organizations')
      .set(bearer(tokens.admin))
      .send({ name: `${MARK} Kitchens`, ownerName: `${MARK} Owner`, ownerPhone: OWNER_PHONE, outletName: `${MARK} Kitchens, Gachibowli`, outletAddress: 'Old Mumbai Highway' })
      .expect(201);
    organizationId = created.body.id as string;
    remember('userIds', created.body.owners[0].id as string);
    outletId = created.body.outlets[0].id as string;
    const second = await http().post(`/organizations/${organizationId}/outlets`).set(bearer(tokens.admin)).send({ outletName: `${MARK} Kitchens, outlet 2`, outletAddress: 'Kondapur' }).expect(201);
    otherOutletId = second.body.id as string;

    const visit = await http().post('/visits').set(bearer(tokens.ops)).send({ outletId, serviceCode: 'DEEP_CLEAN', date: indiaDate(), slot: '0800' }).expect(201);
    visitId = visit.body.id as string;
    remember('visits', visitId);
  }, 60_000);

  afterAll(async () => {
    const failures: unknown[] = [];
    const step = async (work: () => Promise<unknown>) => {
      await work().catch((error: unknown) => failures.push(error));
    };
    await step(() => db().incident.deleteMany({ where: { id: { in: made.incidents } } }));
    await step(async () => {
      const files = await db().attachment.findMany({ where: { id: { in: made.attachments } }, select: { id: true, storageKey: true } });
      await db().attachment.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
      await Promise.all(files.map((file) => app.get(StorageService).remove(file.storageKey).catch(() => undefined)));
    });
    await step(() => db().job.deleteMany({ where: { id: { in: made.visits } } }));
    await step(() => db().notification.deleteMany({ where: { userId: { in: made.userIds } } }));
    await step(() => db().legalAcceptance.deleteMany({ where: { userId: { in: made.userIds } } }));
    await step(() => db().session.deleteMany({ where: { OR: [{ id: { in: made.sessionIds } }, { userId: { in: made.userIds } }] } }));
    await step(() => db().otpChallenge.deleteMany({ where: { id: { in: made.challengeIds } } }));
    for (const id of [outletId, otherOutletId].filter(Boolean)) {
      await step(() => db().publicProfile.deleteMany({ where: { outletId: id } }));
      await step(() => db().hygieneScoreSnapshot.deleteMany({ where: { outletId: id } }));
    }
    await step(() => db().user.deleteMany({ where: { id: { in: made.userIds } } }));
    await step(() => db().outlet.deleteMany({ where: { id: { in: [outletId, otherOutletId].filter(Boolean) } } }));
    if (organizationId) await step(() => db().organization.deleteMany({ where: { id: organizationId } }));
    await app.close();
    if (failures.length > 0) throw failures[0];
  });

  it('is refused to a Supervisor and a BDE', async () => {
    for (const token of [tokens.supervisor, tokens.bde]) {
      await http().get('/quality/incidents').set(bearer(token)).expect(403);
      await http().post('/quality/incidents').set(bearer(token)).send({ outletId, happenedOn: indiaDate(), whatHappened: 'Should not be added' }).expect(403);
    }
  });

  it('adds one with its photos and a file, the visit it happened on, and its cost', async () => {
    const photo = await upload(outletId, jpeg(1), 'PROOF', 'arm.jpg', 'image/jpeg');
    const note = await upload(outletId, PDF, 'DOCUMENT', 'clinic.pdf', 'application/pdf');
    // Not in the future, not another outlet's visit, not another outlet's file.
    await http().post('/quality/incidents').set(bearer(tokens.ops)).send({ outletId, happenedOn: addDays(indiaDate(), 1), whatHappened: 'Degreaser splash' }).expect(400);
    await http().post('/quality/incidents').set(bearer(tokens.ops)).send({ outletId: otherOutletId, visitId, happenedOn: indiaDate(), whatHappened: 'Degreaser splash' }).expect(400);
    const elsewhere = await upload(otherOutletId, jpeg(2), 'PROOF', 'x.jpg', 'image/jpeg');
    await http().post('/quality/incidents').set(bearer(tokens.ops)).send({ outletId, happenedOn: indiaDate(), whatHappened: 'Degreaser splash', attachmentIds: [elsewhere] }).expect(400);

    const response = await http()
      .post('/quality/incidents')
      .set(bearer(tokens.ops))
      .send({
        outletId,
        visitId,
        happenedOn: indiaDate(),
        whatHappened: "Degreaser splash on a crew member's forearm during hood work; gloves on, no sleeve guard.",
        whatWasDone: 'Rinsed for 15 minutes; clinic visit, no burn.',
        costRupees: 450,
        attachmentIds: [photo, note],
      })
      .expect(201);
    incident = response.body as IncidentDto;
    remember('incidents', incident.id);
    expect(incident).toMatchObject({
      reference: expect.stringMatching(/^INC-\d{4}$/),
      outletId,
      status: 'OPEN',
      costPaise: 45_000,
      fileCount: 2,
      visit: { id: visitId, date: indiaDate() },
      closedAt: null,
    });
    expect(incident.files.map((file) => file.isPdf).sort((a, b) => Number(a) - Number(b))).toEqual([false, true]);
    expect(incident.createdByName).toBeTruthy();

    const list = (await http().get('/quality/incidents').query({ state: 'open' }).set(bearer(tokens.admin)).expect(200)).body as IncidentsDto;
    expect(list.items.find((item) => item.id === incident.id)).toMatchObject({ status: 'OPEN', fileCount: 2, outletName: `${MARK} Kitchens, Gachibowli` });
  });

  it('shows as open on Today, for the office', async () => {
    const page = (await http().get('/today').set(bearer(tokens.ops)).expect(200)).body as TodayDto;
    expect(page.needsYou.find((item) => item.key === `INCIDENT_OPEN:${incident.id}`)).toMatchObject({
      title: `${MARK} Kitchens, Gachibowli: incident ${incident.reference} open`,
      button: 'Open',
      target: { kind: 'INCIDENT', incidentId: incident.id },
    });
    const own = (await http().get('/today').set(bearer(tokens.supervisor)).expect(200)).body as TodayDto;
    expect(own.needsYou.some((item) => item.kind === 'INCIDENT_OPEN')).toBe(false);
  });

  it('is changed: a photo added, the file taken off, the cost corrected', async () => {
    const more = await upload(outletId, jpeg(3), 'PROOF', 'sleeve.jpg', 'image/jpeg');
    const pdf = incident.files.find((file) => file.isPdf)!.id;
    const changed = (
      await http().patch(`/quality/incidents/${incident.id}`).set(bearer(tokens.ops)).send({ addAttachmentIds: [more], removeAttachmentIds: [pdf], costRupees: 600 }).expect(200)
    ).body as IncidentDto;
    expect(changed).toMatchObject({ costPaise: 60_000, fileCount: 2 });
    expect(changed.files.every((file) => !file.isPdf)).toBe(true);
    // The file taken off stays in storage with the outlet; it is no longer the incident's.
    expect((await db().attachment.findUniqueOrThrow({ where: { id: pdf } })).incidentId).toBeNull();
  });

  it('prints the whole story as a PDF, with no public link', async () => {
    const response = await http().get(`/quality/incidents/${incident.id}/pdf`).set(bearer(tokens.ops)).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain(`Incident ${incident.reference}.pdf`);
    const body = response.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.INCIDENT_PDF_SAMPLE) writeFileSync(process.env.INCIDENT_PDF_SAMPLE, body);
    // Its words, read back from the PDF.
    const require = createRequire(import.meta.url);
    const { extractText, getDocumentProxy } = (await import(pathToFileURL(require.resolve('unpdf')).href)) as typeof import('unpdf');
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(body)), { mergePages: true });
    expect(text).toContain(incident.reference);
    expect(text).toContain('Degreaser splash');
    expect(text).toContain('Rinsed for 15 minutes');
    await http().get(`/quality/incidents/${incident.id}/pdf`).set(bearer(tokens.supervisor)).expect(403);
    await http().get(`/quality/incidents/${incident.id}/pdf`).expect(401);
  }, 60_000);

  it('closes with how it ended, leaving Today, and reopens', async () => {
    await http().post(`/quality/incidents/${incident.id}/close`).set(bearer(tokens.ops)).send({ note: 'x' }).expect(400);
    const closed = (
      await http().post(`/quality/incidents/${incident.id}/close`).set(bearer(tokens.ops)).send({ note: 'Clinic note filed; sleeve guards added to the load list.', costRupees: 650 }).expect(200)
    ).body as IncidentDto;
    expect(closed).toMatchObject({ status: 'CLOSED', costPaise: 65_000, closeNote: 'Clinic note filed; sleeve guards added to the load list.' });
    expect(closed.closedByName).toBeTruthy();
    await http().post(`/quality/incidents/${incident.id}/close`).set(bearer(tokens.ops)).send({ note: 'again and again' }).expect(409);
    const page = (await http().get('/today').set(bearer(tokens.ops)).expect(200)).body as TodayDto;
    expect(page.needsYou.some((item) => item.key === `INCIDENT_OPEN:${incident.id}`)).toBe(false);

    const reopened = (await http().post(`/quality/incidents/${incident.id}/reopen`).set(bearer(tokens.admin)).expect(200)).body as IncidentDto;
    expect(reopened).toMatchObject({ status: 'OPEN', closedAt: null, closeNote: null });
    const all = (await http().get('/quality/incidents').set(bearer(tokens.ops)).expect(200)).body as IncidentsDto;
    // Open ones first.
    const firstClosed = all.items.findIndex((item) => item.status === 'CLOSED');
    const lastOpen = all.items.map((item) => item.status).lastIndexOf('OPEN');
    if (firstClosed >= 0) expect(lastOpen).toBeLessThan(firstClosed);
  });
});
