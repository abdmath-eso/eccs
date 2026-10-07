import { ApiError } from '@eccs/api-client';
import { useSyncExternalStore } from 'react';

import { api } from '@/lib/api';

import { checklistCache } from './checklist-cache';
import { discardPhoto, newId, openKeptPhoto, readJson, writeJson } from './files';
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
      await api.attachments.upload({ outletId: op.outletId, file, id: op.attachmentId, capturedAt: op.capturedAt });
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
  classify,
  onRun: (run) => checklistCache.putRun(run),
  discardPhoto,
  newId,
});

/** The outbox as it is now, for a screen; the screen redraws whenever it changes. */
export const useOutbox = () => useSyncExternalStore(outbox.subscribe, outbox.getSnapshot, outbox.getSnapshot);

/** True when a failed load only means there is no signal, so the copy on the phone is shown instead. */
export const isNoSignal = (error: unknown) => error instanceof ApiError && error.isNetworkError;
