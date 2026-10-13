// The vendor directory: who may read it, that the list is the nearest first
// from the outlet's saved place with the right distances, and what happens
// when the outlet has no saved place. Runs against the local database with the
// sample seed loaded.
//
// It makes its own throwaway vendors (codes starting "e2e-") and two throwaway
// outlets of Deccan Biryani, one with a saved place and one without, and
// removes them all afterwards. It does not depend on which sample vendors are
// loaded: where they would get in the way, the answers are narrowed to the
// vendors made here.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { metresBetween, VENDOR_RULES } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', otherManager: '4821' };
const PHONES = { admin: '+919000000002', supervisor: '+919000000003' };
const DEVICE = 'e2e-vendors';
const OUTLET_CODE = 'E2EVD-PL0001';
const NO_PLACE_CODE = 'E2EVD-NP0002';
const MANAGER_NAME = 'E2E Vendors Manager';
const CHEF_NAME = 'E2E Vendors Chef';
const VENDOR_PREFIX = 'e2e-';

// Where the throwaway outlet is, and the throwaway vendors around it. Their names run
// the other way from their distances, so name order and nearest-first cannot be confused.
const PLACE = { latitude: 17.4, longitude: 78.4 };
const NEAR = { code: 'e2e-near', name: 'E2E Zulu Vendor', latitude: 17.41, longitude: 78.4 }; // 0.01 degrees north
const MIDDLE = { code: 'e2e-middle', name: 'E2E Mike Vendor', latitude: 17.4, longitude: 78.43 }; // 0.03 degrees east
const FAR = { code: 'e2e-far', name: 'E2E Alpha Vendor', latitude: 17.5, longitude: 78.4 }; // 0.1 degrees north
const UNPLACED = { code: 'e2e-unplaced', name: 'E2E Bravo Vendor', latitude: null, longitude: null };
const CLOSED = { code: 'e2e-closed', name: 'E2E Closed Vendor', latitude: 17.401, longitude: 78.4 };

type Vendor = {
  id: string;
  name: string;
  categories: string[];
  sells: Record<string, string> | null;
  area: string;
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  whatsapp: string | null;
  delivers: boolean;
  minOrderPaise: number | null;
  hours: Record<string, string> | null;
  fssaiNumber: string | null;
  isSample: boolean;
  distanceMetres: number | null;
};
type Directory = { outletId: string; outletHasPlace: boolean; nearbyMetres: number; vendors: Vendor[] };

describe('Vendor directory (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let noPlaceOutletId: string;
  let seededOutletId: string;
  let owner: string;
  let manager: string;
  let chef: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;
  /** The ids of the vendors made here, by their code. */
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const list = (token: string, outlet: string | null = outletId) =>
    http().get('/vendors').query(outlet ? { outletId: outlet } : {}).set(bearer(token));
  const one = (token: string, id: string, outlet: string | null = outletId) =>
    http().get(`/vendors/${id}`).query(outlet ? { outletId: outlet } : {}).set(bearer(token));
  /** The vendors made here, in the order the answer lists them. */
  const ours = (directory: Directory) => directory.vendors.filter((vendor) => Object.values(ids).includes(vendor.id));
  const distanceTo = (vendor: { latitude: number; longitude: number }) =>
    metresBetween(PLACE.latitude, PLACE.longitude, vendor.latitude, vendor.longitude);

  async function cleanUp() {
    const db = prisma.client;
    const names = [MANAGER_NAME, CHEF_NAME];
    await db.vendor.deleteMany({ where: { code: { startsWith: VENDOR_PREFIX } } });
    await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { user: { name: { in: names } } }] } });
    // Memberships go with their user.
    await db.user.deleteMany({ where: { name: { in: names } } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    for (const code of [OUTLET_CODE, NO_PLACE_CODE]) {
      const outlet = await db.outlet.findUnique({ where: { code }, select: { id: true } });
      if (!outlet) continue;
      // A server running alongside may have kept a score for the outlet.
      await db.hygieneScoreSnapshot.deleteMany({ where: { outletId: outlet.id } });
      await db.outlet.delete({ where: { id: outlet.id } });
    }
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

  /** A throwaway login at the throwaway outlet, made by the Owner as in the app. */
  async function newLogin(name: string, role: 'MANAGER' | 'HEAD_CHEF'): Promise<string> {
    const made = await http().post('/restaurant-users').set(bearer(owner)).send({ name, role, outletId }).expect(201);
    return pinLogin(OUTLET_CODE, made.body.pin as string);
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();
    const db = prisma.client;

    const seeded = await db.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    seededOutletId = seeded.id;
    const outlet = (name: string, code: string, place: { latitude: number; longitude: number } | null) =>
      db.outlet.create({ data: { organizationId: seeded.organizationId, name, code, address: 'Test Road', ...place } });
    outletId = (await outlet('E2E vendors outlet', OUTLET_CODE, PLACE)).id;
    noPlaceOutletId = (await outlet('E2E vendors outlet with no place', NO_PLACE_CODE, null)).id;

    for (const vendor of [NEAR, MIDDLE, FAR, UNPLACED, CLOSED]) {
      const made = await db.vendor.create({
        data: {
          ...vendor,
          // One category this version does not know, which must not reach the app.
          categories: vendor === NEAR ? ['DAIRY', 'NOT_A_CATEGORY'] : ['PACKAGING'],
          sells: { en: `What ${vendor.name} sells` },
          area: 'Test Area',
          city: 'Hyderabad',
          address: vendor === NEAR ? 'Shop 1, Test Road' : null,
          phone: '+91 90000 09901',
          whatsapp: vendor === NEAR ? '+91 90000 09902' : null,
          delivers: vendor === NEAR,
          minOrderPaise: vendor === NEAR ? 150000 : null,
          ...(vendor === NEAR && { hours: { en: '6 am to 6 pm' } }),
          fssaiNumber: vendor === NEAR ? '13600000009901' : null,
          isSample: true,
          isActive: vendor !== CLOSED,
        },
      });
      ids[vendor.code] = made.id;
    }

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    manager = await newLogin(MANAGER_NAME, 'MANAGER');
    chef = await newLogin(CHEF_NAME, 'HEAD_CHEF');
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('who may read', () => {
    it('answers the Owner and the Manager of the outlet', async () => {
      for (const token of [owner, manager]) {
        const directory = (await list(token).expect(200)).body as Directory;
        expect(directory).toMatchObject({ outletId, outletHasPlace: true, nearbyMetres: VENDOR_RULES.nearbyMetres });
        expect(ours(directory)).toHaveLength(4);
        await one(token, ids[NEAR.code]!).expect(200);
      }
      // The Owner covers every outlet of the restaurant; a Manager only their own.
      await list(owner, seededOutletId).expect(200);
      await list(owner, noPlaceOutletId).expect(200);
      await list(manager, seededOutletId).expect(403);
      await list(manager, noPlaceOutletId).expect(403);
      await one(manager, ids[NEAR.code]!, seededOutletId).expect(403);
    });

    it('refuses the Head Chef, ECCS admins and a Supervisor', async () => {
      for (const token of [chef, admin, supervisor]) {
        await list(token).expect(403);
        await one(token, ids[NEAR.code]!).expect(403);
      }
    });

    it('refuses a Manager of another restaurant for this outlet, and anyone not logged in', async () => {
      await list(otherManager).expect(403);
      await one(otherManager, ids[NEAR.code]!).expect(403);
      await list(otherManager, noPlaceOutletId).expect(403);

      await http().get('/vendors').query({ outletId }).expect(401);
      await http().get(`/vendors/${ids[NEAR.code]!}`).query({ outletId }).expect(401);
    });

    it('needs an outlet to measure from, and one that exists', async () => {
      await list(owner, null).expect(400);
      await one(owner, ids[NEAR.code]!, null).expect(400);
      await list(owner, 'no-such-outlet').expect(403);
      await one(owner, ids[NEAR.code]!, 'no-such-outlet').expect(403);
    });
  });

  describe('the list', () => {
    it('is the nearest first, with the right distances', async () => {
      const directory = (await list(owner).expect(200)).body as Directory;
      const mine = ours(directory);
      expect(mine.map((vendor) => vendor.name)).toEqual([NEAR.name, MIDDLE.name, FAR.name, UNPLACED.name]);
      expect(mine.map((vendor) => vendor.distanceMetres)).toEqual([distanceTo(NEAR), distanceTo(MIDDLE), distanceTo(FAR), null]);
      // One hundredth of a degree of latitude is 1,112 metres anywhere; a tenth is ten times that.
      expect(mine[0]!.distanceMetres).toBe(1112);
      expect(mine[2]!.distanceMetres).toBe(11119);
      expect(mine[1]!.distanceMetres).toBeGreaterThan(3100);
      expect(mine[1]!.distanceMetres).toBeLessThan(3300);

      // The whole answer, whatever else is loaded: measured vendors by distance, then those with no place.
      const distances = directory.vendors.map((vendor) => vendor.distanceMetres);
      const measured = distances.filter((distance): distance is number => distance !== null);
      expect(distances.slice(0, measured.length)).toEqual(measured);
      expect(measured).toEqual([...measured].sort((a, b) => a - b));
      expect(directory.vendors.length).toBeLessThanOrEqual(VENDOR_RULES.maxListed);
    });

    it('gives each vendor exactly what the app shows, and nothing else', async () => {
      const directory = (await list(manager).expect(200)).body as Directory;
      expect(ours(directory)[0]).toEqual({
        id: ids[NEAR.code],
        name: NEAR.name,
        categories: ['DAIRY'],
        sells: { en: `What ${NEAR.name} sells` },
        area: 'Test Area',
        city: 'Hyderabad',
        address: 'Shop 1, Test Road',
        latitude: NEAR.latitude,
        longitude: NEAR.longitude,
        phone: '+91 90000 09901',
        whatsapp: '+91 90000 09902',
        delivers: true,
        minOrderPaise: 150000,
        hours: { en: '6 am to 6 pm' },
        fssaiNumber: '13600000009901',
        isSample: true,
        distanceMetres: 1112,
      });
      expect(ours(directory)[3]).toMatchObject({ whatsapp: null, hours: null, fssaiNumber: null, latitude: null, longitude: null, delivers: false });
    });

    it('leaves out a vendor that is no longer active', async () => {
      const directory = (await list(owner).expect(200)).body as Directory;
      expect(directory.vendors.map((vendor) => vendor.id)).not.toContain(ids[CLOSED.code]);
      expect(directory.vendors.map((vendor) => vendor.name)).not.toContain(CLOSED.name);
      await one(owner, ids[CLOSED.code]!).expect(404);

      // Switched back on, it is listed, and as the nearest of all made here.
      await prisma.client.vendor.update({ where: { id: ids[CLOSED.code]! }, data: { isActive: true } });
      const again = (await list(owner).expect(200)).body as Directory;
      expect(again.vendors.find((vendor) => vendor.id === ids[CLOSED.code])).toMatchObject({ distanceMetres: distanceTo(CLOSED) });
      await prisma.client.vendor.update({ where: { id: ids[CLOSED.code]! }, data: { isActive: false } });
    });

    it('is in name order, with no distances, when the outlet has no saved place', async () => {
      const directory = (await list(owner, noPlaceOutletId).expect(200)).body as Directory;
      expect(directory).toMatchObject({ outletId: noPlaceOutletId, outletHasPlace: false, nearbyMetres: VENDOR_RULES.nearbyMetres });
      expect(ours(directory).map((vendor) => vendor.name)).toEqual([FAR.name, UNPLACED.name, MIDDLE.name, NEAR.name]);
      expect(directory.vendors.every((vendor) => vendor.distanceMetres === null)).toBe(true);
      // The whole answer is in name order, whatever else is loaded.
      const names = directory.vendors.map((vendor) => vendor.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    });
  });

  describe('one vendor', () => {
    it('comes with its distance from the outlet asked about', async () => {
      expect((await one(owner, ids[MIDDLE.code]!).expect(200)).body).toMatchObject({
        id: ids[MIDDLE.code],
        name: MIDDLE.name,
        categories: ['PACKAGING'],
        distanceMetres: distanceTo(MIDDLE),
      });
      expect((await one(manager, ids[NEAR.code]!).expect(200)).body).toMatchObject({ id: ids[NEAR.code], distanceMetres: 1112 });
      // No distance for a vendor with no place, nor from an outlet with none.
      expect((await one(owner, ids[UNPLACED.code]!).expect(200)).body).toMatchObject({ name: UNPLACED.name, distanceMetres: null });
      expect((await one(owner, ids[NEAR.code]!, noPlaceOutletId).expect(200)).body).toMatchObject({ name: NEAR.name, distanceMetres: null });
    });

    it('is not found when unknown', async () => {
      await one(owner, 'no-such-vendor').expect(404);
    });
  });
});
