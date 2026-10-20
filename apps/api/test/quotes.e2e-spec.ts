// Sales → Quotes (20 Oct 2026, the console plan 4.9): the list of every quote with where it
// stands (draft, sent, won, declined, expired), the "Build now" free checks with no quote,
// marking a quote won or declined and taking the mark back, a quote won by itself when its
// lead becomes a client, the PDF, the five-day "no reply" follow-up in Do today, and who may
// see what (the Super Admin and the Ops Manager every quote, a BDE their own, the Supervisor
// nothing).
//
// Runs against the local database with the sample seed loaded. Everything is a throwaway it
// makes itself and records by id: two BDE logins, sessions made straight in the database
// for the sample Super Admin, Ops Manager and Supervisor, leads with their quotes and steps,
// and a client to link one to. Clean-up removes exactly those ids, nothing found by name.

import { createHash, randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import {
  addDays,
  FREE_CHECK_POINTS,
  freeCheckPicks,
  indiaMoment,
  type DoTodayItemDto,
  type LeadDetailDto,
  type QuoteDto,
  type QuoteListDto,
  type QuoteOptionDto,
} from '@eccs/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { indiaDate } from './../src/checklists/checklists.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const SAMPLE_PHONES = { admin: '+919000000001', ops: '+919000000002', supervisor: '+919000000003' };
const BDE_PHONES = { a: '+919199900071', b: '+919199900072' };

describe('Quotes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const made = { users: [] as string[], sessions: [] as string[], leads: [] as string[], organizations: [] as string[] };
  const token = { admin: '', ops: '', supervisor: '', a: '', b: '' };
  const bdeId = { a: '', b: '' };
  let options: QuoteOptionDto[];

  const today = indiaDate();
  const http = () => request(app.getHttpServer());
  const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });
  const daysAgo = (days: number, time = '10:00') => indiaMoment(addDays(today, -days), time);

  /** A session made straight in the database: its id is recorded and removed by it. */
  async function session(userId: string): Promise<string> {
    const value = randomBytes(24).toString('hex');
    const row = await prisma.client.session.create({ data: { userId, tokenHash: sha256(value), deviceName: 'e2e quotes', expiresAt: new Date(Date.now() + 3_600_000) } });
    made.sessions.push(row.id);
    return value;
  }

  async function addLead(who: string, name: string): Promise<LeadDetailDto> {
    const lead = (await http().post('/sales/leads').set(bearer(who)).send({ businessName: `E2E Quotes ${name}`, source: 'FIELD_VISIT', contactPhone: '9876500071' }).expect(201)).body as LeadDetailDto;
    made.leads.push(lead.id);
    return lead;
  }
  const service = () => options.find((option) => option.kind === 'SERVICE')!;
  const makeQuote = async (who: string, leadId: string): Promise<QuoteDto> =>
    (await http().post(`/sales/leads/${leadId}/quotes`).set(bearer(who)).send({ lines: [{ kind: 'SERVICE', refId: service().refId, quantity: 1 }] }).expect(201)).body;
  const send = (who: string, quoteId: string) => http().post(`/sales/quotes/${quoteId}/send`).set(bearer(who)).expect(200);
  const list = async (who: string, query: Record<string, string> = {}): Promise<QuoteListDto> => (await http().get('/sales/quotes').query(query).set(bearer(who)).expect(200)).body;
  const row = (data: QuoteListDto, quoteId: string) => data.quotes.find((entry) => entry.id === quoteId);

  async function cleanUp() {
    const db = prisma.client;
    // A lead takes its steps, quotes and follow-ups with it.
    if (made.leads.length > 0) await db.lead.deleteMany({ where: { id: { in: made.leads } } });
    if (made.organizations.length > 0) await db.organization.deleteMany({ where: { id: { in: made.organizations } } });
    if (made.sessions.length > 0) await db.session.deleteMany({ where: { id: { in: made.sessions } } });
    if (made.users.length > 0) await db.user.deleteMany({ where: { id: { in: made.users } } });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const db = prisma.client;
    // A throwaway from an earlier run that stopped half-way would hold these phone numbers.
    if (await db.user.count({ where: { phone: { in: Object.values(BDE_PHONES) } } })) throw new Error('A BDE login from an earlier quotes test run is still there: remove it by hand first');

    for (const key of ['a', 'b'] as const) {
      const user = await db.user.create({ data: { phone: BDE_PHONES[key], name: `E2E Quotes BDE ${key}`, memberships: { create: [{ role: 'BDE' }] } } });
      made.users.push(user.id);
      bdeId[key] = user.id;
      token[key] = await session(user.id);
    }
    for (const key of ['admin', 'ops', 'supervisor'] as const) {
      const user = await db.user.findUniqueOrThrow({ where: { phone: SAMPLE_PHONES[key] }, select: { id: true } });
      token[key] = await session(user.id);
    }
    options = (await http().get('/sales/quote-options').set(bearer(token.admin)).expect(200)).body;
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('refuses the Supervisor and anyone not logged in', async () => {
    await http().get('/sales/quotes').set(bearer(token.supervisor)).expect(403);
    await http().get('/sales/quotes').expect(401);
    const lead = await addLead(token.a, 'Refused');
    const quote = await makeQuote(token.a, lead.id);
    await http().post(`/sales/quotes/${quote.id}/won`).set(bearer(token.supervisor)).expect(403);
    await http().post(`/sales/quotes/${quote.id}/declined`).set(bearer(token.supervisor)).send({ reason: 'No' }).expect(403);
    await http().get(`/sales/quotes/${quote.id}/pdf`).set(bearer(token.supervisor)).expect(403);
  });

  it('lists every quote with where it stands: draft, sent, expired, won and declined', async () => {
    const db = prisma.client;
    const draftLead = await addLead(token.a, 'Draft');
    const draft = await makeQuote(token.a, draftLead.id);
    const sentLead = await addLead(token.a, 'Sent');
    const sent = await makeQuote(token.a, sentLead.id);
    await send(token.a, sent.id);
    const oldLead = await addLead(token.a, 'Expired');
    const old = await makeQuote(token.a, oldLead.id);
    await send(token.a, old.id);
    // Its validity ended yesterday.
    await db.quote.update({ where: { id: old.id }, data: { validUntil: new Date(`${addDays(today, -1)}T00:00:00Z`) } });

    const data = await list(token.a);
    expect(row(data, draft.id)).toMatchObject({ state: 'DRAFT', status: 'DRAFT', sentAt: null, action: 'SEND', latest: true, businessName: 'E2E Quotes Draft', ownerId: bdeId.a });
    expect(row(data, sent.id)).toMatchObject({ state: 'SENT', action: 'OPEN', waitingDays: null, openCount: 0 });
    expect(row(data, old.id)).toMatchObject({ state: 'EXPIRED', action: 'REVISE' });
    expect((await list(token.a, { state: 'EXPIRED' })).quotes.map((entry) => entry.id)).toEqual([old.id]);
    expect(data.counts).toMatchObject({ DRAFT: expect.any(Number), EXPIRED: 1 });

    // Won by hand, taken back, then declined with a reason; the other mark needs a reopen first.
    const won = (await http().post(`/sales/quotes/${sent.id}/won`).set(bearer(token.a)).expect(200)).body as QuoteDto;
    expect(won).toMatchObject({ state: 'WON', outcome: 'WON', outcomeBy: 'E2E Quotes BDE a', outcomeReason: null });
    await http().post(`/sales/quotes/${sent.id}/declined`).set(bearer(token.a)).send({ reason: 'Too dear' }).expect(409);
    expect((await http().post(`/sales/quotes/${sent.id}/reopen`).set(bearer(token.a)).expect(200)).body).toMatchObject({ state: 'SENT', outcome: null });
    await http().post(`/sales/quotes/${sent.id}/reopen`).set(bearer(token.a)).expect(409);
    await http().post(`/sales/quotes/${sent.id}/declined`).set(bearer(token.a)).send({ reason: ' ' }).expect(400);
    const declined = (await http().post(`/sales/quotes/${sent.id}/declined`).set(bearer(token.a)).send({ reason: 'Went with their old vendor' }).expect(200)).body as QuoteDto;
    expect(declined).toMatchObject({ state: 'DECLINED', outcomeReason: 'Went with their old vendor' });
    expect(row(await list(token.a, { state: 'DECLINED' }), sent.id)).toMatchObject({ action: 'OPEN' });
    // A draft has not been offered: it cannot be won or declined.
    await http().post(`/sales/quotes/${draft.id}/won`).set(bearer(token.a)).expect(409);
    // The lead's own page shows the same.
    expect((await http().get(`/sales/leads/${sentLead.id}`).set(bearer(token.a)).expect(200)).body.quotes[0]).toMatchObject({ state: 'DECLINED' });
    // The public page and the open tracking are unchanged by a mark.
    await http().get(`/public/quotes/${declined.link.split('/q/')[1]}`).expect(200);
  });

  it('marks a quote won by itself when its lead becomes a client, and takes it back when the link is undone', async () => {
    const db = prisma.client;
    const lead = await addLead(token.a, 'Becomes Client');
    const quote = await makeQuote(token.a, lead.id);
    await send(token.a, quote.id);
    const organization = await db.organization.create({ data: { name: 'E2E Quotes Client', stateCode: '36' } });
    made.organizations.push(organization.id);
    // A BDE cannot link a lead to a client; the Super Admin does it when onboarding it.
    await http().put(`/sales/leads/${lead.id}/client`).set(bearer(token.a)).send({ organizationId: organization.id }).expect(403);
    await http().put(`/sales/leads/${lead.id}/client`).set(bearer(token.admin)).send({ organizationId: organization.id }).expect(200);
    expect(row(await list(token.a), quote.id)).toMatchObject({ state: 'WON', outcome: 'WON', outcomeBy: null });
    await http().put(`/sales/leads/${lead.id}/client`).set(bearer(token.admin)).send({ organizationId: null }).expect(200);
    expect(row(await list(token.a), quote.id)).toMatchObject({ state: 'SENT', outcome: null });
  });

  it('shows a free check with no quote as "Build now", with the services that fix what it found', async () => {
    const lead = await addLead(token.a, 'Check Done');
    const fixes = new Set(['HOOD', 'PESTS']);
    const answers = FREE_CHECK_POINTS.map((point) => ({ point, answer: fixes.has(point) ? 'FIX' : 'OK' }));
    const done = (await http().post(`/sales/leads/${lead.id}/steps`).set(bearer(token.a)).send({ kind: 'CHECK_DONE', scorecard: { answers } }).expect(201)).body as LeadDetailDto;
    expect(done.stage).toBe('CHECK_DONE');
    const build = await list(token.a, { state: 'BUILD' });
    expect(build.quotes).toEqual([]);
    expect(build.buildNow.find((entry) => entry.leadId === lead.id)).toMatchObject({ checkFindings: 2, ownerId: bdeId.a });
    // The console starts the quote from the latest scorecard, as the phone does: catalogue items only.
    const card = done.activities.find((entry) => entry.kind === 'CHECK_DONE')!.scorecard!;
    const picks = freeCheckPicks(options, card.answers);
    for (const pick of picks) expect(['CHIMNEY', 'PEST']).toContain(options.find((option) => option.refId === pick.refId)?.serviceCode);
    // Once a quote is made, it leaves "Build now".
    await makeQuote(token.a, lead.id);
    expect((await list(token.a)).buildNow.some((entry) => entry.leadId === lead.id)).toBe(false);
  });

  it('asks for a follow-up when a quote went five days ago with nothing logged since', async () => {
    const db = prisma.client;
    const lead = await addLead(token.a, 'No Reply');
    const quote = await makeQuote(token.a, lead.id);
    await send(token.a, quote.id);
    const sentAt = daysAgo(6);
    await db.quote.update({ where: { id: quote.id }, data: { sentAt } });
    await db.lead.update({ where: { id: lead.id }, data: { lastActivityAt: sentAt } });
    expect(row(await list(token.a), quote.id)).toMatchObject({ state: 'SENT', waitingDays: 6, action: 'REVISE' });
    const items = (await http().get('/sales/do-today').set(bearer(token.a)).expect(200)).body.items as DoTodayItemDto[];
    expect(items.find((item) => item.leadId === lead.id)).toMatchObject({ kind: 'QUOTE_NOT_OPENED', bucket: 'OVERDUE', days: 6 });
    // A call logged since is a reply: the follow-up goes.
    await http().post(`/sales/leads/${lead.id}/steps`).set(bearer(token.a)).send({ kind: 'CALL' }).expect(201);
    expect(row(await list(token.a), quote.id)).toMatchObject({ waitingDays: null, action: 'OPEN' });
  });

  it('shows a BDE only their own quotes, and everyone else every quote', async () => {
    const mine = await addLead(token.a, 'Mine');
    const mineQuote = await makeQuote(token.a, mine.id);
    const theirs = await addLead(token.b, 'Theirs');
    const theirQuote = await makeQuote(token.b, theirs.id);
    const ofA = await list(token.a);
    expect(row(ofA, mineQuote.id)).toBeDefined();
    expect(row(ofA, theirQuote.id)).toBeUndefined();
    expect(ofA.owners.map((person) => person.id)).toEqual([bdeId.a]);
    // Asking for someone else's is ignored for a BDE.
    expect(row(await list(token.a, { owner: bdeId.b }), theirQuote.id)).toBeUndefined();
    await http().post(`/sales/quotes/${theirQuote.id}/won`).set(bearer(token.a)).expect(404);
    await http().get(`/sales/quotes/${theirQuote.id}/pdf`).set(bearer(token.a)).expect(404);
    for (const who of [token.admin, token.ops]) {
      const all = await list(who);
      expect(row(all, mineQuote.id)).toBeDefined();
      expect(row(all, theirQuote.id)).toMatchObject({ ownerName: 'E2E Quotes BDE b' });
      const ofB = await list(who, { owner: bdeId.b });
      expect(ofB.quotes.every((entry) => entry.ownerId === bdeId.b)).toBe(true);
      expect(row(ofB, theirQuote.id)).toBeDefined();
    }
  });

  it('prints a quote as a PDF, a draft too', async () => {
    const lead = await addLead(token.a, 'PDF');
    const quote = await makeQuote(token.a, lead.id);
    const draft = await http().get(`/sales/quotes/${quote.id}/pdf`).set(bearer(token.a)).buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(draft.headers['content-type']).toBe('application/pdf');
    expect(draft.headers['content-disposition']).toBe(`attachment; filename="Quote ${quote.number}.pdf"`);
    expect((draft.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await send(token.a, quote.id);
    await http().get(`/sales/quotes/${quote.id}/pdf`).set(bearer(token.ops)).expect(200).expect('Content-Type', 'application/pdf');
  }, 60_000);
});
