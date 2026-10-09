import { ApiError, type ApiClient } from '@eccs/api-client';
import type { CreateFoodLabelInput, FoodItemDto } from '@eccs/shared';

import type { LabelFacts } from './labels';
import { newId, readJson, writeJson } from './offline/files';

// Labels made without signal.
//
// A label has to be printed the moment the food goes into its tub, signal or
// no signal. The print itself needs no server, so when the server cannot be
// reached the label is printed anyway and its record is kept in a small list
// on the phone, then sent the next time a label screen is opened with signal.
// Each carries an id chosen here, which the server remembers, so sending one
// twice still makes one label.
//
// This is deliberately a small list of its own and not part of the app's main
// outbox (lib/offline/outbox-core.ts): that one is built round checklists and
// a Supervisor's visits, with rules about order and conflicts that labels do
// not have. Each label stands alone, so "send each, keep what did not go" is
// all that is needed. Also kept here: the outlet's items and names, so the
// "make a label" screen opens without signal.

export interface QueuedLabel {
  userId: string;
  outletId: string;
  /** Exactly what will be sent, with the phone's own id and the moment it was made. */
  input: CreateFoodLabelInput & { clientId: string; madeAt: string; preparedAt: string; expiresAt: string };
  /** What the label says, to show it on the list while it waits. */
  facts: LabelFacts;
}

const FILE = 'label-queue';
const read = async () => (await readJson<QueuedLabel[]>(FILE).catch(() => null)) ?? [];

/** Labels this person made on this phone that the server does not have yet. */
export const queuedLabels = async (userId: string, outletId?: string) =>
  (await read()).filter((entry) => entry.userId === userId && (!outletId || entry.outletId === outletId));

/** Keeps a label to send later. */
export async function queueLabel(entry: Omit<QueuedLabel, 'input'> & { input: Omit<QueuedLabel['input'], 'clientId'> }) {
  const queued: QueuedLabel = { ...entry, input: { ...entry.input, clientId: newId() } };
  await writeJson(FILE, [...(await read()), queued]);
  return queued;
}

let sending: Promise<{ sent: number; refused: number }> | null = null;

/**
 * Sends this person's waiting labels, oldest first. Stops at the first one
 * that cannot get through (no signal, the server in trouble, the login
 * ended) and keeps it and the rest for next time. One the server will never
 * accept (its item was retired meanwhile, it waited too long) is dropped and
 * counted in `refused`, so the screen can say so.
 */
export function sendQueuedLabels(api: ApiClient, userId: string): Promise<{ sent: number; refused: number }> {
  // Two screens asking at once share one go, so nothing is sent twice at the same moment.
  sending ??= (async () => {
    let sent = 0;
    let refused = 0;
    try {
      for (const entry of await queuedLabels(userId)) {
        try {
          await api.foodLabels.create(entry.input);
          sent += 1;
        } catch (error) {
          const final =
            error instanceof ApiError &&
            !error.isNetworkError &&
            error.status >= 400 &&
            error.status < 500 &&
            ![401, 408, 429].includes(error.status);
          if (!final) break;
          refused += 1;
        }
        await writeJson(FILE, (await read()).filter((other) => other.input.clientId !== entry.input.clientId));
      }
    } finally {
      sending = null;
    }
    return { sent, refused };
  })();
  return sending;
}

// ───────────────────────── What the "make a label" screen needs, kept for no signal ─────────────────────────

interface Kept {
  items: FoodItemDto[];
  names: string[];
  outletName: string;
}

const keptName = (outletId: string) => `label-items-${outletId}`;

export const keepLabelChoices = (outletId: string, kept: Kept) => writeJson(keptName(outletId), kept).catch(() => undefined);
export const keptLabelChoices = (outletId: string) => readJson<Kept>(keptName(outletId)).catch(() => null);
