// Team: document dates and console access (Stage I, step 1; 20 Oct 2026, the console plan's
// Team part): a medical fitness certificate accepted with the date a year from its upload, a
// date changed and cleared, a document due within 30 days, one missing past the day it was
// expected (and one not yet, its onboarding task still ahead), the due list across the team,
// the Team list's mark and "keep an eye on", the console access card (role, the sections the
// role opens, the last login from either app), and who sees what: the Ops Manager reads the
// due list and the card but changes no date; a Supervisor and a BDE are refused. Mark as left
// switches the login off and ends its sessions.
//
// Everything is a throwaway made here (one login with its team details, onboarding, files and
// sessions) and removed again by the ids recorded as it was made; the sample people are only
// logged in, and their sessions and one-time codes made here are removed by id too.

import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { addDays, consoleAccessGroups, yearsAfter, type PersonOnboardingDto, type TeamDocumentDueDto, type TeamListDto, type TeamMemberDto } from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { StorageService } from './../src/storage/storage.service.js';

const MARK = 'E2E Documents';
const DEVICE = 'e2e-team-documents';
const PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003', bde: '+919000000004' };
const MINE = '+919199900091';
// A 1-by-1 PNG: enough for the server to know what it is.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const ASKED = [
  { kind: 'PHOTO', required: true },
  { kind: 'ID_PROOF', required: true },
  { kind: 'POLICE_VERIFICATION', required: true },
  { kind: 'MEDICAL_FITNESS', required: true },
  { kind: 'EDUCATION', required: false },
];

describe('Team documents and console access (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storage: StorageService;
  const token = { admin: '', ops: '', supervisor: '', bde: '', mine: '' };
  // What this run made, by id, to remove exactly that afterwards.
  const made = { userId: '', memberId: '', sessions: [] as string[], otps: [] as string[] };
  const today = indiaDate();
  const joinedOn = addDays(today, -40);

  const http = () => request(app.getHttpServer());
  const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });
  const member = async (as: string): Promise<TeamMemberDto> => (await http().get(`/team/${made.userId}`).set(bearer(as)).expect(200)).body;
  const papers = async (): Promise<PersonOnboardingDto> => (await http().get(`/onboarding/people/${made.userId}`).set(bearer(token.admin)).expect(200)).body;
  const document = async (kind: string) => (await papers()).onboarding!.documents!.find((entry) => entry.kind === kind)!;
  const upload = (kind: string) =>
    http().post(`/onboarding/people/${made.userId}/documents`).set(bearer(token.admin)).field('kind', kind).attach('file', PNG, { filename: 'document.png', contentType: 'image/png' }).expect(201);

  /** Logs in with the fixed one-time code, recording the code's and the session's ids. */
  async function otpLogin(phone: string, deviceName = DEVICE) {
    const db = prisma.client;
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const otp = await db.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (otp) made.otps.push(otp.id);
    const body = (await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName }).expect(200)).body as { token: string };
    const session = await db.session.findUnique({ where: { tokenHash: createHash('sha256').update(body.token).digest('hex') }, select: { id: true } });
    if (session) made.sessions.push(session.id);
    return body.token;
  }

  async function cleanUp() {
    const db = prisma.client;
    if (made.memberId) {
      // The files of the throwaway's documents: the store's copies, then their records.
      const files = await db.attachment.findMany({ where: { storageKey: { startsWith: `team/${made.memberId}/` } }, select: { id: true, storageKey: true } });
      for (const file of files) await storage.remove(file.storageKey).catch(() => undefined);
      await db.attachment.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
    }
    // The throwaway login takes its team details, onboarding, documents and sessions with it.
    if (made.userId) await db.user.deleteMany({ where: { id: made.userId } });
    await db.session.deleteMany({ where: { id: { in: made.sessions } } });
    await db.otpChallenge.deleteMany({ where: { id: { in: made.otps } } });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    // A login left by an earlier run that stopped half-way (the number is this spec's own).
    const left = await prisma.client.user.findUnique({ where: { phone: MINE }, select: { id: true, teamMember: { select: { id: true } } } });
    if (left) {
      made.userId = left.id;
      made.memberId = left.teamMember?.id ?? '';
      await cleanUp();
      made.userId = '';
      made.memberId = '';
    }
    token.admin = await otpLogin(PHONES.admin);
    token.ops = await otpLogin(PHONES.ops);
    token.supervisor = await otpLogin(PHONES.supervisor);
    token.bde = await otpLogin(PHONES.bde);

    // The throwaway Supervisor, joined 40 days ago, with a known list of documents and one
    // later-document task of its own (the police verification's, due in 5 days).
    const added = (await http().post('/team').set(bearer(token.admin)).send({ name: `${MARK} Meena`, phone: MINE, role: 'SUPERVISOR', joinedOn, startOnboarding: true }).expect(201)).body as TeamMemberDto;
    made.userId = added.userId;
    made.memberId = added.memberId!;
    const db = prisma.client;
    const onboarding = await db.onboarding.findUniqueOrThrow({ where: { memberId: made.memberId }, select: { id: true } });
    await db.onboarding.update({ where: { id: onboarding.id }, data: { documents: ASKED } });
    await db.onboardingTask.deleteMany({ where: { onboardingId: onboarding.id, auto: { in: ['POLICE_CERTIFICATE', 'MEDICAL_CERTIFICATE'] } } });
    await db.onboardingTask.create({ data: { onboardingId: onboarding.id, phase: 'FIRST_MONTH', title: `${MARK} police verification`, owner: 'NEW_HIRE', daysFromJoining: 45, auto: 'POLICE_CERTIFICATE' } });
  }, 90_000);

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
  });

  it('counts a required document missing past the day it was expected, and not one whose task is still ahead', async () => {
    await upload('PHOTO');
    const page = await member(token.admin);
    // ID proof was expected on the joining day; medical fitness 30 days after it (it has no task of its own);
    // police verification by its task, 5 days ahead, so not yet; the optional education certificate never.
    expect(page.dueDocuments.map((entry) => [entry.kind, entry.state])).toEqual([
      ['ID_PROOF', 'MISSING'],
      ['MEDICAL_FITNESS', 'MISSING'],
    ]);
    expect(page.dueDocuments[0]).toMatchObject({ words: 'ID proof missing', date: joinedOn });
    expect((await document('ID_PROOF')).due).toMatchObject({ state: 'MISSING' });
    expect((await document('POLICE_VERIFICATION')).due).toBeNull();
  });

  it('accepts medical fitness with the date a year from its upload, and keeps no date on a document that does not run out', async () => {
    await upload('MEDICAL_FITNESS');
    const uploaded = await document('MEDICAL_FITNESS');
    expect(uploaded).toMatchObject({ status: 'UPLOADED', expiresOn: null, proposedExpiry: yearsAfter(today), due: null });
    const accepted = (await http().post(`/onboarding/documents/${uploaded.documentId}/accept`).set(bearer(token.admin)).expect(200)).body as PersonOnboardingDto;
    expect(accepted.onboarding!.documents!.find((entry) => entry.kind === 'MEDICAL_FITNESS')).toMatchObject({ status: 'ACCEPTED', expiresOn: yearsAfter(today), due: null });
    // A photo accepted with nothing sent has no date.
    const photo = await document('PHOTO');
    await http().post(`/onboarding/documents/${photo.documentId}/accept`).set(bearer(token.admin)).send({}).expect(200);
    expect((await document('PHOTO')).expiresOn).toBeNull();
  });

  it('changes and clears a date, and shows one within 30 days as due everywhere', async () => {
    const medical = await document('MEDICAL_FITNESS');
    // Not before the document was uploaded.
    await http().put(`/onboarding/documents/${medical.documentId}/date`).set(bearer(token.admin)).send({ expiresOn: addDays(today, -1) }).expect(400);
    await http().put(`/onboarding/documents/${medical.documentId}/date`).set(bearer(token.admin)).send({ expiresOn: '3 Nov' }).expect(400);
    await http().put(`/onboarding/documents/${medical.documentId}/date`).set(bearer(token.admin)).send({ expiresOn: addDays(today, 10) }).expect(200);
    expect((await document('MEDICAL_FITNESS')).due).toMatchObject({ state: 'EXPIRING', days: 10, date: addDays(today, 10) });

    const page = await member(token.admin);
    expect(page.dueDocuments.map((entry) => [entry.kind, entry.state])).toEqual([
      ['ID_PROOF', 'MISSING'],
      ['MEDICAL_FITNESS', 'EXPIRING'],
    ]);
    expect(page.documentsDue).toEqual({ count: 2, words: '2 documents due' });
    // Documents due are the last thing to keep an eye on.
    const row = ((await http().get('/team').set(bearer(token.admin)).expect(200)).body as TeamListDto).members.find((entry) => entry.userId === made.userId)!;
    expect(row.documentsDue).toEqual({ count: 2, words: '2 documents due' });
    expect(page.keep.pick?.kind === 'DOCUMENTS_DUE' || page.keep.note.includes('2 documents due')).toBe(true);

    // The due list across the team, for Today: the facts only, never a file.
    const due = (await http().get('/team/documents-due').set(bearer(token.admin)).expect(200)).body as { today: string; items: TeamDocumentDueDto[] };
    const mine = due.items.filter((entry) => entry.userId === made.userId);
    expect(mine.map((entry) => entry.kind)).toEqual(['ID_PROOF', 'MEDICAL_FITNESS']);
    expect(mine[0]).toMatchObject({ name: `${MARK} Meena`, roleLabel: 'Supervisor', state: 'MISSING' });
    expect(JSON.stringify(mine)).not.toMatch(/documentId|storageKey|attachment/);

    // Cleared: medical fitness no longer runs out.
    await http().put(`/onboarding/documents/${medical.documentId}/date`).set(bearer(token.admin)).send({ expiresOn: null }).expect(200);
    expect((await document('MEDICAL_FITNESS')).due).toBeNull();
    expect((await member(token.admin)).dueDocuments.map((entry) => entry.kind)).toEqual(['ID_PROOF']);
  });

  it('refuses a date on a document sent back', async () => {
    await upload('ID_PROOF');
    const id = (await document('ID_PROOF')).documentId!;
    await http().post(`/onboarding/documents/${id}/send-back`).set(bearer(token.admin)).send({ reason: 'Upload the masked Aadhaar' }).expect(200);
    await http().put(`/onboarding/documents/${id}/date`).set(bearer(token.admin)).send({ expiresOn: addDays(today, 100) }).expect(409);
  });

  it("gives the access card the role, what it opens and the last login from either app", async () => {
    const before = (await member(token.admin)).access;
    expect(before).toMatchObject({ role: 'SUPERVISOR', roleLabel: 'Supervisor', loginOn: true, lastLoginAt: null, lastLoginIn: null });
    expect(before.groups).toEqual(consoleAccessGroups('SUPERVISOR'));
    expect(before.groups.flatMap((group) => group.sections).find((section) => section.label === 'Clients')?.note).toBe('Health only');
    expect(before.groups.flatMap((group) => group.sections).map((section) => section.label)).not.toContain('Team');

    token.mine = await otpLogin(MINE);
    const fromApp = (await member(token.admin)).access;
    expect(fromApp.lastLoginIn).toBe('APP');
    expect(Date.now() - new Date(fromApp.lastLoginAt!).getTime()).toBeLessThan(60_000);
    await otpLogin(MINE, 'ECCS console');
    expect((await member(token.admin)).access.lastLoginIn).toBe('CONSOLE');
  });

  it('lets the Ops Manager read the due list and the card but change no date, and refuses a Supervisor and a BDE', async () => {
    await http().get('/team/documents-due').set(bearer(token.ops)).expect(200);
    const seen = await member(token.ops);
    expect(seen.access.role).toBe('SUPERVISOR');
    expect(seen.dueDocuments.length).toBeGreaterThan(0);
    const medical = await document('MEDICAL_FITNESS');
    await http().put(`/onboarding/documents/${medical.documentId}/date`).set(bearer(token.ops)).send({ expiresOn: addDays(today, 5) }).expect(403);
    for (const refused of [token.supervisor, token.bde, token.mine]) {
      await http().get('/team/documents-due').set(bearer(refused)).expect(403);
      await http().get(`/team/${made.userId}`).set(bearer(refused)).expect(403);
      await http().put(`/onboarding/documents/${medical.documentId}/date`).set(bearer(refused)).send({ expiresOn: null }).expect(403);
    }
  });

  it('switches the login off and ends its sessions when marked as left, and then nothing of theirs is due', async () => {
    await http().get('/auth/me').set(bearer(token.mine)).expect(200);
    await http().post(`/team/${made.userId}/mark-left`).set(bearer(token.admin)).send({ leftOn: today }).expect(200);
    await http().get('/auth/me').set(bearer(token.mine)).expect(401);
    const page = await member(token.admin);
    expect(page.access.loginOn).toBe(false);
    expect(page.dueDocuments).toEqual([]);
    expect(page.documentsDue).toBeNull();
    const open = await prisma.client.session.count({ where: { userId: made.userId, revokedAt: null } });
    expect(open).toBe(0);
    const due = (await http().get('/team/documents-due').set(bearer(token.admin)).expect(200)).body as { items: TeamDocumentDueDto[] };
    expect(due.items.some((entry) => entry.userId === made.userId)).toBe(false);
  });
});
