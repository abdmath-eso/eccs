// Photo integrity: what the server records about a proof photo, which photos it
// marks as doubtful and why, and who is told. Runs against the local database
// with the sample seed loaded and local object storage running. Everything
// happens at a throwaway client it creates itself and removes afterwards; the
// sample outlets are not touched.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { describePhotoFlag, type PhotoFlagDto } from '@eccs/shared';
import { encode } from 'jpeg-js';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { StorageService } from './../src/storage/storage.service.js';

const MARK = 'E2E Photo integrity';
const DEVICE = 'e2e-photo-integrity';
const PHONES = { admin: '+919000000002', supervisor: '+919000000003', owner: '+919199900031' };
const SAMPLE = { code: 'SPICE-JH2K7M', managerPin: '4821' };
/** Where the throwaway kitchen "is" (Jubilee Hills), and a spot about 2.1 km north of it. */
const KITCHEN = { latitude: 17.4326, longitude: 78.4071 };
const FAR_AWAY = { latitude: 17.4516, longitude: 78.4071 };

// ───────── Real JPEG files, made by program ─────────

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * A made-up kitchen scene saved as a JPEG. The same `seed` is the same scene; `size` and
 * `quality` save it differently (a different file that looks the same); `shift` moves the camera.
 */
function jpeg(seed: number, options: { width?: number; quality?: number; shift?: number } = {}): Buffer {
  const { width = 640, quality = 60, shift = 0 } = options;
  const height = Math.round(width * 0.75);
  const next = random(seed);
  const colour = (): [number, number, number] => [20 + next() * 220, 20 + next() * 220, 20 + next() * 220];
  const base = colour();
  const shapes = Array.from({ length: 14 }, () => ({ x: next() * 0.9, y: next() * 0.9, w: 0.08 + next() * 0.35, h: 0.08 + next() * 0.35, colour: colour() }));
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width + shift;
      const v = y / height + shift * 0.7;
      let pixel: [number, number, number] = [base[0] + 30 * u, base[1] - 20 * v, base[2]];
      for (const shape of shapes) {
        if (u >= shape.x && u < shape.x + shape.w && v >= shape.y && v < shape.y + shape.h) pixel = shape.colour;
      }
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) data[offset + channel] = Math.max(0, Math.min(255, Math.round(pixel[channel]!)));
      data[offset + 3] = 255;
    }
  }
  return encode({ data, width, height }, quality).data;
}

type Outlet = { id: string; code: string; latitude: number | null; longitude: number | null };
type Client = { id: string; outlets: Outlet[] };
type VisitPhoto = { id: string; kind: string; flags?: PhotoFlagDto[] };
type Visit = { id: string; status: string; photos: VisitPhoto[]; canSetOutletLocation?: boolean };
type Run = {
  id: string;
  title: Record<string, string>;
  items: { id: string; response: { photoPath: string | null; photoRepeatOf?: string } | null }[];
};
type BoardPhotos = {
  level: string;
  checked: number;
  doubtful: number;
  certain: number;
  fromChecklists: number;
  items: { id: string; receivedOn: string; what: { kind: string; name: Record<string, string> | null }; visitId: string | null; inspectionId: string | null; flags: PhotoFlagDto[] }[];
};
type Board = { outlets: { outletId: string; level: string; attention: string[]; watch: string[]; photos: BoardPhotos }[] };

describe('Photo integrity (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let supervisor: string;
  let supervisorId: string;
  let sampleManager: string;
  let manager: string;
  let chef: string;
  let client: Client;
  let outlet: Outlet;
  let runId: string;
  /** The checks of the throwaway checklist, used one per test. */
  let items: string[];
  let visitId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = () => indiaDate();
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  async function cleanUp() {
    const db = prisma.client;
    const ours = { name: { startsWith: MARK } };
    const atOurs = { outlet: { organization: ours } };
    const files = await db.attachment.findMany({ where: atOurs, select: { storageKey: true } });
    await db.attachment.deleteMany({ where: atOurs });
    await Promise.all(files.map((file) => app.get(StorageService).remove(file.storageKey).catch(() => undefined)));
    await db.issue.deleteMany({ where: atOurs });
    await db.inspection.deleteMany({ where: atOurs });
    await db.serviceReport.deleteMany({ where: { job: atOurs } });
    await db.signOff.deleteMany({ where: { job: atOurs } });
    await db.jobTaskResponse.deleteMany({ where: { job: atOurs } });
    await db.job.deleteMany({ where: atOurs });
    await db.checklistRun.deleteMany({ where: atOurs });
    await db.checklistItem.deleteMany({ where: atOurs });
    await db.outletChecklist.deleteMany({ where: atOurs });
    await db.checklistTemplate.deleteMany({ where: atOurs });
    await db.hygieneScoreSnapshot.deleteMany({ where: atOurs });
    // The throwaway client: its people first (their sessions and notifications go with them), then the rest.
    await db.user.deleteMany({ where: { memberships: { some: { OR: [{ organization: ours }, { outlet: { organization: ours } }] } } } });
    await db.user.deleteMany({ where: { phone: PHONES.owner } });
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { OR: [{ name: DEVICE }, { organization: ours }] } });
    await db.outlet.deleteMany({ where: { organization: ours } });
    await db.organization.deleteMany({ where: ours });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
    await db.$executeRaw`DELETE FROM "Notification" WHERE "data"::text ILIKE ${`%${MARK}%`} OR "body" ILIKE ${`%${MARK}%`}`;
  }

  async function otpLogin(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    return (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200)).body;
  }
  async function pinLogin(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    return (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200)).body.token;
  }
  async function addPerson(role: 'MANAGER' | 'HEAD_CHEF'): Promise<string> {
    const person = await http()
      .post('/restaurant-users')
      .set(bearer(admin))
      .send({ name: `${MARK} ${role}`, role, outletId: outlet.id })
      .expect(201);
    return pinLogin(outlet.code, person.body.pin as string);
  }

  /** What the server stored about a photo. */
  async function stored(id: string) {
    const row = await prisma.client.attachment.findUniqueOrThrow({ where: { id } });
    const flags = (row.integrityFlags ?? []) as unknown as PhotoFlagDto[];
    return { ...row, flags, codes: flags.map((flag) => flag.code) };
  }

  /** Text fields of an upload form, added before the file. */
  function withFields<T extends { field(name: string, value: string): T }>(upload: T, fields: Record<string, string | number | boolean>): T {
    let form = upload;
    for (const [name, value] of Object.entries(fields)) form = form.field(name, String(value));
    return form;
  }

  /** The Head Chef takes the proof photo for one check of the checklist, as the app does: upload, then answer. */
  async function proof(item: number, file: Buffer, fields: Record<string, string | number | boolean> = {}): Promise<string> {
    const upload = await withFields(http().post('/attachments').set(bearer(chef)).field('outletId', outlet.id), fields)
      .attach('file', file, { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const id = upload.body.id as string;
    await http()
      .put(`/checklists/runs/${runId}/items/${items[item]!}`)
      .set(bearer(chef))
      .send({ passed: true, attachmentId: id, ...(typeof fields.capturedAt === 'string' && { capturedAt: fields.capturedAt }) })
      .expect(200);
    return id;
  }

  /** A visit of the sample pest-control kind at the throwaway outlet, given to the sample Supervisor. */
  async function addVisit(): Promise<string> {
    const created = await http()
      .post('/visits')
      .set(bearer(admin))
      .send({ outletId: outlet.id, serviceCode: 'PEST', date: today(), slot: '1000', supervisorId })
      .expect(201);
    return created.body.id as string;
  }
  const getVisit = async (token: string, id: string): Promise<Visit> => (await http().get(`/visits/${id}`).set(bearer(token)).expect(200)).body;
  async function visitPhoto(id: string, file: Buffer, fields: Record<string, string | number | boolean> = {}): Promise<string> {
    const before = (await getVisit(supervisor, id)).photos.map((photo) => photo.id);
    const visit = (
      await withFields(http().post(`/visits/${id}/photos`).set(bearer(supervisor)).field('kind', 'AFTER'), fields)
        .attach('file', file, { filename: 'visit.jpg', contentType: 'image/jpeg' })
        .expect(200)
    ).body as Visit;
    return visit.photos.find((photo) => !before.includes(photo.id))!.id;
  }
  const board = async (token: string): Promise<BoardPhotos> =>
    ((await http().get('/monitoring').set(bearer(token)).expect(200)).body as Board).outlets.find((row) => row.outletId === outlet.id)!.photos;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();

    admin = (await otpLogin(PHONES.admin)).token;
    const supervisorSession = await otpLogin(PHONES.supervisor);
    supervisor = supervisorSession.token;
    supervisorId = supervisorSession.user.id;
    sampleManager = await pinLogin(SAMPLE.code, SAMPLE.managerPin);

    // The throwaway client, made the way the console makes one. Its outlet has no location yet.
    const created = await http()
      .post('/organizations')
      .set(bearer(admin))
      .send({ name: `${MARK} Client`, ownerName: `${MARK} Owner`, ownerPhone: PHONES.owner, outletName: `${MARK} Outlet`, outletAddress: '1 Test Road' })
      .expect(201);
    client = created.body;
    outlet = client.outlets[0]!;
    manager = await addPerson('MANAGER');
    chef = await addPerson('HEAD_CHEF');

    // A checklist of the outlet's own with enough photo checks for every case below, due at the end of the day.
    const title = `${MARK} checks`;
    const lists = (await http().post('/checklists/setup').set(bearer(manager)).send({ outletId: outlet.id, title, dueTime: '23:59' }).expect(201))
      .body as { id: string; title: Record<string, string> }[];
    const list = lists.find((entry) => Object.values(entry.title).includes(title))!;
    for (let index = 1; index <= 12; index += 1) {
      await http().post(`/checklists/setup/${list.id}/items`).set(bearer(manager)).send({ label: `${MARK} check ${index}` }).expect(201);
    }
    const runs = (await http().get('/checklists/today').query({ outletId: outlet.id }).set(bearer(chef)).expect(200)).body as Run[];
    const run = runs.find((entry) => Object.values(entry.title).includes(title))!;
    runId = run.id;
    items = run.items.map((item) => item.id);
    expect(items).toHaveLength(12);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe("the outlet's location", () => {
    it('starts unknown, and can be saved from the kitchen by the Supervisor during a visit', async () => {
      expect(outlet).toMatchObject({ latitude: null, longitude: null });
      visitId = await addVisit();
      // Not before checking in.
      expect((await getVisit(supervisor, visitId)).canSetOutletLocation).toBeUndefined();
      await http().post(`/visits/${visitId}/outlet-location`).set(bearer(supervisor)).send(KITCHEN).expect(409);

      const started = (await http().post(`/visits/${visitId}/check-in`).set(bearer(supervisor)).send({}).expect(200)).body as Visit;
      expect(started.canSetOutletLocation).toBe(true);
      await http().post(`/visits/${visitId}/outlet-location`).set(bearer(supervisor)).send({ latitude: 200, longitude: 78 }).expect(400);
      await http().post(`/visits/${visitId}/outlet-location`).set(bearer(manager)).send(KITCHEN).expect(403);

      const saved = (await http().post(`/visits/${visitId}/outlet-location`).set(bearer(supervisor)).send(KITCHEN).expect(200)).body as Visit;
      expect(saved.canSetOutletLocation).toBeUndefined();
      expect(await prisma.client.outlet.findUniqueOrThrow({ where: { id: outlet.id } })).toMatchObject(KITCHEN);

      // Once it is known, a phone does not move it: that is done in the office.
      await http().post(`/visits/${visitId}/outlet-location`).set(bearer(supervisor)).send(FAR_AWAY).expect(200);
      expect(await prisma.client.outlet.findUniqueOrThrow({ where: { id: outlet.id } })).toMatchObject(KITCHEN);
    });

    it('is set, changed and cleared by ECCS in the console, both numbers together', async () => {
      const path = `/organizations/${client.id}/outlets/${outlet.id}`;
      const outletOf = (body: Client) => body.outlets.find((entry) => entry.id === outlet.id)!;
      await http().patch(path).set(bearer(admin)).send({ latitude: 17.4 }).expect(400);
      await http().patch(path).set(bearer(admin)).send({ latitude: 17.4, longitude: 278 }).expect(400);
      await http().patch(path).set(bearer(supervisor)).send(FAR_AWAY).expect(403);

      expect(outletOf((await http().patch(path).set(bearer(admin)).send({ latitude: null, longitude: null }).expect(200)).body)).toMatchObject({ latitude: null, longitude: null });
      expect(outletOf((await http().patch(path).set(bearer(admin)).send(KITCHEN).expect(200)).body)).toMatchObject(KITCHEN);
      // Changing something else leaves the location alone.
      expect(outletOf((await http().patch(path).set(bearer(admin)).send({ city: 'Hyderabad' }).expect(200)).body)).toMatchObject(KITCHEN);
    });
  });

  describe('a checklist photo', () => {
    let original: string;

    it('is not doubtful when nothing is wrong, and keeps what is known about it', async () => {
      // No location sent at all: permission refused, or no fix indoors. That alone is never a flag.
      original = await proof(0, jpeg(1), { capturedAt: minutesAgo(1), source: 'CAMERA' });
      const photo = await stored(original);
      expect(photo).toMatchObject({ doubtful: false, flags: [], source: 'CAMERA', latitude: null, distanceMetres: null });
      expect(photo.integrityCheckedAt).not.toBeNull();
      expect(photo.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(photo.perceptualHash).toMatch(/^[0-9a-f]{144}$/);
      expect(photo.captureGapSeconds).toBeGreaterThanOrEqual(55);
      expect(photo.captureGapSeconds).toBeLessThan(120);
    });

    it('is not checked until it is proof of something', async () => {
      // Uploaded but not attached to any check (as a photo for an issue would be): the very same file as above.
      const upload = await http()
        .post('/attachments')
        .set(bearer(chef))
        .field('outletId', outlet.id)
        .attach('file', jpeg(1), { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .expect(201);
      expect(await stored(upload.body.id)).toMatchObject({ doubtful: false, integrityFlags: null, integrityCheckedAt: null });
      const issue = await http()
        .post('/issues')
        .set(bearer(chef))
        .send({ outletId: outlet.id, category: 'EQUIPMENT', description: `${MARK}: the fridge door does not close`, attachmentIds: [upload.body.id] })
        .expect(201);
      expect(issue.body.photoPaths).toHaveLength(1);
      expect(await stored(upload.body.id)).toMatchObject({ doubtful: false, integrityCheckedAt: null });
    });

    it('is flagged, with certainty, when the identical file is used again for another check', async () => {
      const again = await proof(1, jpeg(1));
      const photo = await stored(again);
      expect(photo.doubtful).toBe(true);
      expect(photo.flags).toEqual([
        { code: 'SAME_FILE', certain: true, earlierOn: today(), earlierWhat: { kind: 'CHECKLIST', name: expect.objectContaining({ en: `${MARK} checks` }) } },
      ]);
      expect(describePhotoFlag(photo.flags[0]!)).toMatch(new RegExp(`^Same photo as on \\d+ \\w+, ${MARK} checks$`));
      // The earlier photo is the original, and stays unmarked.
      expect((await stored(original)).doubtful).toBe(false);
    });

    it('is flagged softly when it is the same picture saved again as a different file', async () => {
      const copy = await proof(2, jpeg(1, { width: 480, quality: 35 }));
      const photo = await stored(copy);
      expect(photo.contentHash).not.toBe((await stored(original)).contentHash);
      expect(photo.flags).toEqual([{ code: 'LOOKS_SAME', certain: false, earlierOn: today(), earlierWhat: expect.objectContaining({ kind: 'CHECKLIST' }) }]);
    });

    it('is not flagged when it is the same place photographed again, or a different place', async () => {
      // The honest case: the same counter, the camera held a little differently.
      expect((await stored(await proof(3, jpeg(1, { shift: 0.06 })))).flags).toEqual([]);
      expect((await stored(await proof(4, jpeg(2)))).flags).toEqual([]);
    });

    it('is not flagged when retaken for the same check, though the pictures are all but the same', async () => {
      const retake = await proof(4, jpeg(2, { quality: 50 }));
      expect((await stored(retake)).flags).toEqual([]);
    });

    it('is not flagged when taken at the outlet, near it, or with only a rough fix', async () => {
      const here = await proof(5, jpeg(3), { ...KITCHEN, accuracy: 18, mocked: false });
      expect(await stored(here)).toMatchObject({ doubtful: false, distanceMetres: 0, latitude: KITCHEN.latitude, locationAccuracy: 18, locationMocked: false });
      // About 220 m off, as a phone indoors can be.
      const near = await stored(await proof(5, jpeg(4), { latitude: 17.4346, longitude: KITCHEN.longitude, accuracy: 60 }));
      expect(near.flags).toEqual([]);
      expect(near.distanceMetres).toBeGreaterThan(150);
      // About 1 km off, but the phone itself says it is only sure to within 1.5 km (approximate location).
      expect((await stored(await proof(5, jpeg(5), { latitude: 17.4416, longitude: KITCHEN.longitude, accuracy: 1500 }))).flags).toEqual([]);
      // A location that cannot be read is ignored, not an error.
      expect(await stored(await proof(5, jpeg(6), { latitude: 'north', longitude: '78.4' }))).toMatchObject({ doubtful: false, latitude: null });
    });

    it('is flagged when taken far from the outlet, with the distance', async () => {
      const photo = await stored(await proof(6, jpeg(7), { ...FAR_AWAY, accuracy: 12, mocked: false }));
      expect(photo.codes).toEqual(['FAR_FROM_OUTLET']);
      expect(photo.flags[0]).toMatchObject({ certain: false });
      expect(photo.distanceMetres).toBeGreaterThan(2000);
      expect(photo.distanceMetres).toBeLessThan(2200);
      expect(describePhotoFlag(photo.flags[0]!)).toBe('Taken 2.1 km from the outlet');
    });

    it('is flagged, with certainty, when the phone reports a faked location', async () => {
      const photo = await stored(await proof(7, jpeg(8), { ...KITCHEN, accuracy: 5, mocked: true }));
      expect(photo.flags).toEqual([{ code: 'MOCK_LOCATION', certain: true }]);
      expect(photo.locationMocked).toBe(true);
    });

    it('is not flagged when sent hours after it was taken, as the offline outbox does', async () => {
      // Taken up to five hours ago (but today in India: a checklist cannot be filled in before its day begins).
      const dayStart = Date.parse(`${today()}T00:00:00.000+05:30`);
      const takenAt = new Date(Math.max(Date.now() - 5 * 3_600_000, dayStart + 60_000));
      const photo = await stored(await proof(8, jpeg(9), { capturedAt: takenAt.toISOString() }));
      expect(photo.flags).toEqual([]);
      expect(photo.phoneCapturedAt?.toISOString()).toBe(takenAt.toISOString());
      expect(Math.abs(photo.captureGapSeconds! - (Date.now() - takenAt.getTime()) / 1000)).toBeLessThan(60);
    });

    it('is flagged when the phone says it was taken in the future', async () => {
      const photo = await stored(await proof(9, jpeg(10), { capturedAt: new Date(Date.now() + 3 * 3_600_000).toISOString() }));
      expect(photo.codes).toEqual(['CLOCK_AHEAD']);
      expect(photo.flags[0]!.minutes).toBeGreaterThanOrEqual(179);
      expect(photo.flags[0]!.minutes).toBeLessThanOrEqual(181);
      expect(photo.captureGapSeconds).toBeLessThan(0);
      expect(describePhotoFlag(photo.flags[0]!)).toBe('Phone clock was 3 hours ahead');
    });

    it("is flagged when the phone says it was taken before the checklist's day began", async () => {
      const photo = await stored(await proof(10, jpeg(11), { capturedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }));
      expect(photo.codes).toEqual(['TAKEN_BEFORE']);
      expect(photo.flags[0]!.minutes).toBeGreaterThan(24 * 60);
    });

    it('is flagged when picked from files instead of taken with the camera', async () => {
      expect((await stored(await proof(11, jpeg(12), { source: 'FILE' }))).flags).toEqual([{ code: 'NOT_CAMERA', certain: false }]);
    });

    it('never stops the checklist from being answered or handed in', async () => {
      const run = (await http().get(`/checklists/runs/${runId}`).set(bearer(chef)).expect(200)).body as Run;
      expect(run.items.every((item) => item.response?.photoPath)).toBe(true);
      await http().post(`/checklists/runs/${runId}/submit`).set(bearer(chef)).expect(200);
    });
  });

  describe("a visit's and an inspection's photos", () => {
    let reused: string;

    it('are checked the same way: the same file as a checklist photo is flagged', async () => {
      reused = await visitPhoto(visitId, jpeg(1), { ...KITCHEN, accuracy: 10, mocked: false, capturedAt: minutesAgo(0) });
      const photo = await stored(reused);
      expect(photo.codes).toEqual(['SAME_FILE']);
      expect(photo.flags[0]!.earlierWhat).toMatchObject({ kind: 'CHECKLIST' });
      // Two different photos of one visit are fine.
      expect((await stored(await visitPhoto(visitId, jpeg(20)))).flags).toEqual([]);
    });

    it('are not flagged when the visit was done without signal days ago and sent now', async () => {
      const late = await addVisit();
      const then = Date.now() - 3 * 86_400_000;
      await http().post(`/visits/${late}/check-in`).set(bearer(supervisor)).send({ at: new Date(then).toISOString() }).expect(200);
      const photo = await stored(await visitPhoto(late, jpeg(21), { capturedAt: new Date(then + 20 * 60_000).toISOString() }));
      expect(photo.flags).toEqual([]);
      expect(photo.captureGapSeconds).toBeGreaterThan(2.9 * 86_400);

      // But a photo dated before the Supervisor arrived is.
      const early = await stored(await visitPhoto(late, jpeg(22), { capturedAt: new Date(then - 6 * 3_600_000).toISOString() }));
      expect(early.codes).toEqual(['TAKEN_BEFORE']);
    });

    it('covers a photo of an inspection finding', async () => {
      const inspection = (await http().post('/inspections').set(bearer(admin)).send({ outletId: outlet.id, supervisorId }).expect(201)).body as {
        id: string;
        sections: { checks: { itemId: string }[] }[];
      };
      const itemId = inspection.sections[0]!.checks[0]!.itemId;
      await http().put(`/inspections/${inspection.id}/checks/${itemId}`).set(bearer(supervisor)).send({ answer: 'NON_COMPLIANT' }).expect(200);
      const added = await http()
        .post(`/inspections/${inspection.id}/checks/${itemId}/photos`)
        .set(bearer(supervisor))
        .field('mocked', 'true')
        .field('latitude', String(KITCHEN.latitude))
        .field('longitude', String(KITCHEN.longitude))
        .attach('file', jpeg(20), { filename: 'finding.jpg', contentType: 'image/jpeg' })
        .expect(200);
      const id = (added.body.check.photos as { id: string; flags?: unknown }[])[0]!.id;
      // The reply to the Supervisor's own phone never carries the reasons.
      expect(added.body.check.photos[0].flags).toBeUndefined();
      const photo = await stored(id);
      expect(photo.codes).toEqual(['SAME_FILE', 'MOCK_LOCATION']);
      expect(photo.flags[0]!.earlierWhat).toMatchObject({ kind: 'VISIT' });

      type Inspection = { sections: { checks: { itemId: string; photos: { id: string; flags?: PhotoFlagDto[] }[] }[] }[] };
      const seenBy = async (token: string) =>
        ((await http().get(`/inspections/${inspection.id}`).set(bearer(token)).expect(200)).body as Inspection).sections[0]!.checks[0]!.photos[0]!;
      expect((await seenBy(admin)).flags?.map((flag) => flag.code)).toEqual(['SAME_FILE', 'MOCK_LOCATION']);
      expect((await seenBy(supervisor)).flags).toBeUndefined();
    });

    it('show their reasons to the ECCS office only, not to the Supervisor or the restaurant', async () => {
      const photoOf = async (token: string) => (await getVisit(token, visitId)).photos.find((photo) => photo.id === reused);
      const forAdmin = await photoOf(admin);
      expect(forAdmin?.flags?.map((flag) => flag.code)).toEqual(['SAME_FILE']);
      expect((await photoOf(supervisor))!.flags).toBeUndefined();
      for (const photo of (await getVisit(manager, visitId)).photos) expect(photo.flags).toBeUndefined();
      // A photo with nothing wrong carries no list at all.
      expect((await getVisit(admin, visitId)).photos.find((photo) => photo.id !== reused)!.flags).toBeUndefined();
    });
  });

  describe('who is told about a checklist photo', () => {
    const repeats = async (token: string) =>
      ((await http().get(`/checklists/runs/${runId}`).set(bearer(token)).expect(200)).body as Run).items.map((item) => item.response?.photoRepeatOf ?? null);

    it("tells the restaurant's Manager, neutrally, which photos repeat an earlier one, and nothing else", async () => {
      const seen = await repeats(manager);
      // Checks 2 and 3 (the identical file, and the same picture saved again) carry the day of the earlier photo.
      expect(seen.slice(0, 3)).toEqual([null, today(), today()]);
      // Far away, faked location, wrong clock, picked from files: not told to the restaurant.
      expect(seen.slice(3)).toEqual(Array(9).fill(null));
    });

    it('tells the Head Chef nothing, and ECCS nothing through the checklist itself', async () => {
      expect(await repeats(chef)).toEqual(Array(12).fill(null));
      expect(await repeats(admin)).toEqual(Array(12).fill(null));
    });

    it('keeps another restaurant out', async () => {
      await http().get(`/checklists/runs/${runId}`).set(bearer(sampleManager)).expect(404);
    });
  });

  describe('the monitoring board', () => {
    it('counts the doubtful photos of the period for the ECCS office, with the reasons and no pictures', async () => {
      const photos = await board(admin);
      // Checklist: same file, same look, far, faked, clock ahead, before the day, from files = 7.
      // ECCS's own: the visit's reused photo, the early visit photo, the inspection photo = 3.
      expect(photos).toMatchObject({ doubtful: 10, fromChecklists: 7, certain: 4, level: 'ATTENTION' });
      // Every proof photo still attached to something is counted; replaced checklist photos and the issue's photo are not.
      const counted = await prisma.client.attachment.count({
        where: { outletId: outlet.id, OR: [{ checklistResponseId: { not: null } }, { jobId: { not: null } }, { inspectionFindingId: { not: null } }] },
      });
      expect(photos.checked).toBe(counted);
      expect(photos.items).toHaveLength(10);
      for (const item of photos.items) {
        expect(item.flags.length).toBeGreaterThan(0);
        expect(item.receivedOn).toBe(today());
        expect(item).not.toHaveProperty('path');
        expect(item.visitId !== null).toBe(item.what.kind === 'VISIT');
        expect(item.inspectionId !== null).toBe(item.what.kind === 'INSPECTION');
      }
      expect(photos.items.filter((item) => item.what.kind === 'CHECKLIST').every((item) => item.what.name?.en === `${MARK} checks`)).toBe(true);
    });

    it('raises the outlet on the board, and leaves the area empty for a Supervisor', async () => {
      const all = (await http().get('/monitoring').set(bearer(admin)).expect(200)).body as Board;
      expect(all.outlets.find((row) => row.outletId === outlet.id)!.attention).toContain('photos');
      expect(await board(supervisor)).toMatchObject({ checked: 0, doubtful: 0, level: 'NONE', items: [] });
      await http().get('/monitoring').set(bearer(manager)).expect(403);
    });

    it('does not change the hygiene score', async () => {
      // The score is worked out from inspections, licences and checklists handed in. Twelve of twelve checks
      // were answered and the checklist handed in on time, seven doubtful photos among them: full marks for it.
      const score = (await http().get(`/scores/${outlet.id}`).set(bearer(admin)).expect(200)).body as { parts?: unknown; score: number | null };
      const again = (await http().get(`/scores/${outlet.id}`).set(bearer(admin)).expect(200)).body as { score: number | null };
      expect(again.score).toBe(score.score);
      const flagged = await prisma.client.attachment.count({ where: { outletId: outlet.id, doubtful: true } });
      await prisma.client.attachment.updateMany({ where: { outletId: outlet.id }, data: { doubtful: false, integrityFlags: [] } });
      const without = (await http().get(`/scores/${outlet.id}`).set(bearer(admin)).expect(200)).body as { score: number | null };
      expect(flagged).toBeGreaterThan(0);
      expect(without.score).toBe(score.score);
    });
  });
});
