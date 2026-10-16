import {
  freeCheckCounts,
  freeCheckFindings,
  inPointOrder,
  isReferral,
  moveForward,
  normalizePhone,
  scoreInspection,
  STEP_STAGE,
  type InspectionAnswer,
  type InspectionCheckDto,
  type InspectionDto,
  type InspectionScore,
  type InspectionSeverity,
  type LeadActivityDto,
  type LeadDetailDto,
  type LeadInput,
  type LeadRowDto,
  type LeadStage,
  type LeadUpdateInput,
  type LoseInput,
  type ParkInput,
  type StepInput,
  type VisitDto,
  type VisitPhotoKind,
} from '@eccs/shared';

// What an ECCS Supervisor does in a kitchen with no signal: the steps of a
// service visit and of an inspection. Each step is one entry in the same outbox
// the checklists use (see outbox-core.ts), kept on the phone and sent in order.
// This file is the shapes of those entries and the rule for showing them on
// screen before the server has them. Like outbox-core.ts it knows nothing about
// React, the phone's storage or the network, so it can be tested on its own.

/** What a step belongs to: one service visit, one inspection, or one of a BDE's leads (B2). */
export type FieldSubject = 'visit' | 'inspection' | 'lead';

/**
 * Why work is being kept on the phone without being sent:
 * finished: the visit or inspection was finished from somewhere else first;
 * cancelled: the ECCS office cancelled the visit;
 * gone: it was given to someone else, or removed.
 * Held work is never deleted by the app itself. The person either sends it
 * again (after the office has put things right) or deletes it themselves.
 */
export type HoldReason = 'finished' | 'cancelled' | 'gone';

/** Where the visit or inspection stands on the server: still open to this person, or why not. */
export type FieldState = 'open' | HoldReason;

interface FieldBase {
  id: string;
  /** Who did it. It is only ever sent while this same person is logged in. */
  userId: string;
  /** When it was done on the phone. */
  createdAt: string;
  /** How many times sending was tried and did not get through. */
  attempts: number;
  subject: FieldSubject;
  /** The visit's or the inspection's id. */
  subjectId: string;
  /** Set when the server refused the work for this visit or inspection; it is kept, not sent. */
  held?: HoldReason;
}

/** "I have arrived". `at` is when it was tapped; the server records that time, and uses it to recognise a repeat. */
export interface VisitCheckInOp extends FieldBase {
  kind: 'visitCheckIn';
  at: string;
}

/** A task ticked as done, or marked not done with its reason. */
export interface VisitTaskOp extends FieldBase {
  kind: 'visitTask';
  itemId: string;
  done: boolean;
  note?: string;
  /** For a task that records a meter reading (the frying oil test): the number read. */
  value?: number;
}

/** Who did the work, and the notes for the restaurant. */
export interface VisitRecordOp extends FieldBase {
  kind: 'visitRecord';
  technicianNames: string[];
  notes: string;
  /** The outside partner that did its share of the work; left out when the screen does not ask for it. */
  partnerName?: string;
}

/** A before or after photo. Its file is kept on the phone under `photoId` until the server has it. */
export interface VisitPhotoOp extends FieldBase {
  kind: 'visitPhoto';
  /** Chosen on the phone, so sending the photo twice stores it once. */
  photoId: string;
  photoKind: VisitPhotoKind;
  capturedAt: string;
}

export interface VisitPhotoRemoveOp extends FieldBase {
  kind: 'visitPhotoRemove';
  photoId: string;
}

/** Finish. `at` is when it was pressed; see VisitCheckInOp. */
export interface VisitCompleteOp extends FieldBase {
  kind: 'visitComplete';
  at: string;
}

/** The answer to one inspection check, with the details of a non-compliance. */
export interface InspAnswerOp extends FieldBase {
  kind: 'inspAnswer';
  itemId: string;
  answer: InspectionAnswer;
  note?: string;
  severity?: InspectionSeverity | null;
  correctiveAction?: string;
  dueDate?: string | null;
  /** When it was answered. */
  at: string;
}

/** A photo of a non-compliance. */
export interface InspPhotoOp extends FieldBase {
  kind: 'inspPhoto';
  itemId: string;
  photoId: string;
  capturedAt: string;
}

export interface InspPhotoRemoveOp extends FieldBase {
  kind: 'inspPhotoRemove';
  itemId: string;
  photoId: string;
}

export interface InspFinishOp extends FieldBase {
  kind: 'inspFinish';
  at: string;
}

// A BDE's work on a lead (B2, 16 Oct 2026). The lead's id, each step's id and its time
// are all chosen on the phone, so the server recognises anything sent twice (B1's
// `POST /sales/leads` and `/steps`, and Park and Lost since B2, take them for this).

/** A lead's photo (the shop board, a free check's "Needs fixing"). Its file is kept on the phone under `photoId` until the server has it; it goes before what points at it. */
export interface LeadPhotoOp extends FieldBase {
  kind: 'leadPhoto';
  photoId: string;
  capturedAt: string;
}

/** A lead logged on this phone. `subjectId` is the lead's id, also `input.id`. */
export interface LeadCreateOp extends FieldBase {
  kind: 'leadCreate';
  input: LeadInput & { id: string };
}

/** A change to a lead's details or its next step. Only what changed is sent. */
export interface LeadUpdateOp extends FieldBase {
  kind: 'leadUpdate';
  changes: LeadUpdateInput;
}

/** A call, a visit, a note, a free check booked or done (with its scorecard). */
export interface LeadStepOp extends FieldBase {
  kind: 'leadStep';
  input: StepInput & { id: string; at: string };
}

export interface LeadParkOp extends FieldBase {
  kind: 'leadPark';
  input: ParkInput & { id: string; at: string };
}

export interface LeadLoseOp extends FieldBase {
  kind: 'leadLose';
  input: LoseInput & { id: string; at: string };
}

export type VisitOp = VisitCheckInOp | VisitTaskOp | VisitRecordOp | VisitPhotoOp | VisitPhotoRemoveOp | VisitCompleteOp;
export type InspectionOp = InspAnswerOp | InspPhotoOp | InspPhotoRemoveOp | InspFinishOp;
export type LeadOp = LeadPhotoOp | LeadCreateOp | LeadUpdateOp | LeadStepOp | LeadParkOp | LeadLoseOp;
export type FieldOp = VisitOp | InspectionOp | LeadOp;

type Filled = 'id' | 'userId' | 'createdAt' | 'attempts' | 'held';
type Unfilled<T> = T extends unknown ? Omit<T, Filled> : never;
/** What to add to the outbox; the id, time and person are filled in there. */
export type NewFieldOp = Unfilled<FieldOp>;

/** Anything in the outbox: a Supervisor's step, or a checklist entry (which has no `subject`). */
interface AnyOp {
  kind: string;
  subject?: FieldSubject;
}

export const isFieldOp = (op: AnyOp): op is FieldOp => op.subject !== undefined;
/** A photo whose file is kept on this phone until the step is sent. */
export const isPhotoOp = (op: FieldOp): op is VisitPhotoOp | InspPhotoOp | LeadPhotoOp =>
  op.kind === 'visitPhoto' || op.kind === 'inspPhoto' || op.kind === 'leadPhoto';
/** Finish: the step that closes the visit or the inspection. */
export const isFinishOp = (op: FieldOp): op is VisitCompleteOp | InspFinishOp =>
  op.kind === 'visitComplete' || op.kind === 'inspFinish';

const about = (ops: readonly AnyOp[], subject: FieldSubject, subjectId: string): FieldOp[] =>
  ops.filter((op): op is FieldOp => isFieldOp(op) && op.subject === subject && op.subjectId === subjectId);

/** What a list needs to know about one visit or inspection without having it in full. */
export interface FieldSummary {
  /** Steps saved on this phone that the server does not have yet (held ones are not counted). */
  unsent: number;
  /** Steps the server refused, kept on this phone, and why. */
  held: number;
  holdReason: HoldReason | null;
  /** Work was started on this phone (a check-in, an answer) that the server has not heard of. */
  started: boolean;
  /** Finish was pressed on this phone and has not reached the server. */
  finishPending: boolean;
}

export function fieldSummary(ops: readonly AnyOp[], subject: FieldSubject, subjectId: string): FieldSummary {
  const mine = about(ops, subject, subjectId);
  const held = mine.filter((op) => op.held);
  return {
    unsent: mine.length - held.length,
    held: held.length,
    holdReason: held[0]?.held ?? null,
    started: mine.length > 0,
    finishPending: mine.some(isFinishOp),
  };
}

// ───────────────────────── A visit as it stands on this phone ─────────────────────────

export interface VisitView extends FieldSummary {
  /** The server's copy with what is still waiting on this phone laid over it. */
  visit: VisitDto;
  /** Photos taken on this phone that the server does not have yet: shown from the phone's own file. */
  localPhotos: ReadonlySet<string>;
  /** Tasks answered on this phone that the server does not have yet. */
  unsentTasks: ReadonlySet<string>;
  /** The check-in, or the team and notes, are still waiting. */
  checkInPending: boolean;
  recordPending: boolean;
}

/**
 * Lays one person's waiting steps over the server's copy of a visit, so the
 * screen shows their work as done straight away. `ops` may hold other things;
 * they are ignored. A visit the server no longer lets this person record
 * (finished, cancelled) is shown exactly as the server has it.
 */
export function applyVisitPending(
  visit: VisitDto,
  ops: readonly AnyOp[],
  me: { id: string; name: string } | null,
): VisitView {
  const mine = about(ops, 'visit', visit.id) as VisitOp[];
  const view: VisitView = {
    ...fieldSummary(ops, 'visit', visit.id),
    visit,
    localPhotos: new Set(),
    unsentTasks: new Set(),
    checkInPending: false,
    recordPending: false,
  };
  if (mine.length === 0 || !visit.canRecord) return view;

  const next: VisitDto = { ...visit, tasks: visit.tasks.map((task) => ({ ...task })), photos: [...visit.photos] };
  const localPhotos = new Set<string>();
  const unsentTasks = new Set<string>();

  for (const op of mine) {
    switch (op.kind) {
      case 'visitCheckIn':
        if (next.status === 'SCHEDULED' || next.status === 'ASSIGNED') {
          next.status = 'IN_PROGRESS';
          next.checkInAt = op.at;
          // As on the server: whoever starts a visit nobody was given takes it.
          next.supervisorId ??= me?.id ?? null;
          next.supervisorName ??= me?.name ?? null;
        }
        view.checkInPending = true;
        break;
      case 'visitTask': {
        const task = next.tasks.find((candidate) => candidate.itemId === op.itemId);
        if (!task) break;
        task.done = op.done;
        task.note = op.note || null;
        // A reading task keeps its number while done; "not done" clears it, as on the server.
        if (task.reading) task.reading = { ...task.reading, value: op.done ? (op.value ?? null) : null };
        unsentTasks.add(op.itemId);
        break;
      }
      case 'visitRecord':
        next.technicianNames = [...new Set(op.technicianNames)];
        next.notes = op.notes || null;
        if (op.partnerName !== undefined) next.partnerName = op.partnerName || null;
        view.recordPending = true;
        break;
      case 'visitPhoto':
        if (!next.photos.some((photo) => photo.id === op.photoId)) {
          next.photos.push({ id: op.photoId, kind: op.photoKind, path: '' });
          localPhotos.add(op.photoId);
        }
        break;
      case 'visitPhotoRemove':
        next.photos = next.photos.filter((photo) => photo.id !== op.photoId);
        localPhotos.delete(op.photoId);
        break;
      case 'visitComplete':
        // The status stays "in progress" until the server has the Finish: nobody else can see it yet.
        next.completedAt = op.at;
        break;
    }
  }

  view.visit = next;
  view.localPhotos = localPhotos;
  view.unsentTasks = unsentTasks;
  return view;
}

// ───────────────────────── An inspection as it stands on this phone ─────────────────────────

export interface InspectionView extends FieldSummary {
  /** The server's copy with what is still waiting on this phone laid over it, scores included. */
  inspection: InspectionDto;
  /** The scores of the answers as they stand on this phone, by the same rule the server uses. */
  score: InspectionScore;
  localPhotos: ReadonlySet<string>;
  /** Checks answered or changed on this phone that the server does not have yet. */
  unsentChecks: ReadonlySet<string>;
}

/** The server's own test for "nothing more is needed for this check" (see InspectionCheckDto.complete). */
export const isCheckComplete = (check: InspectionCheckDto) =>
  check.answer !== null &&
  (check.answer !== 'NON_COMPLIANT' ||
    Boolean(check.note && check.severity && check.correctiveAction && check.dueDate && check.photos.length > 0));

/** The inspection's scores, worked out on the phone with the function the server uses (`scoreInspection`). */
export function scoreOf(inspection: InspectionDto): InspectionScore {
  return scoreInspection(
    inspection.sections.flatMap((section) =>
      section.checks.map((check) => ({ section: section.title, marks: check.marks, answer: check.answer })),
    ),
  );
}

/**
 * An inspection with its section scores and its counts worked out again from its
 * checks as they stand, for a copy on the phone whose checks have changed.
 */
export function rescored(inspection: InspectionDto): { inspection: InspectionDto; score: InspectionScore } {
  const score = scoreOf(inspection);
  const checks = inspection.sections.flatMap((section) => section.checks);
  const answered = checks.filter((check) => check.answer !== null).length;
  return {
    score,
    inspection: {
      ...inspection,
      sections: inspection.sections.map((section) => {
        const scored = score.sections.find((entry) => entry.section === section.title);
        return scored ? { ...section, score: scored.score, earned: scored.earned, possible: scored.possible } : section;
      }),
      answered,
      complete: checks.filter((check) => check.complete).length,
      nonCompliant: score.nonCompliant,
      criticalFailed: score.criticalFailed,
      // A draft nobody has answered a check of is still only planned.
      status: inspection.status === 'PLANNED' && answered > 0 ? 'IN_PROGRESS' : inspection.status,
    },
  };
}

/**
 * Lays one person's waiting answers, photos and Finish over the server's copy
 * of an inspection, and works the scores out again from the result. An
 * inspection the server no longer lets this person record is shown as the
 * server has it.
 */
export function applyInspectionPending(inspection: InspectionDto, ops: readonly AnyOp[]): InspectionView {
  const mine = about(ops, 'inspection', inspection.id) as InspectionOp[];
  const summary = fieldSummary(ops, 'inspection', inspection.id);
  if (mine.length === 0 || !inspection.canRecord) {
    return { ...summary, inspection, score: scoreOf(inspection), localPhotos: new Set(), unsentChecks: new Set() };
  }

  const checks = new Map<string, InspectionCheckDto>();
  const sections = inspection.sections.map((section) => ({
    ...section,
    checks: section.checks.map((check) => {
      const copy = { ...check, photos: [...check.photos] };
      checks.set(copy.itemId, copy);
      return copy;
    }),
  }));
  const localPhotos = new Set<string>();
  const unsentChecks = new Set<string>();
  let finishedAt: string | null = null;
  let startedAt = inspection.startedAt;

  for (const op of mine) {
    if (op.kind === 'inspFinish') {
      finishedAt = op.at;
      continue;
    }
    const check = checks.get(op.itemId);
    if (!check) continue;
    unsentChecks.add(op.itemId);
    if (op.kind === 'inspAnswer') {
      const failed = op.answer === 'NON_COMPLIANT';
      // As on the server: the details belong to a non-compliance, and go when the answer changes.
      if (!failed) {
        for (const photo of check.photos) localPhotos.delete(photo.id);
        check.photos = [];
      }
      check.answer = op.answer;
      check.note = failed ? op.note || null : null;
      check.severity = failed ? (op.severity ?? null) : null;
      check.correctiveAction = failed ? op.correctiveAction || null : null;
      check.dueDate = failed ? (op.dueDate ?? null) : null;
      startedAt ??= op.at;
    } else if (op.kind === 'inspPhoto') {
      if (check.answer === 'NON_COMPLIANT' && !check.photos.some((photo) => photo.id === op.photoId)) {
        check.photos.push({ id: op.photoId, path: '' });
        localPhotos.add(op.photoId);
      }
    } else {
      check.photos = check.photos.filter((photo) => photo.id !== op.photoId);
      localPhotos.delete(op.photoId);
    }
  }

  for (const check of checks.values()) check.complete = isCheckComplete(check);

  const { inspection: next, score } = rescored({ ...inspection, sections, startedAt });
  if (finishedAt) {
    // Finished on this phone: the score is shown now, though the status stays "under way"
    // until the server has it, because nobody else can see it yet.
    next.completedAt = finishedAt;
    next.overallScore = score.overallScore;
    next.grade = score.grade;
  }

  return { ...summary, inspection: next, score, localPhotos, unsentChecks };
}

// ───────────────────────── A BDE's lead as it stands on this phone (B2) ─────────────────────────

/** Who is using the phone, for the steps they log here. */
export interface Me {
  id: string;
  name: string;
}

export interface LeadView extends FieldSummary {
  /** The server's copy (or, for a lead logged here, one made from what was typed) with what is still waiting laid over it. */
  lead: LeadDetailDto;
  /** Logged on this phone and not on the server yet. */
  isNew: boolean;
  /** Timeline entries done on this phone that the server does not have yet. */
  unsentActivities: ReadonlySet<string>;
  /** Photos (the board, a free check's) still only on this phone: shown from the phone's own file. */
  localPhotos: ReadonlySet<string>;
}

const leadOps = (ops: readonly AnyOp[], leadId: string) => about(ops, 'lead', leadId) as LeadOp[];

/** A typed phone number as the server will keep it, for showing before it has it. */
const phoneOf = (typed: string | null | undefined) => (typed ? (normalizePhone(typed) ?? typed) : null);
const textOf = (typed: string | null | undefined) => {
  const trimmed = typed?.trim();
  return trimmed ? trimmed : null;
};

function activity(fields: Partial<LeadActivityDto> & Pick<LeadActivityDto, 'id' | 'kind' | 'at'>): LeadActivityDto {
  return {
    byName: null,
    note: null,
    fromStage: null,
    toStage: null,
    checkAt: null,
    checkWith: null,
    findings: null,
    amountPaise: null,
    signal: null,
    rating: null,
    quoteNumber: null,
    scorecard: null,
    ...fields,
  };
}

/** A lead logged on this phone, as its page shows it before the server has it. */
export function draftLead(op: LeadCreateOp, me: Me | null): LeadDetailDto {
  const input = op.input;
  const at = op.createdAt;
  const nextActionAt = input.nextActionAt ?? null;
  return {
    id: input.id,
    businessName: input.businessName.trim(),
    area: textOf(input.area),
    stage: 'NEW',
    status: 'OPEN',
    source: input.source,
    kitchens: input.kitchens ?? 1,
    ownerId: me?.id ?? op.userId,
    ownerName: me?.name ?? '',
    contactName: textOf(input.contactName),
    contactPhone: phoneOf(input.contactPhone),
    createdAt: at,
    lastActivityAt: at,
    nextAction: textOf(input.nextAction) ?? (nextActionAt ? 'Next step' : null),
    nextActionAt,
    parkedUntil: null,
    quote: null,
    stale: null,
    organization: null,
    isSample: false,
    photo: input.photoId ? { id: input.photoId, path: '' } : null,
    address: textOf(input.address),
    referrerName: input.referrerName && isReferral(input.source) ? textOf(input.referrerName) : null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
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
    activities: [activity({ id: `created-${input.id}`, kind: 'CREATED', at, byName: me?.name ?? null })],
    quotes: [],
    close: null,
    toDo: null,
    owners: [],
  };
}

/**
 * Lays one person's waiting work on a lead over the server's copy, so the lead page and
 * the list show it done straight away: the stage moves right by the same rule the server
 * uses (STEP_STAGE, moveForward), a step on a parked or lost lead brings it back, a park
 * or a loss changes its state, a change of details shows at once, and every step is in
 * the timeline marked as not sent yet. `lead` is null for a lead logged on this phone
 * that the server does not have yet; the view is then made from what was typed. Null
 * when there is neither.
 *
 * While work is waiting, the server's "do today" and "waiting" notes on the lead are put
 * aside: the BDE has just done something about it.
 */
export function applyLeadPending(lead: LeadDetailDto | null, leadId: string, ops: readonly AnyOp[], me: Me | null): LeadView | null {
  const mine = leadOps(ops, leadId);
  const summary = fieldSummary(ops, 'lead', leadId);
  const create = mine.find((op): op is LeadCreateOp => op.kind === 'leadCreate');
  const base = lead ?? (create ? draftLead(create, me) : null);
  if (!base) return null;
  const unsentActivities = new Set<string>();
  const localPhotos = new Set<string>();
  if (mine.length === 0) return { ...summary, lead: base, isNew: false, unsentActivities, localPhotos };

  const next: LeadDetailDto = { ...base, activities: [...base.activities] };
  let acted = false;
  const touched = (at: string) => {
    acted = true;
    if (at > next.lastActivityAt) next.lastActivityAt = at;
  };
  /** A next step given with a step replaces the old one; one already due is cleared, since this step was it (as on the server). */
  const nextStepAfter = (input: { nextAction?: string | null; nextActionAt?: string | null }, at: string) => {
    if (input.nextAction || input.nextActionAt) {
      next.nextAction = textOf(input.nextAction) ?? 'Next step';
      next.nextActionAt = input.nextActionAt ?? null;
    } else if (next.nextActionAt && next.nextActionAt <= at) {
      next.nextAction = null;
      next.nextActionAt = null;
    } else if (!next.nextActionAt && next.nextAction) {
      next.nextAction = null;
    }
  };
  const reopenIfClosed = () => {
    if (next.status === 'OPEN') return;
    next.status = 'OPEN';
    next.parkedAt = null;
    next.parkedUntil = null;
    next.parkedReason = null;
    next.lostAt = null;
    next.lostReason = null;
  };

  for (const op of mine) {
    switch (op.kind) {
      case 'leadPhoto':
        localPhotos.add(op.photoId);
        break;
      case 'leadCreate':
        if (op.input.photoId) localPhotos.add(op.input.photoId);
        break;
      case 'leadUpdate': {
        const changes = op.changes;
        if (changes.businessName !== undefined) next.businessName = changes.businessName.trim();
        if (changes.area !== undefined) next.area = textOf(changes.area);
        if (changes.address !== undefined) next.address = textOf(changes.address);
        if (changes.contactName !== undefined) next.contactName = textOf(changes.contactName);
        if (changes.contactPhone !== undefined) next.contactPhone = phoneOf(changes.contactPhone);
        if (changes.kitchens !== undefined) next.kitchens = changes.kitchens;
        if (changes.source !== undefined) next.source = changes.source;
        if (changes.referrerName !== undefined) next.referrerName = textOf(changes.referrerName);
        if (changes.photoId !== undefined) {
          next.photo = changes.photoId ? { id: changes.photoId, path: '' } : null;
          if (changes.photoId) localPhotos.add(changes.photoId);
        }
        if (changes.nextAction !== undefined || changes.nextActionAt !== undefined) {
          const at = changes.nextActionAt === undefined ? next.nextActionAt : (changes.nextActionAt ?? null);
          const text = changes.nextAction === undefined ? next.nextAction : textOf(changes.nextAction);
          next.nextActionAt = at;
          next.nextAction = at ? (text ?? 'Next step') : text;
          acted = true;
        }
        break;
      }
      case 'leadStep': {
        const input = op.input;
        const from: LeadStage = next.stage;
        const stage = moveForward(from, STEP_STAGE[input.kind]);
        reopenIfClosed();
        nextStepAfter(input, input.at);
        let findings: number | null = null;
        let scorecard: LeadActivityDto['scorecard'] = null;
        if (input.kind === 'CHECK_BOOKED') {
          next.checkAt = input.checkAt ?? null;
          next.checkWith = textOf(input.checkWith);
        }
        if (input.kind === 'CHECK_DONE') {
          const answers = input.scorecard ? inPointOrder(input.scorecard.answers) : null;
          findings = answers ? freeCheckFindings(answers) : (input.findings ?? 0);
          if (answers) {
            scorecard = {
              answers: answers.map((entry) => ({ point: entry.point, answer: entry.answer, photo: entry.photoId ? { id: entry.photoId, path: '' } : null })),
              counts: freeCheckCounts(answers),
            };
            for (const entry of answers) if (entry.photoId) localPhotos.add(entry.photoId);
          }
          next.checkDoneAt = input.at;
          next.checkFindings = findings;
          next.checkAt = null;
          next.checkWith = null;
        }
        next.stage = stage;
        next.activities.push(
          activity({
            id: input.id,
            kind: input.kind,
            at: input.at,
            byName: me?.name ?? null,
            note: textOf(input.note),
            ...(stage !== from && { fromStage: from, toStage: stage }),
            checkAt: input.kind === 'CHECK_BOOKED' ? (input.checkAt ?? null) : null,
            checkWith: input.kind === 'CHECK_BOOKED' ? textOf(input.checkWith) : null,
            findings,
            signal: input.kind === 'ASKED' ? (input.signal ?? null) : null,
            scorecard,
          }),
        );
        unsentActivities.add(input.id);
        touched(input.at);
        break;
      }
      case 'leadPark':
        next.status = 'PARKED';
        next.parkedAt = op.input.at;
        next.parkedUntil = op.input.until;
        next.parkedReason = op.input.reason.trim();
        next.nextAction = null;
        next.nextActionAt = null;
        next.activities.push(activity({ id: op.input.id, kind: 'PARKED', at: op.input.at, byName: me?.name ?? null, note: op.input.reason.trim() }));
        unsentActivities.add(op.input.id);
        touched(op.input.at);
        break;
      case 'leadLose':
        next.status = 'LOST';
        next.lostAt = op.input.at;
        next.lostReason = op.input.reason.trim();
        next.nextAction = null;
        next.nextActionAt = null;
        next.activities.push(activity({ id: op.input.id, kind: 'LOST', at: op.input.at, byName: me?.name ?? null, note: op.input.reason.trim() }));
        unsentActivities.add(op.input.id);
        touched(op.input.at);
        break;
    }
  }

  // Newest first, as the server sends the timeline.
  next.activities.sort((a, b) => b.at.localeCompare(a.at));
  if (acted) {
    next.toDo = null;
    next.stale = null;
  }
  return { ...summary, lead: next, isNew: lead === null, unsentActivities, localPhotos };
}

/** A lead's row for the list, as it stands on this phone. */
export function applyLeadRowPending(row: LeadRowDto, ops: readonly AnyOp[], me: Me | null): LeadRowDto {
  if (leadOps(ops, row.id).length === 0) return row;
  const detail: LeadDetailDto = {
    ...row,
    photo: null,
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
    activities: [],
    quotes: [],
    close: null,
    toDo: null,
    owners: [],
  };
  return rowOf(applyLeadPending(detail, row.id, ops, me)!.lead, row);
}

/** The list's fields of a lead page, on top of a row (or none, for a lead logged here). */
function rowOf(view: LeadDetailDto, row?: LeadRowDto): LeadRowDto {
  return {
    id: view.id,
    businessName: view.businessName,
    area: view.area,
    stage: view.stage,
    status: view.status,
    source: view.source,
    kitchens: view.kitchens,
    ownerId: view.ownerId,
    ownerName: view.ownerName,
    contactName: view.contactName,
    contactPhone: view.contactPhone,
    createdAt: view.createdAt,
    lastActivityAt: view.lastActivityAt,
    nextAction: view.nextAction,
    nextActionAt: view.nextActionAt,
    parkedUntil: view.parkedUntil,
    quote: row?.quote ?? view.quote,
    stale: view.stale,
    organization: row?.organization ?? view.organization,
    isSample: row?.isSample ?? view.isSample,
  };
}

/** Leads logged on this phone that the server does not have yet (not in `known`), newest first, as list rows. */
export function newLeadsOnPhone(ops: readonly AnyOp[], known: ReadonlySet<string>, me: Me | null): LeadRowDto[] {
  const creates = ops.filter((op): op is LeadCreateOp => isFieldOp(op) && op.kind === 'leadCreate' && !known.has(op.subjectId));
  return creates
    .map((op) => rowOf(applyLeadPending(null, op.subjectId, ops, me)!.lead))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
