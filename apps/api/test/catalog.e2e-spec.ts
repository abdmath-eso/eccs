// The console's editing of clients, outlets and the service catalogue.
// Runs against the local database with the sample seed loaded and local object
// storage running. Everything it changes is a throwaway it creates itself (a
// client, its outlet and people, a kind of service) and removes again; the
// sample clients, logins and services are only read.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const MARK = 'E2E Catalog';
const KIND = 'E2E_CATALOG_KIND';
const DEVICE = 'e2e-catalog';
const SAMPLE = { code: 'DECCA-KP6R3T', ownerPin: '3917', ownerPhone: '+919100000002' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003', owner: '+919199900011', ownerNew: '+919199900012' };
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e catalog photo bytes')]);

type Outlet = { id: string; name: string; code: string; address: string; city: string; pincode: string | null; fssaiNumber: string | null; isActive: boolean };
type Client = {
  id: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  isActive: boolean;
  owners: { id: string; name: string; phone: string | null; email: string | null; hasPin: boolean }[];
  outlets: Outlet[];
};
type Phone = { id: string; name: string | null; outletId: string | null };
type Task = { id: string; label: Record<string, string>; isActive: boolean; answerCount: number };
type Kind = { code: string; name: Record<string, string>; isActive: boolean; tasks: Task[]; visitCount: number };
type Item = { id: string; serviceCode: string; name: Record<string, string>; description: Record<string, string> | null; pricePaise: number; durationMinutes: number; isActive: boolean; bookingCount: number };
type Catalogue = { kinds: Kind[]; items: Item[] };
type Visit = { id: string; status: string; tasks: { itemId: string; label: Record<string, string>; done: boolean | null }[] };

const daysAhead = (days: number) => indiaDate(new Date(Date.now() + days * 86_400_000));

describe('Editing clients, outlets and the catalogue (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  let sampleOwner: string;
  let client: Client;
  let outlet: Outlet;
  let ownerId: string;
  let owner: string;
  let manager: string;
  let managerPin: string;
  let managerPhone: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const asAdmin = () => bearer(admin);

  async function cleanUp() {
    const db = prisma.client;
    const ours = { name: { startsWith: MARK } };
    const jobs = { outlet: { organization: ours } };
    await db.document.deleteMany({ where: { outlet: { organization: ours } } });
    await db.attachment.deleteMany({ where: { outlet: { organization: ours } } });
    await db.serviceReport.deleteMany({ where: { job: jobs } });
    await db.signOff.deleteMany({ where: { job: jobs } });
    await db.jobTaskResponse.deleteMany({ where: { job: jobs } });
    await db.job.deleteMany({ where: jobs });
    await db.booking.deleteMany({ where: { outlet: { organization: ours } } });
    // Daily checklists are handed to an outlet the first time anything asks for them, which another suite may do.
    await db.checklistRun.deleteMany({ where: { outlet: { organization: ours } } });
    await db.outletChecklist.deleteMany({ where: { outlet: { organization: ours } } });

    // The throwaway kind of service, its bookable services and its task list.
    const kind = await db.serviceType.findUnique({ where: { code: KIND } });
    if (kind) {
      await db.serviceCatalogItem.deleteMany({ where: { serviceTypeId: kind.id } });
      await db.serviceType.delete({ where: { id: kind.id } });
      if (kind.checklistTemplateId) {
        await db.checklistItem.deleteMany({ where: { templateId: kind.checklistTemplateId } });
        await db.checklistTemplate.delete({ where: { id: kind.checklistTemplateId } });
      }
    }

    // The throwaway client: its people first (their sessions and notifications go with them), then the rest.
    await db.user.deleteMany({ where: { memberships: { some: { OR: [{ organization: ours }, { outlet: { organization: ours } }] } } } });
    await db.user.deleteMany({ where: { phone: { in: [PHONES.owner, PHONES.ownerNew] } } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { OR: [{ name: DEVICE }, { organization: ours }] } });
    await db.outlet.deleteMany({ where: { organization: ours } });
    await db.organization.deleteMany({ where: ours });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
    // What the sample ECCS staff were told about the throwaway client.
    await db.$executeRaw`DELETE FROM "Notification" WHERE "data"::text ILIKE ${`%${MARK}%`} OR "body" ILIKE ${`%${MARK}%`}`;
  }

  async function otpLogin(phone: string, extra: Record<string, unknown> = {}) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    return http()
      .post('/auth/otp/verify')
      .send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE, ...extra });
  }
  const link = (code: string) => http().post('/auth/device/link').send({ code, deviceName: DEVICE });
  const pin = (deviceToken: string, value: string) => http().post('/auth/pin/login').send({ deviceToken, pin: value });

  const catalogue = async (): Promise<Catalogue> => (await http().get('/catalog').set(asAdmin()).expect(200)).body;
  const kind = async (): Promise<Kind> => (await catalogue()).kinds.find((entry) => entry.code === KIND)!;
  const inUse = (entry: Kind) => entry.tasks.filter((task) => task.isActive).map((task) => task.label.en);
  const visit = async (id: string): Promise<Visit> => (await http().get(`/visits/${id}`).set(asAdmin()).expect(200)).body;

  /** ECCS adds a visit of the throwaway kind at the throwaway outlet, given to the sample Supervisor. */
  async function addVisit(): Promise<string> {
    const created = await http()
      .post('/visits')
      .set(asAdmin())
      .send({ outletId: outlet.id, serviceCode: KIND, date: daysAhead(1), slot: '1000', supervisorId })
      .expect(201);
    return created.body.id as string;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();

    admin = (await otpLogin(PHONES.admin).then((r) => r.body)).token;
    const supervisorSession = (await otpLogin(PHONES.supervisor)).body;
    supervisor = supervisorSession.token;
    supervisorId = supervisorSession.user.id;
    const sampleDevice = await link(SAMPLE.code).expect(200);
    sampleOwner = (await pin(sampleDevice.body.deviceToken, SAMPLE.ownerPin).expect(200)).body.token;

    // The throwaway client, made the way the console makes one.
    const created = await http()
      .post('/organizations')
      .set(asAdmin())
      .send({
        name: `${MARK} Client`,
        ownerName: `${MARK} Owner`,
        ownerPhone: PHONES.owner,
        outletName: `${MARK} Outlet`,
        outletAddress: '1 Test Road',
        pincode: '500001',
      })
      .expect(201);
    client = created.body;
    outlet = client.outlets[0]!;
    ownerId = client.owners[0]!.id;

    const person = await http()
      .post('/restaurant-users')
      .set(asAdmin())
      .send({ name: `${MARK} Manager`, role: 'MANAGER', outletId: outlet.id })
      .expect(201);
    managerPin = person.body.pin;

    // A kind of service with no task list yet, as the safety inspection has none. Named in two languages.
    await prisma.client.serviceType.create({
      data: { code: KIND, sacCode: '998533', name: { en: `${MARK} kind`, te: 'పాత పేరు' } },
    });
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('who may', () => {
    it('refuses Supervisors, restaurant roles and anyone not logged in', async () => {
      const change = { name: 'Should not happen' };
      for (const token of [supervisor, sampleOwner]) {
        await http().get('/catalog').set(bearer(token)).expect(403);
        await http().post('/catalog/items').set(bearer(token)).send({ serviceCode: KIND, name: 'No', priceRupees: 1, durationMinutes: 30 }).expect(403);
        await http().patch(`/catalog/kinds/${KIND}`).set(bearer(token)).send(change).expect(403);
        await http().post(`/catalog/kinds/${KIND}/tasks`).set(bearer(token)).send({ label: 'Should not happen' }).expect(403);
        await http().patch(`/organizations/${client.id}`).set(bearer(token)).send(change).expect(403);
        await http().patch(`/organizations/${client.id}/outlets/${outlet.id}`).set(bearer(token)).send(change).expect(403);
        await http().post(`/organizations/${client.id}/outlets/${outlet.id}/new-code`).set(bearer(token)).expect(403);
        await http().get(`/organizations/${client.id}/phones`).set(bearer(token)).expect(403);
        await http().patch(`/organizations/${client.id}/owners/${ownerId}`).set(bearer(token)).send(change).expect(403);
        await http().post(`/organizations/${client.id}/owners/${ownerId}/reset-setup`).set(bearer(token)).expect(403);
      }
      await http().get('/catalog').expect(401);
      await http().patch(`/organizations/${client.id}`).send(change).expect(401);
      expect((await kind()).name.en).toBe(`${MARK} kind`);
    });
  });

  describe('the catalogue', () => {
    let itemId: string;
    let bookingId: string;

    it('lists every kind and service to an ECCS admin, with the sample ones untouched', async () => {
      const all = await catalogue();
      expect(all.kinds.map((entry) => entry.code)).toEqual(expect.arrayContaining(['PEST', 'DEEP_CLEAN', 'CHIMNEY', KIND]));
      expect(all.kinds.find((entry) => entry.code === 'PEST')!.tasks.length).toBeGreaterThan(0);
      expect(all.kinds.find((entry) => entry.code === KIND)!.tasks).toEqual([]);
      expect(all.items.length).toBeGreaterThanOrEqual(4);
    });

    it('adds a bookable service, in English, which restaurants then see', async () => {
      await http().post('/catalog/items').set(asAdmin()).send({ serviceCode: KIND, name: 'x', priceRupees: 100, durationMinutes: 30 }).expect(400);
      await http().post('/catalog/items').set(asAdmin()).send({ serviceCode: KIND, name: `${MARK} service`, priceRupees: '', durationMinutes: 30 }).expect(400);
      await http().post('/catalog/items').set(asAdmin()).send({ serviceCode: 'NO_SUCH_KIND', name: `${MARK} service`, priceRupees: 100, durationMinutes: 30 }).expect(404);

      const added = await http()
        .post('/catalog/items')
        .set(asAdmin())
        .send({ serviceCode: KIND, name: `${MARK} service`, description: 'A sample', priceRupees: 1500, durationMinutes: 60 })
        .expect(201);
      const item = (added.body as Catalogue).items.find((entry) => entry.name.en === `${MARK} service`)!;
      expect(item).toMatchObject({ serviceCode: KIND, pricePaise: 150_000, durationMinutes: 60, isActive: true, bookingCount: 0, description: { en: 'A sample' } });
      itemId = item.id;

      const offered = (await http().get('/services/catalog').set(bearer(sampleOwner)).expect(200)).body as { id: string }[];
      expect(offered.some((entry) => entry.id === itemId)).toBe(true);
    });

    it('changes a service nobody has booked where it is, price included', async () => {
      const changed = await http()
        .patch(`/catalog/items/${itemId}`)
        .set(asAdmin())
        .send({ name: `${MARK} service renamed`, description: '', priceRupees: '1750.50', durationMinutes: 90 })
        .expect(200);
      expect(changed.body.replacedById).toBeNull();
      const item = (changed.body.catalogue as Catalogue).items.find((entry) => entry.id === itemId)!;
      expect(item).toMatchObject({ name: { en: `${MARK} service renamed` }, description: null, pricePaise: 175_050, durationMinutes: 90 });
    });

    it('leaves a booked service and its price alone when the price changes, and offers a new one in its place', async () => {
      owner = (await otpLogin(PHONES.owner).then((r) => r.body)).token;
      const booked = await http()
        .post('/bookings')
        .set(bearer(owner))
        .send({ outletId: outlet.id, catalogItemId: itemId, preferredDate: daysAhead(3), preferredSlot: '1000' })
        .expect(201);
      bookingId = booked.body.id;
      expect(booked.body.pricePaise).toBe(175_050);

      // A new name alone is not a new price: the booked service is reworded where it is.
      const renamed = await http().patch(`/catalog/items/${itemId}`).set(asAdmin()).send({ name: `${MARK} service` }).expect(200);
      expect(renamed.body.replacedById).toBeNull();

      const repriced = await http().patch(`/catalog/items/${itemId}`).set(asAdmin()).send({ priceRupees: 2000 }).expect(200);
      const newId = repriced.body.replacedById as string;
      expect(newId).toBeTruthy();
      expect(newId).not.toBe(itemId);
      const items = (repriced.body.catalogue as Catalogue).items;
      expect(items.find((entry) => entry.id === itemId)).toMatchObject({ pricePaise: 175_050, isActive: false, bookingCount: 1 });
      expect(items.find((entry) => entry.id === newId)).toMatchObject({
        name: { en: `${MARK} service` },
        pricePaise: 200_000,
        durationMinutes: 90,
        isActive: true,
        bookingCount: 0,
      });

      // The request made earlier still shows what was agreed.
      const bookings = (await http().get('/bookings').query({ outletId: outlet.id }).set(bearer(owner)).expect(200)).body as { id: string; pricePaise: number }[];
      expect(bookings.find((entry) => entry.id === bookingId)!.pricePaise).toBe(175_050);

      // Restaurants are offered the new price only.
      const offered = (await http().get('/services/catalog').set(bearer(owner)).expect(200)).body as { id: string; pricePaise: number }[];
      expect(offered.some((entry) => entry.id === itemId)).toBe(false);
      expect(offered.find((entry) => entry.id === newId)!.pricePaise).toBe(200_000);
      itemId = newId;
    });

    it('stops offering a service without deleting it, and offers it again', async () => {
      const stopped = await http().patch(`/catalog/items/${itemId}`).set(asAdmin()).send({ isActive: false }).expect(200);
      expect((stopped.body.catalogue as Catalogue).items.find((entry) => entry.id === itemId)!.isActive).toBe(false);
      const offered = (await http().get('/services/catalog').set(bearer(owner)).expect(200)).body as { id: string }[];
      expect(offered.some((entry) => entry.id === itemId)).toBe(false);
      await http()
        .post('/bookings')
        .set(bearer(owner))
        .send({ outletId: outlet.id, catalogItemId: itemId, preferredDate: daysAhead(3), preferredSlot: '1000' })
        .expect(400);

      await http().patch(`/catalog/items/${itemId}`).set(asAdmin()).send({ isActive: true }).expect(200);
      await http().patch('/catalog/items/no-such-item').set(asAdmin()).send({ isActive: true }).expect(404);
    });

    it('renames a kind in English and keeps its other languages as they were', async () => {
      const renamed = await http().patch(`/catalog/kinds/${KIND}`).set(asAdmin()).send({ name: `${MARK} kind renamed` }).expect(200);
      expect((renamed.body as Catalogue).kinds.find((entry) => entry.code === KIND)!.name).toEqual({
        en: `${MARK} kind renamed`,
        te: 'పాత పేరు',
      });
    });

    it('switches a kind off, which takes it and its services off offer, and back on', async () => {
      await http().patch(`/catalog/kinds/${KIND}`).set(asAdmin()).send({ isActive: false }).expect(200);
      const types = (await http().get('/services/types').set(asAdmin()).expect(200)).body as { code: string }[];
      expect(types.some((type) => type.code === KIND)).toBe(false);
      const offered = (await http().get('/services/catalog').set(bearer(owner)).expect(200)).body as { id: string }[];
      expect(offered.some((entry) => entry.id === itemId)).toBe(false);
      await http().post('/visits').set(asAdmin()).send({ outletId: outlet.id, serviceCode: KIND, date: daysAhead(1), slot: '1000' }).expect(400);

      const back = await http().patch(`/catalog/kinds/${KIND}`).set(asAdmin()).send({ isActive: true }).expect(200);
      expect((back.body as Catalogue).kinds.find((entry) => entry.code === KIND)!.isActive).toBe(true);
    });
  });

  describe('a task list', () => {
    let oldVisitId: string;
    let retiredId: string;

    it('gives a kind without one its first tasks, in order', async () => {
      await http().post(`/catalog/kinds/${KIND}/tasks`).set(asAdmin()).send({ label: 'A' }).expect(400);
      for (const label of ['First task', 'Second task', 'Third task']) {
        await http().post(`/catalog/kinds/${KIND}/tasks`).set(asAdmin()).send({ label }).expect(201);
      }
      const now = await kind();
      expect(inUse(now)).toEqual(['First task', 'Second task', 'Third task']);
      expect(now.tasks.every((task) => Object.keys(task.label).join() === 'en')).toBe(true);
    });

    it('moves a task up and down one place', async () => {
      const [first, , third] = (await kind()).tasks;
      await http().post(`/catalog/tasks/${third!.id}/move`).set(asAdmin()).send({ direction: 'up' }).expect(200);
      expect(inUse(await kind())).toEqual(['First task', 'Third task', 'Second task']);
      // Already at the top: nothing changes and nothing fails.
      await http().post(`/catalog/tasks/${first!.id}/move`).set(asAdmin()).send({ direction: 'up' }).expect(200);
      expect(inUse(await kind())).toEqual(['First task', 'Third task', 'Second task']);
      await http().post(`/catalog/tasks/${first!.id}/move`).set(asAdmin()).send({ direction: 'down' }).expect(200);
      expect(inUse(await kind())).toEqual(['Third task', 'First task', 'Second task']);
      await http().post(`/catalog/tasks/${first!.id}/move`).set(asAdmin()).send({ direction: 'sideways' }).expect(400);
    });

    it('rewords a task in English and keeps its other languages', async () => {
      const task = (await kind()).tasks.find((entry) => entry.label.en === 'Second task')!;
      await prisma.client.checklistItem.update({ where: { id: task.id }, data: { label: { en: 'Second task', hi: 'पुराना' } } });
      const reworded = await http().patch(`/catalog/tasks/${task.id}`).set(asAdmin()).send({ label: 'Second task, reworded' }).expect(200);
      const now = (reworded.body as Catalogue).kinds.find((entry) => entry.code === KIND)!.tasks.find((entry) => entry.id === task.id)!;
      expect(now.label).toEqual({ en: 'Second task, reworded', hi: 'पुराना' });
      retiredId = task.id;
    });

    it('cannot reach checklist items that are not a service task', async () => {
      const daily = await prisma.client.checklistItem.findFirstOrThrow({ where: { template: { kind: 'DAILY' }, outletId: null } });
      await http().patch(`/catalog/tasks/${daily.id}`).set(asAdmin()).send({ isActive: false }).expect(404);
      await http().post(`/catalog/tasks/${daily.id}/move`).set(asAdmin()).send({ direction: 'up' }).expect(404);
      expect((await prisma.client.checklistItem.findUniqueOrThrow({ where: { id: daily.id } })).isActive).toBe(true);
    });

    it('keeps a retired task on a finished visit and leaves it off a new one', async () => {
      // A visit done while all three tasks were in use.
      oldVisitId = await addVisit();
      await http().post(`/visits/${oldVisitId}/check-in`).set(bearer(supervisor)).send({}).expect(200);
      for (const task of (await visit(oldVisitId)).tasks) {
        await http().put(`/visits/${oldVisitId}/tasks/${task.itemId}`).set(bearer(supervisor)).send({ done: true }).expect(200);
      }
      await http()
        .post(`/visits/${oldVisitId}/photos`)
        .set(bearer(supervisor))
        .field('kind', 'AFTER')
        .attach('file', PHOTO, { filename: 'visit.jpg', contentType: 'image/jpeg' })
        .expect(200);
      await http().post(`/visits/${oldVisitId}/complete`).set(bearer(supervisor)).expect(200);

      // Then one task is retired and another added.
      const retired = await http().patch(`/catalog/tasks/${retiredId}`).set(asAdmin()).send({ isActive: false }).expect(200);
      const task = (retired.body as Catalogue).kinds.find((entry) => entry.code === KIND)!.tasks.find((entry) => entry.id === retiredId)!;
      expect(task).toMatchObject({ isActive: false, answerCount: 1 });
      await http().post(`/catalog/tasks/${retiredId}/move`).set(asAdmin()).send({ direction: 'up' }).expect(400);
      await http().post(`/catalog/kinds/${KIND}/tasks`).set(asAdmin()).send({ label: 'Fourth task' }).expect(201);
      expect(inUse(await kind())).toEqual(['Third task', 'First task', 'Fourth task']);

      // The finished visit is as it was done: the retired task is there, the new one is not.
      const old = await visit(oldVisitId);
      expect(old.status).toBe('COMPLETED');
      expect(old.tasks.map((entry) => entry.label.en)).toEqual(['Third task', 'First task', 'Second task, reworded']);
      expect(old.tasks.every((entry) => entry.done === true)).toBe(true);

      // A new visit has today's list, and can be finished without the retired task.
      const newVisitId = await addVisit();
      expect((await visit(newVisitId)).tasks.map((entry) => entry.label.en)).toEqual(['Third task', 'First task', 'Fourth task']);
      await http().post(`/visits/${newVisitId}/check-in`).set(bearer(supervisor)).send({}).expect(200);
      await http().put(`/visits/${newVisitId}/tasks/${retiredId}`).set(bearer(supervisor)).send({ done: true }).expect(404);
    });

    it('brings a retired task back', async () => {
      await http().patch(`/catalog/tasks/${retiredId}`).set(asAdmin()).send({ isActive: true }).expect(200);
      expect(inUse(await kind())).toContain('Second task, reworded');
    });
  });

  describe('a client and its outlet', () => {
    it('changes the client’s name, legal name and GSTIN, and clears them', async () => {
      await http().patch(`/organizations/${client.id}`).set(asAdmin()).send({ gstin: '36ABC' }).expect(400);
      await http().patch(`/organizations/${client.id}`).set(asAdmin()).send({ name: '' }).expect(400);
      const changed = await http()
        .patch(`/organizations/${client.id}`)
        .set(asAdmin())
        .send({ name: `${MARK} Client Two`, legalName: `${MARK} Foods Pvt Ltd`, gstin: '36abcde1234f1z5' })
        .expect(200);
      expect(changed.body).toMatchObject({ name: `${MARK} Client Two`, legalName: `${MARK} Foods Pvt Ltd`, gstin: '36ABCDE1234F1Z5' });

      const cleared = await http().patch(`/organizations/${client.id}`).set(asAdmin()).send({ legalName: '', gstin: '' }).expect(200);
      expect(cleared.body).toMatchObject({ name: `${MARK} Client Two`, legalName: null, gstin: null });
      await http().patch('/organizations/no-such-client').set(asAdmin()).send({ name: 'x' }).expect(404);
    });

    it('changes the outlet’s name, address, city, PIN code and FSSAI number', async () => {
      const path = `/organizations/${client.id}/outlets/${outlet.id}`;
      await http().patch(path).set(asAdmin()).send({ pincode: '5000' }).expect(400);
      const changed = await http()
        .patch(path)
        .set(asAdmin())
        .send({ name: `${MARK} Outlet Two`, address: '2 Test Road', city: 'Secunderabad', pincode: '500003', fssaiNumber: '13619011000123' })
        .expect(200);
      expect((changed.body as Client).outlets[0]).toMatchObject({
        id: outlet.id,
        name: `${MARK} Outlet Two`,
        address: '2 Test Road',
        city: 'Secunderabad',
        pincode: '500003',
        fssaiNumber: '13619011000123',
        code: outlet.code,
      });
      const cleared = await http().patch(path).set(asAdmin()).send({ pincode: '', fssaiNumber: '' }).expect(200);
      expect((cleared.body as Client).outlets[0]).toMatchObject({ pincode: null, fssaiNumber: null });
      // An outlet is only reachable through its own client.
      const sample = await prisma.client.outlet.findUniqueOrThrow({ where: { code: SAMPLE.code } });
      await http().patch(`/organizations/${client.id}/outlets/${sample.id}`).set(asAdmin()).send({ name: 'x' }).expect(404);
    });

    it('changes the Owner’s name, number and email, refusing a number someone else has', async () => {
      const path = `/organizations/${client.id}/owners/${ownerId}`;
      await http().patch(path).set(asAdmin()).send({ phone: '12345' }).expect(400);
      await http().patch(path).set(asAdmin()).send({ phone: SAMPLE.ownerPhone }).expect(409);
      const changed = await http()
        .patch(path)
        .set(asAdmin())
        .send({ name: `${MARK} Owner Two`, phone: '91999 00012', email: 'Owner@E2E-Catalog.example' })
        .expect(200);
      expect((changed.body as Client).owners[0]).toMatchObject({ name: `${MARK} Owner Two`, phone: PHONES.ownerNew, email: 'owner@e2e-catalog.example' });

      // The one-time code now goes to the new number, and the old one is nobody's.
      expect((await otpLogin(PHONES.owner)).status).toBe(401);
      expect((await otpLogin(PHONES.ownerNew)).status).toBe(200);
      // Only an Owner of this client can be changed here.
      await http().patch(`/organizations/${client.id}/owners/${supervisorId}`).set(asAdmin()).send({ name: 'x' }).expect(404);
    });

    it('sends an Owner who lost their PIN back through the one-time-code set-up', async () => {
      const before = await otpLogin(PHONES.ownerNew);
      expect(before.body.generatedPin).toBeUndefined();
      const session = before.body.token as string;

      const reset = await http().post(`/organizations/${client.id}/owners/${ownerId}/reset-setup`).set(asAdmin()).expect(200);
      expect((reset.body as Client).owners[0]!.hasPin).toBe(false);
      await http().get('/auth/me').set(bearer(session)).expect(401);

      const after = await otpLogin(PHONES.ownerNew);
      expect(after.status).toBe(200);
      expect(after.body.generatedPin).toMatch(/^\d{4}$/);
      owner = after.body.token;
      const list = (await http().get('/organizations').set(asAdmin()).expect(200)).body as Client[];
      expect(list.find((entry) => entry.id === client.id)!.owners[0]!.hasPin).toBe(true);
    });
  });

  describe('restaurant codes and linked phones', () => {
    it('issues a new code: the old one links nothing more, phones already linked carry on', async () => {
      managerPhone = (await link(outlet.code).expect(200)).body.deviceToken;
      manager = (await pin(managerPhone, managerPin).expect(200)).body.token;

      const changed = await http().post(`/organizations/${client.id}/outlets/${outlet.id}/new-code`).set(asAdmin()).expect(200);
      const newCode = (changed.body as Client).outlets[0]!.code;
      expect(newCode).not.toBe(outlet.code);

      await link(outlet.code).expect(404);
      await http().get('/auth/me').set(bearer(manager)).expect(200);
      await pin(managerPhone, managerPin).expect(200);
      await link(newCode).expect(200);
      outlet = (changed.body as Client).outlets[0]!;
    });

    it('lists the phones linked to the client and unlinks one', async () => {
      const phones = (await http().get(`/organizations/${client.id}/phones`).set(asAdmin()).expect(200)).body as Phone[];
      // Two typed the outlet's code; the Owner's own phones have no outlet.
      expect(phones.filter((phone) => phone.outletId === outlet.id)).toHaveLength(2);
      expect(phones.some((phone) => phone.outletId === null)).toBe(true);

      const device = await prisma.client.session.findFirstOrThrow({
        where: { user: { name: `${MARK} Manager` }, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const left = await http().delete(`/organizations/${client.id}/phones/${device.linkedDeviceId}`).set(asAdmin()).expect(200);
      expect((left.body as Phone[]).some((phone) => phone.id === device.linkedDeviceId)).toBe(false);

      // Whoever was logged in on it is logged out, and the PIN no longer works from it.
      await http().get('/auth/me').set(bearer(manager)).expect(401);
      const refused = await pin(managerPhone, managerPin).expect(401);
      expect(refused.body.code).toBe('DEVICE_NOT_LINKED');
      await http().delete(`/organizations/${client.id}/phones/${device.linkedDeviceId}`).set(asAdmin()).expect(404);

      // Linked again with the code, the same PIN works: unlinking changed nobody's PIN.
      managerPhone = (await link(outlet.code).expect(200)).body.deviceToken;
      manager = (await pin(managerPhone, managerPin).expect(200)).body.token;
    });
  });

  describe('switching off', () => {
    it('an outlet: its staff cannot log in, it links no phones and takes no bookings or visits', async () => {
      const path = `/organizations/${client.id}/outlets/${outlet.id}`;
      const off = await http().patch(path).set(asAdmin()).send({ isActive: false }).expect(200);
      expect((off.body as Client).outlets[0]!.isActive).toBe(false);
      expect((off.body as Client).isActive).toBe(true);

      // The Manager is logged out at once, and the right PIN is refused with the reason.
      await http().get('/auth/me').set(bearer(manager)).expect(401);
      const refused = await pin(managerPhone, managerPin).expect(403);
      expect(refused.body.code).toBe('RESTAURANT_INACTIVE');
      await link(outlet.code).expect(404);

      // The Owner belongs to the client, not the outlet: still in, but with nothing to book for.
      await http().get('/auth/me').set(bearer(owner)).expect(200);
      const item = (await catalogue()).items.find((entry) => entry.serviceCode === KIND && entry.isActive)!;
      await http()
        .post('/bookings')
        .set(bearer(owner))
        .send({ outletId: outlet.id, catalogItemId: item.id, preferredDate: daysAhead(3), preferredSlot: '1000' })
        .expect(403);
      expect(((await http().get('/outlets').set(bearer(owner)).expect(200)).body as { id: string }[]).some((entry) => entry.id === outlet.id)).toBe(false);

      // ECCS cannot put a visit there, and it is off the list ECCS picks outlets from.
      await http().post('/visits').set(asAdmin()).send({ outletId: outlet.id, serviceCode: KIND, date: daysAhead(1), slot: '1000' }).expect(400);
      expect(((await http().get('/outlets').set(asAdmin()).expect(200)).body as { id: string }[]).some((entry) => entry.id === outlet.id)).toBe(false);
      // Nothing was deleted: it is still on the client, marked as off.
      const list = (await http().get('/organizations').set(asAdmin()).expect(200)).body as Client[];
      expect(list.find((entry) => entry.id === client.id)!.outlets[0]).toMatchObject({ id: outlet.id, isActive: false });
    });

    it('and on again, which restores everything', async () => {
      await http().patch(`/organizations/${client.id}/outlets/${outlet.id}`).set(asAdmin()).send({ isActive: true }).expect(200);
      manager = (await pin(managerPhone, managerPin).expect(200)).body.token;
      await link(outlet.code).expect(200);
      expect(((await http().get('/outlets').set(bearer(manager)).expect(200)).body as { id: string }[]).some((entry) => entry.id === outlet.id)).toBe(true);
    });

    it('a whole client: nobody there can log in, the Owner included, until it is switched back on', async () => {
      const off = await http().patch(`/organizations/${client.id}`).set(asAdmin()).send({ isActive: false }).expect(200);
      expect(off.body.isActive).toBe(false);

      await http().get('/auth/me').set(bearer(owner)).expect(401);
      await http().get('/auth/me').set(bearer(manager)).expect(401);
      expect((await pin(managerPhone, managerPin).expect(403)).body.code).toBe('RESTAURANT_INACTIVE');
      expect((await otpLogin(PHONES.ownerNew)).status).toBe(401);
      await link(outlet.code).expect(404);
      await http().post('/visits').set(asAdmin()).send({ outletId: outlet.id, serviceCode: KIND, date: daysAhead(1), slot: '1000' }).expect(400);

      const on = await http().patch(`/organizations/${client.id}`).set(asAdmin()).send({ isActive: true }).expect(200);
      expect(on.body.isActive).toBe(true);
      await http().get('/auth/me').set(bearer(owner)).expect(200);
      await pin(managerPhone, managerPin).expect(200);
    });
  });
});
