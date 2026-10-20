// New outlets (Clients > New outlets, 20 Oct 2026): an outlet's first ten days in nine steps.
// A throwaway restaurant is onboarded through the real organisations endpoint, so its
// onboarding starts by itself; then the events happen as the apps make them (the Owner's
// one-time-code login and PIN, the Manager and Head Chef added with their PINs, everyone's
// agreement to the terms) or, for the licence copy and the first checklist with a proof
// photo, as the rows those apps write. Days are moved by shifting the throwaway outlet's
// own creation time. Everything made is removed by the ids recorded here.

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { LEGAL_DOCUMENTS, documentsToAccept, indiaDay, type OutletOnboardingAttentionDto, type OutletOnboardingBoardDto, type OutletOnboardingCardDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { sha256 } from './../src/auth/auth.crypto.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const MARK = 'OOE2E';
const DEVICE = 'e2e-outlet-onboarding';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003' };
const OWNER_PHONE = '+919199900311';
const BDE_PHONE = '+919199900312';
const HOUR = 3_600_000;

describe('New outlets: onboarding an outlet (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let ops: string;
  let supervisor: string;
  let bde: string;

  // Everything this suite makes, by id.
  const made = {
    organizationId: '',
    outletIds: [] as string[],
    userIds: [] as string[],
    sessionIds: [] as string[],
    challengeIds: [] as string[],
    attachmentIds: [] as string[],
    documentIds: [] as string[],
    licenceIds: [] as string[],
    outletChecklistIds: [] as string[],
    runIds: [] as string[],
  };
  let outletId = '';
  let outletCode = '';
  let ownerToken = '';
  let adminName = '';
  let opsName = '';

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const db = () => prisma.client;
  const keepSession = async (token: string) => {
    const session = await db().session.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true } });
    if (session) made.sessionIds.push(session.id);
    return token;
  };

  async function otpLogin(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const challenge = await db().otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (challenge) made.challengeIds.push(challenge.id);
    const body = (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body;
    await keepSession(body.token as string);
    return body as { token: string; generatedPin?: string };
  }

  async function pinLogin(pin: string) {
    const phone = await http().post('/auth/device/link').send({ code: outletCode, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return keepSession(session.body.token as string);
  }

  async function agree(token: string, role: 'OWNER' | 'MANAGER' | 'HEAD_CHEF') {
    const documents = documentsToAccept(role, LEGAL_DOCUMENTS).map((document) => ({ key: document.key, version: document.version }));
    await http().post('/legal/accept').set(bearer(token)).send({ documents, language: 'EN', appVersion: '1.0.0-e2e' }).expect(200);
  }

  const board = async (token = ops) => (await http().get('/outlet-onboarding').set(bearer(token)).expect(200)).body as OutletOnboardingBoardDto;
  const card = async (id = outletId) => (await board()).cards.find((one) => one.outletId === id);
  const attention = async () => (await http().get('/outlet-onboarding/attention').set(bearer(ops)).expect(200)).body as OutletOnboardingAttentionDto;
  const done = (found: OutletOnboardingCardDto | undefined) => found?.steps.filter((step) => step.done).map((step) => step.number);
  const step = (found: OutletOnboardingCardDto | undefined, key: string) => found?.steps.find((one) => one.key === key);

  /**
   * Moves an outlet (and an onboarding that started with it) back in time, as if added `days`
   * India days ago, a minute after that day's midnight, so the day counted is exact at any hour.
   */
  async function addedDaysAgo(id: string, days: number) {
    const midnight = new Date(`${indiaDay(new Date())}T00:00:00.000+05:30`).getTime();
    const at = new Date(midnight - days * 24 * HOUR + 60_000);
    await db().outlet.update({ where: { id }, data: { createdAt: at } });
    await db().outletOnboarding.updateMany({ where: { outletId: id }, data: { startedAt: at } });
  }

  async function cleanUp() {
    const outletIds = made.outletIds;
    await db().legalAcceptance.deleteMany({ where: { userId: { in: made.userIds } } });
    await db().session.deleteMany({ where: { OR: [{ id: { in: made.sessionIds } }, { userId: { in: made.userIds } }] } });
    if (made.organizationId) await db().linkedDevice.deleteMany({ where: { organizationId: made.organizationId } });
    await db().otpChallenge.deleteMany({ where: { id: { in: made.challengeIds } } });
    // Licences point at documents, documents and proof photos at files, files at checklist answers.
    await db().licence.deleteMany({ where: { id: { in: made.licenceIds } } });
    await db().document.deleteMany({ where: { id: { in: made.documentIds } } });
    await db().attachment.deleteMany({ where: { id: { in: made.attachmentIds } } });
    await db().checklistResponse.deleteMany({ where: { runId: { in: made.runIds } } });
    await db().checklistRun.deleteMany({ where: { id: { in: made.runIds } } });
    await db().outletChecklist.deleteMany({ where: { id: { in: made.outletChecklistIds } } });
    if (outletIds.length > 0) {
      await db().staffMember.deleteMany({ where: { outletId: { in: outletIds } } });
      await db().hygieneScoreSnapshot.deleteMany({ where: { outletId: { in: outletIds } } });
      await db().publicProfile.deleteMany({ where: { outletId: { in: outletIds } } });
    }
    await db().user.deleteMany({ where: { id: { in: made.userIds } } });
    // An outlet takes its onboarding and the onboarding's entries with it.
    await db().outlet.deleteMany({ where: { id: { in: outletIds } } });
    if (made.organizationId) await db().organization.deleteMany({ where: { id: made.organizationId } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    admin = (await otpLogin(PHONES.admin)).token;
    ops = (await otpLogin(PHONES.ops)).token;
    supervisor = (await otpLogin(PHONES.supervisor)).token;
    const bdeUser = await db().user.create({ data: { phone: BDE_PHONE, name: `${MARK} BDE`, memberships: { create: [{ role: 'BDE' }] } } });
    made.userIds.push(bdeUser.id);
    bde = (await otpLogin(BDE_PHONE)).token;
    adminName = (await http().get('/auth/me').set(bearer(admin)).expect(200)).body.name as string;
    opsName = (await http().get('/auth/me').set(bearer(ops)).expect(200)).body.name as string;
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('starts by itself when a restaurant is onboarded, with step 1 ticked by whoever added it', async () => {
    const created = await http()
      .post('/organizations')
      .set(bearer(admin))
      .send({ name: `${MARK} Biryani`, ownerName: `${MARK} Owner`, ownerPhone: OWNER_PHONE, outletName: `${MARK} Biryani, Kondapur`, outletAddress: 'Kondapur Main Road' })
      .expect(201);
    made.organizationId = created.body.id as string;
    made.userIds.push(created.body.owners[0].id as string);
    outletId = created.body.outlets[0].id as string;
    outletCode = created.body.outlets[0].code as string;
    made.outletIds.push(outletId);

    const found = await card();
    expect(found).toBeDefined();
    expect(done(found)).toEqual([1]);
    expect(step(found, 'OUTLET_ADDED')).toMatchObject({ by: adminName, detail: `code ${outletCode}` });
    expect(step(found, 'OWNER_LOGIN')).toMatchObject({ done: false, detail: 'The Owner has not logged in yet' });
    expect(found).toMatchObject({ day: 0, stepsDone: 1, live: false, stuck: false, owner: { name: `${MARK} Owner`, phone: OWNER_PHONE } });
    expect(step(found, 'DAY3_CALL')!.dueOn).toBeTruthy();
  });

  it('ticks steps 2 to 6 from what the apps record, and is live with all six', async () => {
    // 2: the Owner's first login with a one-time code gives them their PIN.
    const owner = await otpLogin(OWNER_PHONE);
    ownerToken = owner.token;
    expect(owner.generatedPin).toMatch(/^\d{4}$/);
    let found = await card();
    expect(done(found)).toEqual([1, 2]);
    expect(step(found, 'LEGAL')).toMatchObject({ done: false, detail: '0 of 1 person' });

    // 3: the Owner adds a Manager and a Head Chef, each with a PIN.
    const add = async (name: string, role: 'MANAGER' | 'HEAD_CHEF') => {
      const body = (await http().post('/restaurant-users').set(bearer(ownerToken)).send({ name, role, outletId, language: 'EN' }).expect(201)).body;
      made.userIds.push(body.user.id as string);
      return body.pin as string;
    };
    const managerPin = await add(`${MARK} Manager`, 'MANAGER');
    found = await card();
    expect(step(found, 'STAFF_PINS')).toMatchObject({ done: false, detail: '1 of 2' });
    const chefPin = await add(`${MARK} Chef`, 'HEAD_CHEF');
    found = await card();
    expect(step(found, 'STAFF_PINS')).toMatchObject({ done: true, detail: '2 of 2' });

    // 4: everyone at the outlet agrees to the terms and privacy in the app.
    await agree(ownerToken, 'OWNER');
    const manager = await pinLogin(managerPin);
    await agree(manager, 'MANAGER');
    found = await card();
    expect(step(found, 'LEGAL')).toMatchObject({ done: false, detail: '2 of 3 people' });
    const chef = await pinLogin(chefPin);
    await agree(chef, 'HEAD_CHEF');
    found = await card();
    expect(step(found, 'LEGAL')).toMatchObject({ done: true, detail: '3 of 3 people' });

    // 5: the FSSAI licence with a copy filed (the rows the restaurant app's licence screen writes).
    const ownerId = made.userIds[1]!;
    const licenceFile = await db().attachment.create({
      data: { outletId, kind: 'DOCUMENT', storageKey: `e2e/${MARK}/${randomUUID()}.pdf`, mimeType: 'application/pdf', uploadedById: ownerId },
    });
    made.attachmentIds.push(licenceFile.id);
    const document = await db().document.create({ data: { outletId, category: 'licence', title: 'FSSAI licence', attachmentId: licenceFile.id, uploadedById: ownerId } });
    made.documentIds.push(document.id);
    const licence = await db().licence.create({ data: { outletId, type: 'FIRE_NOC', expiresOn: new Date('2027-12-31T00:00:00.000Z') } });
    made.licenceIds.push(licence.id);
    found = await card();
    expect(step(found, 'LICENCES')).toMatchObject({ done: false, detail: '0 of 1 · no FSSAI licence yet' });
    const fssai = await db().licence.create({ data: { outletId, type: 'FSSAI', expiresOn: new Date('2027-12-31T00:00:00.000Z'), documentId: document.id } });
    made.licenceIds.push(fssai.id);
    await db().licence.update({ where: { id: licence.id }, data: { documentId: document.id } });
    found = await card();
    expect(step(found, 'LICENCES')).toMatchObject({ done: true, detail: '2 of 2', by: `${MARK} Owner` });

    // 6: the first checklist handed in with a proof photo (the rows the checklist screen writes).
    const template = await db().checklistTemplate.findFirstOrThrow({
      where: { kind: 'DAILY', outletId: null, isActive: true, items: { some: { outletId: null, isActive: true } } },
      select: { id: true, items: { where: { outletId: null, isActive: true }, take: 1, select: { id: true } } },
    });
    const list = await db().outletChecklist.create({ data: { outletId, templateId: template.id } });
    made.outletChecklistIds.push(list.id);
    const day = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const unsent = await db().checklistRun.create({ data: { outletChecklistId: list.id, outletId, date: day, shift: 'e2e-a', status: 'SUBMITTED', submittedAt: new Date(), submittedById: made.userIds[3]! } });
    made.runIds.push(unsent.id);
    found = await card();
    // Handed in, but without a proof photo: not yet.
    expect(step(found, 'FIRST_CHECKLIST')!.done).toBe(false);
    const run = await db().checklistRun.create({ data: { outletChecklistId: list.id, outletId, date: day, shift: 'e2e-b', status: 'SUBMITTED', submittedAt: new Date(), submittedById: made.userIds[3]! } });
    made.runIds.push(run.id);
    const response = await db().checklistResponse.create({ data: { runId: run.id, itemId: template.items[0]!.id, valueBool: true, passed: true, capturedAt: new Date(), answeredById: made.userIds[3]! } });
    const proof = await db().attachment.create({
      data: { outletId, kind: 'PROOF', storageKey: `e2e/${MARK}/${randomUUID()}.jpg`, mimeType: 'image/jpeg', checklistResponseId: response.id, uploadedById: made.userIds[3]! },
    });
    made.attachmentIds.push(proof.id);

    found = await card();
    expect(done(found)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(step(found, 'FIRST_CHECKLIST')).toMatchObject({ done: true, by: `${MARK} Chef` });
    expect(found).toMatchObject({ live: true, stuck: false, stepsDone: 6 });
    expect(found!.liveAfterHours).toBe(0);
  }, 60_000);

  it('logs the calls and the posters in one tap, with a note and who, and takes one back', async () => {
    const logged = await http().post(`/outlet-onboarding/outlets/${outletId}/entries`).set(bearer(ops)).send({ kind: 'DAY3_CALL', note: 'chef wants Telugu labels' }).expect(201);
    expect(step(logged.body, 'DAY3_CALL')).toMatchObject({ done: true, by: opsName, detail: 'chef wants Telugu labels' });

    const posters = await http().post(`/outlet-onboarding/outlets/${outletId}/entries`).set(bearer(ops)).send({ kind: 'POSTERS' }).expect(201);
    const ticked = step(posters.body, 'POSTERS')!;
    expect(ticked.done).toBe(true);
    const undone = await http().delete(`/outlet-onboarding/outlets/${outletId}/entries/${ticked.entryId}`).set(bearer(ops)).expect(200);
    expect(step(undone.body, 'POSTERS')!.done).toBe(false);

    const noted = await http().post(`/outlet-onboarding/outlets/${outletId}/entries`).set(bearer(admin)).send({ kind: 'NOTE', note: 'Visit and set up in person' }).expect(201);
    expect((noted.body as OutletOnboardingCardDto).notes).toEqual([expect.objectContaining({ note: 'Visit and set up in person', by: adminName })]);
    expect((noted.body as OutletOnboardingCardDto).stepsDone).toBe(7);

    await http().post(`/outlet-onboarding/outlets/${outletId}/entries`).set(bearer(ops)).send({ kind: 'SOMETHING' }).expect(400);
    await http().post(`/outlet-onboarding/outlets/${outletId}/entries`).set(bearer(ops)).send({ kind: 'NOTE', note: 'x'.repeat(301) }).expect(400);
    await http().delete(`/outlet-onboarding/outlets/${outletId}/entries/${randomUUID()}`).set(bearer(ops)).expect(404);
    await http().post(`/outlet-onboarding/outlets/${randomUUID()}/entries`).set(bearer(ops)).send({ kind: 'POSTERS' }).expect(404);
  });

  it('shows "Act" for an outlet not live 24 hours after being added, and lists the calls due for Today', async () => {
    // A second outlet through "Add an outlet": it starts by itself too.
    const second = await http().post(`/organizations/${made.organizationId}/outlets`).set(bearer(ops)).send({ outletName: `${MARK} Biryani, Madhapur`, outletAddress: 'Madhapur' }).expect(201);
    const secondId = second.body.id as string;
    made.outletIds.push(secondId);
    let found = await card(secondId);
    expect(step(found, 'OUTLET_ADDED')!.by).toBe(opsName);
    // The Owner had logged in before this outlet was added.
    expect(step(found, 'OWNER_LOGIN')).toMatchObject({ done: true, detail: 'Owner already had a login' });
    expect(found!.stuck).toBe(false);
    expect((await attention()).stuck.map((one) => one.outletId)).not.toContain(secondId);

    await addedDaysAgo(secondId, 2);
    found = await card(secondId);
    expect(found).toMatchObject({ stuck: true, live: false, day: 2 });
    expect(found!.hoursSinceAdded).toBeGreaterThanOrEqual(24);
    const now = await attention();
    expect(now.stuck).toContainEqual(expect.objectContaining({ outletId: secondId, outletName: `${MARK} Biryani, Madhapur` }));
    expect(now.calls.filter((call) => call.outletId === secondId)).toEqual([]);
    // Stuck outlets come first on the tab.
    const cards = (await board()).cards.filter((one) => made.outletIds.includes(one.outletId));
    expect(cards.map((one) => one.outletId)).toEqual([secondId, outletId]);

    // Three days on, its day-3 call is due (the first outlet's was logged).
    await addedDaysAgo(secondId, 3);
    await addedDaysAgo(outletId, 3);
    expect((await attention()).calls.filter((call) => made.outletIds.includes(call.outletId))).toEqual([
      expect.objectContaining({ outletId: secondId, kind: 'DAY3_CALL' }),
    ]);

    // Ten days on, the first outlet's day-10 call is due; eleven days on it has left the tab, and the call stays due.
    await addedDaysAgo(outletId, 10);
    expect((await attention()).calls).toContainEqual(expect.objectContaining({ outletId, kind: 'DAY10_CALL' }));
    expect(await card(outletId)).toBeDefined();
    await addedDaysAgo(outletId, 11);
    expect(await card(outletId)).toBeUndefined();
    expect((await attention()).calls).toContainEqual(expect.objectContaining({ outletId, kind: 'DAY10_CALL' }));
    await http().post(`/outlet-onboarding/outlets/${outletId}/entries`).set(bearer(ops)).send({ kind: 'DAY10_CALL', note: 'rated 5 stars' }).expect(201);
    expect((await attention()).calls.filter((call) => call.outletId === outletId)).toEqual([]);

    // The strip counts this India month (its numbers are unit-tested in packages/shared).
    expect((await board()).strip.month).toBe(indiaDay(new Date()).slice(0, 7));
  });

  it('offers "Start onboarding" only for an outlet under ten days old without one', async () => {
    const third = await http().post(`/organizations/${made.organizationId}/outlets`).set(bearer(ops)).send({ outletName: `${MARK} Biryani, Gachibowli`, outletAddress: 'Gachibowli' }).expect(201);
    const thirdId = third.body.id as string;
    made.outletIds.push(thirdId);
    // As if added before onboarding started by itself.
    await db().outletOnboarding.delete({ where: { outletId: thirdId } });
    let now = await board();
    expect(now.toStart.map((one) => one.outletId)).toContain(thirdId);
    expect(now.cards.map((one) => one.outletId)).not.toContain(thirdId);

    now = (await http().post(`/outlet-onboarding/outlets/${thirdId}/start`).set(bearer(ops)).expect(200)).body as OutletOnboardingBoardDto;
    expect(now.toStart.map((one) => one.outletId)).not.toContain(thirdId);
    expect(now.cards.find((one) => one.outletId === thirdId)).toBeDefined();
    await http().post(`/outlet-onboarding/outlets/${thirdId}/start`).set(bearer(ops)).expect(409);

    // Older than ten days: not offered, and refused.
    await db().outletOnboarding.delete({ where: { outletId: thirdId } });
    await db().outlet.update({ where: { id: thirdId }, data: { createdAt: new Date(Date.now() - 12 * 24 * HOUR) } });
    expect((await board()).toStart.map((one) => one.outletId)).not.toContain(thirdId);
    await http().post(`/outlet-onboarding/outlets/${thirdId}/start`).set(bearer(ops)).expect(409);
    await http().post(`/outlet-onboarding/outlets/${randomUUID()}/start`).set(bearer(ops)).expect(404);
  });

  it('is for the Super Admin and the Ops Manager only', async () => {
    await board(admin);
    for (const token of [supervisor, bde, ownerToken]) {
      await http().get('/outlet-onboarding').set(bearer(token)).expect(403);
      await http().get('/outlet-onboarding/attention').set(bearer(token)).expect(403);
      await http().post(`/outlet-onboarding/outlets/${outletId}/entries`).set(bearer(token)).send({ kind: 'POSTERS' }).expect(403);
      await http().post(`/outlet-onboarding/outlets/${outletId}/start`).set(bearer(token)).expect(403);
    }
  });
});
