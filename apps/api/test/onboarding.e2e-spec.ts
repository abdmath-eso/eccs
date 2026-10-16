// Onboarding a new team member (Stage D, 16 Oct 2026): who sees what (the Super Admin
// everything; the Ops Manager the checklist and nothing of the papers; the new hire only their
// own; another BDE, a Supervisor and a restaurant user refused); the file routes refusing the
// joining documents and the letter to everyone but the Super Admin and the person, and the
// ordinary signed links refusing them outright; starting onboarding from Add and from an
// existing member; template changes not reaching checklists already started; the joining file
// saved and masked (a whole Aadhaar number refused); documents uploaded, accepted and sent
// back; the letter made, made again before acceptance, accepted, and replaced; the handbook
// accepted with its version; tasks ticking themselves; the Team list's Joining state and the
// keep-an-eye-on rule; and no personal value in any activity log row.
//
// Everything is a throwaway made here (logins, their team details, files, a handbook version)
// and removed again. The Supervisor's checklist template is set to a known one for the run and
// put back exactly as it was afterwards; the sample people are only logged in.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { addDays, type JoiningPageDto, type OnboardingTemplatesDto, type PersonOnboardingDto, type TeamListDto, type TeamMemberDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ActivityLogService } from './../src/activity-log/activity-log.service.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { StorageService } from './../src/storage/storage.service.js';

const MARK = 'E2E Onboard';
const DEVICE = 'e2e-onboarding';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003' };
const MINE = { hire: '+919199900081', other: '+919199900082', later: '+919199900083', old: '+919199900084', second: '+919199900085', secret: '+919199900086' };
const OWNER = { code: 'SPICE-JH2K7M', pin: '2580' };
// Values no activity log row may ever hold.
const SECRET = { last4: '7319', pan: 'QWEPZ6543K', account: '506070809011', ifsc: 'KKBK0007319', address: 'Secret Tamarind Street', dob: '1993-07-21', salary: 3_141_500 };

// A 1-by-1 PNG and a tiny PDF: enough for the server to know what they are.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

/** The Supervisor's template for the run: one task of each kind the rules know. */
const TEST_TASKS = [
  { phase: 'BEFORE_JOINING', title: `${MARK} details`, owner: 'NEW_HIRE', daysFromJoining: -3, auto: 'DETAILS' },
  { phase: 'BEFORE_JOINING', title: `${MARK} documents`, owner: 'SUPER_ADMIN', daysFromJoining: -2, auto: 'DOCUMENTS' },
  { phase: 'BEFORE_JOINING', title: `${MARK} letter`, owner: 'NEW_HIRE', daysFromJoining: -2, auto: 'LETTER' },
  { phase: 'BEFORE_JOINING', title: `${MARK} handbook`, owner: 'NEW_HIRE', daysFromJoining: -1, auto: 'HANDBOOK' },
  { phase: 'BEFORE_JOINING', title: `${MARK} kit`, owner: 'OPS_MANAGER', daysFromJoining: -5, auto: null },
  { phase: 'FIRST_DAY', title: `${MARK} login`, owner: 'NEW_HIRE', daysFromJoining: 0, auto: 'APP_LOGIN' },
  { phase: 'FIRST_DAY', title: `${MARK} welcome`, owner: 'OPS_MANAGER', daysFromJoining: 0, auto: null },
  { phase: 'FIRST_DAY', title: `${MARK} read the safety sheets`, owner: 'NEW_HIRE', daysFromJoining: 0, auto: null },
  { phase: 'FIRST_MONTH', title: `${MARK} check-in`, owner: 'SUPER_ADMIN', daysFromJoining: 30, auto: null },
];
const TEST_DOCUMENTS = [
  { kind: 'PHOTO', required: true },
  { kind: 'ID_PROOF', required: true },
  { kind: 'BANK_PROOF', required: true },
  { kind: 'POLICE_VERIFICATION', required: true },
  { kind: 'EDUCATION', required: false },
];

describe('Onboarding (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let activity: ActivityLogService;
  let storage: StorageService;
  let admin: string;
  let ops: string;
  let supervisor: string;
  let owner: string;
  let hire: string;
  let other: string;
  const id = { hire: '', other: '', later: '', old: '', second: '' };
  const today = indiaDate();
  const joins = addDays(today, 3);
  let saved: { template: unknown; tasks: unknown[] } | null = null;
  const handbookIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const person = async (token: string, userId: string): Promise<PersonOnboardingDto> => (await http().get(`/onboarding/people/${userId}`).set(bearer(token)).expect(200)).body;
  const mine = async (token: string): Promise<JoiningPageDto> => (await http().get('/onboarding/me').set(bearer(token)).expect(200)).body.page;
  const list = async (token: string): Promise<TeamListDto> => (await http().get('/team').set(bearer(token)).expect(200)).body;
  const addMember = (body: Record<string, unknown>) => http().post('/team').set(bearer(admin)).send(body);
  const task = (dto: PersonOnboardingDto | JoiningPageDto, title: string) => {
    const tasks = 'onboarding' in dto ? dto.onboarding!.phases.flatMap((phase) => phase.tasks) : [...dto.firstWeek, ...dto.myTasks];
    return tasks.find((entry) => entry.title === `${MARK} ${title}`)!;
  };

  async function otpLogin(phone: string, deviceName = DEVICE) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    return (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName }).expect(200)).body.token as string;
  }
  async function pinLogin(code: string, pin: string) {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    return (await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200)).body.token as string;
  }

  async function cleanUp() {
    const db = prisma.client;
    const users = await db.user.findMany({ where: { phone: { in: Object.values(MINE) } }, select: { id: true, teamMember: { select: { id: true } } } });
    const memberIds = users.map((user) => user.teamMember?.id).filter((value): value is string => Boolean(value));
    // Their files: the store's copies and the records, then the logins (their team details, checklists, file, documents and letters go with them).
    const files = await db.attachment.findMany({ where: { OR: memberIds.map((memberId) => ({ storageKey: { startsWith: `team/${memberId}/` } })) }, select: { id: true, storageKey: true } });
    const letters = await db.appointmentLetter.findMany({ where: { memberId: { in: memberIds }, pdfKey: { not: null } }, select: { pdfKey: true } });
    for (const key of [...files.map((file) => file.storageKey), ...letters.map((letter) => letter.pdfKey!)]) await storage?.remove(key).catch(() => undefined);
    if (memberIds.length > 0) await db.attachment.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
    await db.session.deleteMany({ where: { OR: [{ deviceName: { in: [DEVICE, 'ECCS console'] }, userId: { in: users.map((user) => user.id) } }, { deviceName: DEVICE }] } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await db.staffHandbook.deleteMany({ where: { id: { in: handbookIds } } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: [...Object.values(PHONES), ...Object.values(MINE)] } } });
    if (activity) {
      await activity.flush();
      await db.activityLog.deleteMany({ where: { id: { in: activity.recordedForTest() } } });
    }
  }

  /** Sets the Supervisor's template to the known one for the run, keeping the real one to put back. */
  async function useTestTemplate() {
    const db = prisma.client;
    const existing = await db.onboardingTemplate.findUnique({ where: { role: 'SUPERVISOR' }, include: { tasks: true } });
    if (existing) {
      const { tasks, ...template } = existing;
      saved = { template, tasks };
      await db.onboardingTemplate.delete({ where: { id: existing.id } });
    }
    await db.onboardingTemplate.create({
      data: { role: 'SUPERVISOR', documents: TEST_DOCUMENTS, tasks: { create: TEST_TASKS.map((entry, position) => ({ ...entry, required: true, position })) } },
    });
  }

  async function restoreTemplate() {
    const db = prisma.client;
    await db.onboardingTemplate.deleteMany({ where: { role: 'SUPERVISOR' } });
    if (saved) {
      await db.onboardingTemplate.create({ data: saved.template as never });
      await db.onboardingTemplateTask.createMany({ data: saved.tasks as never });
    }
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    activity = app.get(ActivityLogService);
    storage = app.get(StorageService);
    await cleanUp();
    await useTestTemplate();
    admin = await otpLogin(PHONES.admin);
    ops = await otpLogin(PHONES.ops);
    supervisor = await otpLogin(PHONES.supervisor);
    owner = await pinLogin(OWNER.code, OWNER.pin);
  }, 90_000);

  afterAll(async () => {
    activity?.setForTest({ on: false });
    if (prisma) {
      await restoreTemplate();
      await cleanUp();
    }
    await app?.close();
  });

  // ───────────────────────── Starting ─────────────────────────

  describe('starting onboarding', () => {
    it('starts from Add a team member, for someone joining on a day ahead, with the template copied and due days from the joining day', async () => {
      const added = (await addMember({ name: `${MARK} Kiran`, phone: MINE.hire, role: 'SUPERVISOR', area: 'Banjara Hills', joinedOn: joins, monthlySalaryPaise: 3_000_000, startOnboarding: true }).expect(201)).body as TeamMemberDto;
      id.hire = added.userId;
      const page = await person(admin, id.hire);
      expect(page.onboarding).not.toBeNull();
      const tasks = page.onboarding!.phases.flatMap((phase) => phase.tasks);
      expect(tasks.map((entry) => entry.title)).toEqual(TEST_TASKS.map((entry) => entry.title));
      expect(task(page, 'kit').dueOn).toBe(addDays(joins, -5));
      expect(task(page, 'check-in').dueOn).toBe(addDays(joins, 30));
      expect(page.onboarding!.progress).toMatchObject({ done: 0, total: TEST_TASKS.length, late: 0, doneOn: null });
      // One per person.
      await http().post(`/onboarding/people/${id.hire}/start`).set(bearer(admin)).expect(409);
    });

    it('shows Joining on the Team list', async () => {
      const row = (await list(admin)).members.find((entry) => entry.userId === id.hire)!;
      expect(row.today.words).toMatch(/^Joins \w{3} \d{1,2} \w{3}$/);
      expect(row.onboarding).toEqual({ done: 0, total: TEST_TASKS.length, late: 0, words: `Onboarding 0 of ${TEST_TASKS.length}` });
      expect(row.week).toBeNull();
      expect(row.flag).toBeNull();
    });

    it('starts for an existing member from their page, a due day already past late only from the next day', async () => {
      const added = (await addMember({ name: `${MARK} Old`, phone: MINE.old, role: 'SUPERVISOR', joinedOn: addDays(today, -40) }).expect(201)).body as TeamMemberDto;
      id.old = added.userId;
      expect(await person(admin, id.old)).toEqual({ onboarding: null, canStart: true });
      // The Ops Manager may not start one.
      await http().post(`/onboarding/people/${id.old}/start`).set(bearer(ops)).expect(403);
      expect((await person(ops, id.old)).canStart).toBe(false);
      const started = (await http().post(`/onboarding/people/${id.old}/start`).set(bearer(admin)).expect(201)).body as PersonOnboardingDto;
      expect(task(started, 'kit').dueOn).toBe(addDays(today, -45));
      expect(started.onboarding!.progress.late).toBe(0);
      // A day later (the start moved back a day), every task past its day is 1 day late.
      await prisma.client.onboarding.update({ where: { id: started.onboarding!.id }, data: { startedOn: new Date(`${addDays(today, -1)}T00:00:00.000Z`) } });
      const next = await person(admin, id.old);
      expect(task(next, 'kit')).toMatchObject({ daysLate: 1, dueWords: '1 day late' });
    });

    it('copies the template as it is when each onboarding starts: later changes never reach a checklist already started', async () => {
      const templates = (await http().get('/onboarding/templates').set(bearer(admin)).expect(200)).body as OnboardingTemplatesDto;
      expect(templates.templates.map((entry) => entry.role)).toEqual(['OPS_MANAGER', 'SUPERVISOR', 'BDE']);
      const changed = (
        await http()
          .post('/onboarding/templates/SUPERVISOR/tasks')
          .set(bearer(admin))
          .send({ phase: 'FIRST_WEEK', title: `${MARK} added later`, owner: 'OPS_MANAGER', daysFromJoining: 3 })
          .expect(201)
      ).body as OnboardingTemplatesDto;
      expect(changed.templates.find((entry) => entry.role === 'SUPERVISOR')!.tasks.some((entry) => entry.title === `${MARK} added later` && entry.phase === 'FIRST_WEEK')).toBe(true);
      // A day outside its phase is refused.
      await http().post('/onboarding/templates/SUPERVISOR/tasks').set(bearer(admin)).send({ phase: 'FIRST_DAY', title: 'x', owner: 'OPS_MANAGER', daysFromJoining: 4 }).expect(400);
      expect((await person(admin, id.hire)).onboarding!.progress.total).toBe(TEST_TASKS.length);
      const second = (await addMember({ name: `${MARK} Second`, phone: MINE.second, role: 'SUPERVISOR', joinedOn: joins, startOnboarding: true }).expect(201)).body as TeamMemberDto;
      id.second = second.userId;
      expect((await person(admin, id.second)).onboarding!.progress.total).toBe(TEST_TASKS.length + 1);
      // Only the Super Admin changes templates.
      await http().get('/onboarding/templates').set(bearer(ops)).expect(403);
    });
  });

  // ───────────────────────── Who sees what ─────────────────────────

  describe('who sees what', () => {
    it('gives the Ops Manager the checklist and nothing of the file, documents, letter or salary', async () => {
      const page = await person(ops, id.hire);
      expect(page.onboarding).toMatchObject({ file: null, documents: null, letter: null, handbook: null, canEdit: false });
      expect(JSON.stringify(page)).not.toContain('3000000');
      expect(task(page, 'kit').canTick).toBe(true);
      expect(task(page, 'check-in').canTick).toBe(false);
      await http().post(`/onboarding/people/${id.hire}/tasks/${task(page, 'check-in').id}/tick`).set(bearer(ops)).send({ done: true }).expect(403);
      const ticked = (await http().post(`/onboarding/people/${id.hire}/tasks/${task(page, 'kit').id}/tick`).set(bearer(ops)).send({ done: true, note: 'Size M' }).expect(200)).body as PersonOnboardingDto;
      expect(task(ticked, 'kit')).toMatchObject({ done: true, note: 'Size M', doneBy: 'Sample Ops Manager' });
      await http().get(`/onboarding/people/${id.hire}/details`).set(bearer(ops)).expect(403);
      await http().put(`/onboarding/people/${id.hire}/details`).set(bearer(ops)).send({ uniformSize: 'L' }).expect(403);
      await http().post(`/onboarding/people/${id.hire}/letter`).set(bearer(ops)).expect(403);
      await http().post(`/onboarding/people/${id.hire}/tasks`).set(bearer(ops)).send({ title: 'x', owner: 'OPS_MANAGER', dueOn: today }).expect(403);
    });

    it("gives the new hire their own page and nothing of anyone else's", async () => {
      hire = await otpLogin(MINE.hire);
      const page = await mine(hire);
      expect(page).toMatchObject({ name: `${MARK} Kiran`, role: 'SUPERVISOR', joinedOn: joins, left: 4 });
      expect(page.todo.map((entry) => entry.key)).toEqual(['DETAILS', 'DOCUMENTS', 'LETTER', 'HANDBOOK']);
      expect(page.myTasks.map((entry) => entry.title)).toEqual([`${MARK} read the safety sheets`]);
      // A Supervisor has no Team grant: nobody's checklist on the Team page, their own included.
      await http().get(`/onboarding/people/${id.hire}`).set(bearer(hire)).expect(403);
      await http().get(`/onboarding/people/${id.second}`).set(bearer(hire)).expect(403);
      // They tick their own task; never one owned by someone else, nor one on another checklist.
      const own = page.myTasks[0]!;
      expect((await http().post(`/onboarding/me/tasks/${own.id}/tick`).set(bearer(hire)).send({ done: true }).expect(200)).body.page.myTasks[0].done).toBe(true);
      const welcome = page.firstWeek.find((entry) => entry.title === `${MARK} welcome`)!;
      expect(welcome.canTick).toBe(false);
      await http().post(`/onboarding/me/tasks/${welcome.id}/tick`).set(bearer(hire)).send({ done: true }).expect(403);
      const theirs = (await person(admin, id.second)).onboarding!.phases.flatMap((phase) => phase.tasks).find((entry) => entry.title === `${MARK} read the safety sheets`)!;
      await http().post(`/onboarding/me/tasks/${theirs.id}/tick`).set(bearer(hire)).send({ done: true }).expect(404);
    });

    it('refuses another BDE, a Supervisor and a restaurant user', async () => {
      const added = (await addMember({ name: `${MARK} Other`, phone: MINE.other, role: 'BDE', joinedOn: addDays(today, -10) }).expect(201)).body as TeamMemberDto;
      id.other = added.userId;
      other = await otpLogin(MINE.other);
      expect((await http().get('/onboarding/me').set(bearer(other)).expect(200)).body).toEqual({ page: null });
      for (const token of [other, supervisor, owner]) {
        await http().get(`/onboarding/people/${id.hire}`).set(bearer(token)).expect(403);
        await http().get('/onboarding/templates').set(bearer(token)).expect(403);
      }
      await http().get('/onboarding/me').set(bearer(owner)).expect(403);
      await http().put('/onboarding/me/details').set(bearer(other)).send({ uniformSize: 'M' }).expect(404);
    });
  });

  // ───────────────────────── The joining file ─────────────────────────

  describe('the joining file', () => {
    it('refuses a whole Aadhaar number, saves half-filled, and ticks itself once complete', async () => {
      const refused = await http().put('/onboarding/me/details').set(bearer(hire)).send({ idType: 'AADHAAR', idLast4: '1234 5678 9012' }).expect(400);
      expect(JSON.stringify(refused.body)).toContain('ECCS never keeps a whole Aadhaar number');
      await http().put('/onboarding/me/details').set(bearer(hire)).send({ currentAddress: 'My Aadhaar 1234 5678 9012' }).expect(400);
      await http().put('/onboarding/me/details').set(bearer(hire)).send({ pan: 'ABCCK1234L' }).expect(400);
      await http().put('/onboarding/me/details').set(bearer(hire)).send({ bankIfsc: 'SBIN1234567' }).expect(400);
      await http().put('/onboarding/me/details').set(bearer(hire)).send({ bankAccount: '123456789012', bankAccountAgain: '123456789013' }).expect(400);

      const half = (await http().put('/onboarding/me/details').set(bearer(hire)).send({ dateOfBirth: '1996-04-12', currentAddress: '4-2-10, Banjara Hills', permanentSame: true, uniformSize: 'M' }).expect(200)).body.page as JoiningPageDto;
      expect(half.file.complete).toBe(false);
      expect(half.file.missing).toContain('Bank account number');
      expect(half.todo[0]).toMatchObject({ key: 'DETAILS', done: false });

      const full = (
        await http()
          .put('/onboarding/me/details')
          .set(bearer(hire))
          .send({
            emergencyName: 'Lakshmi',
            emergencyRelation: 'Mother',
            emergencyPhone: '90000 12345',
            idType: 'AADHAAR',
            idLast4: '4821',
            pan: 'abcpk1234l',
            bankHolder: `${MARK} Kiran`,
            bankAccount: '1234 5678 9012',
            bankAccountAgain: '123456789012',
            bankIfsc: 'sbin0001234',
          })
          .expect(200)
      ).body.page as JoiningPageDto;
      expect(full.file.complete).toBe(true);
      expect(full.file.shown).toMatchObject({ bankAccount: '•••• 9012', pan: '•••• 234L', idLast4: '4821', bankIfsc: 'SBIN0001234', currentAddress: '4-2-10, Banjara Hills' });
      expect(JSON.stringify(full)).not.toContain('123456789012');
      expect(JSON.stringify(full)).not.toContain('ABCPK1234L');
      const admin1 = await person(admin, id.hire);
      expect(task(admin1, 'details')).toMatchObject({ done: true, doneBy: 'the app' });
      expect(admin1.onboarding!.file!.shown.bankAccount).toBe('•••• 9012');
      // Only the Super Admin's edit form gets the whole of it.
      const whole = (await http().get(`/onboarding/people/${id.hire}/details`).set(bearer(admin)).expect(200)).body;
      expect(whole).toMatchObject({ bankAccount: '123456789012', pan: 'ABCPK1234L' });
      // A field left out is kept; the Super Admin can change it for them.
      await http().put(`/onboarding/people/${id.hire}/details`).set(bearer(admin)).send({ bloodGroup: 'O+' }).expect(200);
      expect((await mine(hire)).file.shown).toMatchObject({ bloodGroup: 'O+', bankAccount: '•••• 9012' });
    });
  });

  // ───────────────────────── Documents ─────────────────────────

  describe('documents', () => {
    let photoId = '';

    it('takes a photo or a PDF of a kind asked for, nothing else', async () => {
      await http().post('/onboarding/me/documents').set(bearer(hire)).field('kind', 'MEDICAL_FITNESS').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(400);
      await http().post('/onboarding/me/documents').set(bearer(hire)).field('kind', 'PHOTO').attach('file', Buffer.from('not a picture'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);
      let page = (await http().post('/onboarding/me/documents').set(bearer(hire)).field('kind', 'PHOTO').attach('file', PNG, { filename: 'me.png', contentType: 'image/png' }).expect(201)).body.page as JoiningPageDto;
      page = (await http().post('/onboarding/me/documents').set(bearer(hire)).field('kind', 'ID_PROOF').attach('file', PDF, { filename: 'aadhaar.pdf', contentType: 'application/pdf' }).expect(201)).body.page as JoiningPageDto;
      const photo = page.documents.find((entry) => entry.kind === 'PHOTO')!;
      expect(photo).toMatchObject({ status: 'UPLOADED', pdf: false, required: true });
      expect(page.documents.find((entry) => entry.kind === 'ID_PROOF')).toMatchObject({ status: 'UPLOADED', pdf: true });
      expect(page.documents.find((entry) => entry.kind === 'EDUCATION')).toMatchObject({ status: 'WAITING', required: false });
      photoId = photo.documentId!;
    });

    it('opens the files only for the Super Admin and the person; the ordinary signed link refuses them', async () => {
      const own = await http().get(`/onboarding/documents/${photoId}/file`).set(bearer(hire)).expect(200);
      expect(own.headers['content-type']).toBe('image/png');
      expect(own.headers['cache-control']).toBe('private, no-store');
      await http().get(`/onboarding/documents/${photoId}/file`).set(bearer(admin)).expect(200);
      for (const token of [ops, other, supervisor, owner]) await http().get(`/onboarding/documents/${photoId}/file`).set(bearer(token)).expect(403);
      await http().get(`/onboarding/documents/${photoId}/file`).expect(401);
      const document = await prisma.client.joiningDocument.findUniqueOrThrow({ where: { id: photoId } });
      // Even a correctly signed link, as photos are shown by, is refused for a joining document.
      await http().get(storage.signedPath(document.attachmentId!)).expect(403);
    });

    it('is accepted or sent back by the Super Admin only; sent back, its file is deleted at once', async () => {
      await http().post(`/onboarding/documents/${photoId}/accept`).set(bearer(ops)).expect(403);
      await http().post(`/onboarding/documents/${photoId}/accept`).set(bearer(hire)).expect(403);
      let admin1 = (await http().post(`/onboarding/documents/${photoId}/accept`).set(bearer(admin)).expect(200)).body as PersonOnboardingDto;
      expect(admin1.onboarding!.documents!.find((entry) => entry.kind === 'PHOTO')).toMatchObject({ status: 'ACCEPTED', reviewedBy: 'Sample Founder' });
      // Accepted, the new hire cannot replace it.
      await http().post('/onboarding/me/documents').set(bearer(hire)).field('kind', 'PHOTO').attach('file', PNG, { filename: 'me.png', contentType: 'image/png' }).expect(409);

      const idProof = admin1.onboarding!.documents!.find((entry) => entry.kind === 'ID_PROOF')!;
      const before = await prisma.client.joiningDocument.findUniqueOrThrow({ where: { id: idProof.documentId! } });
      await http().post(`/onboarding/documents/${idProof.documentId}/send-back`).set(bearer(admin)).send({ reason: 'x' }).expect(400);
      admin1 = (await http().post(`/onboarding/documents/${idProof.documentId}/send-back`).set(bearer(admin)).send({ reason: 'Upload the masked Aadhaar' }).expect(200)).body as PersonOnboardingDto;
      expect(admin1.onboarding!.documents!.find((entry) => entry.kind === 'ID_PROOF')).toMatchObject({ status: 'SENT_BACK', reason: 'Upload the masked Aadhaar', documentId: null });
      expect(await prisma.client.attachment.findUnique({ where: { id: before.attachmentId! } })).toBeNull();
      expect((await mine(hire)).documents.find((entry) => entry.kind === 'ID_PROOF')).toMatchObject({ status: 'SENT_BACK', reason: 'Upload the masked Aadhaar' });

      // Uploaded again, and the rest, then accepted: "documents accepted" ticks itself (the police certificate has its own task).
      await http().post('/onboarding/me/documents').set(bearer(hire)).field('kind', 'ID_PROOF').attach('file', PDF, { filename: 'masked.pdf', contentType: 'application/pdf' }).expect(201);
      await http().post(`/onboarding/people/${id.hire}/documents`).set(bearer(admin)).field('kind', 'BANK_PROOF').attach('file', PNG, { filename: 'cheque.png', contentType: 'image/png' }).expect(201);
      await http().post(`/onboarding/people/${id.hire}/documents`).set(bearer(ops)).field('kind', 'BANK_PROOF').attach('file', PNG, { filename: 'cheque.png', contentType: 'image/png' }).expect(403);
      const now = await person(admin, id.hire);
      for (const entry of now.onboarding!.documents!.filter((doc) => doc.status === 'UPLOADED')) {
        await http().post(`/onboarding/documents/${entry.documentId}/accept`).set(bearer(admin)).expect(200);
      }
      expect(task(await person(admin, id.hire), 'documents')).toMatchObject({ done: true, doneBy: 'the app' });
    });
  });

  // ───────────────────────── The appointment letter ─────────────────────────

  describe('the appointment letter', () => {
    let letterId = '';

    it('needs the salary, the date of birth and the address first', async () => {
      const bare = (await addMember({ name: `${MARK} Later`, phone: MINE.later, role: 'BDE', joinedOn: joins, startOnboarding: true }).expect(201)).body as TeamMemberDto;
      id.later = bare.userId;
      const refused = await http().post(`/onboarding/people/${id.later}/letter`).set(bearer(admin)).expect(400);
      expect(refused.body.message).toMatch(/monthly salary.*date of birth.*address/);
      expect((await person(admin, id.later)).onboarding!.letter!.missing.length).toBe(3);
    });

    it("is made with the codes' particulars from Team's records, numbered, and made again when the salary changes before acceptance", async () => {
      const made = (await http().post(`/onboarding/people/${id.hire}/letter`).set(bearer(admin)).expect(200)).body as PersonOnboardingDto;
      const letter = made.onboarding!.letter!.current!;
      letterId = letter.id;
      expect(letter).toMatchObject({ status: 'WAITING', version: 1, madeBy: 'Sample Founder' });
      expect(letter.number).toMatch(new RegExp(`^ECCS/AL/${today.slice(0, 4)}/\\d{4}$`));
      const rows = Object.fromEntries(letter.rows.map((row) => [row.label, row.value]));
      expect(rows).toMatchObject({ Name: `${MARK} Kiran`, 'Date of birth': '12 April 1996', Designation: 'Supervisor', 'Category of skill': 'Skilled', 'Weekly day off': 'Sunday, every week.' });
      expect(rows['Wages']).toMatch(/^₹30,000 a month/);
      expect(rows['Place of work']).toMatch(/^Hyderabad \(Banjara Hills\)/);
      expect(rows['Address']).toBe('4-2-10, Banjara Hills');

      // The salary changes before it is accepted: made again, saying what changed.
      await http().patch(`/team/${id.hire}`).set(bearer(admin)).send({ salary: { monthlyPaise: 3_200_000, from: joins } }).expect(200);
      const page = await mine(hire);
      expect(page.letter).toMatchObject({ id: letterId, version: 2, status: 'WAITING', remadeFor: ['Wages'] });
      expect(page.letter!.rows.find((row) => row.label === 'Wages')!.value).toMatch(/^₹32,000 a month/);
      // The Ops Manager never sees it; its PDF opens for the Super Admin and the person only.
      for (const token of [ops, other, supervisor, owner]) await http().get(`/onboarding/letters/${letterId}/pdf`).set(bearer(token)).expect(403);
      const pdf = await http().get(`/onboarding/letters/${letterId}/pdf`).set(bearer(hire)).expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      await http().get(`/onboarding/letters/${letterId}/pdf`).set(bearer(admin)).expect(200);
    }, 60_000);

    it('is accepted by the new hire, only in the version they read, and then never changes', async () => {
      const stale = await http().post('/onboarding/me/letter/accept').set(bearer(hire)).send({ letterId, version: 1 }).expect(409);
      expect(stale.body.code).toBe('LETTER_CHANGED');
      await http().post('/onboarding/me/letter/accept').set(bearer(other)).send({ letterId, version: 2 }).expect(404);
      const page = (await http().post('/onboarding/me/letter/accept').set(bearer(hire)).send({ letterId, version: 2 }).expect(200)).body.page as JoiningPageDto;
      expect(page.letter).toMatchObject({ status: 'ACCEPTED', acceptedHow: 'CLICK', acceptedBy: `${MARK} Kiran` });
      expect(page.todo.find((entry) => entry.key === 'LETTER')!.done).toBe(true);
      const row = await prisma.client.appointmentLetter.findUniqueOrThrow({ where: { id: letterId } });
      expect(row.acceptedSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(task(await person(admin, id.hire), 'letter')).toMatchObject({ done: true, doneBy: 'the app' });

      // A later raise does not touch the accepted letter.
      await http().patch(`/team/${id.hire}`).set(bearer(admin)).send({ salary: { monthlyPaise: 3_400_000, from: addDays(joins, 10) } }).expect(200);
      const after = (await person(admin, id.hire)).onboarding!.letter!;
      expect(after.current).toMatchObject({ id: letterId, version: 2, status: 'ACCEPTED' });
      await http().post('/onboarding/me/letter/accept').set(bearer(hire)).send({ letterId, version: 2 }).expect(409);
    });

    it('is replaced by a new letter, signed on paper, and the old one stays in the file', async () => {
      const made = (await http().post(`/onboarding/people/${id.hire}/letter`).set(bearer(admin)).expect(200)).body as PersonOnboardingDto;
      const fresh = made.onboarding!.letter!.current!;
      expect(fresh.id).not.toBe(letterId);
      expect(fresh.status).toBe('WAITING');
      await http().post(`/onboarding/letters/${fresh.id}/paper`).set(bearer(ops)).attach('file', PDF, { filename: 'signed.pdf', contentType: 'application/pdf' }).expect(403);
      const signed = (await http().post(`/onboarding/letters/${fresh.id}/paper`).set(bearer(admin)).attach('file', PDF, { filename: 'signed.pdf', contentType: 'application/pdf' }).expect(200)).body as PersonOnboardingDto;
      expect(signed.onboarding!.letter!.current).toMatchObject({ id: fresh.id, status: 'ACCEPTED', acceptedHow: 'PAPER' });
      expect(signed.onboarding!.letter!.earlier).toEqual([expect.objectContaining({ id: letterId, replacedAt: expect.any(String) })]);
    });
  });

  // ───────────────────────── The handbook and logging in ─────────────────────────

  describe('the handbook and the app login', () => {
    it('is accepted in its newest version, and the acceptance keeps the version', async () => {
      const published = (await http().post('/onboarding/handbook').set(bearer(admin)).send({ title: `${MARK} handbook`, body: 'Wear the PPE. Never mix bleach and ammonia.' }).expect(201)).body;
      handbookIds.push((await prisma.client.staffHandbook.findUniqueOrThrow({ where: { version: published.version } })).id);
      await http().post('/onboarding/handbook').set(bearer(ops)).send({ title: 'x', body: 'Wear the PPE, always, everywhere.' }).expect(403);
      await http().post('/onboarding/me/handbook/accept').set(bearer(hire)).send({ version: published.version - 1 }).expect(409);
      const page = (await http().post('/onboarding/me/handbook/accept').set(bearer(hire)).send({ version: published.version }).expect(200)).body.page as JoiningPageDto;
      expect(page.handbookAccepted).toMatchObject({ version: published.version });
      expect(page.todo.find((entry) => entry.key === 'HANDBOOK')!.done).toBe(true);
      expect(task(await person(admin, id.hire), 'handbook')).toMatchObject({ done: true, doneBy: 'the app' });
    });

    it('ticks "logged in to the app" from a login on the phone app, not from the console', async () => {
      // The hire's logins so far were the test's own device: that counts as the app. The second person logs in on the console only.
      expect(task(await person(admin, id.hire), 'login')).toMatchObject({ done: true, doneBy: 'the app' });
      await otpLogin(MINE.second, 'ECCS console');
      expect(task(await person(admin, id.second), 'login').done).toBe(false);
      await otpLogin(MINE.second);
      expect(task(await person(admin, id.second), 'login').done).toBe(true);
    });

    it('cannot untick by hand what ticked itself, and is done when every required task is', async () => {
      const page = await person(admin, id.hire);
      expect(task(page, 'login').canTick).toBe(false);
      await http().post(`/onboarding/people/${id.hire}/tasks/${task(page, 'login').id}/tick`).set(bearer(admin)).send({ done: false }).expect(403);
      // The police certificate has not come yet: the Super Admin ticks the rest by hand, then adds and removes a task.
      for (const title of ['welcome', 'check-in']) await http().post(`/onboarding/people/${id.hire}/tasks/${task(page, title).id}/tick`).set(bearer(admin)).send({ done: true }).expect(200);
      const added = (await http().post(`/onboarding/people/${id.hire}/tasks`).set(bearer(admin)).send({ title: `${MARK} extra`, owner: 'SUPER_ADMIN', dueOn: addDays(joins, 2) }).expect(201)).body as PersonOnboardingDto;
      expect(task(added, 'extra')).toMatchObject({ phase: 'FIRST_WEEK', custom: true, dueOn: addDays(joins, 2) });
      const removed = (await http().delete(`/onboarding/people/${id.hire}/tasks/${task(added, 'extra').id}`).set(bearer(admin)).expect(200)).body as PersonOnboardingDto;
      expect(removed.onboarding!.progress).toMatchObject({ done: TEST_TASKS.length, total: TEST_TASKS.length, doneOn: today });
      // Done: off the Team list's Joining state.
      expect((await list(admin)).members.find((entry) => entry.userId === id.hire)!.onboarding).toBeNull();
    });
  });

  // ───────────────────────── Keep an eye on ─────────────────────────

  describe("the Team page's keep-an-eye-on", () => {
    it('flags late onboarding tasks, the only thing judged before the joining day, and counts them in the menu', async () => {
      const page = await person(admin, id.second);
      // Started five days ago: the kit (due 5 days before joining, 2 days ago) is late.
      await prisma.client.onboarding.update({ where: { id: page.onboarding!.id }, data: { startedOn: new Date(`${addDays(today, -5)}T00:00:00.000Z`) } });
      const teamList = await list(admin);
      const row = teamList.members.find((entry) => entry.userId === id.second)!;
      expect(row.flag?.kind).toBe('ONBOARDING_LATE');
      expect(row.flag?.words).toMatch(/^\d onboarding tasks? late\.$/);
      expect(row.onboarding!.late).toBeGreaterThan(0);
      expect(teamList.flagged).toBeGreaterThanOrEqual(1);
      const member = (await http().get(`/team/${id.second}`).set(bearer(ops)).expect(200)).body as TeamMemberDto;
      expect(member.keep.pick?.kind).toBe('ONBOARDING_LATE');
      expect(member.keep.note).toMatch(/^Joins on \w+day \d+ \w+\.$/);
      expect(member.cards).toEqual([]);
    });
  });

  // ───────────────────────── The activity log ─────────────────────────

  describe('the activity log', () => {
    it('records each change as the action and who did it, never an ID digit, PAN, account, IFSC, address, date of birth or salary', async () => {
      activity.setForTest({ on: true });
      try {
        const added = (await addMember({ name: `${MARK} Secret`, phone: MINE.secret, role: 'SUPERVISOR', joinedOn: joins, monthlySalaryPaise: SECRET.salary, startOnboarding: true }).expect(201)).body as TeamMemberDto;
        const token = await otpLogin(MINE.secret);
        await http()
          .put('/onboarding/me/details')
          .set(bearer(token))
          .send({ dateOfBirth: SECRET.dob, currentAddress: SECRET.address, permanentSame: true, idType: 'AADHAAR', idLast4: SECRET.last4, pan: SECRET.pan, bankAccount: SECRET.account, bankAccountAgain: SECRET.account, bankIfsc: SECRET.ifsc })
          .expect(200);
        await http().post('/onboarding/me/documents').set(bearer(token)).field('kind', 'PHOTO').attach('file', PNG, { filename: 'me.png', contentType: 'image/png' }).expect(201);
        const page = await person(admin, added.userId);
        const photo = page.onboarding!.documents!.find((entry) => entry.kind === 'PHOTO')!;
        await http().get(`/onboarding/documents/${photo.documentId}/file`).set(bearer(admin)).expect(200);
        await http().post(`/onboarding/documents/${photo.documentId}/send-back`).set(bearer(admin)).send({ reason: 'Secret Saffron reason' }).expect(200);
        await http().get(`/onboarding/people/${added.userId}/details`).set(bearer(admin)).expect(200);
        const kit = task(page, 'kit');
        await http().post(`/onboarding/people/${added.userId}/tasks/${kit.id}/tick`).set(bearer(ops)).send({ done: true, note: 'Secret cardamom note' }).expect(200);
        await activity.flush();
        const rows = await prisma.client.activityLog.findMany({ where: { id: { in: activity.recordedForTest() } } });
        const team = rows.filter((row) => row.category === 'team');
        expect(team.map((row) => row.action).sort()).toEqual(
          [
            'team.member.added',
            'team.onboarding.detailsOpened',
            'team.onboarding.detailsSaved',
            'team.onboarding.documentAdded',
            'team.onboarding.documentOpened',
            'team.onboarding.documentSentBack',
            'team.onboarding.taskTicked',
          ].sort(),
        );
        for (const row of team) expect(row).toMatchObject({ details: null, entityId: null, entityLabel: null, actorUserId: expect.any(String) });
        // Ids, times and durations are left out of the search: a random id or a time can hold any four digits.
        const everything = JSON.stringify(
          rows.map(({ id: _id, at: _at, phoneAt: _phoneAt, actorUserId: _actor, organizationId: _organization, outletId: _outlet, entityId: _entity, deviceId: _device, requestId: _request, durationMs: _duration, ...rest }) => rest),
        );
        for (const secret of [SECRET.last4, SECRET.pan, SECRET.account, SECRET.ifsc, 'Tamarind', SECRET.dob, '21 July', String(SECRET.salary), '31415', 'Saffron', 'cardamom', '9199900086']) {
          expect(everything.includes(secret), secret).toBe(false);
        }
      } finally {
        activity.setForTest({ on: false });
      }
    });
  });
});
