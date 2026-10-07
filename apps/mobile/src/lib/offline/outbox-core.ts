import type { ChecklistRunDto, LocalizedText } from '@eccs/shared';

// The "outbox": everything a person does on a checklist is written here first,
// kept on the phone, and sent to the server one at a time, oldest first, when
// there is signal. This file is the rules only (order, retrying, what to drop,
// keeping people apart). It knows nothing about React, the phone's storage or
// the network; those are handed in, so the rules can be tested on their own.

/** One thing waiting to be sent. */
export type OutboxOp = AnswerOp | ClearOp | SubmitOp;

interface OpBase {
  id: string;
  /** Who did it. It is only ever sent while this same person is logged in. */
  userId: string;
  runId: string;
  /** When it was done on the phone. */
  createdAt: string;
  /** How many times sending was tried and did not get through. */
  attempts: number;
}

/** OK or Problem for one item, with its photo if one was just taken. */
export interface AnswerOp extends OpBase {
  kind: 'answer';
  outletId: string;
  itemId: string;
  passed: boolean;
  note?: string;
  /** The moment the photo was taken or the item ticked; never the moment it was sent. */
  capturedAt: string;
  /** The proof photo this answer points at: one already on the server, or one chosen on this phone. */
  attachmentId?: string;
  /**
   * Set when the photo was taken on this phone: 'toUpload' while its file is
   * only here, 'uploaded' once the server has the file (so a retry does not
   * send the picture twice). Left out when the photo was on the server already.
   */
  photo?: 'toUpload' | 'uploaded';
}

/** Takes back a tick made by mistake. */
export interface ClearOp extends OpBase {
  kind: 'clear';
  itemId: string;
}

/** Hands the checklist in. */
export interface SubmitOp extends OpBase {
  kind: 'submit';
}

/** What to add to the outbox; the id, time and person are filled in here. */
export type NewOp =
  | Omit<AnswerOp, keyof OpBase | 'photo'> & { runId: string; photo?: 'toUpload' }
  | Omit<ClearOp, keyof OpBase> & { runId: string }
  | Omit<SubmitOp, keyof OpBase> & { runId: string };

/**
 * Something the person must be told once: answers that were saved on the
 * phone and then could not be added to the checklist.
 */
export interface OutboxNotice {
  id: string;
  userId: string;
  runId: string;
  /**
   * submittedByOther: someone else handed the checklist in first.
   * closed: the checklist's day is over.
   * rejected: the server refused them for another reason.
   */
  reason: 'submittedByOther' | 'closed' | 'rejected';
  /** How many answers were not added (a dropped Submit is not counted). */
  count: number;
  /** Who submitted it, where known. */
  by: string | null;
  title: LocalizedText | null;
}

/** What is written to the phone's storage. */
export interface OutboxFile {
  version: 1;
  ops: OutboxOp[];
  notices: OutboxNotice[];
}

/**
 * Why a send failed, which decides what happens next:
 * offline (server not reached) and retry (server in trouble) keep everything and try again later;
 * auth (the login has ended) keeps everything until the same person logs in again;
 * conflict (the checklist is locked) and rejected (the server will never accept it) drop it and tell the person.
 */
export type Failure = 'offline' | 'retry' | 'auth' | 'conflict' | 'rejected';

export interface OutboxDeps {
  load: () => Promise<OutboxFile | null>;
  save: (file: OutboxFile) => Promise<void>;
  transport: {
    /** The id of the person the server takes this phone's login to be. */
    whoAmI: () => Promise<string>;
    uploadPhoto: (op: AnswerOp) => Promise<void>;
    answer: (op: AnswerOp) => Promise<ChecklistRunDto>;
    clear: (op: ClearOp) => Promise<ChecklistRunDto>;
    submit: (op: SubmitOp) => Promise<ChecklistRunDto>;
    fetchRun: (runId: string) => Promise<ChecklistRunDto>;
  };
  classify: (error: unknown) => Failure;
  /** The server's latest copy of a checklist, to keep on the phone. */
  onRun: (run: ChecklistRunDto) => void;
  /** A photo file kept on the phone is no longer needed. */
  discardPhoto: (attachmentId: string) => void;
  newId: () => string;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface OutboxSnapshot {
  /** False until the outbox has been read from the phone's storage. */
  ready: boolean;
  /** Waiting to be sent for the person logged in, oldest first. Nobody else's are ever listed. */
  ops: readonly OutboxOp[];
  notices: readonly OutboxNotice[];
  /** Whether the server could be reached last time; null before anything was tried. */
  online: boolean | null;
  /** idle: nothing to send. sending: sending now. waiting: will try again by itself. needsLogin: the login has ended. */
  phase: 'idle' | 'sending' | 'waiting' | 'needsLogin';
  /** The one being sent right now. */
  sendingId: string | null;
  /** When the outbox last became empty because everything was sent. */
  allSentAt: number | null;
}

// How long to wait before trying again: quickly at first, then at most once a minute.
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

// A checklist belongs to one day and is closed the next, so an answer older
// than this can never be accepted. Dropping it (and saying so) also means one
// answer that cannot be sent never holds up the rest for ever.
export const MAX_AGE_MS = 48 * 3_600_000;

const EMPTY: OutboxSnapshot = {
  ready: false,
  ops: [],
  notices: [],
  online: null,
  phase: 'idle',
  sendingId: null,
  allSentAt: null,
};

export class Outbox {
  private ops: OutboxOp[] = [];
  private notices: OutboxNotice[] = [];
  private loading: Promise<void> | null = null;
  private loaded = false;
  private userId: string | null = null;
  private userName: string | null = null;
  /** The person the server has confirmed this login belongs to. Nothing is sent before that. */
  private verifiedUserId: string | null = null;
  private online: boolean | null = null;
  private needsLogin = false;
  private draining = false;
  private sendingId: string | null = null;
  private allSentAt: number | null = null;
  private failures = 0;
  private timer: unknown = null;
  private saving: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private snapshot: OutboxSnapshot = EMPTY;
  private readonly deps: OutboxDeps;

  constructor(deps: OutboxDeps) {
    this.deps = deps;
  }

  // ---- reading ----

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Reads the outbox back from the phone's storage. Safe to call more than once. */
  init(): Promise<void> {
    this.loading ??= this.deps
      .load()
      .catch(() => null)
      .then((file) => {
        // Anything added in the instant before the file was read goes after what was already waiting.
        this.ops = [...(file?.ops ?? []), ...this.ops];
        this.notices = [...(file?.notices ?? []), ...this.notices];
        this.loaded = true;
        this.dropExpired();
        this.emit();
        void this.drain();
      });
    return this.loading;
  }

  // ---- who is logged in ----

  /**
   * Says who is using the phone now (null when nobody is). Only that person's
   * answers are shown and sent; anyone else's stay on the phone, untouched,
   * until they log in again.
   */
  setUser(userId: string | null, userName: string | null = null) {
    this.userName = userName;
    if (userId === this.userId) return;
    this.userId = userId;
    this.verifiedUserId = null;
    this.needsLogin = false;
    this.failures = 0;
    this.allSentAt = null;
    this.stopTimer();
    this.emit();
    void this.drain();
  }

  // ---- adding ----

  /**
   * Adds something to send. It is on the phone's storage by the time this
   * returns, so closing the app straight afterwards loses nothing.
   */
  async enqueue(input: NewOp): Promise<OutboxOp> {
    const userId = this.userId;
    if (!userId) throw new Error('Nobody is logged in');
    await this.init();

    const op = {
      ...input,
      id: this.deps.newId(),
      userId,
      createdAt: new Date(this.now()).toISOString(),
      attempts: 0,
    } as OutboxOp;

    if (op.kind !== 'submit') this.supersede(op);
    this.ops = [...this.ops, op];
    this.emit();
    try {
      await this.persist();
    } catch (error) {
      // Could not be written to the phone (storage full, say): do not pretend it is safe.
      this.ops = this.ops.filter((queued) => queued.id !== op.id);
      this.emit();
      throw error;
    }
    void this.drain();
    return op;
  }

  /**
   * A newer answer to an item replaces an older one that has not been sent,
   * because the server keeps only the latest answer anyway. This saves sending
   * a photo that was retaken a moment later. If the newer answer still points
   * at the older one's photo (OK changed to Problem, say), the photo moves across.
   */
  private supersede(next: AnswerOp | ClearOp) {
    const kept: OutboxOp[] = [];
    for (const old of this.ops) {
      const same =
        old.userId === next.userId &&
        old.runId === next.runId &&
        old.kind !== 'submit' &&
        old.itemId === next.itemId &&
        old.id !== this.sendingId;
      if (!same) {
        kept.push(old);
        continue;
      }
      if (old.kind === 'answer' && old.photo && old.attachmentId) {
        if (next.kind === 'answer' && next.attachmentId === old.attachmentId) {
          if (!next.photo) next.photo = old.photo;
        } else {
          this.deps.discardPhoto(old.attachmentId);
        }
      }
    }
    this.ops = kept;
  }

  // ---- signals from outside ----

  /** Try now: the app was opened again, the person pulled to refresh, or tapped "Try now". */
  kick() {
    this.failures = 0;
    this.stopTimer();
    void this.drain();
  }

  /** A screen's own request did, or did not, reach the server. */
  noteReachable(reached: boolean) {
    if (reached) {
      if (this.online === true) return;
      this.online = true;
      this.emit();
      this.kick();
    } else if (this.online !== false) {
      this.online = false;
      this.emit();
      this.schedule();
    }
  }

  /** The person has read a notice; it is not shown again. */
  dismissNotice(noticeId: string) {
    this.notices = this.notices.filter((notice) => notice.id !== noticeId);
    this.emit();
    void this.persist().catch(() => undefined);
  }

  // ---- sending ----

  private async drain() {
    if (this.draining || !this.loaded) return;
    this.draining = true;
    this.stopTimer();
    try {
      for (;;) {
        const userId = this.userId;
        if (!userId || this.needsLogin) break;
        this.dropExpired();
        const op = this.ops.find((queued) => queued.userId === userId);
        // Nothing to send. If the server could not be reached last time, see whether it can now,
        // so screens showing the copy saved on the phone know when to load afresh.
        if (!op && this.online !== false) break;

        // Before sending anything, the server confirms whose login this is. A queue is
        // never sent under another person's login, whatever the app believes.
        if (!op || this.verifiedUserId !== userId) {
          let who: string;
          try {
            who = await this.deps.transport.whoAmI();
          } catch (error) {
            this.failed(this.deps.classify(error), null);
            break;
          }
          if (this.userId !== userId) continue;
          this.online = true;
          if (who !== userId) {
            // The login is changing hands this instant; look again shortly.
            this.schedule();
            break;
          }
          this.verifiedUserId = userId;
          this.failures = 0;
          this.emit();
          // Something may have been added while the server was being asked: look again.
          if (!op) continue;
        }

        this.sendingId = op.id;
        this.emit();
        let failure: Failure | null = null;
        try {
          const run = await this.send(op);
          this.sent(op, run);
        } catch (error) {
          failure = this.deps.classify(error);
        }
        this.sendingId = null;

        if (failure === 'conflict') failure = await this.resolveConflict(op);
        else if (failure === 'rejected') await this.reject(op);
        if (failure && failure !== 'rejected') {
          this.failed(failure, op);
          break;
        }
      }
    } finally {
      this.draining = false;
      this.sendingId = null;
      this.emit();
    }
  }

  private async send(op: OutboxOp): Promise<ChecklistRunDto> {
    const { transport } = this.deps;
    if (op.kind === 'clear') return transport.clear(op);
    if (op.kind === 'submit') return transport.submit(op);
    let answer = op;
    if (answer.photo === 'toUpload') {
      await transport.uploadPhoto(answer);
      // Remember that the picture itself is across, so a retry only repeats the small step.
      answer = { ...answer, photo: 'uploaded' };
      this.replace(answer);
      await this.persist().catch(() => undefined);
    }
    return transport.answer(answer);
  }

  private sent(op: OutboxOp, run: ChecklistRunDto) {
    this.remove([op]);
    this.online = true;
    this.failures = 0;
    this.deps.onRun(run);
    if (!this.ops.some((queued) => queued.userId === op.userId)) this.allSentAt = this.now();
    void this.persist().catch(() => undefined);
    this.emit();
  }

  /** Keeps everything and decides when to try again. */
  private failed(failure: Failure, op: OutboxOp | null) {
    if (failure === 'auth') {
      // The login has ended. The queue stays on the phone for when this person logs in again.
      this.needsLogin = true;
      this.verifiedUserId = null;
      this.emit();
      return;
    }
    this.online = failure !== 'offline';
    if (op) {
      // The copy in the queue may be newer than the one that was being sent (its photo now uploaded).
      const current = this.ops.find((queued) => queued.id === op.id) ?? op;
      this.replace({ ...current, attempts: current.attempts + 1 });
      void this.persist().catch(() => undefined);
    }
    this.failures += 1;
    this.schedule();
    this.emit();
  }

  /**
   * The server says the checklist can no longer be changed. Looks at the
   * checklist as the server has it, then drops everything this person still
   * had waiting for it and leaves one notice saying so. Returns a failure if
   * the checklist could not be looked at, in which case nothing is dropped yet.
   */
  private async resolveConflict(op: OutboxOp): Promise<Failure | null> {
    let latest: ChecklistRunDto | null = null;
    try {
      latest = await this.deps.transport.fetchRun(op.runId);
    } catch (error) {
      const failure = this.deps.classify(error);
      if (failure === 'offline' || failure === 'retry' || failure === 'auth') return failure;
    }
    if (latest) this.deps.onRun(latest);

    // Our own Submit arrived the first time but its reply was lost, and this was the
    // repeat: the checklist is submitted by this person, which is what they asked for.
    const ownSubmit =
      op.kind === 'submit' &&
      latest?.status === 'SUBMITTED' &&
      latest.submittedByName !== null &&
      latest.submittedByName === this.userName;

    const dropped = this.ops.filter((queued) => queued.userId === op.userId && queued.runId === op.runId);
    this.remove(dropped);
    if (!ownSubmit) {
      const reason = !latest ? 'rejected' : latest.status === 'SUBMITTED' ? 'submittedByOther' : 'closed';
      this.notify(op, reason, dropped, latest);
    } else if (!this.ops.some((queued) => queued.userId === op.userId)) {
      this.allSentAt = this.now();
    }
    this.online = true;
    this.failures = 0;
    await this.persist().catch(() => undefined);
    this.emit();
    return null;
  }

  /** The server will never accept this one. Drops it alone, says so, and carries on with the rest. */
  private async reject(op: OutboxOp) {
    this.remove([op]);
    this.notify(op, 'rejected', [op], null);
    this.online = true;
    this.failures = 0;
    await this.persist().catch(() => undefined);
    this.emit();
    // The checklist may have changed (an item removed, say): show it as the server has it.
    try {
      this.deps.onRun(await this.deps.transport.fetchRun(op.runId));
    } catch {
      // Not reachable just now; the screen loads it afresh when it can.
    }
  }

  /** Answers too old to be accepted are dropped, for whoever they belong to, with a notice for that person. */
  private dropExpired() {
    const cutoff = this.now() - MAX_AGE_MS;
    const expired = this.ops.filter((op) => Date.parse(op.createdAt) < cutoff && op.id !== this.sendingId);
    if (expired.length === 0) return;
    this.remove(expired);
    for (const op of expired) this.notify(op, 'closed', [op], null);
    void this.persist().catch(() => undefined);
  }

  /** One notice per person, checklist and reason: more of the same adds to its count. */
  private notify(op: OutboxOp, reason: OutboxNotice['reason'], dropped: OutboxOp[], latest: ChecklistRunDto | null) {
    const count = dropped.filter((queued) => queued.kind !== 'submit').length;
    const existing = this.notices.find(
      (notice) => notice.userId === op.userId && notice.runId === op.runId && notice.reason === reason,
    );
    if (existing) {
      this.notices = this.notices.map((notice) =>
        notice === existing ? { ...notice, count: notice.count + count } : notice,
      );
      return;
    }
    this.notices = [
      ...this.notices,
      {
        id: this.deps.newId(),
        userId: op.userId,
        runId: op.runId,
        reason,
        count,
        by: latest?.submittedByName ?? null,
        title: latest?.title ?? null,
      },
    ];
  }

  // ---- small helpers ----

  private remove(gone: OutboxOp[]) {
    const ids = new Set(gone.map((op) => op.id));
    this.ops = this.ops.filter((op) => !ids.has(op.id));
    for (const op of gone) {
      // A photo file is kept only while something still waiting needs it.
      if (op.kind !== 'answer' || !op.photo || !op.attachmentId) continue;
      const stillNeeded = this.ops.some(
        (queued) => queued.kind === 'answer' && queued.photo && queued.attachmentId === op.attachmentId,
      );
      if (!stillNeeded) this.deps.discardPhoto(op.attachmentId);
    }
  }

  private replace(next: OutboxOp) {
    this.ops = this.ops.map((op) => (op.id === next.id ? next : op));
  }

  /** Writes the whole outbox to the phone, one write after another so they never cross. */
  private persist(): Promise<void> {
    const write = this.saving.then(() => this.deps.save({ version: 1, ops: this.ops, notices: this.notices }));
    this.saving = write.catch(() => undefined);
    return write;
  }

  private schedule() {
    this.stopTimer();
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0]!;
    const setTimer = this.deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.timer = setTimer(() => {
      this.timer = null;
      void this.drain();
    }, delay);
  }

  private stopTimer() {
    if (this.timer === null) return;
    (this.deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private emit() {
    const ops = this.userId ? this.ops.filter((op) => op.userId === this.userId) : [];
    const notices = this.userId ? this.notices.filter((notice) => notice.userId === this.userId) : [];
    this.snapshot = {
      ready: this.loaded,
      ops,
      notices,
      online: this.online,
      // "Sending" covers the whole attempt, including the moment the login is being confirmed.
      phase: ops.length === 0 ? 'idle' : this.needsLogin ? 'needsLogin' : this.draining ? 'sending' : 'waiting',
      sendingId: this.sendingId,
      allSentAt: this.allSentAt,
    };
    for (const listener of this.listeners) listener();
  }
}

// ---- what the person sees ----

/** A checklist as it stands on this phone: the server's copy with what is still waiting laid over it. */
export interface RunView {
  run: ChecklistRunDto;
  /** Items with an answer on this phone that the server does not have yet. */
  items: Record<string, { /** A photo taken on this phone, not yet on the server. */ localPhotoId: string | null }>;
  /** How many answers and photos are waiting (a waiting Submit is not counted). */
  unsent: number;
  /** Submit was pressed on this phone and has not reached the server. */
  submitPending: boolean;
}

/**
 * Lays one person's waiting answers over the server's copy of a checklist, so
 * the screen shows their work as done straight away. `ops` may hold other
 * checklists' entries; they are ignored. A checklist the server has already
 * locked is shown exactly as the server has it.
 */
export function applyPending(run: ChecklistRunDto, ops: readonly OutboxOp[], myName: string | null): RunView {
  const mine = ops.filter((op) => op.runId === run.id);
  const view: RunView = {
    run,
    items: {},
    unsent: mine.filter((op) => op.kind !== 'submit').length,
    submitPending: false,
  };
  if (mine.length === 0 || (run.status !== 'PENDING' && run.status !== 'IN_PROGRESS')) return view;

  const items = run.items.map((item) => ({ ...item }));
  let status: ChecklistRunDto['status'] = run.status;
  let submittedAt = run.submittedAt;
  let submittedByName = run.submittedByName;
  // Photos taken on this phone that the server has not linked to an answer yet.
  const localPhotos = new Set<string>();

  for (const op of mine) {
    if (op.kind === 'submit') {
      status = 'SUBMITTED';
      submittedAt = op.createdAt;
      submittedByName = myName;
      view.submitPending = true;
      continue;
    }
    const item = items.find((candidate) => candidate.id === op.itemId);
    if (!item) continue;
    if (op.kind === 'clear') {
      item.response = null;
      view.items[item.id] = { localPhotoId: null };
      continue;
    }
    if (op.photo && op.attachmentId) localPhotos.add(op.attachmentId);
    item.response = {
      passed: op.passed,
      note: op.passed ? null : (op.note ?? null),
      capturedAt: op.capturedAt,
      // As on the server: whoever answered first stays named.
      takenByName: item.response?.takenByName ?? myName,
      photoPath: item.response?.photoPath ?? null,
    };
    view.items[item.id] = {
      localPhotoId: op.attachmentId && localPhotos.has(op.attachmentId) ? op.attachmentId : null,
    };
    if (status === 'PENDING') status = 'IN_PROGRESS';
  }

  view.run = { ...run, items, status, submittedAt, submittedByName };
  return view;
}
