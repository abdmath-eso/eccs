import { ApiError, type ApiClient } from '@eccs/api-client';
import { LEGAL_ERROR, type CreateFoodLabelInput, type FoodItemDto } from '@eccs/shared';

import { readJson, writeJson } from './offline/files';

// Labels made without signal.
//
// A label has to be printed the moment the food goes into its tub, signal or
// no signal. The print itself needs no server, so when the server cannot be
// reached the label is printed anyway and its record is kept in a small list
// on the phone, then sent the next time a label screen is opened with signal.
// Each carries an id chosen on the phone, which the server remembers, so sending one
// twice still makes one label.
//
// This is deliberately a small list of its own and not part of the app's main
// outbox (lib/offline/outbox-core.ts): that one is built round checklists and
// a Supervisor's visits, with rules about order and conflicts that labels do
// not have. Each label stands alone, so "send each, keep what did not go" is
// all that is needed. Also kept here: the outlet's saved labels, so the Food
// labels screen opens, and prints, without signal.

export interface QueuedLabel {
  userId: string;
  outletId: string;
  /**
   * Exactly what will be sent, with the phone's own id and the moment Print
   * was pressed. That moment goes as both `madeAt` and `preparedAt`, so the
   * label says when the food was really labelled, however late it is sent;
   * the server adds how long the food keeps to it, as the phone did.
   */
  input: CreateFoodLabelInput & { clientId: string; madeAt: string; preparedAt: string };
}

const FILE = 'label-queue';
const read = async () => (await readJson<QueuedLabel[]>(FILE).catch(() => null)) ?? [];

/** Labels this person made on this phone that the server does not have yet. */
export const queuedLabels = async (userId: string, outletId?: string) =>
  (await read()).filter((entry) => entry.userId === userId && (!outletId || entry.outletId === outletId));

/**
 * Keeps a label to send later. It keeps the id the screen already tried to
 * send it with, so if that first try did reach the server after all, sending
 * it again from here still makes one label.
 */
export async function queueLabel(entry: QueuedLabel) {
  await writeJson(FILE, [...(await read()).filter((other) => other.input.clientId !== entry.input.clientId), entry]);
  return entry;
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
          // Refused until the person agrees to updated terms (TERMS_NOT_ACCEPTED) is not final either.
          const final =
            error instanceof ApiError &&
            !error.isNetworkError &&
            error.status >= 400 &&
            error.status < 500 &&
            ![401, 408, 429].includes(error.status) &&
            error.code !== LEGAL_ERROR.notAccepted;
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

// ───────────────────────── The outlet's saved labels, kept for no signal ─────────────────────────

interface Kept {
  items: FoodItemDto[];
  outletName: string;
}

const keptName = (outletId: string) => `label-items-${outletId}`;

export const keepLabelChoices = (outletId: string, kept: Kept) => writeJson(keptName(outletId), kept).catch(() => undefined);
export const keptLabelChoices = (outletId: string) => readJson<Kept>(keptName(outletId)).catch(() => null);
