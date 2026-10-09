// Food labels: who may manage items and make labels, items retired rather than
// deleted once they have labels, the limits on a label's times, a Manager's or
// Owner's override, the list of what is in the fridge, and marking food used
// up or thrown away. Runs against the local database with the sample seed
// loaded. Works on a throwaway outlet with a throwaway Manager and Head Chef
// of its own and removes all of it.

import { writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FOOD_LABEL_RULES, type FoodItemDto, type FoodLabelBoardDto, type FoodLabelDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', otherChef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-food-labels';
const OUTLET_CODE = 'E2EFL-LB0001';
const PEOPLE = { manager: 'E2E Label Manager', chef: 'E2E Label Chef' };
const STAFF_NAME = 'E2E Label Cook';

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const ahead = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

describe('Food labels (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let owner: string;
  let manager: string;
  let chef: string;
  let otherChef: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  /** A two-day chilled item, and a label made for it. */
  let gravy: FoodItemDto;
  let label: FoodLabelDto;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const items = async (token: string, all = false): Promise<FoodItemDto[]> =>
    (await http().get('/food-labels/items').query({ outletId, ...(all && { all: '1' }) }).set(bearer(token)).expect(200)).body;
  const addItem = (token: string, body: Record<string, unknown>) =>
    http().post('/food-labels/items').set(bearer(token)).send({ outletId, ...body });
  const make = (token: string, body: Record<string, unknown>) => http().post('/food-labels/labels').set(bearer(token)).send(body);
  const board = async (token: string): Promise<FoodLabelBoardDto> =>
    (await http().get('/food-labels/labels').query({ outletId }).set(bearer(token)).expect(200)).body;
  const close = (token: string, id: string, body: Record<string, unknown>) =>
    http().post(`/food-labels/labels/${id}/close`).set(bearer(token)).send(body);
  const ids = (labels: FoodLabelDto[]) => labels.map((entry) => entry.id);

  async function cleanUp() {
    const db = prisma.client;
    const outlet = await db.outlet.findUnique({ where: { code: OUTLET_CODE }, select: { id: true } });
    const names = Object.values(PEOPLE);
    await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { user: { name: { in: names } } }] } });
    if (outlet) {
      await db.foodLabel.deleteMany({ where: { outletId: outlet.id } });
      await db.foodItem.deleteMany({ where: { outletId: outlet.id } });
      await db.staffMember.deleteMany({ where: { outletId: outlet.id } });
      await db.linkedDevice.deleteMany({ where: { outletId: outlet.id } });
      await db.user.deleteMany({ where: { name: { in: names } } });
      await db.hygieneScoreSnapshot.deleteMany({ where: { outletId: outlet.id } });
      await db.outlet.delete({ where: { id: outlet.id } });
    }
    await db.user.deleteMany({ where: { name: { in: names } } });
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

  /** A new login at the throwaway outlet, logged in on a phone linked to it. */
  async function newLogin(name: string, role: 'MANAGER' | 'HEAD_CHEF'): Promise<string> {
    const created = await http()
      .post('/restaurant-users')
      .set(bearer(owner))
      .send({ name, role, outletId, language: 'EN' })
      .expect(201);
    return pinLogin(OUTLET_CODE, created.body.pin as string);
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();

    const seeded = await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    // A second outlet of the same sample restaurant, with no items and no labels.
    outletId = (
      await prisma.client.outlet.create({
        data: { organizationId: seeded.organizationId, name: 'E2E label kitchen', code: OUTLET_CODE, address: 'Test Road' },
      })
    ).id;
    await prisma.client.staffMember.create({ data: { outletId, name: STAFF_NAME, monthlySalaryPaise: 0 } });

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    manager = await newLogin(PEOPLE.manager, 'MANAGER');
    chef = await newLogin(PEOPLE.chef, 'HEAD_CHEF');
    otherChef = await pinLogin(CODES.kukatpally, PINS.otherChef);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  // ───────────────────────── Items ─────────────────────────

  describe('items', () => {
    it('needs a login', async () => {
      await http().get('/food-labels/items').query({ outletId }).expect(401);
      await http().post('/food-labels/labels').send({ foodItemId: 'x' }).expect(401);
    });

    it('lets the Owner and the Manager add items, and not the Head Chef, another outlet or ECCS', async () => {
      const body = { name: 'E2E gravy base', storage: 'CHILLED', shelfLifeHours: 48, allergens: ['TREE_NUT', 'MILK'], note: 'Blue tub' };
      await addItem(chef, body).expect(403);
      await addItem(otherManager, body).expect(403);
      await addItem(admin, body).expect(403);
      await addItem(supervisor, body).expect(403);

      gravy = (await addItem(manager, body).expect(201)).body;
      expect(gravy).toMatchObject({
        outletId,
        name: 'E2E gravy base',
        storage: 'CHILLED',
        shelfLifeHours: 48,
        // In the standard order, whatever order they were sent in.
        allergens: ['MILK', 'TREE_NUT'],
        note: 'Blue tub',
        isActive: true,
        labelCount: 0,
        lastUsedAt: null,
      });
      await addItem(owner, { name: 'E2E fried onions', storage: 'AMBIENT', shelfLifeHours: 168, starterKey: 'fried-onions' }).expect(201);
    });

    it('checks what an item is given', async () => {
      const body = { name: 'E2E bad item', storage: 'CHILLED', shelfLifeHours: 24 };
      await addItem(manager, { ...body, name: '' }).expect(400);
      await addItem(manager, { ...body, storage: 'WARM' }).expect(400);
      await addItem(manager, { ...body, shelfLifeHours: 0 }).expect(400);
      await addItem(manager, { ...body, shelfLifeHours: FOOD_LABEL_RULES.maxShelfLifeHours + 1 }).expect(400);
      await addItem(manager, { ...body, allergens: ['GLASS'] }).expect(400);
      // The same name twice on one list would make the wrong one easy to pick.
      await addItem(manager, { ...body, name: 'e2e GRAVY base' }).expect(409);
    });

    it('lets everyone at the outlet read the items, ECCS admins too, and nobody from elsewhere', async () => {
      for (const token of [owner, manager, chef, admin]) {
        expect((await items(token)).map((item) => item.name).sort()).toEqual(['E2E fried onions', 'E2E gravy base']);
      }
      await http().get('/food-labels/items').query({ outletId }).set(bearer(otherChef)).expect(403);
      await http().get('/food-labels/items').query({ outletId }).set(bearer(otherManager)).expect(403);
      await http().get('/food-labels/items').query({ outletId }).set(bearer(supervisor)).expect(403);
      await http().get('/food-labels/items').set(bearer(owner)).expect(400);
    });

    it('lets the Manager change an item and not the Head Chef', async () => {
      await http().patch(`/food-labels/items/${gravy.id}`).set(bearer(chef)).send({ shelfLifeHours: 72 }).expect(403);
      await http().patch(`/food-labels/items/${gravy.id}`).set(bearer(otherManager)).send({ shelfLifeHours: 72 }).expect(404);
      const changed = (
        await http().patch(`/food-labels/items/${gravy.id}`).set(bearer(manager)).send({ note: '', allergens: ['MILK'] }).expect(200)
      ).body as FoodItemDto;
      expect(changed).toMatchObject({ note: null, allergens: ['MILK'], shelfLifeHours: 48, name: 'E2E gravy base' });
      gravy = changed;
    });

    it('deletes an item that never had a label', async () => {
      const spare = (await addItem(manager, { name: 'E2E spare item', storage: 'FROZEN', shelfLifeHours: 720 }).expect(201)).body as FoodItemDto;
      await http().delete(`/food-labels/items/${spare.id}`).set(bearer(chef)).expect(403);
      const removed = (await http().delete(`/food-labels/items/${spare.id}`).set(bearer(manager)).expect(200)).body;
      expect(removed).toEqual({ deleted: true, item: null });
      expect(await prisma.client.foodItem.count({ where: { id: spare.id } })).toBe(0);
    });

    it('offers the outlet’s logins and staff list as "prepared by"', async () => {
      const people = (await http().get('/food-labels/people').query({ outletId }).set(bearer(chef)).expect(200)).body as { names: string[] };
      expect(people.names).toEqual(expect.arrayContaining([PEOPLE.manager, PEOPLE.chef, STAFF_NAME]));
      // The restaurant's Owner covers every outlet, so is offered too.
      expect(people.names.length).toBeGreaterThanOrEqual(4);
      await http().get('/food-labels/people').query({ outletId }).set(bearer(otherChef)).expect(403);
    });
  });

  // ───────────────────────── Making a label ─────────────────────────

  describe('making a label', () => {
    it('sets prepared to now and use-by from the shelf life', async () => {
      const before = Date.now();
      label = (await make(chef, { foodItemId: gravy.id }).expect(201)).body;
      const prepared = Date.parse(label.preparedAt);
      expect(prepared).toBeGreaterThanOrEqual(before - 1000);
      expect(prepared).toBeLessThanOrEqual(Date.now() + 1000);
      expect(Date.parse(label.expiresAt) - prepared).toBe(48 * HOUR);
      expect(label).toMatchObject({
        outletId,
        foodItemId: gravy.id,
        itemName: 'E2E gravy base',
        storage: 'CHILLED',
        allergens: ['MILK'],
        preparedByName: PEOPLE.chef,
        quantityNote: null,
        copies: 1,
        status: 'LIVE',
        group: 'LATER',
        overrideReason: null,
        printedAt: null,
      });
    });

    it('lets all three roles make labels, with another name, a batch note and copies', async () => {
      const made = (
        await make(manager, { foodItemId: gravy.id, preparedByName: STAFF_NAME, quantityNote: '2 kg', copies: 3 }).expect(201)
      ).body as FoodLabelDto;
      expect(made).toMatchObject({ preparedByName: STAFF_NAME, quantityNote: '2 kg', copies: 3 });
      await make(owner, { foodItemId: gravy.id }).expect(201);

      // Not from another outlet, and not ECCS (who may only read).
      await make(otherChef, { foodItemId: gravy.id }).expect(404);
      await make(admin, { foodItemId: gravy.id }).expect(403);
      await make(supervisor, { foodItemId: gravy.id }).expect(403);
      await make(chef, { foodItemId: 'no-such-item' }).expect(404);
      await make(chef, { foodItemId: gravy.id, copies: FOOD_LABEL_RULES.maxCopies + 1 }).expect(400);
    });

    it('lets prepared be set back up to a day, never into the future, with use-by counted from it', async () => {
      const earlier = ago(6);
      const made = (await make(chef, { foodItemId: gravy.id, preparedAt: earlier }).expect(201)).body as FoodLabelDto;
      expect(made.preparedAt).toBe(earlier);
      expect(Date.parse(made.expiresAt) - Date.parse(earlier)).toBe(48 * HOUR);

      const tooOld = await make(chef, { foodItemId: gravy.id, preparedAt: ago(FOOD_LABEL_RULES.maxBackdateHours + 1) }).expect(400);
      expect(tooOld.body.code).toBe('PREPARED_TOO_OLD');
      const future = await make(chef, { foodItemId: gravy.id, preparedAt: ahead(1) }).expect(400);
      expect(future.body.code).toBe('PREPARED_IN_FUTURE');
    });

    it('accepts a shorter use-by and refuses one at or before the prepared time', async () => {
      const made = (await make(chef, { foodItemId: gravy.id, expiresAt: ahead(5) }).expect(201)).body as FoodLabelDto;
      expect(Date.parse(made.expiresAt) - Date.parse(made.preparedAt)).toBeLessThan(48 * HOUR);
      const backwards = await make(chef, { foodItemId: gravy.id, expiresAt: ago(1) }).expect(400);
      expect(backwards.body.code).toBe('USE_BY_BEFORE_PREPARED');
    });

    it('refuses a Head Chef a use-by later than the shelf life allows, with or without a reason', async () => {
      const refused = await make(chef, { foodItemId: gravy.id, expiresAt: ahead(60) }).expect(403);
      expect(refused.body.code).toBe('OVERRIDE_NOT_ALLOWED');
      await make(chef, { foodItemId: gravy.id, expiresAt: ahead(60), overrideReason: 'Vacuum packed' }).expect(403);
      // Prepared six hours ago, so 48 hours from now is already past the shelf life.
      await make(chef, { foodItemId: gravy.id, preparedAt: ago(6), expiresAt: ahead(48) }).expect(403);
    });

    it('lets a Manager or the Owner go past the shelf life, but only with a reason', async () => {
      const noReason = await make(manager, { foodItemId: gravy.id, expiresAt: ahead(60) }).expect(400);
      expect(noReason.body.code).toBe('OVERRIDE_NEEDS_REASON');
      await make(manager, { foodItemId: gravy.id, expiresAt: ahead(60), overrideReason: '   ' }).expect(400);

      const made = (
        await make(manager, { foodItemId: gravy.id, expiresAt: ahead(60), overrideReason: 'Vacuum packed' }).expect(201)
      ).body as FoodLabelDto;
      expect(made).toMatchObject({ overrideReason: 'Vacuum packed', overrideByName: PEOPLE.manager });
      await make(owner, { foodItemId: gravy.id, expiresAt: ahead(60), overrideReason: 'Tested by the chef' }).expect(201);

      // Even they cannot go beyond about a year.
      const tooFar = await make(owner, {
        foodItemId: gravy.id,
        expiresAt: ahead((FOOD_LABEL_RULES.maxUseByDays + 2) * 24),
        overrideReason: 'Pickle',
      }).expect(400);
      expect(tooFar.body.code).toBe('USE_BY_TOO_FAR');
      // A reason given when none was needed is not kept.
      const plain = (await make(manager, { foodItemId: gravy.id, overrideReason: 'Not needed' }).expect(201)).body as FoodLabelDto;
      expect(plain.overrideReason).toBeNull();
    });

    it('makes one label when the same one is sent twice from a phone that had no signal', async () => {
      const queued = { foodItemId: gravy.id, clientId: 'e2e-label-queued-0001', madeAt: ago(30), preparedAt: ago(40) };
      // Made 30 hours ago on the phone, prepared 10 hours before that: inside the limit as it stood then.
      const first = (await make(chef, queued).expect(201)).body as FoodLabelDto;
      const [again, both] = await Promise.all([make(chef, queued).expect(201), make(chef, queued).expect(201)]);
      expect(again.body.id).toBe(first.id);
      expect(both.body.id).toBe(first.id);
      expect(await prisma.client.foodLabel.count({ where: { clientId: queued.clientId } })).toBe(1);

      // Without the phone's own id, the same times are simply too old.
      await make(chef, { foodItemId: gravy.id, preparedAt: ago(40) }).expect(400);
      // And a label that waited longer than the queue allows is refused.
      const stale = await make(chef, {
        foodItemId: gravy.id,
        clientId: 'e2e-label-queued-0002',
        madeAt: ago(FOOD_LABEL_RULES.maxQueuedHours + 1),
      }).expect(400);
      expect(stale.body.code).toBe('QUEUED_TOO_LONG');
    });

    it('notes when a label was printed', async () => {
      const printed = (await http().post(`/food-labels/labels/${label.id}/printed`).set(bearer(chef)).expect(200)).body as FoodLabelDto;
      expect(printed.printedAt).not.toBeNull();
      await http().post(`/food-labels/labels/${label.id}/printed`).set(bearer(otherChef)).expect(404);
    });
  });

  // ───────────────────────── Retiring ─────────────────────────

  describe('an item with labels', () => {
    it('is retired, not deleted, and its labels stay', async () => {
      const withLabels = (await items(manager)).find((item) => item.id === gravy.id)!;
      expect(withLabels.labelCount).toBeGreaterThan(0);
      expect(withLabels.lastUsedAt).not.toBeNull();
      // Most recently used first.
      expect((await items(manager))[0]!.id).toBe(gravy.id);

      const removed = (await http().delete(`/food-labels/items/${gravy.id}`).set(bearer(manager)).expect(200)).body;
      expect(removed.deleted).toBe(false);
      expect(removed.item).toMatchObject({ id: gravy.id, isActive: false });
      expect(await prisma.client.foodItem.count({ where: { id: gravy.id } })).toBe(1);
      expect(await prisma.client.foodLabel.count({ where: { foodItemId: gravy.id } })).toBe(withLabels.labelCount);

      // Gone from the list people choose from, still there when retired ones are asked for.
      expect((await items(chef)).map((item) => item.id)).not.toContain(gravy.id);
      expect((await items(manager, true)).find((item) => item.id === gravy.id)).toMatchObject({ isActive: false });
      // The label already on the shelf is still on the list.
      expect(ids((await board(chef)).later)).toContain(label.id);
    });

    it('cannot be used for a new label while retired, and can be brought back', async () => {
      await make(chef, { foodItemId: gravy.id }).expect(409);
      await http().patch(`/food-labels/items/${gravy.id}`).set(bearer(chef)).send({ isActive: true }).expect(403);
      const back = (await http().patch(`/food-labels/items/${gravy.id}`).set(bearer(owner)).send({ isActive: true }).expect(200)).body;
      expect(back.isActive).toBe(true);
      await make(chef, { foodItemId: gravy.id }).expect(201);
    });

    it('keeps the name a label was printed with when the item is renamed', async () => {
      await http().patch(`/food-labels/items/${gravy.id}`).set(bearer(manager)).send({ name: 'E2E gravy base (new)', storage: 'FROZEN' }).expect(200);
      const old = [...(await board(chef)).later].find((entry) => entry.id === label.id)!;
      expect(old).toMatchObject({ itemName: 'E2E gravy base', storage: 'CHILLED' });
      const fresh = (await make(chef, { foodItemId: gravy.id }).expect(201)).body as FoodLabelDto;
      expect(fresh).toMatchObject({ itemName: 'E2E gravy base (new)', storage: 'FROZEN' });
    });
  });

  // ───────────────────────── The fridge list ─────────────────────────

  describe('what is in the fridge now', () => {
    let expired: string;
    let today: string | null = null;

    beforeAll(async () => {
      // Labels cannot be made already expired, so their times are set straight in the database.
      const base = { outletId, foodItemId: gravy.id, itemName: 'E2E old gravy', preparedByName: 'Test' };
      expired = (
        await prisma.client.foodLabel.create({ data: { ...base, preparedAt: new Date(ago(50)), expiresAt: new Date(ago(2)) } })
      ).id;
      // One that runs out a minute from now is "today", unless this very minute is the last before midnight in India.
      const soon = new Date(Date.now() + 60_000);
      const sameDay = (date: Date) => new Date(date.getTime() + 5.5 * HOUR).toISOString().slice(0, 10);
      if (sameDay(soon) === sameDay(new Date())) {
        today = (await prisma.client.foodLabel.create({ data: { ...base, preparedAt: new Date(ago(47)), expiresAt: soon } })).id;
      }
    });

    it('groups live labels as expired, use today and later, soonest first', async () => {
      const list = await board(chef);
      expect(list.outletId).toBe(outletId);
      expect(ids(list.expired)).toEqual([expired]);
      expect(list.expired[0]).toMatchObject({ group: 'EXPIRED', status: 'LIVE' });
      // Labels made earlier in this run with a few hours of life may also fall due today.
      if (today) expect(ids(list.today)[0]).toBe(today);
      for (const entry of list.today) expect(entry.group).toBe('TODAY');
      expect(ids(list.later)).toContain(label.id);
      for (const group of [list.expired, list.today, list.later]) {
        const times = group.map((entry) => Date.parse(entry.expiresAt));
        expect(times).toEqual([...times].sort((a, b) => a - b));
      }
      for (const entry of list.later) expect(Date.parse(entry.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('counts the two numbers for Home', async () => {
      const counts = (await http().get('/food-labels/counts').query({ outletId }).set(bearer(chef)).expect(200)).body;
      const list = await board(chef);
      expect(counts).toEqual({ outletId, expired: 1, today: list.today.length });
      if (today) expect(counts.today).toBeGreaterThanOrEqual(1);
    });

    it('is read by everyone at the outlet and ECCS admins, and by nobody else', async () => {
      for (const token of [owner, manager, admin]) expect(ids((await board(token)).expired)).toEqual([expired]);
      await http().get('/food-labels/labels').query({ outletId }).set(bearer(otherChef)).expect(403);
      await http().get('/food-labels/labels').query({ outletId }).set(bearer(supervisor)).expect(403);
      await http().get('/food-labels/counts').query({ outletId }).set(bearer(otherManager)).expect(403);
    });

    it('needs a reason to throw food away', async () => {
      await close(chef, expired, { outcome: 'DISCARDED' }).expect(400);
      await close(chef, expired, { outcome: 'DISCARDED', reason: 'LOST' }).expect(400);
      await close(chef, expired, { outcome: 'EATEN' }).expect(400);
      await close(otherChef, expired, { outcome: 'USED' }).expect(404);
      await close(admin, expired, { outcome: 'USED' }).expect(403);
    });

    it('takes a thrown-away label off the list, with who and why', async () => {
      const closed = (await close(chef, expired, { outcome: 'DISCARDED', reason: 'EXPIRED', note: 'Smelt off' }).expect(200)).body as FoodLabelDto;
      expect(closed).toMatchObject({
        status: 'DISCARDED',
        group: null,
        discardReason: 'EXPIRED',
        closeNote: 'Smelt off',
        closedByName: PEOPLE.chef,
      });
      expect(closed.closedAt).not.toBeNull();
      expect((await board(chef)).expired).toEqual([]);
      expect((await http().get('/food-labels/counts').query({ outletId }).set(bearer(chef)).expect(200)).body.expired).toBe(0);
      // Marked once only.
      await close(manager, expired, { outcome: 'USED' }).expect(409);
    });

    it('takes a used-up label off the list, and puts it back if that was a mistake', async () => {
      const used = (await close(manager, label.id, { outcome: 'USED' }).expect(200)).body as FoodLabelDto;
      expect(used).toMatchObject({ status: 'USED', discardReason: null, closedByName: PEOPLE.manager });
      expect(ids((await board(chef)).later)).not.toContain(label.id);

      await http().post(`/food-labels/labels/${label.id}/reopen`).set(bearer(otherChef)).expect(404);
      const back = (await http().post(`/food-labels/labels/${label.id}/reopen`).set(bearer(chef)).expect(200)).body as FoodLabelDto;
      expect(back).toMatchObject({ status: 'LIVE', closedAt: null, closedByName: null });
      expect(ids((await board(chef)).later)).toContain(label.id);
    });

    it('does not put a label back once the few minutes for undoing have passed', async () => {
      await close(chef, label.id, { outcome: 'DISCARDED', reason: 'SPOILED' }).expect(200);
      await prisma.client.foodLabel.update({
        where: { id: label.id },
        data: { closedAt: new Date(Date.now() - (FOOD_LABEL_RULES.undoMinutes + 1) * 60_000) },
      });
      await http().post(`/food-labels/labels/${label.id}/reopen`).set(bearer(chef)).expect(409);
    });
  });

  // ───────────────────────── The picture ─────────────────────────

  describe('the label as a picture', () => {
    const data = {
      itemName: 'అల్లం-వెల్లుల్లి పేస్ట్',
      preparedHeading: 'Prepared',
      preparedText: 'Fri, 9 Oct, 4:30 pm',
      useByHeading: 'Use by',
      useByText: 'Mon, 12 Oct, 4:30 pm',
      dayWord: 'Monday',
      dayIndex: 1,
      lines: ['By Ravi', 'Chilled'],
      outletName: 'E2E label kitchen',
      rtl: false,
    };

    it('is drawn as a PNG at a thermal printer’s dots', async () => {
      const drawn = await http().post('/food-labels/render').set(bearer(chef)).send({ size: 'L50X30', label: data });
      // A server with no browser installed cannot draw; everything else about labels still works.
      if (drawn.status === 503) return;
      expect(drawn.status).toBe(200);
      expect(drawn.body).toMatchObject({ widthPx: 400, heightPx: 240 });
      const png = Buffer.from(drawn.body.pngBase64 as string, 'base64');
      expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      // The picture's own header gives its size: width and height, four bytes each, from byte 16.
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([400, 240]);
      // Set FOOD_LABEL_SAMPLE=<path ending .png> to keep a copy to look at.
      if (process.env.FOOD_LABEL_SAMPLE) writeFileSync(process.env.FOOD_LABEL_SAMPLE, png);
    }, 60_000);

    it('is refused for a size that is not a label, bad wording, and people with no labels', async () => {
      await http().post('/food-labels/render').set(bearer(chef)).send({ size: 'A4', label: data }).expect(400);
      await http().post('/food-labels/render').set(bearer(chef)).send({ size: 'L50X30', label: { ...data, dayIndex: 9 } }).expect(400);
      await http().post('/food-labels/render').set(bearer(supervisor)).send({ size: 'L50X30', label: data }).expect(403);
    });
  });
});
