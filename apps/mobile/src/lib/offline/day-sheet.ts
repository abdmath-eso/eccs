import { cleanCarryItem, closeShownFully, type CarryItemDto, type DaySheetDto, type SheetToDoDto } from '@eccs/shared';

// The day's sheet on a Supervisor's phone (console plan step 3, 20 Oct 2026): its rules, with
// no React or Expo in them so they can be tested (day-sheet.test.ts). The sheet is the server's
// copy, kept with the visit lists in field-cache.ts. The ticks on "What to carry" are the
// phone's own and never sent: one small file per person, for one India day (sheet-ticks.ts).

/** The ticks kept on this phone for one person. */
export interface SheetTicksFile {
  version: 1;
  /** The India date they are for. A file for another day is forgotten, never shown. */
  date: string;
  /** The things ticked, by `carryKey`, in the list's order. */
  ticked: string[];
}

type CarryLine = Pick<CarryItemDto, 'item'>;

/** One thing, the way the server merges the lists: "Ladder" and " ladder " are the same thing. */
export const carryKey = (item: string) => cleanCarryItem(item).toLowerCase();

/** The sheet kept on this phone, if it is today's. An earlier day's copy is not shown. */
export function todaysSheet(sheet: DaySheetDto | null | undefined, today: string): DaySheetDto | null {
  return sheet && sheet.date === today ? sheet : null;
}

/**
 * The ticks that apply to today's list: the file's, if it is for that day, and only for things
 * still on the list. A thing whose visits all left the sheet drops off with its tick; a new
 * thing arrives unticked.
 */
export function ticksThatApply(file: SheetTicksFile | null, date: string, carry: readonly CarryLine[]): Set<string> {
  if (!file || file.version !== 1 || file.date !== date) return new Set();
  const onList = new Set(carry.map((line) => carryKey(line.item)));
  return new Set(file.ticked.filter((key) => onList.has(key)));
}

/** The file after one tick or untick: for that day, holding only what is on its list. */
export function withTick(
  file: SheetTicksFile | null,
  date: string,
  carry: readonly CarryLine[],
  item: string,
  ticked: boolean,
): SheetTicksFile {
  const next = ticksThatApply(file, date, carry);
  if (ticked) next.add(carryKey(item));
  else next.delete(carryKey(item));
  return { version: 1, date, ticked: carry.map((line) => carryKey(line.item)).filter((key) => next.has(key)) };
}

/** "3 of 8 packed". */
export function packedCount(carry: readonly CarryLine[], ticks: ReadonlySet<string>): { packed: number; total: number } {
  return { packed: carry.filter((line) => ticks.has(carryKey(line.item))).length, total: carry.length };
}

/**
 * "Still to do today": from 4 pm in India, when the office's Evening close opens, and without a
 * visit whose Finish is already on this phone waiting to be sent (its card says so).
 */
export function stillToDoShown(
  items: readonly SheetToDoDto[],
  now: Date,
  finishWaiting: (visitId: string) => boolean,
): SheetToDoDto[] {
  if (!closeShownFully(now)) return [];
  return items.filter((item) => !(item.kind === 'FINISH' && item.visitId !== null && finishWaiting(item.visitId)));
}
