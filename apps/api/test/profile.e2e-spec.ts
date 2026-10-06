// "My profile". Runs against the local database with the sample seed loaded
// and local object storage running. Uses the Spice Route logins, restores
// anything it changes and removes the photos it uploads.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const JUBILEE_CODE = 'SPICE-JH2K7M';
const PINS = { owner: '2580', manager: '4821', chef: '7306' };
const ADMIN_PHONE = '+919000000001';
const DEVICE = 'e2e-profile';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e profile photo one')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('e2e profile photo two')]);
const PDF = Buffer.from('%PDF-1.4\n% not a photo\n%%EOF\n');

type Profile = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  language: string;
  role: string;
  photoPath: string | null;
  organizationName: string | null;
  outlets: { id: string; name: string; address: string; city: string; code: string | null }[];
  memberSince: string;
  canEditName: boolean;
};

describe('My profile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: string;
  let manager: string;
  let chef: string;
  let admin: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const profile = async (token: string) => (await http().get('/profile').set(bearer(token)).expect(200)).body as Profile;
  const uploadPhoto = (token: string, file: Buffer, filename: string) =>
    http().post('/profile/photo').set(bearer(token)).attach('file', file, { filename, contentType: 'application/octet-stream' });

  async function cleanUp() {
    const db = prisma.client;
    // The photos these tests upload are recognised by their exact size.
    const mine = await db.attachment.findMany({ where: { kind: 'PROFILE', sizeBytes: { in: [JPEG.length, PNG.length] } } });
    await db.user.updateMany({ where: { photoId: { in: mine.map((photo) => photo.id) } }, data: { photoId: null } });
    await db.attachment.deleteMany({ where: { id: { in: mine.map((photo) => photo.id) } } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: ADMIN_PHONE } });
  }

  async function pinLogin(pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code: JUBILEE_CODE, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return session.body.token as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();

    owner = await pinLogin(PINS.owner);
    manager = await pinLogin(PINS.manager);
    chef = await pinLogin(PINS.chef);
    await http().post('/auth/otp/request').send({ phone: ADMIN_PHONE }).expect(200);
    const session = await http()
      .post('/auth/otp/verify')
      .send({ phone: ADMIN_PHONE, code: env.DEV_FIXED_OTP, deviceName: DEVICE })
      .expect(200);
    admin = session.body.token as string;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('needs a login', async () => {
    await http().get('/profile').expect(401);
  });

  it('shows the Owner their details and every branch with its restaurant code', async () => {
    const mine = await profile(owner);
    expect(mine).toMatchObject({
      name: 'Sample Owner (Spice Route)',
      phone: '+919100000001',
      email: 'owner@spiceroute.example',
      role: 'OWNER',
      organizationName: 'Spice Route Kitchens',
      canEditName: true,
    });
    expect(mine.outlets.map((outlet) => [outlet.name, outlet.code])).toEqual([
      ['Spice Route, Gachibowli', 'SPICE-GB4N8P'],
      ['Spice Route, Jubilee Hills', 'SPICE-JH2K7M'],
    ]);
    for (const outlet of mine.outlets) expect(outlet.address.length).toBeGreaterThan(0);
    expect(new Date(mine.memberSince).getTime()).not.toBeNaN();
  });

  it('shows a Manager their one branch with its code, and a Head Chef theirs without it', async () => {
    const forManager = await profile(manager);
    expect(forManager).toMatchObject({ role: 'MANAGER', organizationName: 'Spice Route Kitchens', phone: null, canEditName: false });
    expect(forManager.outlets.map((outlet) => [outlet.name, outlet.code])).toEqual([['Spice Route, Jubilee Hills', 'SPICE-JH2K7M']]);

    const forChef = await profile(chef);
    expect(forChef).toMatchObject({ role: 'HEAD_CHEF', language: 'TE', canEditName: false });
    expect(forChef.outlets.map((outlet) => [outlet.name, outlet.code])).toEqual([['Spice Route, Jubilee Hills', null]]);
  });

  it('shows ECCS staff a profile with no restaurant', async () => {
    const mine = await profile(admin);
    expect(mine).toMatchObject({ role: 'SUPER_ADMIN', organizationName: null, outlets: [], canEditName: true });
  });

  it('lets the Owner change their own name, but not a Manager or Head Chef', async () => {
    const before = (await profile(owner)).name;
    await http().patch('/auth/me').set(bearer(owner)).send({ name: 'E2E Renamed Owner' }).expect(200);
    expect((await profile(owner)).name).toBe('E2E Renamed Owner');
    await http().patch('/auth/me').set(bearer(owner)).send({ name: before }).expect(200);

    await http().patch('/auth/me').set(bearer(manager)).send({ name: 'E2E Manager' }).expect(403);
    await http().patch('/auth/me').set(bearer(chef)).send({ name: 'E2E Chef' }).expect(403);
    // Everyone can still choose their own language.
    await http().patch('/auth/me').set(bearer(chef)).send({ language: 'TE' }).expect(200);
    expect((await profile(chef)).name).toBe('Sample Head Chef (Jubilee Hills)');
  });

  it('stores a profile photo, replaces it, and removes it', async () => {
    expect((await profile(chef)).photoPath).toBeNull();

    const first = (await uploadPhoto(chef, JPEG, 'me.jpg').expect(200)).body as Profile;
    expect(first.photoPath).toMatch(/^\/attachments\/.+\/content\?exp=\d+&sig=/);
    const shown = await http().get(first.photoPath!).expect(200);
    expect(shown.headers['content-type']).toBe('image/jpeg');
    const firstId = first.photoPath!.split('/')[2]!;

    // A new photo takes the old one's place, and the old one is deleted.
    const second = (await uploadPhoto(chef, PNG, 'me.png').expect(200)).body as Profile;
    expect(second.photoPath).not.toBe(first.photoPath);
    expect((await http().get(second.photoPath!).expect(200)).headers['content-type']).toBe('image/png');
    expect(await prisma.client.attachment.findUnique({ where: { id: firstId } })).toBeNull();

    // It is this person's photo only.
    expect((await profile(manager)).photoPath).toBeNull();

    const removed = (await http().delete('/profile/photo').set(bearer(chef)).expect(200)).body as Profile;
    expect(removed.photoPath).toBeNull();
    expect(await prisma.client.attachment.count({ where: { kind: 'PROFILE', uploadedById: removed.id } })).toBe(0);
  });

  it('accepts only photos', async () => {
    await uploadPhoto(chef, PDF, 'me.pdf').expect(400);
    await http().post('/profile/photo').set(bearer(chef)).expect(400);
    await http().post('/profile/photo').attach('file', JPEG, 'me.jpg').expect(401);
    expect((await profile(chef)).photoPath).toBeNull();
  });
});
