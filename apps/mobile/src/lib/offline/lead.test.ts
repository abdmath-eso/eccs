// A BDE's leads without signal (B2): a lead logged with its board photo and a note, steps,
// a park and a loss, kept on the phone and sent in order; repeated changes merged; what
// the server refuses; and how the lead and the list look before the server has them.
// No phone, storage or network is involved.
//
// Run from the repo root with:
//   pnpm exec vitest run --root apps/mobile src/lib/offline

import { FREE_CHECK_POINTS, type LeadDetailDto, type LeadRowDto } from '@eccs/shared';
import { describe, expect, it } from 'vitest';

import { applyLeadPending, applyLeadRowPending, fieldSummary, newLeadsOnPhone, type FieldOp, type FieldState, type NewFieldOp } from './field-ops';
import { Outbox, type Failure, type OutboxFile } from './outbox-core';

const ME = { id: 'bde-1', name: 'Ravi' };
const LEAD = 'lead-1';

class Refused extends Error {
  constructor(readonly failure: Failure) {
    super(failure);
  }
}

/** An outbox joined to a pretend phone and a pretend server, as in field.test.ts. */
function harness(file: OutboxFile | null = null) {
  const world = {
    saved: file,
    sent: [] as FieldOp[],
    down: false,
    replies: [] as (Failure | 'ok')[],
    state: 'open' as FieldState | Failure,
    discarded: [] as string[],
  };
  let nextId = 0;
  const outbox = new Outbox({
    load: async () => world.saved,
    save: async (next) => {
      world.saved = JSON.parse(JSON.stringify(next)) as OutboxFile;
    },
    transport: {
      whoAmI: async () => {
        if (world.down) throw new Refused('offline');
        return ME.id;
      },
      uploadPhoto: async () => undefined,
      answer: async () => {
        throw new Error('not used');
      },
      clear: async () => {
        throw new Error('not used');
      },
      submit: async () => {
        throw new Error('not used');
      },
      fetchRun: async () => {
        throw new Error('not used');
      },
    },
    field: {
      send: async (op) => {
        if (world.down) throw new Refused('offline');
        const reply = world.replies.shift() ?? 'ok';
        if (reply !== 'ok') throw new Refused(reply);
        world.sent.push(op);
      },
      inspect: async () => {
        if (world.state === 'offline' || world.state === 'retry' || world.state === 'auth') throw new Refused(world.state);
        return world.state as FieldState;
      },
    },
    classify: (error) => (error instanceof Refused ? error.failure : 'retry'),
    onRun: () => undefined,
    discardPhoto: (id) => world.discarded.push(id),
    newId: () => `id-${++nextId}`,
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
  const settle = async () => {
    for (let turn = 0; turn < 50; turn++) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const signal = async () => {
    world.down = false;
    outbox.kick();
    await settle();
  };
  return { outbox, world, settle, signal };
}

const leadOp = (op: Record<string, unknown>, leadId = LEAD) => ({ subject: 'lead', subjectId: leadId, ...op }) as NewFieldOp;
const kinds = (ops: readonly { kind: string }[]) => ops.map((op) => op.kind);
const scorecard = (fix: string[]) => ({ answers: FREE_CHECK_POINTS.map((point) => ({ point, answer: fix.includes(point) ? 'FIX' : 'OK' })) });

/** A moment some minutes after the lead is logged (the outbox stamps the lead itself with the real time). */
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const CALL_AT = later(60);

/** A lead logged in the street with no signal: its board photo, the lead, a first note; then a call and a free check. */
async function offlineDay() {
  const h = harness();
  h.world.down = true;
  h.outbox.setUser(ME.id, ME.name);
  await h.outbox.enqueue(leadOp({ kind: 'leadPhoto', photoId: 'board-1', capturedAt: later(0) }));
  await h.outbox.enqueue(
    leadOp({ kind: 'leadCreate', input: { id: LEAD, businessName: 'Sri Annapurna Tiffins', area: 'Kukatpally', contactPhone: '98480 22338', source: 'FIELD_VISIT', kitchens: 2, photoId: 'board-1' } }),
  );
  await h.outbox.enqueue(leadOp({ kind: 'leadStep', input: { id: 'note-1', kind: 'NOTE', note: 'Owner back at 4', at: later(1) } }));
  await h.outbox.enqueue(leadOp({ kind: 'leadStep', input: { id: 'call-1', kind: 'CALL', at: CALL_AT } }));
  await h.outbox.enqueue(leadOp({ kind: 'leadPhoto', photoId: 'grease-1', capturedAt: later(90) }));
  await h.outbox.enqueue(
    leadOp({ kind: 'leadStep', input: { id: 'check-1', kind: 'CHECK_DONE', at: later(95), scorecard: { answers: scorecard(['HOOD', 'STAFF']).answers.map((entry) => (entry.point === 'HOOD' ? { ...entry, photoId: 'grease-1' } : entry)) } } }),
  );
  await h.settle();
  return h;
}

describe('the outbox with a BDE’s leads', () => {
  it('keeps a lead logged without signal, with its photo and steps, and sends them in order, photos first', async () => {
    const h = await offlineDay();
    expect(h.world.sent).toEqual([]);
    expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 6, online: false });
    await h.signal();
    expect(kinds(h.world.sent)).toEqual(['leadPhoto', 'leadCreate', 'leadStep', 'leadStep', 'leadPhoto', 'leadStep']);
    // Each step keeps the id and the time it was given on the phone, which is how the server recognises a repeat.
    expect(h.world.sent[3]).toMatchObject({ input: { id: 'call-1', at: CALL_AT } });
    expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, phase: 'idle' });
    // Each photo's file is let go once the server has it.
    expect(h.world.discarded).toEqual(['board-1', 'grease-1']);
  });

  it('repeats a step that did not get through, unchanged, and survives the app being closed', async () => {
    const first = await offlineDay();
    first.world.replies.push('ok', 'offline');
    await first.signal();
    expect(kinds(first.world.sent)).toEqual(['leadPhoto']);
    const again = harness(first.world.saved);
    again.outbox.setUser(ME.id, ME.name);
    await again.outbox.init();
    await again.settle();
    expect(kinds(again.world.sent)).toEqual(['leadCreate', 'leadStep', 'leadStep', 'leadPhoto', 'leadStep']);
    expect(again.world.sent[0]).toMatchObject({ input: { id: LEAD, businessName: 'Sri Annapurna Tiffins' } });
  });

  it('merges a lead’s details changed twice in a row into one change, the later winning', async () => {
    const h = harness();
    h.world.down = true;
    h.outbox.setUser(ME.id, ME.name);
    await h.outbox.enqueue(leadOp({ kind: 'leadUpdate', changes: { contactName: 'Faisal', kitchens: 2 } }));
    await h.outbox.enqueue(leadOp({ kind: 'leadUpdate', changes: { kitchens: 3, area: 'Madhapur' } }));
    expect(h.outbox.getSnapshot().ops).toEqual([expect.objectContaining({ kind: 'leadUpdate', changes: { contactName: 'Faisal', kitchens: 3, area: 'Madhapur' } })]);
    // A step in between keeps them apart, so the order the server sees is the order things were done.
    await h.outbox.enqueue(leadOp({ kind: 'leadStep', input: { id: 's', kind: 'VISIT', at: 'x' } }));
    await h.outbox.enqueue(leadOp({ kind: 'leadUpdate', changes: { contactName: 'Imran' } }));
    expect(kinds(h.outbox.getSnapshot().ops)).toEqual(['leadUpdate', 'leadStep', 'leadUpdate']);
  });

  it('drops only a step the server will never take when the lead is still the BDE’s, and says so', async () => {
    const h = await offlineDay();
    h.world.replies.push('ok', 'ok', 'rejected');
    h.world.state = 'open';
    await h.signal();
    expect(kinds(h.world.sent)).toEqual(['leadPhoto', 'leadCreate', 'leadStep', 'leadPhoto', 'leadStep']);
    expect(h.outbox.getSnapshot().notices).toEqual([expect.objectContaining({ subject: 'lead', runId: LEAD, reason: 'rejected', count: 1 })]);
  });

  it('holds all of a lead’s work on the phone when the server no longer shows it to the BDE, and sends it again when asked', async () => {
    const h = await offlineDay();
    h.world.replies.push('ok', 'ok', 'conflict');
    h.world.state = 'gone';
    await h.signal();
    expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 4 });
    expect(h.world.discarded).toEqual(['board-1']);
    expect(fieldSummary(h.outbox.getSnapshot().ops, 'lead', LEAD)).toMatchObject({ held: 4, holdReason: 'gone' });
    h.world.state = 'open';
    h.outbox.release('lead', LEAD);
    await h.settle();
    expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 0 });
  });
});

// ───────────────────────── What the screens show ─────────────────────────

const serverLead = (change: Partial<LeadDetailDto> = {}): LeadDetailDto => ({
  id: LEAD,
  businessName: 'Mehfil Biryani',
  area: 'Tolichowki',
  stage: 'NEW',
  status: 'OPEN',
  source: 'FIELD_VISIT',
  kitchens: 1,
  ownerId: ME.id,
  ownerName: ME.name,
  contactName: null,
  contactPhone: '+919848022338',
  createdAt: '2026-10-10T05:00:00.000Z',
  lastActivityAt: '2026-10-10T05:00:00.000Z',
  nextAction: 'Call back',
  nextActionAt: '2026-10-15T05:00:00.000Z',
  parkedUntil: null,
  quote: null,
  stale: { reason: 'NEXT_ACTION_PASSED', days: 1, context: 'contacted 10 Oct', words: 'next step was due 1 day ago' },
  organization: null,
  isSample: false,
  photo: { id: 'board-0', path: '/attachments/board-0/content' },
  address: null,
  referrerName: null,
  latitude: null,
  longitude: null,
  checkAt: null,
  checkWith: null,
  checkDoneAt: null,
  checkFindings: null,
  parkedAt: null,
  parkedReason: null,
  lostAt: null,
  lostReason: null,
  wonAt: null,
  planAt: null,
  activities: [{ id: 'a0', kind: 'CREATED', at: '2026-10-10T05:00:00.000Z', byName: 'Ravi', note: null, fromStage: null, toStage: null, checkAt: null, checkWith: null, findings: null, amountPaise: null, signal: null, rating: null, quoteNumber: null, scorecard: null }],
  quotes: [],
  close: null,
  toDo: null,
  owners: [],
  ...change,
});

const queued = (ops: NewFieldOp[], held?: 'gone'): FieldOp[] =>
  ops.map((op, index) => ({ ...op, id: `q${index}`, userId: ME.id, createdAt: `2026-10-16T06:0${index}:00.000Z`, attempts: 0, ...(held && { held }) }) as FieldOp);

describe('a lead as it stands on the phone', () => {
  it('shows a lead logged here before the server has it, made from what was typed', async () => {
    const h = await offlineDay();
    const view = applyLeadPending(null, LEAD, h.outbox.getSnapshot().ops, ME)!;
    expect(view.isNew).toBe(true);
    expect(view.lead).toMatchObject({
      businessName: 'Sri Annapurna Tiffins',
      area: 'Kukatpally',
      contactPhone: '+919848022338',
      kitchens: 2,
      ownerId: ME.id,
      photo: { id: 'board-1', path: '' },
      // The call made it Contacted and the free check moved it on, by the server's own rule.
      stage: 'CHECK_DONE',
      checkFindings: 2,
    });
    expect([...view.localPhotos].sort()).toEqual(['board-1', 'grease-1']);
    expect(view.lead.activities.map((entry) => entry.kind)).toEqual(['CHECK_DONE', 'CALL', 'NOTE', 'CREATED']);
    expect(view.lead.activities[0]!.scorecard?.counts).toEqual({ OK: 8, FIX: 2, UNSEEN: 0 });
    expect([...view.unsentActivities].sort()).toEqual(['call-1', 'check-1', 'note-1']);
    expect(applyLeadPending(null, 'other', h.outbox.getSnapshot().ops, ME)).toBeNull();
  });

  it('lays a step over the server’s copy: stage, the due next step cleared, the waiting note put aside', () => {
    const server = serverLead();
    const view = applyLeadPending(server, LEAD, queued([leadOp({ kind: 'leadStep', input: { id: 'v1', kind: 'VISIT', at: '2026-10-16T06:00:00.000Z' } })]), ME)!;
    expect(view.lead).toMatchObject({ stage: 'CONTACTED', nextAction: null, nextActionAt: null, stale: null, lastActivityAt: '2026-10-16T06:00:00.000Z' });
    expect(view.lead.activities[0]).toMatchObject({ id: 'v1', kind: 'VISIT', fromStage: 'NEW', toStage: 'CONTACTED', byName: 'Ravi' });
    expect(view.unsent).toBe(1);
    // The server's copy itself is never changed.
    expect(server.stage).toBe('NEW');
    expect(server.activities).toHaveLength(1);
  });

  it('parks and brings back a lead, never moves it left, and marks a loss', () => {
    const parked = applyLeadPending(serverLead({ stage: 'QUOTED' }), LEAD, queued([leadOp({ kind: 'leadPark', input: { id: 'p1', at: '2026-10-16T06:00:00.000Z', until: '2026-11-05', reason: 'after Diwali' } })]), ME)!.lead;
    expect(parked).toMatchObject({ status: 'PARKED', parkedUntil: '2026-11-05', parkedReason: 'after Diwali', nextAction: null, stage: 'QUOTED' });
    const back = applyLeadPending(
      serverLead({ stage: 'QUOTED', status: 'PARKED', parkedUntil: '2026-11-05', parkedReason: 'after Diwali' }),
      LEAD,
      queued([leadOp({ kind: 'leadStep', input: { id: 'c1', kind: 'CALL', at: '2026-10-16T06:00:00.000Z' } })]),
      ME,
    )!.lead;
    expect(back).toMatchObject({ status: 'OPEN', parkedUntil: null, stage: 'QUOTED' });
    const lost = applyLeadPending(serverLead(), LEAD, queued([leadOp({ kind: 'leadLose', input: { id: 'l1', at: '2026-10-16T06:00:00.000Z', reason: 'Has a vendor' } })]), ME)!.lead;
    expect(lost).toMatchObject({ status: 'LOST', lostReason: 'Has a vendor' });
    expect(lost.activities[0]).toMatchObject({ kind: 'LOST', note: 'Has a vendor' });
  });

  it('shows changed details and a new next step straight away', () => {
    const view = applyLeadPending(
      serverLead(),
      LEAD,
      queued([leadOp({ kind: 'leadUpdate', changes: { contactName: ' Faisal ', contactPhone: '70930 11223', nextAction: 'Visit again', nextActionAt: '2026-10-18T05:30:00.000Z' } })]),
      ME,
    )!.lead;
    expect(view).toMatchObject({ contactName: 'Faisal', contactPhone: '+917093011223', nextAction: 'Visit again', nextActionAt: '2026-10-18T05:30:00.000Z', stale: null });
  });

  it('shows the list with leads logged here first and moved leads in their new stage', async () => {
    const h = await offlineDay();
    const row: LeadRowDto = { ...serverLead(), id: 'lead-2' };
    const ops = [...h.outbox.getSnapshot().ops, ...queued([leadOp({ kind: 'leadStep', input: { id: 'b1', kind: 'CHECK_BOOKED', checkAt: '2026-10-17T05:30:00.000Z', at: '2026-10-16T07:00:00.000Z' } }, 'lead-2')])];
    expect(applyLeadRowPending(row, ops, ME)).toMatchObject({ id: 'lead-2', stage: 'CHECK_BOOKED', stale: null });
    expect(applyLeadRowPending(row, [], ME)).toBe(row);
    const fresh = newLeadsOnPhone(ops, new Set(['lead-2']), ME);
    expect(fresh.map((lead) => [lead.id, lead.businessName, lead.stage])).toEqual([[LEAD, 'Sri Annapurna Tiffins', 'CHECK_DONE']]);
    // Once the server has it, it is not shown twice.
    expect(newLeadsOnPhone(ops, new Set([LEAD, 'lead-2']), ME)).toEqual([]);
  });
});
