// The day's sheet (Stage I, step 3; 20 Oct 2026): one per Supervisor on Today, the Supervisor's
// own copy for the phone with "Still to do today", Send (once, again after a change, with
// "changed since"), and Catalogue's "What to carry". It runs on a weekday about nine months
// ahead through the test clock (`?at=`, honoured only under NODE_ENV=test), where no sample or
// plan visit falls. A throwaway Supervisor, restaurant and kind of service are made, so no sample
// person is told anything and no sample list is changed; all of it is removed by the ids recorded
// here (and written to E2E_STATE_FILE, when set, as it goes).

import { writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { addDays, boardWeekday, mergeCarryList, type CatalogAdminDto, type DaySheetDto, type TodayDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { sha256 } from './../src/auth/auth.crypto.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const MARK = 'DSE2E';
const KIND = 'DSE2E_HOOD_WORK';
const DEVICE = 'e2e-day-sheet';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003', bde: '+919000000004' };
const OWNER_PHONE = '+919199900531';
const SUPERVISOR_PHONE = '+919199900532';

describe("The day's sheet (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens = { admin: '', ops: '', sampleSupervisor: '', bde: '', supervisor: '' };
  let supervisorId = '';
  let outletId = '';
  let organizationId = '';
  let kindId = '';
  let templateId: string | null = null;
  let morning = '';
  let afternoon = '';

  let day = addDays(indiaDate(), 281);
  while (boardWeekday(day) === null) day = addDays(day, 1);
  const at = (date: string, time = '06:10') => `${date}T${time}:00.000+05:30`;

  const made = { visits: [] as string[], sends: [] as string[], userIds: [] as string[], sessionIds: [] as string[], challengeIds: [] as string[] };
  const remember = <K extends keyof typeof made>(kind: K, ...ids: string[]) => {
    for (const id of ids) if (id && !made[kind].includes(id)) made[kind].push(id);
    if (process.env.E2E_STATE_FILE) {
      writeFileSync(process.env.E2E_STATE_FILE, JSON.stringify({ spec: 'day-sheet', outletId, organizationId, kindId, templateId, made }, null, 2));
    }
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

  async function addVisit(input: { serviceCode: string; slot: string; date?: string }): Promise<string> {
    const response = await http()
      .post('/visits')
      .set(bearer(tokens.ops))
      .send({ outletId, serviceCode: input.serviceCode, date: input.date ?? day, slot: input.slot, supervisorId })
      .expect(201);
    remember('visits', response.body.id as string);
    return response.body.id as string;
  }

  const sheetOnToday = async (token = tokens.ops, time = '06:10'): Promise<DaySheetDto | undefined> =>
    ((await http().get('/today').query({ at: at(day, time) }).set(bearer(token)).expect(200)).body as TodayDto).sheets.find((sheet) => sheet.supervisorId === supervisorId);
  const send = (token = tokens.ops, time = '06:10', date = day) =>
    http().post(`/today/sheets/${supervisorId}/send`).query({ at: at(day, time) }).set(bearer(token)).send({ date });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    tokens.admin = await otpLogin(PHONES.admin);
    tokens.ops = await otpLogin(PHONES.ops);
    tokens.sampleSupervisor = await otpLogin(PHONES.supervisor);
    tokens.bde = await otpLogin(PHONES.bde);
    const supervisor = await db().user.create({ data: { name: `${MARK} Naveen`, phone: SUPERVISOR_PHONE, memberships: { create: { role: 'SUPERVISOR' } } } });
    supervisorId = supervisor.id;
    remember('userIds', supervisorId);
    tokens.supervisor = await otpLogin(SUPERVISOR_PHONE);

    const created = await http()
      .post('/organizations')
      .set(bearer(tokens.admin))
      .send({ name: `${MARK} House`, ownerName: `${MARK} Owner`, ownerPhone: OWNER_PHONE, outletName: `${MARK} House, Jubilee Hills`, outletAddress: 'Road 36', city: 'Hyderabad' })
      .expect(201);
    organizationId = created.body.id as string;
    remember('userIds', created.body.owners[0].id as string);
    outletId = created.body.outlets[0].id as string;
    await http().patch(`/organizations/${organizationId}/outlets/${outletId}`).set(bearer(tokens.admin)).send({ latitude: 17.4326, longitude: 78.4071 }).expect(200);

    // A throwaway kind of service, so its "What to carry" can be written without touching the sample lists.
    await http()
      .post('/catalog/kinds')
      .set(bearer(tokens.admin))
      .send({ name: `${MARK} hood work`, category: 'CLEANING', sacCode: '998533', gstRatePercent: 18 })
      .expect(201);
    const kind = await db().serviceType.findUniqueOrThrow({ where: { code: KIND } });
    kindId = kind.id;
    templateId = kind.checklistTemplateId;
    remember('visits');
  }, 60_000);

  afterAll(async () => {
    const failures: unknown[] = [];
    const step = async (work: () => Promise<unknown>) => {
      await work().catch((error: unknown) => failures.push(error));
    };
    const visits = { in: made.visits };
    await step(() => db().daySheetSend.deleteMany({ where: { OR: [{ id: { in: made.sends } }, { supervisorId }] } }));
    await step(() => db().notification.deleteMany({ where: { userId: { in: made.userIds } } }));
    await step(() => db().attachment.deleteMany({ where: { jobId: visits } }));
    await step(() => db().serviceReport.deleteMany({ where: { jobId: visits } }));
    await step(() => db().job.deleteMany({ where: { id: visits } }));
    if (kindId) {
      await step(() => db().serviceCatalogItem.deleteMany({ where: { serviceTypeId: kindId } }));
      await step(() => db().serviceType.deleteMany({ where: { id: kindId } }));
      if (templateId) {
        await step(() => db().checklistItem.deleteMany({ where: { templateId: templateId! } }));
        await step(() => db().checklistTemplate.deleteMany({ where: { id: templateId! } }));
      }
    }
    await step(() => db().legalAcceptance.deleteMany({ where: { userId: { in: made.userIds } } }));
    await step(() => db().session.deleteMany({ where: { OR: [{ id: { in: made.sessionIds } }, { userId: { in: made.userIds } }] } }));
    await step(() => db().otpChallenge.deleteMany({ where: { id: { in: made.challengeIds } } }));
    if (outletId) {
      await step(() => db().publicProfile.deleteMany({ where: { outletId } }));
      await step(() => db().hygieneScoreSnapshot.deleteMany({ where: { outletId } }));
    }
    await step(() => db().user.deleteMany({ where: { id: { in: made.userIds } } }));
    if (outletId) await step(() => db().outlet.deleteMany({ where: { id: outletId } }));
    if (organizationId) await step(() => db().organization.deleteMany({ where: { id: organizationId } }));
    await app.close();
    if (failures.length > 0) throw failures[0];
  });

  it("keeps a kind's What to carry in Catalogue: cleaned, and no longer the sample once saved", async () => {
    await http().patch(`/catalog/kinds/${KIND}`).set(bearer(tokens.sampleSupervisor)).send({ carryItems: ['Ladder'] }).expect(403);
    await http().patch(`/catalog/kinds/${KIND}`).set(bearer(tokens.ops)).send({ carryItems: Array.from({ length: 21 }, (_, index) => `Thing ${index}`) }).expect(400);
    await db().serviceType.update({ where: { id: kindId }, data: { carrySample: true } });
    const catalogue = (await http().patch(`/catalog/kinds/${KIND}`).set(bearer(tokens.ops)).send({ carryItems: [' Ladder', 'Harness', '', 'ladder', 'Gloves'] }).expect(200)).body as CatalogAdminDto;
    expect(catalogue.kinds.find((kind) => kind.code === KIND)).toMatchObject({ carryItems: ['Ladder', 'Harness', 'Gloves'], carrySample: false });
  });

  it("puts one sheet per Supervisor on Today: visits in time order, address, map, last note, and what to carry merged", async () => {
    afternoon = await addVisit({ serviceCode: KIND, slot: '1400' });
    morning = await addVisit({ serviceCode: 'PEST', slot: '0800' });
    // An earlier visit at the outlet, with the Supervisor's note.
    const earlier = await db().job.create({
      data: {
        outletId,
        serviceTypeId: kindId,
        scheduledDate: new Date(`${addDays(day, -30)}T00:00:00.000Z`),
        status: 'COMPLETED',
        completedAt: new Date(at(addDays(day, -30), '12:00')),
        supervisorId,
        notes: 'Hood filter was heavily clogged',
      },
    });
    remember('visits', earlier.id);

    const sheet = await sheetOnToday();
    expect(sheet).toBeDefined();
    expect(sheet!.visits.map((visit) => [visit.visitId, visit.time])).toEqual([
      [morning, '08:00'],
      [afternoon, '14:00'],
    ]);
    expect(sheet!.visits[0]).toMatchObject({
      outletName: `${MARK} House, Jubilee Hills`,
      address: 'Road 36, Hyderabad',
      mapUrl: 'https://www.google.com/maps/search/?api=1&query=17.4326,78.4071',
      lastNote: 'Hood filter was heavily clogged',
      free: false,
    });
    const pest = (await db().serviceType.findUniqueOrThrow({ where: { code: 'PEST' } })).carryItems;
    expect(sheet!.carry).toEqual(
      mergeCarryList([
        { visitId: morning, outletName: `${MARK} House, Jubilee Hills`, time: '08:00', items: pest },
        { visitId: afternoon, outletName: `${MARK} House, Jubilee Hills`, time: '14:00', items: ['Ladder', 'Harness', 'Gloves'] },
      ]),
    );
    expect(sheet!.carry.find((entry) => entry.item === 'Ladder')!.visits.map((visit) => visit.visitId)).toEqual([afternoon]);
    expect(sheet).toMatchObject({ supervisorName: `${MARK} Naveen`, sent: null, canSend: true, stillToDo: [] });
  });

  it("gives the Supervisor their own copy for the phone, with Still to do today; nobody else has one", async () => {
    const own = (await http().get('/today/sheet').query({ at: at(day, '17:00') }).set(bearer(tokens.supervisor)).expect(200)).body as DaySheetDto;
    expect(own.visits.map((visit) => visit.visitId)).toEqual([morning, afternoon]);
    expect(own.canSend).toBe(false);
    expect(own.stillToDo.map((item) => [item.kind, item.visitId])).toEqual([
      ['FINISH', morning],
      ['FINISH', afternoon],
    ]);
    // The morning visit finished with no before photo, waiting for the restaurant.
    await db().job.update({ where: { id: morning }, data: { status: 'COMPLETED', completedAt: new Date(at(day, '10:00')) } });
    const later = (await http().get('/today/sheet').query({ at: at(day, '17:00') }).set(bearer(tokens.supervisor)).expect(200)).body as DaySheetDto;
    expect(later.stillToDo.map((item) => item.kind)).toEqual(['FINISH', 'PHOTOS', 'SIGN_OFF']);
    // On their Today too, without a Send button.
    expect((await sheetOnToday(tokens.supervisor))?.canSend).toBe(false);
    await http().get('/today/sheet').set(bearer(tokens.ops)).expect(400);
    await http().get('/today/sheet').set(bearer(tokens.bde)).expect(403);
  });

  it("sends the sheet to the Supervisor once, and again only after the visits change, saying changed since", async () => {
    await send(tokens.supervisor).expect(403);
    await send(tokens.bde).expect(403);
    await send(tokens.ops, '06:10', addDays(day, 1)).expect(409);

    const sent = await send().expect(200);
    expect(sent.body).toMatchObject({ supervisorId, date: day, sentAt: new Date(at(day)).toISOString(), told: 1 });
    remember('sends', ...(await db().daySheetSend.findMany({ where: { supervisorId }, select: { id: true } })).map((row) => row.id));
    const told = await db().notification.findMany({ where: { userId: supervisorId, type: 'DAY_SHEET_SENT' } });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ dedupeKey: `day-sheet:${supervisorId}:${day}:1`, title: "Your day's sheet" });
    expect((told[0]!.data as { link: unknown; params: unknown }).link).toEqual({ kind: 'services' });
    expect((told[0]!.data as { params: unknown }).params).toEqual({ date: day, count: 2 });

    const again = await send(tokens.ops, '06:20').expect(409);
    expect(again.body.message).toBe('Already sent at 6:10 am; nothing has changed since');
    let sheet = await sheetOnToday();
    expect(sheet!.sent).toMatchObject({ at: new Date(at(day)).toISOString(), changedSince: false });
    expect(sheet!.sent!.byName).toBeTruthy();

    // A visit moves after sending: the sheet says so, and can be sent again.
    await db().job.update({ where: { id: afternoon }, data: { scheduledSlot: '1600' } });
    sheet = await sheetOnToday();
    expect(sheet!.sent?.changedSince).toBe(true);
    await send(tokens.admin, '07:00').expect(200);
    remember('sends', ...(await db().daySheetSend.findMany({ where: { supervisorId }, select: { id: true } })).map((row) => row.id));
    expect(await db().notification.count({ where: { userId: supervisorId, type: 'DAY_SHEET_SENT' } })).toBe(2);
    expect((await sheetOnToday())!.sent).toMatchObject({ at: new Date(at(day, '07:00')).toISOString(), changedSince: false });
  });

  it('refuses a Supervisor with no visits that day', async () => {
    const other = await db().user.findUniqueOrThrow({ where: { phone: PHONES.supervisor } });
    await http().post(`/today/sheets/${other.id}/send`).query({ at: at(day) }).set(bearer(tokens.ops)).send({ date: day }).expect(409);
  });
});
