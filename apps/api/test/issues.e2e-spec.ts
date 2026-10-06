// ECCS support issues. Runs against the local database with the sample seed
// loaded and local object storage running. Uses the Deccan Biryani outlet and
// removes what it creates.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-issues';
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e issue photo bytes')]);

type Issue = {
  id: string;
  reference: string;
  status: string;
  category: string;
  description: string;
  photoPaths: string[];
  comments: { authorName: string; fromEccs: boolean; body: string }[];
  [key: string]: unknown;
};

describe('ECCS support issues (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let otherOutletId: string;
  let chef: string;
  let owner: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  let issueId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanUp() {
    const db = prisma.client;
    await db.attachment.deleteMany({ where: { issue: { outletId } } });
    await db.issue.deleteMany({ where: { outletId } });
    await db.checklistRun.deleteMany({ where: { outletId } });
    await db.attachment.deleteMany({ where: { outletId } });
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
    const session = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE })
      .expect(200);
    return session.body.token as string;
  }

  async function uploadPhoto(token: string, forOutlet = outletId): Promise<string> {
    const response = await http()
      .post('/attachments')
      .set(bearer(token))
      .field('outletId', forOutlet)
      .attach('file', PHOTO, { filename: 'issue.jpg', contentType: 'image/jpeg' })
      .expect(201);
    return response.body.id as string;
  }

  const raise = (token: string, body: Record<string, unknown>) => http().post('/issues').set(bearer(token)).send(body);
  const list = async (token: string, query: Record<string, string> = {}): Promise<Issue[]> =>
    (await http().get('/issues').query(query).set(bearer(token)).expect(200)).body;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const outlets = await prisma.client.outlet.findMany({ where: { code: { in: Object.values(CODES) } } });
    outletId = outlets.find((o) => o.code === CODES.kukatpally)!.id;
    otherOutletId = outlets.find((o) => o.code === CODES.jubilee)!.id;
    await cleanUp();

    chef = await pinLogin(CODES.kukatpally, PINS.chef);
    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('tells a logged-in user how to reach ECCS', async () => {
    await http().get('/support/contact').expect(401);
    const contact = await http().get('/support/contact').set(bearer(chef)).expect(200);
    expect(contact.body).toEqual({ phone: expect.stringMatching(/^\+91\d{10}$/), whatsapp: expect.stringMatching(/^91\d{10}$/), hours: expect.any(String) });
  });

  it('lets a head chef raise an issue with a photo', async () => {
    const photo = await uploadPhoto(chef);
    const created = await raise(chef, {
      outletId,
      category: 'PEST_SIGHTING',
      description: 'E2E Two rats seen behind the dry store at closing',
      attachmentIds: [photo],
    }).expect(201);

    const issue = created.body as Issue;
    issueId = issue.id;
    expect(issue).toMatchObject({
      status: 'OPEN',
      category: 'PEST_SIGHTING',
      raisedByName: 'Sample Head Chef (Kukatpally)',
      outletName: 'Deccan Biryani House, Kukatpally',
      organizationName: 'Deccan Biryani House',
      comments: [],
      photoCount: 1,
    });
    expect(issue.reference).toMatch(/^ECCS-\d{4,}$/);

    const image = await http().get(issue.photoPaths[0]!).expect(200);
    expect(Buffer.compare(image.body as Buffer, PHOTO)).toBe(0);
  });

  it('checks what is being raised and by whom', async () => {
    const valid = { outletId, category: 'CHIMNEY', description: 'E2E Chimney is smoking back into the kitchen' };
    await raise(chef, { ...valid, description: 'bad' }).expect(400);
    await raise(chef, { ...valid, category: 'NOT_A_CATEGORY' }).expect(400);
    await raise(chef, { ...valid, outletId: otherOutletId }).expect(403);
    await http().post('/issues').send(valid).expect(401);

    // A photo uploaded by someone else, or for another outlet, cannot be attached.
    const someoneElses = await uploadPhoto(owner);
    await raise(chef, { ...valid, attachmentIds: [someoneElses] }).expect(400);
    await raise(chef, { ...valid, attachmentIds: ['made-up'] }).expect(400);
  });

  it('shows the issue to the restaurant and to ECCS, and to nobody else', async () => {
    expect((await list(chef)).map((i) => i.id)).toContain(issueId);
    expect((await list(owner)).map((i) => i.id)).toContain(issueId);
    expect((await list(admin)).map((i) => i.id)).toContain(issueId);
    // The sample supervisor has visits assigned at this outlet.
    expect((await list(supervisor)).map((i) => i.id)).toContain(issueId);

    expect((await list(otherManager)).map((i) => i.id)).not.toContain(issueId);
    await http().get(`/issues/${issueId}`).set(bearer(otherManager)).expect(404);
    await http().post(`/issues/${issueId}/comments`).set(bearer(otherManager)).send({ body: 'E2E hello' }).expect(404);
  });

  it('carries a conversation between ECCS and the restaurant', async () => {
    await http().post(`/issues/${issueId}/comments`).set(bearer(admin)).send({ body: '  ' }).expect(400);
    await http()
      .post(`/issues/${issueId}/comments`)
      .set(bearer(admin))
      .send({ body: 'E2E We will send a technician tomorrow morning.' })
      .expect(200);
    const replied = await http()
      .post(`/issues/${issueId}/comments`)
      .set(bearer(chef))
      .send({ body: 'E2E Thank you, please come before 10.' })
      .expect(200);

    expect((replied.body as Issue).comments).toEqual([
      expect.objectContaining({ authorName: 'Sample Ops Manager', fromEccs: true }),
      expect.objectContaining({ authorName: 'Sample Head Chef (Kukatpally)', fromEccs: false }),
    ]);
    expect((await list(owner)).find((i) => i.id === issueId)!.commentCount).toBe(2);
  });

  it('lets ECCS move the issue along, and the owner only close or reopen it', async () => {
    const setStatus = (token: string, status: string) =>
      http().patch(`/issues/${issueId}`).set(bearer(token)).send({ status });

    await setStatus(chef, 'CLOSED').expect(403);
    await setStatus(owner, 'IN_PROGRESS').expect(403);
    await setStatus(owner, 'RESOLVED').expect(403);
    await setStatus(otherManager, 'CLOSED').expect(404);
    await setStatus(admin, 'NOT_A_STATUS').expect(400);

    expect((await setStatus(admin, 'IN_PROGRESS').expect(200)).body).toMatchObject({ status: 'IN_PROGRESS', resolvedAt: null });
    expect((await setStatus(supervisor, 'RESOLVED').expect(200)).body).toMatchObject({
      status: 'RESOLVED',
      resolvedAt: expect.any(String),
    });
    expect((await setStatus(owner, 'CLOSED').expect(200)).body.status).toBe('CLOSED');
    expect((await setStatus(owner, 'OPEN').expect(200)).body).toMatchObject({ status: 'OPEN', resolvedAt: null });
  });

  it('lists open issues first and can leave out finished ones', async () => {
    const second = (await raise(owner, { outletId, category: 'EQUIPMENT', description: 'E2E Walk-in freezer door seal is torn' }).expect(201)).body as Issue;
    await http().patch(`/issues/${second.id}`).set(bearer(admin)).send({ status: 'RESOLVED' }).expect(200);

    const all = (await list(owner, { outletId })).map((i) => i.status);
    expect(all).toEqual(['OPEN', 'RESOLVED']);
    expect((await list(owner, { outletId, status: 'open' })).map((i) => i.id)).toEqual([issueId]);
  });

  it('keeps checklist problems inside the restaurant: they never become ECCS issues', async () => {
    const before = (await list(admin, { outletId })).length;

    const runs = (await http().get('/checklists/today').query({ outletId }).set(bearer(chef)).expect(200)).body as {
      id: string;
      items: { id: string }[];
    }[];
    const photo = await uploadPhoto(chef);
    await http()
      .put(`/checklists/runs/${runs[0]!.id}/items/${runs[0]!.items[0]!.id}`)
      .set(bearer(chef))
      .send({ passed: false, note: 'E2E Floor still greasy near the fryer', attachmentId: photo })
      .expect(200);

    expect((await list(admin, { outletId })).length).toBe(before);
  });
});
