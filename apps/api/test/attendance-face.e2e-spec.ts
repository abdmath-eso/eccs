// Attendance by face: enrolling with consent, clocking in and out on the outlet's
// linked phone, the assisted route, the day's status worked out from the punches,
// the Owner's corrections, and the pay that follows.
//
// Runs against the local database with the sample seed loaded, with the FAKE face
// engine: a test "photo" is a small file that says which made-up face is in it
// (see src/attendance/face/fake-face-engine.ts), so no model files and no real
// faces are needed. Everything happens at two throwaway outlets of the Deccan
// Biryani sample restaurant, with a throwaway Manager and Head Chef, and is
// removed afterwards. The attendance clock is moved by the tests, so "the next
// morning" does not have to be waited for.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FACE_CONSENT_VERSION, FACE_RULES, shiftDate, weekdayOf } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { AttendanceClock } from './../src/attendance/attendance-clock.js';
import { AttendanceService } from './../src/attendance/attendance.service.js';
import { FACE_ENGINE, OffFaceEngine } from './../src/attendance/face/face-engine.js';
import { fakePhoto, type FakeFace } from './../src/attendance/face/fake-face-engine.js';
import { sha256 } from './../src/auth/auth.crypto.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { StorageService } from './../src/storage/storage.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', otherManager: '4821' };
const DEVICE = 'e2e-face';
const OWNER_PHONE_TOKEN = 'e2e-face-owner-phone-token';
const OUTLET_CODE = 'E2EFA-FACE01';
const OTHER_OUTLET_CODE = 'E2EFA-FACE02';
const MANAGER_NAME = 'E2E Face Manager';
const CHEF_NAME = 'E2E Face Chef';
const REASON = 'Checked with the kitchen';

type Identify = {
  result: 'MATCH' | 'UNSURE' | 'NO_MATCH';
  candidate: { staffId: string; name: string } | null;
  nextKind: 'IN' | 'OUT' | null;
  lastPunchAt: string | null;
  lastPunchKind: 'IN' | 'OUT' | null;
  already: boolean;
  ticket: string | null;
  ticketExpiresAt: string | null;
};
type Punched = { result: 'RECORDED' | 'ALREADY'; punchId: string; staffId: string; name: string; kind: 'IN' | 'OUT'; at: string; day: string; workedMinutesToday: number; flag: string | null };
type Cell = { status: string | null; source: string | null; firstInAt: string | null; lastOutAt: string | null; workedMinutes: number | null; flags: string[]; provisional: boolean; onDuty: boolean; punches: number; hasPhoto: boolean; note: string | null };
type Sheet = { date: string; today: string; editable: boolean; people: (Cell & { staffId: string; name: string; enrolled: boolean; markedByName: string | null })[] };
type PunchRow = { id: string; day: string; at: string; kind: string; method: string; flag: string | null; note: string | null; createdByName: string | null; photoPath: string | null; voided: boolean; voidedAt: string | null; voidReason: string | null; reviewedAt: string | null; score: number | null };
type FaceStatus = { staffId: string; enrolled: boolean; templates: number; enrolledAt: string | null; consentAt: string | null; consentVersion: string | null; consentLanguage: string | null; withdrawnAt: string | null };

describe('Attendance by face (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: AttendanceClock;
  let attendance: AttendanceService;
  let organizationId: string;
  let outletId: string;
  let otherOutletId: string;
  let owner: string;
  let manager: string;
  let chef: string;
  let otherManager: string;
  let managerPin: string;
  let chefPin: string;
  /** The phone kept at the outlet, and the one at the second outlet. */
  let phone: string;
  let otherPhone: string;
  /** Enrolled, paid 600 a day. */
  let cookId: string;
  /** Never enrolled: clocks in through the assisted route. Has a weekly day off. */
  let porterId: string;
  /** Enrolled part-way through, to try withdrawing and leaving. */
  let helperId: string;
  /** On the staff of the second outlet. */
  let elsewhereId: string;
  const punchIds: Record<string, string> = {};

  // Six days that have ended, oldest first, and today. All inside the window the Owner can still correct.
  const today = indiaDate();
  const [A, B, C, D, E, F] = [-6, -5, -4, -3, -2, -1].map((by) => shiftDate(today, by)) as [string, string, string, string, string, string];
  /** A moment on a date, India time. */
  const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
  const setClock = (date: string, time: string) => clock.setForTest(ist(date, time));

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const face = (id: string, more: Partial<FakeFace> = {}, salt = '') => fakePhoto([{ id, ...more }], salt);

  const identify = (deviceToken: string, photo: Buffer, second?: Buffer) => {
    const call = http().post('/attendance/clock/identify').field('deviceToken', deviceToken).attach('photo', photo, 'face.jpg');
    return second ? call.attach('photo2', second, 'turned.jpg') : call;
  };
  const confirm = (deviceToken: string, ticket: string) => http().post('/attendance/clock/confirm').send({ deviceToken, ticket });
  const assisted = (deviceToken: string, approverPin: string, staffId: string) =>
    http().post('/attendance/clock/assisted').field('deviceToken', deviceToken).field('approverPin', approverPin).field('staffId', staffId);
  /** Scans a face on the outlet's phone and confirms it, as a person at the door does. */
  async function scan(photo: Buffer, second?: Buffer, deviceToken = phone): Promise<Punched> {
    const found = (await identify(deviceToken, photo, second).expect(200)).body as Identify;
    expect(found.ticket).not.toBeNull();
    return (await confirm(deviceToken, found.ticket!).expect(200)).body as Punched;
  }
  const consentNow = (more: Record<string, unknown> = {}) =>
    JSON.stringify({ consentVersion: FACE_CONSENT_VERSION, language: 'TE', acceptedAt: clock.now().toISOString(), acceptedBy: 'EMPLOYEE', ...more });
  const enrol = (token: string, staffId: string, photos: Buffer[], consent: string | null = consentNow()) => {
    let call = http().post(`/staff/${staffId}/face`).set(bearer(token));
    if (consent !== null) call = call.field('consent', consent);
    photos.forEach((photo, index) => (call = call.attach('photos', photo, `face-${index}.jpg`)));
    return call;
  };
  const three = (id: string) => [face(id, {}, 'front'), face(id, { turn: 0.2 }, 'left'), face(id, { turn: -0.2 }, 'right')];
  const sheet = async (token: string, date?: string) => (await http().get('/staff/attendance/day').query({ outletId, ...(date && { date }) }).set(bearer(token)).expect(200)).body as Sheet;
  const cellOf = async (staffId: string, date: string) => (await sheet(owner, date)).people.find((person) => person.staffId === staffId)!;
  const mark = (token: string, date: string, staffId: string, status: string | null, reason?: string) =>
    http().put('/staff/attendance/day').set(bearer(token)).send({ outletId, date, marks: [{ staffId, status }], ...(reason !== undefined && { reason }) });
  const punchesOf = async (token: string, staffId: string, month: string) =>
    (await http().get('/attendance/punches').query({ staffId, month }).set(bearer(token)).expect(200)).body as { days: (Cell & { date: string; entries: PunchRow[] })[] };
  const review = async (token: string) =>
    (await http().get('/attendance/review').query({ outletId }).set(bearer(token)).expect(200)).body as { punches: PunchRow[]; days: { staffId: string; date: string; flags: string[] }[] };
  const record = (staffId: string, date: string) =>
    prisma.client.attendanceRecord.findUnique({ where: { staffMemberId_date: { staffMemberId: staffId, date: new Date(`${date}T00:00:00.000Z`) } } });

  async function cleanUp() {
    const db = prisma.client;
    const names = [MANAGER_NAME, CHEF_NAME];
    await db.session.deleteMany({ where: { OR: [{ deviceName: DEVICE }, { user: { name: { in: names } } }] } });
    await db.user.deleteMany({ where: { name: { in: names } } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    for (const code of [OUTLET_CODE, OTHER_OUTLET_CODE]) {
      const outlet = await db.outlet.findUnique({ where: { code }, select: { id: true } });
      if (!outlet) continue;
      const staff = await db.staffMember.findMany({ where: { outletId: outlet.id }, select: { id: true } });
      const punches = await db.attendancePunch.findMany({ where: { outletId: outlet.id }, select: { id: true } });
      await db.auditLog.deleteMany({ where: { entityId: { in: [outlet.id, ...staff.map((row) => row.id), ...punches.map((row) => row.id)] } } });
      // Punches, templates, consents, attendance and pay records go with their person.
      await db.staffMember.deleteMany({ where: { outletId: outlet.id } });
      const photos = await db.attachment.findMany({ where: { outletId: outlet.id }, select: { id: true, storageKey: true } });
      for (const photo of photos) await app.get(StorageService).remove(photo.storageKey).catch(() => undefined);
      await db.attachment.deleteMany({ where: { outletId: outlet.id } });
      await db.hygieneScoreSnapshot.deleteMany({ where: { outletId: outlet.id } });
      await db.outlet.delete({ where: { id: outlet.id } });
    }
  }

  const link = async (code: string) => (await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200)).body.deviceToken as string;
  async function pinLogin(code: string, pin: string) {
    const deviceToken = await link(code);
    return (await http().post('/auth/pin/login').send({ deviceToken, pin }).expect(200)).body.token as string;
  }
  async function newLogin(name: string, role: 'MANAGER' | 'HEAD_CHEF') {
    const made = await http().post('/restaurant-users').set(bearer(owner)).send({ name, role, outletId }).expect(201);
    return { pin: made.body.pin as string, token: await pinLogin(OUTLET_CODE, made.body.pin as string) };
  }
  async function addPerson(name: string, at: string, more: Record<string, unknown> = {}) {
    const made = await http().post('/staff/people').set(bearer(owner)).send({ outletId: at, name, payType: 'DAILY', payPaise: 60000, ...more }).expect(201);
    // As if added three weeks ago: nobody is marked absent for a day before they were in the app.
    await prisma.client.staffMember.update({ where: { id: made.body.id as string }, data: { createdAt: ist(shiftDate(today, -21), '10:00') } });
    return made.body.id as string;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    clock = app.get(AttendanceClock);
    attendance = app.get(AttendanceService);
    await cleanUp();

    const seeded = await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } });
    organizationId = seeded.organizationId;
    const outlet = (name: string, code: string) => prisma.client.outlet.create({ data: { organizationId, name, code, address: 'Test Road' } });
    outletId = (await outlet('E2E face outlet', OUTLET_CODE)).id;
    otherOutletId = (await outlet('E2E face outlet two', OTHER_OUTLET_CODE)).id;

    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    ({ pin: managerPin, token: manager } = await newLogin(MANAGER_NAME, 'MANAGER'));
    ({ pin: chefPin, token: chef } = await newLogin(CHEF_NAME, 'HEAD_CHEF'));
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    phone = await link(OUTLET_CODE);
    otherPhone = await link(OTHER_OUTLET_CODE);
    // The Owner's own phone belongs to the restaurant as a whole, not to one outlet.
    await prisma.client.linkedDevice.create({ data: { organizationId, tokenHash: sha256(OWNER_PHONE_TOKEN), name: DEVICE } });

    cookId = await addPerson('E2E Face Cook', outletId, { jobTitle: 'Tandoor cook' });
    porterId = await addPerson('E2E Face Porter', outletId, { weeklyOffDay: weekdayOf(F) });
    helperId = await addPerson('E2E Face Helper', outletId);
    elsewhereId = await addPerson('E2E Face Elsewhere', otherOutletId);
    setClock(A, '08:50');
  }, 60_000);

  afterAll(async () => {
    clock.setForTest(null);
    await cleanUp();
    await app.close();
  });

  // ───────────────────────── Enrolment ─────────────────────────

  it('enrols a face only for the Owner, only with the employee’s own consent, and only from good photos', async () => {
    // No consent, someone else's consent, or consent given days ago: refused.
    expect((await enrol(owner, cookId, three('cook'), null).expect(400)).body.code).toBe('CONSENT_REQUIRED');
    expect((await enrol(owner, cookId, three('cook'), consentNow({ acceptedBy: 'OWNER' })).expect(400)).body.code).toBe('CONSENT_REQUIRED');
    expect((await enrol(owner, cookId, three('cook'), consentNow({ acceptedAt: ist(shiftDate(A, -2), '09:00').toISOString() })).expect(400)).body.code).toBe('CONSENT_REQUIRED');

    // The Manager and the Head Chef cannot enrol anyone; another restaurant cannot even see the person.
    await enrol(manager, cookId, three('cook')).expect(403);
    await enrol(chef, cookId, three('cook')).expect(403);
    await enrol(otherManager, cookId, three('cook')).expect(404);

    // Three to five photos, each of one clear face, all of the same person.
    await enrol(owner, cookId, three('cook').slice(0, 2)).expect(400);
    const twoFaces = await enrol(owner, cookId, [face('cook'), fakePhoto([{ id: 'cook' }, { id: 'passer-by', size: 60 }]), face('cook')]).expect(400);
    expect(twoFaces.body).toMatchObject({ code: 'MANY_FACES', photo: 2 });
    expect((await enrol(owner, cookId, [face('cook'), face('cook'), face('cook', { size: 50 })]).expect(400)).body).toMatchObject({ code: 'FACE_TOO_SMALL', photo: 3 });
    expect((await enrol(owner, cookId, [face('cook', { dark: true }), face('cook'), face('cook')]).expect(400)).body).toMatchObject({ code: 'TOO_DARK_OR_BLURRED', photo: 1 });
    expect((await enrol(owner, cookId, [face('cook'), Buffer.from('not a picture at all'), face('cook')]).expect(400)).body).toMatchObject({ code: 'PHOTO_UNREADABLE', photo: 2 });
    expect((await enrol(owner, cookId, [face('cook'), face('someone-else'), face('cook')]).expect(400)).body).toMatchObject({ code: 'FACES_DIFFER', photo: 2 });
    expect(await prisma.client.faceTemplate.count({ where: { staffMemberId: cookId } })).toBe(0);

    const enrolled = (await enrol(owner, cookId, three('cook')).expect(201)).body as FaceStatus;
    expect(enrolled).toMatchObject({ staffId: cookId, enrolled: true, templates: 3, consentVersion: FACE_CONSENT_VERSION, consentLanguage: 'TE', withdrawnAt: null });
    expect(enrolled.consentAt).toBe(clock.now().toISOString());

    // What is stored is a locked template (nonce, check tag, then 128 numbers), never a photo; and the consent beside it.
    const templates = await prisma.client.faceTemplate.findMany({ where: { staffMemberId: cookId } });
    expect(templates.map((template) => template.vector.length)).toEqual([540, 540, 540]);
    expect(await prisma.client.attachment.count({ where: { outletId } })).toBe(0);
    expect(await prisma.client.faceConsent.findMany({ where: { staffMemberId: cookId } })).toMatchObject([{ version: FACE_CONSENT_VERSION, language: 'TE', acceptedBy: 'EMPLOYEE', endedAt: null }]);
    expect(await prisma.client.auditLog.count({ where: { entityId: cookId, action: 'face.enrol' } })).toBe(1);

    // The Manager can see where the enrolment stands; the Head Chef cannot.
    expect((await http().get(`/staff/${cookId}/face`).set(bearer(manager)).expect(200)).body).toMatchObject({ enrolled: true, templates: 3 });
    await http().get(`/staff/${cookId}/face`).set(bearer(chef)).expect(403);
    await http().get(`/staff/${cookId}/face`).set(bearer(otherManager)).expect(404);
  });

  it('refuses a face that is already enrolled as someone else at the outlet, but not across outlets', async () => {
    const refused = await enrol(owner, helperId, three('cook')).expect(409);
    expect(refused.body).toMatchObject({ code: 'FACE_ALREADY_ENROLLED', staff: { staffId: cookId, name: 'E2E Face Cook' } });
    expect(await prisma.client.faceTemplate.count({ where: { staffMemberId: helperId } })).toBe(0);

    // Faces are never compared across outlets: the same face at the second outlet is a different matter.
    expect((await enrol(owner, elsewhereId, three('cook')).expect(201)).body).toMatchObject({ enrolled: true });
  });

  // ───────────────────────── The linked phone ─────────────────────────

  it('answers only a phone linked to an outlet', async () => {
    expect((await identify('no-such-phone', face('cook')).expect(401)).body.code).toBe('DEVICE_NOT_LINKED');
    expect((await confirm('no-such-phone', 'ticket').expect(401)).body.code).toBe('DEVICE_NOT_LINKED');
    expect((await assisted('no-such-phone', managerPin, cookId).expect(401)).body.code).toBe('DEVICE_NOT_LINKED');
    expect((await http().get('/attendance/clock/roster').query({ deviceToken: 'no-such-phone' }).expect(401)).body.code).toBe('DEVICE_NOT_LINKED');
    await http().get('/attendance/clock/roster').expect(401);
    expect((await identify(OWNER_PHONE_TOKEN, face('cook')).expect(400)).body.code).toBe('DEVICE_HAS_NO_OUTLET');

    // The roster is names and job titles for the picker, and nothing else.
    const roster = (await http().get('/attendance/clock/roster').query({ deviceToken: phone }).expect(200)).body;
    expect(roster).toEqual({
      outletId,
      outletName: 'E2E face outlet',
      faceReady: true,
      people: [
        { staffId: cookId, name: 'E2E Face Cook', jobTitle: 'Tandoor cook', enrolled: true },
        { staffId: helperId, name: 'E2E Face Helper', jobTitle: null, enrolled: false },
        { staffId: porterId, name: 'E2E Face Porter', jobTitle: null, enrolled: false },
      ],
    });
  });

  it('tells the app what is wrong with a photo, and matches nobody it does not know', async () => {
    setClock(A, '08:55');
    await http().post('/attendance/clock/identify').field('deviceToken', phone).expect(400);
    expect((await identify(phone, fakePhoto([])).expect(400)).body.code).toBe('NO_FACE');
    expect((await identify(phone, fakePhoto([{ id: 'cook' }, { id: 'friend' }])).expect(400)).body.code).toBe('MANY_FACES');
    expect((await identify(phone, face('cook', { size: 50 })).expect(400)).body.code).toBe('FACE_TOO_SMALL');
    expect((await identify(phone, face('cook', { blurred: true })).expect(400)).body.code).toBe('TOO_DARK_OR_BLURRED');
    expect((await identify(phone, Buffer.from('not a picture at all')).expect(400)).body.code).toBe('PHOTO_UNREADABLE');
    expect((await identify(phone, Buffer.concat([face('cook'), Buffer.alloc(FACE_RULES.maxPhotoBytes)])).expect(400)).body.code).toBe('PHOTO_TOO_LARGE');
    expect((await identify(phone, face('cook'), fakePhoto([])).expect(400)).body).toMatchObject({ code: 'NO_FACE', photo: 2 });

    const stranger = (await identify(phone, face('a-stranger')).expect(200)).body as Identify;
    expect(stranger).toEqual({ result: 'NO_MATCH', candidate: null, nextKind: null, lastPunchAt: null, lastPunchKind: null, already: false, ticket: null, ticketExpiresAt: null, enrolledHere: expect.any(Number) });
    // Someone small in the background does not get in the way.
    const withBackground = (await identify(phone, fakePhoto([{ id: 'cook' }, { id: 'passer-by', size: 60 }])).expect(200)).body as Identify;
    expect(withBackground).toMatchObject({ result: 'MATCH', candidate: { staffId: cookId } });
  });

  it('never matches the staff of another outlet', async () => {
    // The same face is enrolled at both outlets: each phone finds only its own outlet's person.
    expect(((await identify(phone, face('cook')).expect(200)).body as Identify).candidate).toEqual({ staffId: cookId, name: 'E2E Face Cook' });
    expect(((await identify(otherPhone, face('cook')).expect(200)).body as Identify).candidate).toEqual({ staffId: elsewhereId, name: 'E2E Face Elsewhere' });
    // And a ticket is good only on the phone it was given to.
    const found = (await identify(phone, face('cook')).expect(200)).body as Identify;
    expect((await confirm(otherPhone, found.ticket!).expect(400)).body.code).toBe('TICKET_INVALID');
    expect(await prisma.client.attendancePunch.count({ where: { outletId: { in: [outletId, otherOutletId] } } })).toBe(0);
  });

  // ───────────────────────── Clocking in and out ─────────────────────────

  it('marks nothing on identify, and writes a clock-in on confirm, at the server’s time', async () => {
    setClock(A, '09:00');
    const found = (await identify(phone, face('cook')).expect(200)).body as Identify;
    expect(found).toMatchObject({ result: 'MATCH', candidate: { staffId: cookId, name: 'E2E Face Cook' }, nextKind: 'IN', lastPunchAt: null, already: false });
    expect(found.ticketExpiresAt).toBe(new Date(ist(A, '09:00').getTime() + FACE_RULES.ticketSeconds * 1000).toISOString());
    expect(await prisma.client.attendancePunch.count({ where: { staffMemberId: cookId } })).toBe(0);

    const tampered = `${found.ticket!.slice(0, -1)}${found.ticket!.endsWith('0') ? '1' : '0'}`;
    expect((await confirm(phone, tampered).expect(400)).body.code).toBe('TICKET_INVALID');
    expect((await confirm(phone, 'not-a-ticket').expect(400)).body.code).toBe('TICKET_INVALID');

    const punched = (await confirm(phone, found.ticket!).expect(200)).body as Punched;
    expect(punched).toMatchObject({ result: 'RECORDED', staffId: cookId, name: 'E2E Face Cook', kind: 'IN', at: ist(A, '09:00').toISOString(), day: A, workedMinutesToday: 0, flag: null });
    punchIds.firstIn = punched.punchId;
    const row = await prisma.client.attendancePunch.findUniqueOrThrow({ where: { id: punched.punchId } });
    expect(row).toMatchObject({ outletId, method: 'FACE', kind: 'IN', flag: null, createdById: null, voidedAt: null });
    expect(row.score).toBeCloseTo(1, 3);
    expect(row.deviceId).not.toBeNull();
    expect(row.photoId).not.toBeNull();

    // A ticket works once.
    expect((await confirm(phone, found.ticket!).expect(409)).body.code).toBe('TICKET_USED');
    expect(await prisma.client.attendancePunch.count({ where: { staffMemberId: cookId } })).toBe(1);

    // The day shows as present so far, and on duty.
    expect(await cellOf(cookId, A)).toMatchObject({ status: 'PRESENT', source: 'PUNCHES', provisional: true, onDuty: true, punches: 1, firstInAt: ist(A, '09:00').toISOString(), enrolled: true });
  });

  it('takes a second scan within a few seconds as the same one', async () => {
    clock.setForTest(new Date(ist(A, '09:00').getTime() + 5_000));
    const found = (await identify(phone, face('cook')).expect(200)).body as Identify;
    expect(found).toMatchObject({ result: 'MATCH', already: true, nextKind: 'IN', lastPunchKind: 'IN', lastPunchAt: ist(A, '09:00').toISOString() });
    const again = (await confirm(phone, found.ticket!).expect(200)).body as Punched;
    expect(again).toMatchObject({ result: 'ALREADY', punchId: punchIds.firstIn, kind: 'IN', at: ist(A, '09:00').toISOString() });
    expect(await prisma.client.attendancePunch.count({ where: { staffMemberId: cookId } })).toBe(1);
  });

  it('lets a ticket run out after two minutes', async () => {
    setClock(A, '09:20');
    const found = (await identify(phone, face('cook')).expect(200)).body as Identify;
    expect(found).toMatchObject({ nextKind: 'OUT', already: false });
    clock.setForTest(new Date(ist(A, '09:20').getTime() + (FACE_RULES.ticketSeconds + 1) * 1000));
    expect((await confirm(phone, found.ticket!).expect(410)).body.code).toBe('TICKET_EXPIRED');
    expect(await prisma.client.attendancePunch.count({ where: { staffMemberId: cookId } })).toBe(1);
  });

  it('clocks out on the next scan and adds up the time worked, split shifts included', async () => {
    setClock(A, '13:00');
    expect(await scan(face('cook'))).toMatchObject({ result: 'RECORDED', kind: 'OUT', day: A, workedMinutesToday: 240 });
    setClock(A, '17:00');
    expect(await scan(face('cook'))).toMatchObject({ kind: 'IN', workedMinutesToday: 240 });
    setClock(A, '19:30');
    // Still on shift: the time so far counts the shift that is running.
    expect(await cellOf(cookId, A)).toMatchObject({ onDuty: true, workedMinutes: 390, punches: 3 });
    setClock(A, '22:00');
    expect(await scan(face('cook'))).toMatchObject({ kind: 'OUT', workedMinutesToday: 540 });
    expect(await cellOf(cookId, A)).toMatchObject({ status: 'PRESENT', onDuty: false, workedMinutes: 540, punches: 4, firstInAt: ist(A, '09:00').toISOString(), lastOutAt: ist(A, '22:00').toISOString() });
  });

  it('keeps a shift that runs past midnight on the day it started, and starts a new day at 4 am', async () => {
    setClock(B, '18:00');
    expect(await scan(face('cook'))).toMatchObject({ kind: 'IN', day: B });
    // 1:30 am on the next calendar date is still the same attendance day.
    setClock(C, '01:30');
    expect(await scan(face('cook'))).toMatchObject({ kind: 'OUT', day: B, workedMinutesToday: 450 });
    // The sheet with no date given is still that day's.
    expect(await sheet(owner)).toMatchObject({ date: B, today: B });

    setClock(C, '04:10');
    const found = (await identify(phone, face('cook')).expect(200)).body as Identify;
    expect(found).toMatchObject({ nextKind: 'IN', lastPunchAt: null, already: false });
    expect((await confirm(phone, found.ticket!).expect(200)).body).toMatchObject({ kind: 'IN', day: C, workedMinutesToday: 0 });
    // ...and that clock-in is never followed by a clock-out.
  });

  it('records a failed "turn your head" check as a possible spoof for the Owner, without refusing the punch', async () => {
    setClock(D, '10:00');
    // The head really turned between the two photos: nothing to mark.
    expect(await scan(face('cook'), face('cook', { turn: 0.3 }, 'turned'))).toMatchObject({ kind: 'IN', day: D, flag: null });
    setClock(D, '11:00');
    // The second photo shows no turn at all, as a printed photo held up twice would.
    const flat = await scan(face('cook'), face('cook', {}, 'second'));
    expect(flat).toMatchObject({ result: 'RECORDED', kind: 'OUT', flag: 'POSSIBLE_SPOOF', workedMinutesToday: 60 });
    punchIds.spoof = flat.punchId;
  });

  it('lets an unsure match be confirmed, and marks it', async () => {
    setClock(E, '09:00');
    const found = (await identify(phone, face('cook', { like: 0.45 })).expect(200)).body as Identify;
    expect(found).toMatchObject({ result: 'UNSURE', candidate: { staffId: cookId }, nextKind: 'IN' });
    const punched = (await confirm(phone, found.ticket!).expect(200)).body as Punched;
    expect(punched).toMatchObject({ result: 'RECORDED', kind: 'IN', flag: 'UNSURE_MATCH' });
    punchIds.unsure = punched.punchId;
    expect((await prisma.client.attendancePunch.findUniqueOrThrow({ where: { id: punched.punchId } })).score).toBeCloseTo(0.45, 2);
    // Too poor a likeness is nobody at all.
    expect(((await identify(phone, face('cook', { like: 0.3 })).expect(200)).body as Identify).result).toBe('NO_MATCH');

    setClock(E, '18:00');
    expect(await scan(face('cook'))).toMatchObject({ kind: 'OUT', workedMinutesToday: 540, flag: null });
  });

  // ───────────────────────── The assisted route ─────────────────────────

  it('clocks someone in on the Owner’s or a Manager’s PIN only, and marks the punch as assisted', async () => {
    setClock(E, '09:30');
    const wrongPin = ['1111', '2222', '3333', '4444'].find((pin) => ![PINS.owner, managerPin, chefPin].includes(pin))!;
    await assisted(phone, wrongPin, porterId).expect(401);
    // A wrong PIN here counts towards the phone's lock exactly as on the PIN screen.
    expect((await prisma.client.linkedDevice.findUniqueOrThrow({ where: { tokenHash: sha256(phone) } })).failedPinAttempts).toBe(1);
    expect((await assisted(phone, chefPin, porterId).expect(403)).body.code).toBe('APPROVER_NOT_ALLOWED');
    await assisted(phone, '12', porterId).expect(400);
    expect((await assisted(phone, managerPin, 'no-such-person').expect(400)).body.code).toBe('NOT_ON_STAFF');
    expect((await assisted(phone, managerPin, elsewhereId).expect(400)).body.code).toBe('NOT_ON_STAFF');
    expect(await prisma.client.attendancePunch.count({ where: { staffMemberId: porterId } })).toBe(0);

    const byManager = (await assisted(phone, managerPin, porterId).attach('photo', face('porter'), 'porter.jpg').expect(200)).body as Punched;
    expect(byManager).toMatchObject({ result: 'RECORDED', staffId: porterId, name: 'E2E Face Porter', kind: 'IN', day: E, flag: 'ASSISTED' });
    punchIds.assisted = byManager.punchId;
    const row = await prisma.client.attendancePunch.findUniqueOrThrow({ where: { id: byManager.punchId } });
    expect(row).toMatchObject({ method: 'ASSISTED', flag: 'ASSISTED', score: null, reviewedAt: null });
    expect(row.createdById).not.toBeNull();
    expect(row.photoId).not.toBeNull();
    expect((await prisma.client.linkedDevice.findUniqueOrThrow({ where: { tokenHash: sha256(phone) } })).failedPinAttempts).toBe(0);

    clock.setForTest(new Date(Date.parse(byManager.at) + 5_000));
    expect((await assisted(phone, managerPin, porterId).expect(200)).body).toMatchObject({ result: 'ALREADY', punchId: byManager.punchId });

    // When the Owner vouches, the Owner has already seen it.
    setClock(E, '18:30');
    const byOwner = (await assisted(phone, PINS.owner, porterId).expect(200)).body as Punched;
    expect(byOwner).toMatchObject({ result: 'RECORDED', kind: 'OUT', flag: 'ASSISTED', workedMinutesToday: 540 });
    expect((await prisma.client.attendancePunch.findUniqueOrThrow({ where: { id: byOwner.punchId } })).reviewedAt).not.toBeNull();
  });

  it('limits how many scans one phone may send in a minute', async () => {
    setClock(E, '20:00');
    for (let sent = 0; sent < FACE_RULES.identifyPerMinute; sent += 1) await identify(otherPhone, face('a-stranger')).expect(200);
    expect((await identify(otherPhone, face('a-stranger')).expect(429)).body.code).toBe('TOO_MANY_SCANS');
    // A minute later the phone is welcome again, and the other phone was never held up.
    await identify(phone, face('a-stranger')).expect(200);
    setClock(E, '20:02');
    await identify(otherPhone, face('a-stranger')).expect(200);
  }, 60_000);

  // ───────────────────────── From punches to a day's status ─────────────────────────

  it('settles the days that have ended: by the hours worked, the weekly off, and absent with no punch', async () => {
    setClock(today, '10:00');
    expect(await attendance.closeDays(clock.now(), outletId)).toBeGreaterThan(0);

    const days = async (staffId: string) =>
      Object.fromEntries(
        await Promise.all(
          [A, B, C, D, E, F, today].map(async (date) => {
            const row = await record(staffId, date);
            return [date, row && { status: row.status, source: row.source, workedMinutes: row.workedMinutes, flags: row.flags }] as const;
          }),
        ),
      );
    expect(await days(cookId)).toEqual({
      // 4 hours and 5 hours: a full day.
      [A]: { status: 'PRESENT', source: 'PUNCHES', workedMinutes: 540, flags: [] },
      // 7 and a half hours, less than the 8 of a full day: a half day.
      [B]: { status: 'HALF_DAY', source: 'PUNCHES', workedMinutes: 450, flags: [] },
      // Clocked in and never out: the time is not known, and the benefit of the doubt goes to the worker until the Owner settles it.
      [C]: { status: 'PRESENT', source: 'PUNCHES', workedMinutes: null, flags: ['NO_CLOCK_OUT'] },
      // One hour: absent, and marked so the Owner sees it.
      [D]: { status: 'ABSENT', source: 'PUNCHES', workedMinutes: 60, flags: ['POSSIBLE_SPOOF', 'SHORT_DAY'] },
      [E]: { status: 'PRESENT', source: 'PUNCHES', workedMinutes: 540, flags: ['UNSURE_MATCH'] },
      [F]: { status: 'ABSENT', source: 'PUNCHES', workedMinutes: 0, flags: [] },
      // Today has no punch yet, so nothing is said about it.
      [today]: null,
    });
    expect(await days(porterId)).toMatchObject({
      [A]: { status: 'ABSENT' },
      [E]: { status: 'PRESENT', workedMinutes: 540, flags: ['ASSISTED'] },
      // Their usual day off.
      [F]: { status: 'WEEKLY_OFF' },
      [today]: null,
    });
    // Nothing is said about the days before the outlet's first punch.
    expect(await record(cookId, shiftDate(A, -1))).toBeNull();
    // Running it again changes nothing.
    expect(await attendance.closeDays(clock.now(), outletId)).toBe(0);

    expect(await cellOf(cookId, C)).toMatchObject({ status: 'PRESENT', provisional: true, flags: ['NO_CLOCK_OUT'], workedMinutes: null, onDuty: false });
    expect(await cellOf(cookId, today)).toMatchObject({ status: null, source: null, punches: 0 });
  });

  // ───────────────────────── Reading ─────────────────────────

  it('shows the punches and their photos to the Owner and the Manager, and only today’s sheet to the Head Chef', async () => {
    const month = A.slice(0, 7);
    const list = await punchesOf(manager, cookId, month);
    const dayA = list.days.find((day) => day.date === A)!;
    expect(dayA).toMatchObject({ status: 'PRESENT', workedMinutes: 540, hasPhoto: true });
    expect(dayA.entries.map((entry) => [entry.kind, entry.method, entry.voided])).toEqual([
      ['IN', 'FACE', false],
      ['OUT', 'FACE', false],
      ['IN', 'FACE', false],
      ['OUT', 'FACE', false],
    ]);
    // The photo opens through its signed link, and for a logged-in Owner or Manager.
    const photoPath = dayA.entries[0]!.photoPath!;
    expect(photoPath).toContain('/attachments/');
    expect((await http().get(photoPath).expect(200)).headers['content-type']).toBe('image/jpeg');
    for (const token of [owner, manager]) {
      expect((await http().get(`/attendance/punches/${punchIds.firstIn}/photo`).set(bearer(token)).expect(200)).headers['content-type']).toBe('image/jpeg');
    }
    await http().get(`/attendance/punches/${punchIds.firstIn}/photo`).set(bearer(chef)).expect(403);
    await http().get(`/attendance/punches/${punchIds.firstIn}/photo`).set(bearer(otherManager)).expect(404);
    await http().get(`/attendance/punches/${punchIds.firstIn}/photo`).expect(401);

    await http().get('/attendance/punches').query({ staffId: cookId, month }).set(bearer(chef)).expect(403);
    await http().get('/attendance/punches').query({ staffId: cookId, month }).set(bearer(otherManager)).expect(404);
    await http().get('/attendance/review').query({ outletId }).set(bearer(chef)).expect(403);
    await http().get('/attendance/review').query({ outletId }).set(bearer(otherManager)).expect(403);

    // The Head Chef sees who is in today, with no photos, and no other day.
    setClock(E, '19:00');
    const forChef = await sheet(chef);
    expect(forChef).toMatchObject({ date: E, today: E, editable: false });
    expect(forChef.people.find((person) => person.staffId === cookId)).toMatchObject({ status: 'PRESENT', onDuty: false, hasPhoto: false, firstInAt: ist(E, '09:00').toISOString() });
    await http().get('/staff/attendance/day').query({ outletId, date: D }).set(bearer(chef)).expect(403);
    expect((await sheet(manager, E)).people.find((person) => person.staffId === cookId)).toMatchObject({ hasPhoto: true });
    expect(await sheet(manager, D)).toMatchObject({ date: D, editable: false });
    setClock(today, '10:00');
    expect(await sheet(owner, D)).toMatchObject({ editable: true });

    // The month views carry the same facts, day by day.
    const outletMonth = (await http().get('/staff/attendance/month').query({ outletId, month }).set(bearer(manager)).expect(200)).body as { people: { staffId: string; days: Record<string, Cell> }[] };
    expect(outletMonth.people.find((person) => person.staffId === cookId)!.days[A]).toMatchObject({ status: 'PRESENT', workedMinutes: 540, punches: 4 });
    const personMonth = (await http().get(`/staff/people/${cookId}/attendance`).query({ month }).set(bearer(owner)).expect(200)).body as { marks: Record<string, string>; days: Record<string, Cell> };
    expect(personMonth.marks[A]).toBe('PRESENT');
    expect(personMonth.days[A]).toMatchObject({ firstInAt: ist(A, '09:00').toISOString(), lastOutAt: ist(A, '22:00').toISOString() });
  });

  it('lists for the Owner what is waiting: marked punches and days whose status is a stand-in', async () => {
    const waiting = await review(owner);
    expect(waiting.punches.map((punch) => punch.id).sort()).toEqual([punchIds.spoof, punchIds.unsure, punchIds.assisted].sort());
    expect(waiting.punches.find((punch) => punch.id === punchIds.assisted)).toMatchObject({ method: 'ASSISTED', flag: 'ASSISTED', createdByName: MANAGER_NAME });
    expect(waiting.days.map((day) => [day.staffId, day.date, day.flags])).toEqual([
      [cookId, D, ['POSSIBLE_SPOOF', 'SHORT_DAY']],
      [cookId, C, ['NO_CLOCK_OUT']],
    ]);

    // The Manager can read the list but cannot settle anything on it.
    expect((await review(manager)).punches).toHaveLength(3);
    await http().post(`/attendance/punches/${punchIds.unsure}/review`).set(bearer(manager)).expect(403);
    const seen = (await http().post(`/attendance/punches/${punchIds.unsure}/review`).set(bearer(owner)).expect(200)).body as PunchRow;
    expect(seen.reviewedAt).not.toBeNull();
    expect((await review(owner)).punches.map((punch) => punch.id).sort()).toEqual([punchIds.spoof, punchIds.assisted].sort());
  });

  // ───────────────────────── The Owner's corrections ─────────────────────────

  it('refuses hand-marking to the Manager and the Head Chef, and to the Owner without a reason', async () => {
    for (const token of [manager, chef]) {
      await mark(token, today, cookId, 'PRESENT', REASON).expect(403);
      await mark(token, D, cookId, 'PRESENT', REASON).expect(403);
      await http().put('/attendance/day').set(bearer(token)).send({ outletId, staffId: cookId, date: D, status: 'PRESENT', reason: REASON }).expect(403);
      await http().post('/attendance/punches').set(bearer(token)).send({ staffId: cookId, at: ist(C, '14:10').toISOString(), kind: 'OUT', reason: REASON }).expect(403);
      await http().post(`/attendance/punches/${punchIds.spoof}/void`).set(bearer(token)).send({ reason: REASON }).expect(403);
    }
    expect((await mark(owner, D, cookId, 'PRESENT').expect(400)).body.code).toBe('REASON_REQUIRED');
    expect((await mark(owner, D, cookId, 'PRESENT', 'ok').expect(400)).body.code).toBe('REASON_REQUIRED');
    await http().put('/attendance/day').set(bearer(owner)).send({ outletId, staffId: cookId, date: D, status: 'PRESENT', reason: 'ok' }).expect(400);
    await mark(owner, shiftDate(today, 1), cookId, 'LEAVE', REASON).expect(400);
    await mark(owner, D, elsewhereId, 'PRESENT', REASON).expect(400);
    expect(await record(cookId, D)).toMatchObject({ status: 'ABSENT', source: 'PUNCHES' });
  });

  it('keeps the Owner’s correction of a day when the punches are worked out again', async () => {
    const corrected = (await mark(owner, D, cookId, 'PRESENT', REASON).expect(200)).body as Sheet;
    const person = corrected.people.find((row) => row.staffId === cookId)!;
    expect(person).toMatchObject({ status: 'PRESENT', source: 'OWNER', note: REASON, provisional: false, flags: ['POSSIBLE_SPOOF'], punches: 2 });
    expect(person.markedByName).not.toBeNull();
    expect((await review(owner)).days.map((day) => day.date)).toEqual([C]);

    // Settling the days again, and a change to that day's punches, leave the Owner's entry alone.
    await attendance.closeDays(clock.now(), outletId);
    const extra = (await http().post('/attendance/punches').set(bearer(owner)).send({ staffId: cookId, at: ist(D, '12:00').toISOString(), kind: 'IN', reason: REASON }).expect(201)).body as PunchRow;
    expect(await record(cookId, D)).toMatchObject({ status: 'PRESENT', source: 'OWNER', note: REASON });
    await http().post(`/attendance/punches/${extra.id}/void`).set(bearer(owner)).send({ reason: REASON }).expect(200);
    expect(await record(cookId, D)).toMatchObject({ status: 'PRESENT', source: 'OWNER' });

    // Taking the Owner's entry away goes back to what the punches say.
    await http().put('/attendance/day').set(bearer(owner)).send({ outletId, staffId: cookId, date: D, status: null, reason: REASON }).expect(204);
    expect(await record(cookId, D)).toMatchObject({ status: 'ABSENT', source: 'PUNCHES', workedMinutes: 60 });

    // Leave is the Owner's to record.
    await http().put('/attendance/day').set(bearer(owner)).send({ outletId, staffId: cookId, date: F, status: 'LEAVE', reason: 'Went to his village' }).expect(204);
    expect(await record(cookId, F)).toMatchObject({ status: 'LEAVE', source: 'OWNER', note: 'Went to his village' });
    expect(await prisma.client.auditLog.count({ where: { entityId: cookId, action: 'attendance.day.correct' } })).toBe(3);
  });

  it('lets the Owner add a missing punch and void a wrong one, each with a reason, never deleting anything', async () => {
    const add = (body: Record<string, unknown>) => http().post('/attendance/punches').set(bearer(owner)).send({ staffId: cookId, at: ist(C, '14:10').toISOString(), kind: 'OUT', reason: REASON, ...body });
    await add({ reason: 'no' }).expect(400);
    await add({ at: ist(shiftDate(today, 1), '09:00').toISOString() }).expect(400);
    await add({ kind: 'BREAK' }).expect(400);

    const added = (await add({}).expect(201)).body as PunchRow;
    expect(added).toMatchObject({ day: C, kind: 'OUT', method: 'CORRECTION', flag: null, note: REASON, voided: false });
    expect(added.createdByName).not.toBeNull();
    // 4:10 am to 2:10 pm: ten hours, and nothing left for the Owner to settle.
    expect(await record(cookId, C)).toMatchObject({ status: 'PRESENT', source: 'PUNCHES', workedMinutes: 600, flags: [] });
    // (Day D's short day is still on the list.)
    expect((await review(owner)).days.map((day) => day.date)).toEqual([D]);

    await http().post(`/attendance/punches/${added.id}/void`).set(bearer(owner)).send({ reason: 'no' }).expect(400);
    const voided = (await http().post(`/attendance/punches/${added.id}/void`).set(bearer(owner)).send({ reason: 'Wrong time typed' }).expect(200)).body as PunchRow;
    expect(voided).toMatchObject({ voided: true, voidReason: 'Wrong time typed' });
    expect(voided.voidedAt).not.toBeNull();
    await http().post(`/attendance/punches/${added.id}/void`).set(bearer(owner)).send({ reason: REASON }).expect(409);
    expect(await record(cookId, C)).toMatchObject({ status: 'PRESENT', workedMinutes: null, flags: ['NO_CLOCK_OUT'] });
    // Struck out, not gone.
    const dayC = (await punchesOf(owner, cookId, C.slice(0, 7))).days.find((day) => day.date === C)!;
    expect(dayC.entries.map((entry) => [entry.kind, entry.method, entry.voided])).toEqual([
      ['IN', 'FACE', false],
      ['OUT', 'CORRECTION', true],
    ]);

    await add({ at: ist(C, '13:10').toISOString() }).expect(201);
    expect(await record(cookId, C)).toMatchObject({ status: 'PRESENT', workedMinutes: 540, flags: [] });
    expect(await prisma.client.auditLog.count({ where: { action: { in: ['attendance.punch.add', 'attendance.punch.void'] }, entityId: added.id } })).toBe(2);
  });

  // ───────────────────────── Pay ─────────────────────────

  it('works the pay out from the punches, with no hand-marking anywhere', async () => {
    // 600 a day. A full day, a half day, a full day (after the correction), an absence, a full day, a day of leave.
    const worth: Record<string, number> = { [A]: 1, [B]: 0.5, [C]: 1, [D]: 0, [E]: 1, [F]: 1 };
    const status: Record<string, string> = { [A]: 'PRESENT', [B]: 'HALF_DAY', [C]: 'PRESENT', [D]: 'ABSENT', [E]: 'PRESENT', [F]: 'LEAVE' };
    // The six days may straddle two months; each month is checked on its own days.
    for (const month of new Set(Object.keys(worth).map((date) => date.slice(0, 7)))) {
      const dates = Object.keys(worth).filter((date) => date.startsWith(month));
      const paidDays = dates.reduce((sum, date) => sum + worth[date]!, 0);
      const pay = (await http().get(`/staff/people/${cookId}/salary`).query({ month }).set(bearer(owner)).expect(200)).body as {
        payType: string;
        ratePaise: number;
        paidDays: number;
        computedDuePaise: number;
        totals: { present: number; halfDay: number; absent: number; leave: number };
      };
      expect(pay).toMatchObject({ payType: 'DAILY', ratePaise: 60000, paidDays, computedDuePaise: paidDays * 60000 });
      const count = (wanted: string) => dates.filter((date) => status[date] === wanted).length;
      expect(pay.totals).toMatchObject({ present: count('PRESENT'), halfDay: count('HALF_DAY'), absent: count('ABSENT'), leave: count('LEAVE') });
    }
  });

  it('lets the Owner alone change what counts as a full day, and works the days out again', async () => {
    const settings = (token: string) => http().get(`/attendance/settings/${outletId}`).set(bearer(token));
    const save = (token: string, body: Record<string, unknown>) => http().put(`/attendance/settings/${outletId}`).set(bearer(token)).send(body);
    expect((await settings(manager).expect(200)).body).toEqual({ outletId, fullDayMinutes: 480, halfDayMinutes: 240, dayStartsAtHour: 4, isDefault: true });
    await settings(chef).expect(403);
    await save(manager, { fullDayMinutes: 420, halfDayMinutes: 200 }).expect(403);
    await save(owner, { fullDayMinutes: 200, halfDayMinutes: 420 }).expect(400);

    expect((await save(owner, { fullDayMinutes: 420, halfDayMinutes: 200 }).expect(200)).body).toMatchObject({ fullDayMinutes: 420, halfDayMinutes: 200, isDefault: false });
    // Day B's seven and a half hours is now a full day; the leave the Owner entered is untouched.
    expect(await record(cookId, B)).toMatchObject({ status: 'PRESENT', workedMinutes: 450 });
    expect(await record(cookId, F)).toMatchObject({ status: 'LEAVE', source: 'OWNER' });
  });

  // ───────────────────────── Forgetting a face ─────────────────────────

  it('deletes the templates when consent is withdrawn', async () => {
    await http().delete(`/staff/${cookId}/face`).set(bearer(manager)).expect(403);
    await http().delete(`/staff/${cookId}/face`).set(bearer(chef)).expect(403);
    const withdrawn = (await http().delete(`/staff/${cookId}/face`).set(bearer(owner)).expect(200)).body as FaceStatus;
    expect(withdrawn).toMatchObject({ enrolled: false, templates: 0, enrolledAt: null });
    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect(await prisma.client.faceTemplate.count({ where: { staffMemberId: cookId } })).toBe(0);
    expect(await prisma.client.faceConsent.findMany({ where: { staffMemberId: cookId } })).toMatchObject([{ endedReason: 'WITHDRAWN' }]);
    expect(await prisma.client.auditLog.count({ where: { entityId: cookId, action: 'face.withdraw' } })).toBe(1);

    // The camera no longer knows them; their attendance stays; the assisted route still works.
    expect(((await identify(phone, face('cook')).expect(200)).body as Identify).result).toBe('NO_MATCH');
    expect(await record(cookId, A)).toMatchObject({ status: 'PRESENT' });
    expect((await assisted(phone, managerPin, cookId).expect(200)).body).toMatchObject({ result: 'RECORDED', kind: 'IN', flag: 'ASSISTED' });
  });

  it('deletes the templates when a person leaves', async () => {
    expect((await enrol(owner, helperId, three('helper')).expect(201)).body).toMatchObject({ enrolled: true, templates: 3 });
    expect(((await identify(phone, face('helper')).expect(200)).body as Identify).candidate).toMatchObject({ staffId: helperId });
    // Enrolling again replaces the templates and starts a new consent record; the old one is kept, ended.
    setClock(today, '10:10');
    expect((await enrol(owner, helperId, [...three('helper'), face('helper', {}, 'fourth')]).expect(201)).body).toMatchObject({ templates: 4 });
    expect((await prisma.client.faceConsent.findMany({ where: { staffMemberId: helperId }, orderBy: { createdAt: 'asc' } })).map((row) => row.endedReason)).toEqual(['REENROLLED', null]);

    await http().patch(`/staff/people/${helperId}`).set(bearer(manager)).send({ leftOn: indiaDate(clock.now()) }).expect(200);
    expect(await prisma.client.faceTemplate.count({ where: { staffMemberId: helperId } })).toBe(0);
    expect((await prisma.client.faceConsent.findMany({ where: { staffMemberId: helperId }, orderBy: { createdAt: 'asc' } })).map((row) => row.endedReason)).toEqual(['REENROLLED', 'LEFT']);
    expect(await prisma.client.auditLog.count({ where: { entityId: helperId, action: 'face.delete.left' } })).toBe(1);
    expect(((await identify(phone, face('helper')).expect(200)).body as Identify).result).toBe('NO_MATCH');
    // Someone who has left cannot be enrolled, or clocked in.
    expect((await enrol(owner, helperId, three('helper')).expect(400)).body.code).toBe('NOT_ON_STAFF');
    setClock(today, '10:30');
    expect((await assisted(phone, managerPin, helperId).expect(400)).body.code).toBe('NOT_ON_STAFF');
  });

  // ───────────────────────── Housekeeping ─────────────────────────

  it('deletes punch photos after 35 days, keeping the punch', async () => {
    const punch = await prisma.client.attendancePunch.findUniqueOrThrow({ where: { id: punchIds.firstIn } });
    const photoId = punch.photoId!;
    // Nothing of this outlet's is old enough yet.
    clock.setForTest(null);
    await attendance.cleanUpPhotos();
    expect(await prisma.client.attachment.count({ where: { id: photoId } })).toBe(1);

    // As if that photo had been taken 36 days ago.
    await prisma.client.attachment.update({ where: { id: photoId }, data: { createdAt: new Date(Date.now() - (FACE_RULES.punchPhotoDays + 1) * 86_400_000) } });
    const others = await prisma.client.attachment.count({ where: { outletId, kind: 'PUNCH', id: { not: photoId } } });
    expect(await attendance.cleanUpPhotos()).toBeGreaterThanOrEqual(1);
    expect(await prisma.client.attachment.count({ where: { id: photoId } })).toBe(0);
    expect(await prisma.client.attachment.count({ where: { outletId, kind: 'PUNCH', id: { not: photoId } } })).toBe(others);
    expect(await prisma.client.attendancePunch.findUniqueOrThrow({ where: { id: punchIds.firstIn } })).toMatchObject({ photoId: null, voidedAt: null });
    await http().get(`/attendance/punches/${punchIds.firstIn}/photo`).set(bearer(owner)).expect(404);
    setClock(today, '10:30');
    const dayA = (await punchesOf(owner, cookId, A.slice(0, 7))).days.find((day) => day.date === A)!;
    expect(dayA.entries[0]!.photoPath).toBeNull();
    expect(dayA.entries[1]!.photoPath).not.toBeNull();
  });

  it('answers "not available" when the face models are missing, and the assisted route goes on working', async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(FACE_ENGINE).useValue(new OffFaceEngine()).compile();
    const second = moduleFixture.createNestApplication();
    await second.init();
    try {
      const server = request(second.getHttpServer() as App);
      const refused = await server.post('/attendance/clock/identify').field('deviceToken', phone).attach('photo', face('cook'), 'face.jpg').expect(503);
      expect(refused.body.code).toBe('FACE_ENGINE_UNAVAILABLE');
      const enrolment = await server.post(`/staff/${porterId}/face`).set(bearer(owner)).field('consent', consentNow({ acceptedAt: new Date().toISOString() })).attach('photos', face('porter'), 'a.jpg').attach('photos', face('porter'), 'b.jpg').attach('photos', face('porter'), 'c.jpg').expect(503);
      expect(enrolment.body.code).toBe('FACE_ENGINE_UNAVAILABLE');
      expect((await server.get('/attendance/clock/roster').query({ deviceToken: phone }).expect(200)).body).toMatchObject({ faceReady: false });
      // The assisted route needs no face engine. (An unknown person keeps this from writing a punch at today's real time.)
      expect((await server.post('/attendance/clock/assisted').field('deviceToken', phone).field('approverPin', managerPin).field('staffId', 'no-such-person').expect(400)).body.code).toBe('NOT_ON_STAFF');
    } finally {
      await second.close();
    }
  }, 60_000);
});
