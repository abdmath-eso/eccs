import type { ChecklistRunDto, ChecklistRunSummaryDto } from '@eccs/shared';

import { addDays, indiaToday } from '@/lib/format';

import { readJson, writeJson } from './files';

// The checklists as the server last sent them, kept on the phone so they can
// be opened and filled in with no signal. This is always the server's own
// copy: answers still waiting to be sent are never mixed in here, they are
// laid over it on screen (see applyPending). So when the server has the last
// word, as after a conflict, showing "what the server has" is just showing this.
//
// One small file per person. It holds today's list for each outlet they
// opened, and every checklist they opened today or yesterday; older ones are
// dropped each time it is saved, so it does not grow.

interface TodayList {
  /** The India calendar day the list is for. */
  date: string;
  runIds: string[];
  history: ChecklistRunSummaryDto[];
}

interface CacheFile {
  version: 1;
  today: Record<string, TodayList>;
  runs: Record<string, ChecklistRunDto>;
}

const empty = (): CacheFile => ({ version: 1, today: {}, runs: {} });

let userId: string | null = null;
let data: CacheFile = empty();
let loading: Promise<void> = Promise.resolve();
let saving: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
// What screens were last given, so a screen is handed the very same object until it changes.
let todayViews: Record<string, { runs: ChecklistRunDto[]; history: ChecklistRunSummaryDto[] }> = {};

function changed() {
  todayViews = {};
  for (const listener of listeners) listener();
}

function save() {
  const owner = userId;
  if (!owner) return;
  saving = saving
    // Never before the file has been read, or a save could wipe what it held.
    .then(() => loading)
    .then(() => {
      if (userId !== owner) return;
      // Keep only what can still be filled in or is likely to be looked at.
      const oldest = addDays(indiaToday(), -1);
      const runs = Object.fromEntries(Object.entries(data.runs).filter(([, run]) => run.date >= oldest));
      const today = Object.fromEntries(Object.entries(data.today).filter(([, list]) => list.date >= oldest));
      return writeJson(`checklists-${owner}`, { version: 1, today, runs } satisfies CacheFile);
    })
    .catch(() => undefined);
}

export const checklistCache = {
  /**
   * Reads this person's saved checklists from the phone. Each person has
   * their own, so one login never sees what another opened. Safe to call often.
   */
  load(forUserId: string): Promise<void> {
    if (forUserId !== userId) {
      userId = forUserId;
      data = empty();
      changed();
      loading = readJson<CacheFile>(`checklists-${forUserId}`).then((file) => {
        if (userId !== forUserId || file?.version !== 1) return;
        // Anything already fetched in the meantime is newer than the file.
        data = { version: 1, today: { ...file.today, ...data.today }, runs: { ...file.runs, ...data.runs } };
        changed();
      });
    }
    return loading;
  },

  /** Forgets what is in memory when the person logs out; their file stays for next time. */
  close() {
    userId = null;
    data = empty();
    changed();
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** A checklist as the server last sent it, or null if it was never opened on this phone. */
  getRun(runId: string): ChecklistRunDto | null {
    return data.runs[runId] ?? null;
  },

  /** Today's list for an outlet as last sent by the server; null if not saved, or saved on an earlier day. */
  getToday(outletId: string | null): { runs: ChecklistRunDto[]; history: ChecklistRunSummaryDto[] } | null {
    if (!outletId) return null;
    const list = data.today[outletId];
    if (!list || list.date !== indiaToday()) return null;
    todayViews[outletId] ??= {
      runs: list.runIds.map((id) => data.runs[id]).filter((run): run is ChecklistRunDto => run !== undefined),
      history: list.history,
    };
    return todayViews[outletId];
  },

  /** Keeps the server's latest copy of one checklist. */
  putRun(run: ChecklistRunDto) {
    if (!userId) return;
    data = { ...data, runs: { ...data.runs, [run.id]: run } };
    changed();
    save();
  },

  /** Keeps today's list for an outlet, with each of its checklists in full. */
  putToday(outletId: string, runs: ChecklistRunDto[], history: ChecklistRunSummaryDto[]) {
    if (!userId) return;
    const kept = { ...data.runs };
    for (const run of runs) kept[run.id] = run;
    data = {
      ...data,
      runs: kept,
      // With no checklists there is no date to read; the list is then simply today's.
      today: { ...data.today, [outletId]: { date: runs[0]?.date ?? indiaToday(), runIds: runs.map((run) => run.id), history } },
    };
    changed();
    save();
  },
};
