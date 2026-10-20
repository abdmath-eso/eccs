import type { CarryItemDto } from '@eccs/shared';

import { withTick, type SheetTicksFile } from './day-sheet';
import { readJson, removeJson, writeJson } from './files';

// The ticks on the day's sheet's "What to carry" (the rules are in day-sheet.ts). They live on
// this phone only and are never sent: the office's sheet is the list, the van is the Supervisor's.
// One small file per person, holding one India day; each tick replaces it, so the first tick of
// a new day leaves the earlier day behind, and a file found for another day is deleted on opening.

let owner: string | null = null;
let file: SheetTicksFile | null = null;
let loading: Promise<void> = Promise.resolve();
let saving: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

const changed = () => {
  for (const listener of listeners) listener();
};

const nameOf = (userId: string) => `sheet-ticks-${userId}`;

export const sheetTicks = {
  /** Reads this person's ticks for the day from the phone. Safe to call often. */
  load(userId: string, date: string): Promise<void> {
    if (userId !== owner) {
      owner = userId;
      file = null;
      changed();
      loading = readJson<SheetTicksFile>(nameOf(userId)).then((saved) => {
        if (owner !== userId || !saved) return;
        if (saved.version === 1 && saved.date === date) {
          file = saved;
          changed();
        } else {
          removeJson(nameOf(userId));
        }
      });
    }
    return loading;
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  get: (): SheetTicksFile | null => file,

  /** Ticks or unticks one thing on the day's list, after the file has been read (or a tick could wipe it). */
  set(date: string, carry: readonly Pick<CarryItemDto, 'item'>[], item: string, ticked: boolean) {
    const forUser = owner;
    if (!forUser) return;
    void loading.then(() => {
      if (owner !== forUser) return;
      file = withTick(file, date, carry, item, ticked);
      changed();
      const value = file;
      // One write after another. A tick that could not be stored lasts until the app closes.
      saving = saving.then(() => writeJson(nameOf(forUser), value)).catch(() => undefined);
    });
  },
};
