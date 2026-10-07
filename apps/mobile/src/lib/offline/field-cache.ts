import type { InspectionAnswerResultDto, InspectionDto, VisitDto } from '@eccs/shared';

import { rescored, type FieldSubject } from './field-ops';
import { readJson, removeJson, writeJson } from './files';

// Service visits and inspections as the server last sent them, kept on the
// phone so they can be opened and worked on with no signal. Like the saved
// checklists (checklist-cache.ts) this is always the server's own copy: work
// still waiting to be sent is never mixed in, it is laid over it on screen
// (applyVisitPending, applyInspectionPending). Each copy carries the time the
// server sent it, so the screen can say "as of 2:15 pm" when it shows it
// without signal.
//
// Per person: one small file for the lists, and one file for each visit or
// inspection (an inspection has 92 checks, so they are kept apart to keep each
// save small on a slow phone).

/** Something the server sent, with when it sent it. */
export interface Saved<T> {
  /** Milliseconds since 1970, by this phone's clock. */
  at: number;
  data: T;
}

interface IndexFile {
  version: 1;
  /** A screen's list, under a name the screen chooses. */
  lists: Record<string, Saved<unknown>>;
  /** Every visit and inspection that has its own file ("visit:<id>"), with when it was last saved. */
  known: Record<string, number>;
}

// A visit or inspection not looked at for this long is forgotten, unless work for it is still waiting.
const KEEP_MS = 30 * 86_400_000;

const emptyIndex = (): IndexFile => ({ version: 1, lists: {}, known: {} });
const keyOf = (subject: FieldSubject, id: string) => `${subject}:${id}`;

let userId: string | null = null;
let index: IndexFile = emptyIndex();
let details: Record<string, Saved<VisitDto | InspectionDto>> = {};
/** The files being read, so two screens asking for the same one share the read. */
let opening: Record<string, Promise<void>> = {};
let loading: Promise<void> = Promise.resolve();
let saving: Promise<void> = Promise.resolve();
let stillNeeded: (subject: FieldSubject, id: string) => Promise<boolean> = async () => true;
const listeners = new Set<() => void>();

const changed = () => {
  for (const listener of listeners) listener();
};

const fileOf = (owner: string, key: string) => `field-${owner}-${key}`;

/** One write after another, and never before the lists have been read (or a save could wipe them). */
function queue(write: (owner: string) => Promise<void> | void) {
  const owner = userId;
  if (!owner) return;
  saving = saving
    .then(() => loading)
    .then(() => (userId === owner ? write(owner) : undefined))
    .catch(() => undefined);
}

const saveIndex = () => queue((owner) => writeJson(fileOf(owner, 'lists'), index));

function put(subject: FieldSubject, value: VisitDto | InspectionDto) {
  if (!userId) return;
  const key = keyOf(subject, value.id);
  const saved = { at: Date.now(), data: value };
  details = { ...details, [key]: saved };
  index = { ...index, known: { ...index.known, [key]: saved.at } };
  changed();
  queue((owner) => writeJson(fileOf(owner, key), saved));
  saveIndex();
}

/** Forgets visits and inspections nobody has looked at for a long time, to keep the phone tidy. */
async function forgetOld(owner: string) {
  const cutoff = Date.now() - KEEP_MS;
  for (const [key, at] of Object.entries(index.known)) {
    if (at >= cutoff || userId !== owner) continue;
    const [subject, id] = key.split(':') as [FieldSubject, string];
    if (await stillNeeded(subject, id)) continue;
    const { [key]: _old, ...rest } = index.known;
    index = { ...index, known: rest };
    removeJson(fileOf(owner, key));
  }
  saveIndex();
}

export const fieldCache = {
  /**
   * Reads this person's saved lists from the phone. Each person has their own,
   * so one login never sees what another opened. Safe to call often.
   */
  load(forUserId: string): Promise<void> {
    if (forUserId !== userId) {
      userId = forUserId;
      index = emptyIndex();
      details = {};
      opening = {};
      changed();
      loading = readJson<IndexFile>(fileOf(forUserId, 'lists')).then((file) => {
        if (userId !== forUserId || file?.version !== 1) return;
        // Anything already fetched in the meantime is newer than the file.
        index = { version: 1, lists: { ...file.lists, ...index.lists }, known: { ...file.known, ...index.known } };
        changed();
        void forgetOld(forUserId);
      });
    }
    return loading;
  },

  /** Forgets what is in memory when the person logs out; their files stay for next time. */
  close() {
    userId = null;
    index = emptyIndex();
    details = {};
    opening = {};
    changed();
  },

  /** Says how to tell whether a visit or inspection still has work waiting, so it is never forgotten. */
  keepWhile(needed: (subject: FieldSubject, id: string) => Promise<boolean>) {
    stillNeeded = needed;
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** A screen's list as the server last sent it, or null if it was never loaded on this phone. */
  getList<T>(name: string): Saved<T> | null {
    return (index.lists[name] as Saved<T> | undefined) ?? null;
  },

  putList(name: string, data: unknown) {
    if (!userId) return;
    index = { ...index, lists: { ...index.lists, [name]: { at: Date.now(), data } } };
    changed();
    saveIndex();
  },

  /**
   * Brings a visit or inspection saved on this phone into memory, if it is not
   * there yet. A screen calls this before deciding that it is "not on this phone".
   */
  open(subject: FieldSubject, id: string): Promise<void> {
    const owner = userId;
    const key = keyOf(subject, id);
    if (!owner || details[key]) return Promise.resolve();
    opening[key] ??= loading
      .then(() => readJson<Saved<VisitDto | InspectionDto>>(fileOf(owner, key)))
      .then((file) => {
        // Anything fetched in the meantime is newer than the file.
        if (userId !== owner || !file || details[key]) return;
        details = { ...details, [key]: file };
        changed();
      });
    return opening[key];
  },

  /** Drops the copy of a visit or inspection the server no longer shows this person. */
  forget(subject: FieldSubject, id: string) {
    const key = keyOf(subject, id);
    if (!userId || index.known[key] === undefined) return;
    const { [key]: _gone, ...rest } = details;
    const { [key]: _old, ...known } = index.known;
    details = rest;
    index = { ...index, known };
    changed();
    queue((owner) => removeJson(fileOf(owner, key)));
    saveIndex();
  },

  /** When the full copy on this phone (in memory or in its file) was saved; null if there is none. */
  savedAt(subject: FieldSubject, id: string): number | null {
    return index.known[keyOf(subject, id)] ?? null;
  },

  getVisit(id: string): Saved<VisitDto> | null {
    return (details[keyOf('visit', id)] as Saved<VisitDto> | undefined) ?? null;
  },

  getInspection(id: string): Saved<InspectionDto> | null {
    return (details[keyOf('inspection', id)] as Saved<InspectionDto> | undefined) ?? null;
  },

  /** Keeps the server's latest copy of one visit. */
  putVisit(visit: VisitDto) {
    put('visit', visit);
  },

  putInspection(inspection: InspectionDto) {
    put('inspection', inspection);
  },

  /**
   * After one answer or photo is sent the server replies with just that check
   * (to keep it light on a slow connection); this puts it into the saved inspection.
   */
  patchCheck(inspectionId: string, result: InspectionAnswerResultDto) {
    const saved = this.getInspection(inspectionId);
    if (!saved) return;
    const sections = saved.data.sections.map((section) => ({
      ...section,
      checks: section.checks.map((check) => (check.itemId === result.check.itemId ? result.check : check)),
    }));
    put('inspection', rescored({ ...saved.data, sections, status: result.status }).inspection);
  },
};
