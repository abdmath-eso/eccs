import { ApiError } from '@eccs/api-client';
import { isVisitDone } from '@eccs/shared';
import { useSyncExternalStore } from 'react';

import { api } from '@/lib/api';

import { checklistCache } from './checklist-cache';
import { fieldCache } from './field-cache';
import type { FieldOp, FieldState } from './field-ops';
import { discardPhoto, keptPhotoFacts, newId, openKeptPhoto, readJson, writeJson } from './files';
import { Outbox, type Failure, type OutboxFile } from './outbox-core';

// The app's one outbox: the rules in outbox-core.ts joined to this phone's
// storage and to the server. Everyone's waiting answers are in one file, each
// marked with whose it is; see outbox-core.ts for how they are kept apart.

const FILE = 'outbox';

/** The photo's file is no longer on the phone, so it can never be sent. */
class MissingPhotoError extends Error {}

/** Sorts a failed send into what to do about it. */
function classify(error: unknown): Failure {
  if (error instanceof MissingPhotoError) return 'rejected';
  if (!(error instanceof ApiError)) return 'retry';
  if (error.isNetworkError) return 'offline';
  if (error.status === 401) return 'auth';
  // The checklist was submitted by someone, or its day is over.
  if (error.status === 409) return 'conflict';
  // The server is busy or broken: nothing wrong with the answer itself.
  if (error.status === 408 || error.status === 429 || error.status >= 500) return 'retry';
  return 'rejected';
}

/**
 * Sends one step of a Supervisor's visit or inspection and keeps the server's
 * reply on the phone. Each call is safe to repeat: times and photo ids are
 * chosen on the phone, and the server recognises them when they arrive twice.
 */
async function sendField(op: FieldOp): Promise<void> {
  const id = op.subjectId;
  switch (op.kind) {
    case 'visitCheckIn':
      return fieldCache.putVisit(await api.visits.checkIn(id, { at: op.at }));
    case 'visitTask':
      return fieldCache.putVisit(
        await api.visits.answerTask(id, op.itemId, {
          done: op.done,
          ...(op.note && { note: op.note }),
          ...(op.value !== undefined && { value: op.value }),
        }),
      );
    case 'visitRecord':
      return fieldCache.putVisit(
        await api.visits.updateRecord(id, {
          technicianNames: op.technicianNames,
          notes: op.notes,
          ...(op.partnerName !== undefined && { partnerName: op.partnerName }),
        }),
      );
    case 'visitPhoto': {
      const file = await openKeptPhoto(op.photoId);
      if (!file) throw new MissingPhotoError();
      return fieldCache.putVisit(
        await api.visits.addPhoto(id, op.photoKind, file, {
          id: op.photoId,
          capturedAt: op.capturedAt,
          facts: await keptPhotoFacts(op.photoId),
        }),
      );
    }
    case 'visitPhotoRemove':
      return fieldCache.putVisit(await api.visits.removePhoto(id, op.photoId));
    case 'visitComplete':
      return fieldCache.putVisit(await api.visits.complete(id, { at: op.at }));
    case 'inspFinish':
      return fieldCache.putInspection(await api.inspections.finish(id, { at: op.at }));
    default:
      break;
  }

  // The rest are single checks of an inspection: the server replies with just that
  // check, which goes into the copy saved on the phone (read from its file first,
  // in case the app was only just opened).
  let result;
  if (op.kind === 'inspAnswer') {
    const failed = op.answer === 'NON_COMPLIANT';
    result = await api.inspections.answer(id, op.itemId, {
      answer: op.answer,
      at: op.at,
      ...(failed && {
        note: op.note ?? '',
        severity: op.severity ?? null,
        correctiveAction: op.correctiveAction ?? '',
        dueDate: op.dueDate ?? null,
      }),
    });
  } else if (op.kind === 'inspPhoto') {
    const file = await openKeptPhoto(op.photoId);
    if (!file) throw new MissingPhotoError();
    result = await api.inspections.addPhoto(id, op.itemId, file, {
      id: op.photoId,
      capturedAt: op.capturedAt,
      facts: await keptPhotoFacts(op.photoId),
    });
  } else {
    result = await api.inspections.removePhoto(id, op.photoId, op.itemId);
  }
  await fieldCache.open('inspection', id);
  fieldCache.patchCheck(id, result);
}

/**
 * After the server refused a step: how the visit or inspection stands there
 * now. Its latest copy is kept on the phone, so the screen shows the truth.
 */
async function inspectField(op: FieldOp): Promise<FieldState> {
  try {
    if (op.subject === 'visit') {
      const visit = await api.visits.get(op.subjectId);
      fieldCache.putVisit(visit);
      if (visit.canRecord) return 'open';
      return visit.status === 'CANCELLED' ? 'cancelled' : isVisitDone(visit.status) ? 'finished' : 'gone';
    }
    const inspection = await api.inspections.get(op.subjectId);
    fieldCache.putInspection(inspection);
    if (inspection.canRecord) return 'open';
    return inspection.status === 'SUBMITTED' || inspection.status === 'APPROVED' ? 'finished' : 'gone';
  } catch (error) {
    // Given to someone else, or removed: the server no longer shows it to this person.
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return 'gone';
    throw error;
  }
}

export const outbox = new Outbox({
  load: () => readJson<OutboxFile>(FILE),
  save: (file) => writeJson(FILE, file),
  transport: {
    whoAmI: async () => (await api.auth.me()).id,
    async uploadPhoto(op) {
      const file = op.attachmentId ? await openKeptPhoto(op.attachmentId) : null;
      if (!file || !op.attachmentId) throw new MissingPhotoError();
      // The id was chosen on the phone, so sending the same photo again stores it once.
      // `capturedAt` is when the photo was taken, however much later it is sent.
      // The facts noted when it was taken (where the phone was, that the camera took it) go with it.
      await api.attachments.upload({
        outletId: op.outletId,
        file,
        id: op.attachmentId,
        capturedAt: op.capturedAt,
        facts: await keptPhotoFacts(op.attachmentId),
      });
    },
    answer: (op) =>
      api.checklists.answer(op.runId, op.itemId, {
        passed: op.passed,
        note: op.passed ? undefined : op.note,
        attachmentId: op.attachmentId,
        capturedAt: op.capturedAt,
      }),
    clear: (op) => api.checklists.clearAnswer(op.runId, op.itemId),
    submit: (op) => api.checklists.submit(op.runId),
    fetchRun: (runId) => api.checklists.run(runId),
  },
  field: { send: sendField, inspect: inspectField },
  classify,
  onRun: (run) => checklistCache.putRun(run),
  discardPhoto,
  newId,
});

// A visit's or inspection's saved copy is kept for as long as work for it is waiting on this phone.
fieldCache.keepWhile(async (subject, id) => {
  await outbox.init();
  return outbox.hasFieldWork(subject, id);
});

/** The outbox as it is now, for a screen; the screen redraws whenever it changes. */
export const useOutbox = () => useSyncExternalStore(outbox.subscribe, outbox.getSnapshot, outbox.getSnapshot);

/** True when a failed load only means there is no signal, so the copy on the phone is shown instead. */
export const isNoSignal = (error: unknown) => error instanceof ApiError && error.isNetworkError;
