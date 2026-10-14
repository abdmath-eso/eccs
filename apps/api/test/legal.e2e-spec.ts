// Terms and privacy: who must agree to which document, the record each agreement
// leaves, and the server refusing restaurant users until they agree. Runs against
// the local database with the sample seed loaded.
//
// The whole e2e run has the refusing ("the gate") switched off (vitest.config.e2e.ts),
// because the other suites log in as sample users who have agreed to nothing. These
// tests switch it on themselves, test by test, with LegalService.setGateForTest.
//
// The Manager and Head Chef here are throwaway logins made by the Spice Route Owner
// and deleted afterwards, with their agreements. The Owner is a sample login the
// founder uses, and may really have agreed: so the Owner is only ever made to agree
// to a made-up version (TEST_VERSION), and only those rows are removed afterwards.

import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS, LEGAL_ERROR, type LegalDocument, type LegalStatusDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { LegalService } from './../src/legal/legal.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const JUBILEE_CODE = 'SPICE-JH2K7M';
const OWNER_PIN = '2580';
const ADMIN_PHONE = '+919000000001';
const DEVICE = 'e2e-legal';
const NAMES = { manager: 'E2E Legal Manager', chef: 'E2E Legal Chef' };
/** A version no real document will have, for "the document has changed". */
const TEST_VERSION = '2099-12-31';
const AGENT = 'e2e-legal-agent';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const registry = (key: string) => LEGAL_DOCUMENTS.find((document) => document.key === key)!;
const current = (key: string) => ({ key, version: registry(key).version });
const keysOf = (list: { key: string }[]) => list.map((entry) => entry.key);
/** The documents with some of them moved to TEST_VERSION, as a new version would be published. */
const withNewVersion = (keys: readonly string[]): LegalDocument[] =>
  LEGAL_DOCUMENTS.map((document) => (keys.includes(document.key) ? { ...document, version: TEST_VERSION } : document));

describe('Terms and privacy (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let legal: LegalService;
  let owner: string;
  let manager: string;
  let managerPin: string;
  let chef: string;
  let chefId: string;
  let admin: string;
  let outletId: string;
  let organizationId: string;
  /** The Jubilee Hills phone, as linked by these tests: clocking in uses it with nobody logged in. */
  let outletPhone: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const status = async (token: string) =>
    (await http().get('/legal/status').set(bearer(token)).expect(200)).body as LegalStatusDto;
  const accept = (token: string, documents: { key: string; version: string }[], language = 'EN') =>
    http().post('/legal/accept').set(bearer(token)).set('User-Agent', AGENT).send({ documents, language, appVersion: '1.0.0-e2e' });

  async function cleanUp() {
    const db = prisma.client;
    const temps = (await db.user.findMany({ where: { name: { in: Object.values(NAMES) } }, select: { id: true } })).map(
      (user) => user.id,
    );
    // Throwaway logins: every agreement. Anyone else: only agreements to the made-up version.
    await db.legalAcceptance.deleteMany({ where: { OR: [{ userId: { in: temps } }, { version: TEST_VERSION }] } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.session.deleteMany({ where: { userId: { in: temps } } });
    await db.user.deleteMany({ where: { id: { in: temps } } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: ADMIN_PHONE } });
  }

  async function pinLogin(pin: string): Promise<{ token: string; deviceToken: string }> {
    const phone = await http().post('/auth/device/link').send({ code: JUBILEE_CODE, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return { token: session.body.token as string, deviceToken: phone.body.deviceToken as string };
  }

  async function addLogin(name: string, role: 'MANAGER' | 'HEAD_CHEF') {
    const created = await http().post('/restaurant-users').set(bearer(owner)).send({ name, role, outletId, language: 'EN' }).expect(201);
    return { id: created.body.user.id as string, pin: created.body.pin as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    legal = app.get(LegalService);
    await cleanUp();

    const outlet = await prisma.client.outlet.findUniqueOrThrow({ where: { code: JUBILEE_CODE } });
    outletId = outlet.id;
    organizationId = outlet.organizationId;
    const ownerLogin = await pinLogin(OWNER_PIN);
    owner = ownerLogin.token;
    outletPhone = ownerLogin.deviceToken;

    const madeManager = await addLogin(NAMES.manager, 'MANAGER');
    managerPin = madeManager.pin;
    manager = (await pinLogin(managerPin)).token;
    const madeChef = await addLogin(NAMES.chef, 'HEAD_CHEF');
    chefId = madeChef.id;
    chef = (await pinLogin(madeChef.pin)).token;

    await http().post('/auth/otp/request').send({ phone: ADMIN_PHONE }).expect(200);
    const session = await http()
      .post('/auth/otp/verify')
      .send({ phone: ADMIN_PHONE, code: env.DEV_FIXED_OTP, deviceName: DEVICE })
      .expect(200);
    admin = session.body.token as string;
  });

  afterEach(() => {
    legal.setGateForTest(false);
    legal.setDocumentsForTest(null);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('runs with the gate switched off, as the rest of the e2e tests do', () => {
    expect(legal.gateEnabled).toBe(false);
  });

  it('serves the documents to anyone, without a login', async () => {
    const all = (await http().get('/legal/documents').expect(200)).body as { key: string; title: string; version: string; markdown: string }[];
    expect(keysOf(all)).toEqual([...LEGAL_DOCUMENT_KEYS]);
    for (const document of all) {
      expect(document.title.length).toBeGreaterThan(0);
      expect(document.version).toBe(registry(document.key).version);
      expect(document.markdown).toBe(registry(document.key).markdown);
    }
    const privacy = (await http().get('/legal/documents/privacy').expect(200)).body as { title: string };
    expect(privacy.title).toBe('Privacy Policy');
    await http().get('/legal/documents/cookies').expect(404);
  });

  it('needs a login to see what is pending and to agree', async () => {
    await http().get('/legal/status').expect(401);
    await http().post('/legal/accept').send({ documents: [current('terms')], language: 'EN' }).expect(401);
  });

  it('asks a Manager and a Head Chef for the terms and the privacy policy, and the Owner for four', async () => {
    for (const token of [chef, manager]) {
      const mine = await status(token);
      expect(mine.pending).toEqual([
        { ...current('terms'), title: 'Terms of Service', acceptedVersion: null },
        { ...current('privacy'), title: 'Privacy Policy', acceptedVersion: null },
      ]);
      expect(mine.accepted).toEqual([]);
    }

    // The founder may already have agreed as this Owner: what is pending and what is
    // agreed at the current version must together be exactly the Owner's four.
    const owners = await status(owner);
    const agreedNow = owners.accepted.filter((done) => done.version === registry(done.key).version);
    expect([...keysOf(owners.pending), ...keysOf(agreedNow)].sort()).toEqual(['dataProcessing', 'privacy', 'refunds', 'terms']);
  });

  it('asks ECCS staff for nothing, and never refuses them', async () => {
    expect(await status(admin)).toEqual({ pending: [], accepted: [] });
    await accept(admin, [current('terms')]).expect(400);
    legal.setGateForTest(true);
    await http().get('/profile').set(bearer(admin)).expect(200);
  });

  it('with the gate on, refuses a Head Chef or Manager who has not agreed, except what agreeing needs', async () => {
    await http().get('/profile').set(bearer(chef)).expect(200);
    legal.setGateForTest(true);

    for (const token of [chef, manager]) {
      const refused = await http().get('/profile').set(bearer(token)).expect(403);
      expect(refused.body.code).toBe(LEGAL_ERROR.notAccepted);
    }
    // Still open: the status, their own login details, the documents.
    await http().get('/legal/status').set(bearer(chef)).expect(200);
    await http().get('/auth/me').set(bearer(chef)).expect(200);
    await http().get('/legal/documents/terms').expect(200);
    // Lock on a shared phone: taking push off the phone, then logging out.
    const second = (await pinLogin(managerPin)).token;
    await http().post('/push/devices/unregister').set(bearer(second)).send({ token: 'ExponentPushToken[e2e-legal]' }).expect(200);
    await http().post('/auth/logout').set(bearer(second)).expect(204);
    // Clocking in on the outlet's phone needs no login and is not affected.
    await http().get('/attendance/clock/roster').query({ deviceToken: outletPhone }).expect(200);
  });

  it('refuses the wrong set of documents and an old version, recording nothing', async () => {
    await accept(chef, [current('terms')]).expect(400);
    await accept(chef, [current('terms'), current('privacy'), current('refunds')]).expect(400);
    await accept(chef, [current('terms'), current('privacy'), current('disclaimer')]).expect(400);
    await accept(chef, [current('terms'), current('privacy'), current('terms')]).expect(400);
    await accept(chef, [current('terms'), { key: 'privacy', version: '2020-01-01' }]).expect(400);
    await accept(chef, [current('terms'), current('privacy')], 'FR').expect(400);
    expect(await prisma.client.legalAcceptance.count({ where: { userId: chefId } })).toBe(0);
  });

  it('records the agreement with its proof and lets the Head Chef in; agreeing twice is harmless', async () => {
    legal.setGateForTest(true);
    const answer = (await accept(chef, [current('terms'), current('privacy')], 'TE').expect(200)).body as LegalStatusDto;
    expect(answer.pending).toEqual([]);
    expect(keysOf(answer.accepted)).toEqual(['terms', 'privacy']);
    for (const done of answer.accepted) {
      expect(done.version).toBe(registry(done.key).version);
      expect(done.acceptedOn).toBe(indiaDate(new Date(done.acceptedAt)));
    }
    await http().get('/profile').set(bearer(chef)).expect(200);

    const rows = await prisma.client.legalAcceptance.findMany({ where: { userId: chefId }, orderBy: { documentKey: 'asc' } });
    expect(rows.map((row) => row.documentKey)).toEqual(['privacy', 'terms']);
    for (const row of rows) {
      expect(row).toMatchObject({
        version: registry(row.documentKey).version,
        contentSha256: sha256(registry(row.documentKey).markdown),
        role: 'HEAD_CHEF',
        organizationId: null,
        outletId,
        language: 'TE',
        deviceName: DEVICE,
        userAgent: AGENT,
        appVersion: '1.0.0-e2e',
      });
      expect(row.ip).toBeTruthy();
      expect(Math.abs(row.acceptedAt.getTime() - Date.now())).toBeLessThan(60_000);
    }

    // The same press arriving again changes nothing.
    await accept(chef, [current('terms'), current('privacy')], 'TE').expect(200);
    expect(await prisma.client.legalAcceptance.count({ where: { userId: chefId } })).toBe(2);
  });

  it('asks again, and refuses again, when a document gets a new version', async () => {
    legal.setDocumentsForTest(withNewVersion(['privacy']));
    expect((await status(chef)).pending).toEqual([
      { key: 'privacy', version: TEST_VERSION, title: 'Privacy Policy', acceptedVersion: registry('privacy').version },
    ]);

    legal.setGateForTest(true);
    const refused = await http().get('/profile').set(bearer(chef)).expect(403);
    expect(refused.body.code).toBe(LEGAL_ERROR.notAccepted);
    // The version agreed to before no longer counts.
    await accept(chef, [current('privacy')]).expect(400);
    await accept(chef, [{ key: 'privacy', version: TEST_VERSION }]).expect(200);
    await http().get('/profile').set(bearer(chef)).expect(200);
    expect(await prisma.client.legalAcceptance.count({ where: { userId: chefId } })).toBe(3);
  });

  it("records the Owner's agreement for the restaurant as a business", async () => {
    legal.setDocumentsForTest(withNewVersion(LEGAL_DOCUMENT_KEYS));
    const before = await status(owner);
    expect(before.pending.map((entry) => [entry.key, entry.version])).toEqual([
      ['terms', TEST_VERSION],
      ['privacy', TEST_VERSION],
      ['refunds', TEST_VERSION],
      ['dataProcessing', TEST_VERSION],
    ]);

    legal.setGateForTest(true);
    await http().get('/profile').set(bearer(owner)).expect(403);
    const documents = before.pending.map(({ key, version }) => ({ key, version }));
    expect((await accept(owner, documents).expect(200)).body.pending).toEqual([]);
    await http().get('/profile').set(bearer(owner)).expect(200);

    const rows = await prisma.client.legalAcceptance.findMany({
      where: { version: TEST_VERSION, role: 'OWNER', organizationId },
      orderBy: { documentKey: 'asc' },
    });
    expect(rows.map((row) => row.documentKey)).toEqual(['dataProcessing', 'privacy', 'refunds', 'terms']);
    for (const row of rows) {
      expect(row).toMatchObject({ outletId: null, deviceName: DEVICE, contentSha256: sha256(registry(row.documentKey).markdown) });
    }
  });
});
