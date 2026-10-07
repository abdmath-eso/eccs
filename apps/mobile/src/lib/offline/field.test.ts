// The rules for a Supervisor's visit and inspection without signal: the order
// things are sent in, what is merged, what happens when the server refuses, and
// how waiting work is shown. No phone, storage or network is involved.
//
// The mobile app has no test runner of its own yet. Run these from the repo root with:
//   pnpm exec vitest run --root apps/mobile src/lib/offline

import { scoreInspection, type InspectionCheckDto, type InspectionDto, type VisitDto } from '@eccs/shared';
import { describe, expect, it } from 'vitest';

import {
  applyInspectionPending,
  applyVisitPending,
  fieldSummary,
  type FieldOp,
  type FieldState,
  type NewFieldOp,
} from './field-ops';
import { applyPending, Outbox, type Failure, type OutboxFile, type OutboxOp } from './outbox-core';

const ME = { id: 'sup-1', name: 'Imran' };
const VISIT = 'visit-1';
const INSPECTION = 'insp-1';

class Refused extends Error {
  constructor(readonly failure: Failure) {
    super(failure);
  }
}

/** An outbox joined to a pretend phone and a pretend server. */
function harness(file: OutboxFile | null = null) {
  const world = {
    /** What the phone's storage holds. */
    saved: file,
    /** Every step the server received, in order. */
    sent: [] as FieldOp[],
    /** True while there is no signal: nothing reaches the server at all. */
    down: false,
    /** What the server does with the next sends that reach it: nothing queued means it accepts. */
    replies: [] as (Failure | 'ok')[],
    /** How the visit or inspection stands on the server when asked. */
    state: 'open' as FieldState | Failure,
    discarded: [] as string[],
    timers: [] as (() => void)[],
    saveFails: false,
  };
  let nextId = 0;
  const outbox = new Outbox({
    load: async () => world.saved,
    save: async (next) => {
      if (world.saveFails) throw new Error('storage full');
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
    setTimer: (run) => {
      world.timers.push(run);
      return run;
    },
    clearTimer: (timer) => {
      world.timers = world.timers.filter((entry) => entry !== timer);
    },
  });
  /** Lets everything that can happen without a timer happen. */
  const settle = async () => {
    for (let turn = 0; turn < 50; turn++) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  /** The signal comes back, and whatever follows from that happens. */
  const signal = async () => {
    world.down = false;
    outbox.kick();
    await settle();
  };
  return { outbox, world, settle, signal };
}

const visitOp = (op: Record<string, unknown>) => ({ subject: 'visit', subjectId: VISIT, ...op }) as NewFieldOp;
const inspOp = (op: Record<string, unknown>) => ({ subject: 'inspection', subjectId: INSPECTION, ...op }) as NewFieldOp;
const kinds = (ops: readonly { kind: string }[]) => ops.map((op) => op.kind);

/** Queues a whole visit while the server cannot be reached. */
async function offlineVisit() {
  const h = harness();
  h.world.down = true;
  h.outbox.setUser(ME.id, ME.name);
  await h.outbox.enqueue(visitOp({ kind: 'visitCheckIn', at: '2026-10-07T04:00:00.000Z' }));
  await h.outbox.enqueue(visitOp({ kind: 'visitPhoto', photoId: 'p-before', photoKind: 'BEFORE', capturedAt: 'x' }));
  await h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't1', done: true }));
  await h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't2', done: false, note: 'Area locked or blocked' }));
  await h.outbox.enqueue(visitOp({ kind: 'visitPhoto', photoId: 'p-after', photoKind: 'AFTER', capturedAt: 'x' }));
  await h.outbox.enqueue(visitOp({ kind: 'visitRecord', technicianNames: ['Ravi'], notes: 'Done' }));
  await h.outbox.enqueue(visitOp({ kind: 'visitComplete', at: '2026-10-07T05:00:00.000Z' }));
  await h.settle();
  return h;
}

describe('the outbox with a Supervisor’s work', () => {
  it('keeps a whole visit on the phone with no signal and sends it in the order it was done', async () => {
    const h = await offlineVisit();
    expect(h.world.sent).toEqual([]);
    expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 7, held: 0, online: false, phase: 'waiting' });
    expect(h.world.saved?.ops).toHaveLength(7);

    await h.signal();
    expect(kinds(h.world.sent)).toEqual([
      'visitCheckIn',
      'visitPhoto',
      'visitTask',
      'visitTask',
      'visitPhoto',
      'visitRecord',
      'visitComplete',
    ]);
    expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, online: true, phase: 'idle' });
    expect(h.outbox.getSnapshot().allSentAt).not.toBeNull();
    expect(h.world.saved?.ops).toEqual([]);
    // Each photo's file is let go only once the server has it.
    expect(h.world.discarded).toEqual(['p-before', 'p-after']);
  });

  it('survives the app being closed: a new start finds the queue and sends it', async () => {
    const first = await offlineVisit();
    const second = harness(first.world.saved);
    second.outbox.setUser(ME.id, ME.name);
    await second.outbox.init();
    await second.settle();
    expect(kinds(second.world.sent)).toHaveLength(7);
    expect(second.world.sent[0]).toMatchObject({ kind: 'visitCheckIn', at: '2026-10-07T04:00:00.000Z' });
    expect(second.world.sent.at(-1)).toMatchObject({ kind: 'visitComplete', at: '2026-10-07T05:00:00.000Z' });
  });

  it('stops at the first step that does not get through and repeats that same step, unchanged', async () => {
    const h = await offlineVisit();
    // Signal comes and goes: two get through, the third send dies, then the server is busy.
    h.world.replies.push('ok', 'ok', 'offline');
    await h.signal();
    expect(kinds(h.world.sent)).toEqual(['visitCheckIn', 'visitPhoto']);
    expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 5, online: false });

    h.world.replies.push('retry');
    h.outbox.kick();
    await h.settle();
    expect(h.world.sent).toHaveLength(2);
    expect(h.outbox.getSnapshot().ops[0]).toMatchObject({ kind: 'visitTask', itemId: 't1', attempts: 2 });

    h.outbox.kick();
    await h.settle();
    expect(h.world.sent).toHaveLength(7);
    // The Finish carries the time it was pressed, which is how the server recognises a repeat.
    expect(h.world.sent.at(-1)).toMatchObject({ kind: 'visitComplete', at: '2026-10-07T05:00:00.000Z' });
  });

  it('never sends one person’s work under another person’s login', async () => {
    const h = await offlineVisit();
    h.outbox.setUser('someone-else', 'Other');
    await h.signal();
    expect(h.world.sent).toEqual([]);
    expect(h.outbox.getSnapshot().ops).toEqual([]);
    h.outbox.setUser(ME.id, ME.name);
    await h.settle();
    expect(h.world.sent).toHaveLength(7);
  });

  it('keeps the queue when the login has ended, for when the person logs in again', async () => {
    const h = await offlineVisit();
    h.world.replies.push('auth');
    await h.signal();
    expect(h.outbox.getSnapshot()).toMatchObject({ phase: 'needsLogin', waiting: 7 });
  });

  it('does not pretend something is safe when the phone could not store it', async () => {
    const h = harness();
    h.world.down = true;
    h.outbox.setUser(ME.id, ME.name);
    await h.outbox.enqueue(visitOp({ kind: 'visitCheckIn', at: 'a' }));
    await h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't1', done: true }));
    await h.settle();
    h.world.saveFails = true;
    await expect(h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't1', done: false, note: 'Hot' }))).rejects.toThrow();
    // The earlier answer, which the failed one would have replaced, is still there.
    expect(h.outbox.getSnapshot().ops).toHaveLength(2);
    expect(h.outbox.getSnapshot().ops[1]).toMatchObject({ kind: 'visitTask', done: true });
  });

  describe('merging', () => {
    async function offline() {
      const h = harness();
      h.world.down = true;
      h.outbox.setUser(ME.id, ME.name);
      await h.outbox.enqueue(visitOp({ kind: 'visitCheckIn', at: 'a' }));
      await h.settle();
      return h;
    }

    it('replaces the same task answered twice in a row, and the team and notes saved twice', async () => {
      const h = await offline();
      await h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't1', done: true }));
      await h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't1', done: false, note: 'Hot' }));
      await h.outbox.enqueue(visitOp({ kind: 'visitRecord', technicianNames: ['Ravi'], notes: '' }));
      await h.outbox.enqueue(visitOp({ kind: 'visitRecord', technicianNames: ['Ravi', 'Suresh'], notes: 'All done' }));
      const ops = h.outbox.getSnapshot().ops;
      expect(kinds(ops)).toEqual(['visitCheckIn', 'visitTask', 'visitRecord']);
      expect(ops[1]).toMatchObject({ done: false, note: 'Hot' });
      expect(ops[2]).toMatchObject({ technicianNames: ['Ravi', 'Suresh'] });
    });

    it('does not reach back past other steps, so the order the server sees is the order things were done', async () => {
      const h = await offline();
      await h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't1', done: true }));
      await h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't2', done: true }));
      await h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't1', done: false, note: 'Hot' }));
      expect(kinds(h.outbox.getSnapshot().ops)).toEqual(['visitCheckIn', 'visitTask', 'visitTask', 'visitTask']);
    });

    it('takes a photo and its removal away together when the photo was never sent', async () => {
      const h = await offline();
      await h.outbox.enqueue(visitOp({ kind: 'visitPhoto', photoId: 'p1', photoKind: 'AFTER', capturedAt: 'x' }));
      await h.outbox.enqueue(visitOp({ kind: 'visitPhotoRemove', photoId: 'p1' }));
      expect(kinds(h.outbox.getSnapshot().ops)).toEqual(['visitCheckIn']);
      expect(h.world.discarded).toEqual(['p1']);
      // A photo already on the server is removed by a step of its own.
      await h.outbox.enqueue(visitOp({ kind: 'visitPhotoRemove', photoId: 'on-server' }));
      expect(kinds(h.outbox.getSnapshot().ops)).toEqual(['visitCheckIn', 'visitPhotoRemove']);
    });

    it('sends the removal after the photo when the photo may already have reached the server', async () => {
      const h = harness();
      h.outbox.setUser(ME.id, ME.name);
      // The photo was sent, but no reply came back: the server may or may not have it.
      h.world.replies.push('offline');
      await h.outbox.enqueue(visitOp({ kind: 'visitPhoto', photoId: 'p1', photoKind: 'AFTER', capturedAt: 'x' }));
      await h.settle();
      expect(h.outbox.getSnapshot().ops[0]).toMatchObject({ kind: 'visitPhoto', attempts: 1 });
      await h.outbox.enqueue(visitOp({ kind: 'visitPhotoRemove', photoId: 'p1' }));
      await h.settle();
      expect(h.world.discarded).toEqual(['p1']);
      expect(kinds(h.world.sent)).toEqual(['visitPhoto', 'visitPhotoRemove']);
    });

    it('rewords a non-compliance in place, but queues a changed answer after the photos', async () => {
      const h = harness();
      h.world.down = true;
      h.outbox.setUser(ME.id, ME.name);
      await h.outbox.enqueue(inspOp({ kind: 'inspAnswer', itemId: 'c1', answer: 'COMPLIANT', at: 'a' }));
      await h.settle();
      await h.outbox.enqueue(inspOp({ kind: 'inspAnswer', itemId: 'c2', answer: 'NON_COMPLIANT', at: 'a' }));
      await h.outbox.enqueue(inspOp({ kind: 'inspAnswer', itemId: 'c2', answer: 'NON_COMPLIANT', note: 'Grease', at: 'b' }));
      expect(kinds(h.outbox.getSnapshot().ops)).toEqual(['inspAnswer', 'inspAnswer']);
      expect(h.outbox.getSnapshot().ops[1]).toMatchObject({ itemId: 'c2', note: 'Grease' });

      await h.outbox.enqueue(inspOp({ kind: 'inspPhoto', itemId: 'c2', photoId: 'p1', capturedAt: 'x' }));
      await h.outbox.enqueue(inspOp({ kind: 'inspAnswer', itemId: 'c2', answer: 'NON_COMPLIANT', note: 'Grease on wall', at: 'c' }));
      expect(kinds(h.outbox.getSnapshot().ops)).toEqual(['inspAnswer', 'inspAnswer', 'inspPhoto', 'inspAnswer']);

      // Changing the answer away from "not compliant" removes the photo on the server, so the unsent one goes too.
      await h.outbox.enqueue(inspOp({ kind: 'inspAnswer', itemId: 'c2', answer: 'COMPLIANT', at: 'd' }));
      expect(kinds(h.outbox.getSnapshot().ops)).toEqual(['inspAnswer', 'inspAnswer', 'inspAnswer', 'inspAnswer']);
      expect(h.world.discarded).toEqual(['p1']);
    });
  });

  describe('when the server refuses', () => {
    it('holds all of a cancelled visit’s work on the phone, tells the person once, and sends nothing more', async () => {
      const h = await offlineVisit();
      h.world.replies.push('conflict');
      h.world.state = 'cancelled';
      await h.signal();

      expect(h.world.sent).toEqual([]);
      const box = h.outbox.getSnapshot();
      expect(box).toMatchObject({ waiting: 0, held: 7, phase: 'idle', online: true });
      expect(box.ops.every((op) => 'held' in op && op.held === 'cancelled')).toBe(true);
      // The notice says how many steps are being kept, the same number the visit's own screen shows.
      expect(box.notices).toEqual([expect.objectContaining({ subject: 'visit', runId: VISIT, reason: 'cancelled', count: 7 })]);
      // Nothing is thrown away, photos included, and it is all still there after a restart.
      expect(h.world.discarded).toEqual([]);
      expect(h.world.saved?.ops).toHaveLength(7);
      expect(fieldSummary(box.ops, 'visit', VISIT)).toMatchObject({ unsent: 0, held: 7, holdReason: 'cancelled' });
    });

    it('holds work for a visit that was given to someone else, and sends it once it is given back', async () => {
      const h = await offlineVisit();
      h.world.replies.push('rejected');
      h.world.state = 'gone';
      await h.signal();
      expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 7 });

      // More work on a held visit joins what is held rather than jumping the queue.
      await h.outbox.enqueue(visitOp({ kind: 'visitTask', itemId: 't3', done: true }));
      expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 8 });

      // The office gives the visit back; the Supervisor taps "Send again".
      h.world.state = 'open';
      h.outbox.release('visit', VISIT);
      await h.settle();
      expect(h.world.sent).toHaveLength(8);
      expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 0 });
    });

    it('holds it again if the server still refuses after "Send again"', async () => {
      const h = await offlineVisit();
      h.world.replies.push('conflict');
      h.world.state = 'cancelled';
      await h.signal();
      h.world.replies.push('conflict');
      h.outbox.release('visit', VISIT);
      await h.settle();
      expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 7 });
      expect(h.outbox.getSnapshot().notices).toHaveLength(1);
    });

    it('deletes held work only when the person says so, with its photos', async () => {
      const h = await offlineVisit();
      h.world.replies.push('conflict');
      h.world.state = 'cancelled';
      await h.signal();
      h.outbox.discard('visit', VISIT);
      await h.settle();
      expect(h.outbox.getSnapshot().ops).toEqual([]);
      expect(h.world.discarded.sort()).toEqual(['p-after', 'p-before']);
      expect(h.world.saved?.ops).toEqual([]);
    });

    it('keeps other visits flowing while one is held', async () => {
      const h = await offlineVisit();
      await h.outbox.enqueue({ ...visitOp({ kind: 'visitCheckIn', at: 'b' }), subjectId: 'visit-2' } as NewFieldOp);
      h.world.replies.push('conflict');
      h.world.state = 'cancelled';
      await h.signal();
      expect(h.world.sent).toEqual([expect.objectContaining({ kind: 'visitCheckIn', subjectId: 'visit-2' })]);
      expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 7 });
    });

    it('drops only the one step the server will never take, and says so, when the visit is still open', async () => {
      const h = await offlineVisit();
      // The check-in and photo go through; the first task has been retired by ECCS meanwhile.
      h.world.replies.push('ok', 'ok', 'rejected');
      h.world.state = 'open';
      await h.signal();
      expect(kinds(h.world.sent)).toEqual(['visitCheckIn', 'visitPhoto', 'visitTask', 'visitPhoto', 'visitRecord', 'visitComplete']);
      expect(h.outbox.getSnapshot().notices).toEqual([expect.objectContaining({ subject: 'visit', reason: 'rejected', count: 1 })]);
      expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 0 });
    });

    it('says the visit could not be finished when only Finish is refused, and keeps the visit open', async () => {
      const h = await offlineVisit();
      h.world.replies.push('ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'rejected');
      h.world.state = 'open';
      await h.signal();
      expect(h.outbox.getSnapshot().ops).toEqual([]);
      expect(h.outbox.getSnapshot().notices).toEqual([expect.objectContaining({ reason: 'finishRejected', count: 0 })]);
    });

    it('treats a refused check-in or Finish as done, quietly, when the server already shows it done', async () => {
      // The check-in arrived the first time, but the server could not tell this was a repeat
      // and refused it. The visit is under way, so nothing is said and the rest carries on.
      const h = await offlineVisit();
      h.world.replies.push('conflict');
      h.world.state = 'open';
      await h.signal();
      expect(kinds(h.world.sent)).toHaveLength(6);
      expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 0, notices: [] });

      // The same for a Finish refused on a visit that is finished.
      const again = await offlineVisit();
      again.world.replies.push('ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'conflict');
      again.world.state = 'finished';
      await again.signal();
      expect(again.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 0, notices: [] });
    });

    it('holds work for a visit someone else finished first (the same visit on two phones)', async () => {
      const h = await offlineVisit();
      h.world.replies.push('ok', 'ok', 'conflict');
      h.world.state = 'finished';
      await h.signal();
      expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 0, held: 5 });
      expect(h.outbox.getSnapshot().notices).toEqual([expect.objectContaining({ reason: 'finished', count: 5 })]);
    });

    it('decides nothing while the server cannot be asked how the visit stands', async () => {
      const h = await offlineVisit();
      h.world.replies.push('conflict');
      h.world.state = 'offline';
      await h.signal();
      expect(h.outbox.getSnapshot()).toMatchObject({ waiting: 7, held: 0, notices: [], online: false });
    });

    it('never lets a visit’s or inspection’s work grow too old to send', async () => {
      const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const kept: OutboxOp = {
        id: 'old-1',
        userId: ME.id,
        createdAt: old,
        attempts: 3,
        subject: 'inspection',
        subjectId: INSPECTION,
        kind: 'inspAnswer',
        itemId: 'c1',
        answer: 'COMPLIANT',
        at: old,
      };
      const h = harness({ version: 1, ops: [kept], notices: [] });
      h.outbox.setUser(ME.id, ME.name);
      await h.outbox.init();
      await h.settle();
      expect(h.world.sent).toEqual([expect.objectContaining({ id: 'old-1', at: old })]);
    });
  });
});

// ───────────────────────── What the screen shows ─────────────────────────

const visit = (change: Partial<VisitDto> = {}): VisitDto => ({
  id: VISIT,
  outletId: 'outlet-1',
  outletName: 'Deccan Biryani',
  outletAddress: null,
  organizationName: 'Deccan',
  serviceCode: 'PEST',
  serviceName: { en: 'Pest control' },
  date: '2026-10-07',
  slot: '1000',
  status: 'ASSIGNED',
  supervisorId: null,
  supervisorName: null,
  booked: false,
  fromPlan: false,
  reportNumber: null,
  technicianNames: [],
  checkInAt: null,
  completedAt: null,
  notes: null,
  tasks: [
    { itemId: 't1', label: { en: 'Spray' }, done: null, note: null },
    { itemId: 't2', label: { en: 'Bait' }, done: null, note: null },
  ],
  photos: [{ id: 'on-server', kind: 'BEFORE', path: '/attachments/on-server/content' }],
  signOff: null,
  canRecord: true,
  canSignOff: false,
  correctionNote: null,
  canReview: false,
  canManage: false,
  ...change,
});

const queued = (ops: NewFieldOp[], held?: 'cancelled'): FieldOp[] =>
  ops.map((op, index) => ({ ...op, id: `q${index}`, userId: ME.id, createdAt: 'now', attempts: 0, ...(held && { held }) }) as FieldOp);

describe('a visit as it stands on the phone', () => {
  const ops = queued([
    visitOp({ kind: 'visitCheckIn', at: '2026-10-07T04:00:00.000Z' }),
    visitOp({ kind: 'visitTask', itemId: 't1', done: false, note: 'Hot' }),
    visitOp({ kind: 'visitPhoto', photoId: 'p-after', photoKind: 'AFTER', capturedAt: 'x' }),
    visitOp({ kind: 'visitPhotoRemove', photoId: 'on-server' }),
    visitOp({ kind: 'visitRecord', technicianNames: ['Ravi', 'Ravi'], notes: 'Done' }),
    { ...visitOp({ kind: 'visitTask', itemId: 't2', done: true }), subjectId: 'another-visit' } as NewFieldOp,
  ]);

  it('shows waiting work as done, and marks what the server does not have yet', () => {
    const server = visit();
    const view = applyVisitPending(server, ops, ME);
    expect(view.visit).toMatchObject({
      status: 'IN_PROGRESS',
      checkInAt: '2026-10-07T04:00:00.000Z',
      supervisorId: ME.id,
      supervisorName: ME.name,
      technicianNames: ['Ravi'],
      notes: 'Done',
    });
    expect(view.visit.tasks).toEqual([
      { itemId: 't1', label: { en: 'Spray' }, done: false, note: 'Hot' },
      { itemId: 't2', label: { en: 'Bait' }, done: null, note: null },
    ]);
    expect(view.visit.photos).toEqual([{ id: 'p-after', kind: 'AFTER', path: '' }]);
    expect([...view.localPhotos]).toEqual(['p-after']);
    expect([...view.unsentTasks]).toEqual(['t1']);
    expect(view).toMatchObject({ unsent: 5, held: 0, checkInPending: true, recordPending: true, finishPending: false });
    // The server's copy itself is never changed.
    expect(server.status).toBe('ASSIGNED');
    expect(server.photos).toHaveLength(1);
    expect(server.tasks[0]!.done).toBeNull();
  });

  it('keeps the status "in progress" after Finish until the server has it', () => {
    const view = applyVisitPending(visit(), [...ops, ...queued([visitOp({ kind: 'visitComplete', at: 'done-at' })])], ME);
    expect(view.finishPending).toBe(true);
    expect(view.visit).toMatchObject({ status: 'IN_PROGRESS', completedAt: 'done-at' });
  });

  it('shows a visit the server has closed exactly as the server has it, with what is held', () => {
    const cancelled = visit({ status: 'CANCELLED', canRecord: false });
    const view = applyVisitPending(cancelled, queued([visitOp({ kind: 'visitCheckIn', at: 'a' })], 'cancelled'), ME);
    expect(view.visit).toBe(cancelled);
    expect(view).toMatchObject({ unsent: 0, held: 1, holdReason: 'cancelled' });
  });

  it('leaves checklists alone, and checklists leave visits alone', () => {
    expect(applyVisitPending(visit(), [], ME).visit.status).toBe('ASSIGNED');
    const run = { id: VISIT, status: 'PENDING', items: [], submittedAt: null, submittedByName: null } as never;
    expect(applyPending(run, ops, ME.name).unsent).toBe(0);
  });
});

const check = (itemId: string, number: number, marks: number, change: Partial<InspectionCheckDto> = {}): InspectionCheckDto => ({
  itemId,
  number,
  label: { en: `Check ${number}` },
  critical: marks === 4,
  marks,
  answer: null,
  note: null,
  severity: null,
  correctiveAction: null,
  dueDate: null,
  photos: [],
  complete: false,
  ...change,
});

const inspection = (change: Partial<InspectionDto> = {}): InspectionDto => ({
  id: INSPECTION,
  outletId: 'outlet-1',
  outletName: 'Deccan Biryani',
  outletAddress: null,
  organizationName: 'Deccan',
  status: 'PLANNED',
  date: '2026-10-07',
  supervisorId: ME.id,
  supervisorName: ME.name,
  answered: 0,
  total: 4,
  overallScore: null,
  grade: null,
  nonCompliant: 0,
  reportNumber: null,
  completedAt: null,
  approvedAt: null,
  sections: [
    { key: '1', title: 'Premises', score: 0, earned: 0, possible: 6, checks: [check('c1', 1, 2), check('c2', 2, 4)] },
    { key: '2', title: 'Storage', score: 0, earned: 0, possible: 4, checks: [check('c3', 3, 2), check('c4', 4, 2)] },
  ],
  complete: 0,
  criticalFailed: 0,
  startedAt: null,
  correctionNote: null,
  canRecord: true,
  canReview: false,
  canManage: false,
  ...change,
});

describe('an inspection as it stands on the phone', () => {
  const details = { note: 'Grease', severity: 'HIGH', correctiveAction: 'Clean it', dueDate: '2026-10-14' };
  const answers = queued([
    inspOp({ kind: 'inspAnswer', itemId: 'c1', answer: 'COMPLIANT', at: 'first' }),
    inspOp({ kind: 'inspAnswer', itemId: 'c2', answer: 'COMPLIANT', at: 'b' }),
    inspOp({ kind: 'inspAnswer', itemId: 'c3', answer: 'NON_COMPLIANT', ...details, at: 'c' }),
    inspOp({ kind: 'inspAnswer', itemId: 'c4', answer: 'NOT_APPLICABLE', at: 'd' }),
  ]);

  it('scores the answers waiting on the phone with the server’s own function', () => {
    const view = applyInspectionPending(inspection(), answers);
    const expected = scoreInspection([
      { section: 'Premises', marks: 2, answer: 'COMPLIANT' },
      { section: 'Premises', marks: 4, answer: 'COMPLIANT' },
      { section: 'Storage', marks: 2, answer: 'NON_COMPLIANT' },
      { section: 'Storage', marks: 2, answer: 'NOT_APPLICABLE' },
    ]);
    expect(view.score).toEqual(expected);
    expect(view.score).toMatchObject({ overallScore: 75, grade: 'B', earned: 6, possible: 8 });
    expect(view.inspection.sections.map((section) => [section.score, section.earned, section.possible])).toEqual([
      [100, 6, 6],
      [0, 0, 2],
    ]);
    expect(view.inspection).toMatchObject({ status: 'IN_PROGRESS', answered: 4, nonCompliant: 1, startedAt: 'first' });
    // Not finished yet, so no score is put on the inspection itself.
    expect(view.inspection.overallScore).toBeNull();
    expect([...view.unsentChecks]).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('holds a non-compliance open until it has every detail and a photo, as the server does', () => {
    const without = applyInspectionPending(inspection(), answers);
    expect(without.inspection.complete).toBe(3);
    expect(without.inspection.sections[1]!.checks[0]).toMatchObject({ ...details, complete: false, photos: [] });

    const withPhoto = applyInspectionPending(inspection(), [
      ...answers,
      ...queued([inspOp({ kind: 'inspPhoto', itemId: 'c3', photoId: 'p1', capturedAt: 'x' })]),
    ]);
    expect(withPhoto.inspection.complete).toBe(4);
    expect(withPhoto.inspection.sections[1]!.checks[0]).toMatchObject({ complete: true, photos: [{ id: 'p1', path: '' }] });
    expect([...withPhoto.localPhotos]).toEqual(['p1']);

    const missingNote = applyInspectionPending(
      inspection(),
      queued([inspOp({ kind: 'inspAnswer', itemId: 'c3', answer: 'NON_COMPLIANT', ...details, note: '', at: 'c' })]),
    );
    expect(missingNote.inspection.sections[1]!.checks[0]).toMatchObject({ note: null, complete: false });
  });

  it('drops the details and photos when the answer changes away from "not compliant"', () => {
    const server = inspection({
      status: 'IN_PROGRESS',
      sections: [
        {
          key: '1',
          title: 'Premises',
          score: 0,
          earned: 0,
          possible: 2,
          checks: [check('c1', 1, 2, { answer: 'NON_COMPLIANT', ...details, severity: 'HIGH', photos: [{ id: 's1', path: '/x' }], complete: true })],
        },
      ],
    });
    const view = applyInspectionPending(server, queued([inspOp({ kind: 'inspAnswer', itemId: 'c1', answer: 'COMPLIANT', at: 'z' })]));
    expect(view.inspection.sections[0]!.checks[0]).toMatchObject({
      answer: 'COMPLIANT',
      note: null,
      severity: null,
      correctiveAction: null,
      dueDate: null,
      photos: [],
      complete: true,
    });
    expect(view.score).toMatchObject({ overallScore: 100, grade: 'A_PLUS' });
    expect(server.sections[0]!.checks[0]!.photos).toHaveLength(1);
  });

  it('shows the score and grade once Finish is pressed, with a failed critical check giving no grade', () => {
    const ops = queued([
      inspOp({ kind: 'inspAnswer', itemId: 'c1', answer: 'COMPLIANT', at: 'a' }),
      inspOp({ kind: 'inspAnswer', itemId: 'c2', answer: 'NON_COMPLIANT', ...details, at: 'b' }),
      inspOp({ kind: 'inspPhoto', itemId: 'c2', photoId: 'p1', capturedAt: 'x' }),
      inspOp({ kind: 'inspAnswer', itemId: 'c3', answer: 'COMPLIANT', at: 'c' }),
      inspOp({ kind: 'inspAnswer', itemId: 'c4', answer: 'COMPLIANT', at: 'd' }),
      inspOp({ kind: 'inspFinish', at: 'finished-at' }),
    ]);
    const view = applyInspectionPending(inspection(), ops);
    expect(view.finishPending).toBe(true);
    expect(view.inspection).toMatchObject({
      status: 'IN_PROGRESS',
      completedAt: 'finished-at',
      overallScore: 60,
      grade: 'NON_COMPLIANT',
      criticalFailed: 1,
      complete: 4,
    });
  });

  it('shows an inspection the server has closed exactly as the server has it', () => {
    const submitted = inspection({ status: 'SUBMITTED', canRecord: false, overallScore: 91, grade: 'A_PLUS' });
    const view = applyInspectionPending(submitted, answers);
    expect(view.inspection).toBe(submitted);
  });
});
