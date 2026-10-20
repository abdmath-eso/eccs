// The day's sheet on a Supervisor's phone (console plan step 3, 20 Oct 2026): which sheet is
// shown, which ticks on "What to carry" still apply, what a tick saves, the packed count, and
// when "Still to do today" shows. No phone, storage or network is involved.
//
// Run from the repo root with:
//   pnpm exec vitest run --root apps/mobile src/lib/offline

import { indiaMoment, type DaySheetDto, type SheetToDoDto } from '@eccs/shared';
import { describe, expect, it } from 'vitest';

import { carryKey, packedCount, stillToDoShown, ticksThatApply, todaysSheet, withTick, type SheetTicksFile } from './day-sheet';

const TODAY = '2026-10-20';
const YESTERDAY = '2026-10-19';

const line = (item: string) => ({ item, visits: [{ visitId: 'v1', outletName: 'Spice Route', time: '14:00' }] });
const LIST = [line('Ladder'), line('Harness'), line('Hood brushes')];

const ticks = (date: string, ticked: string[]): SheetTicksFile => ({ version: 1, date, ticked });

function sheet(date: string): DaySheetDto {
  return {
    date,
    supervisorId: 'sup-1',
    supervisorName: 'Naveen',
    visits: [],
    carry: LIST,
    sent: null,
    canSend: false,
    stillToDo: [],
  };
}

describe('the sheet kept on the phone', () => {
  it('is shown on its own day only', () => {
    expect(todaysSheet(sheet(TODAY), TODAY)?.date).toBe(TODAY);
    expect(todaysSheet(sheet(YESTERDAY), TODAY)).toBeNull();
    expect(todaysSheet(null, TODAY)).toBeNull();
    expect(todaysSheet(undefined, TODAY)).toBeNull();
  });
});

describe('the ticks on What to carry', () => {
  it('treats a thing the way the server merges it, whatever its spacing or capitals', () => {
    expect(carryKey('  Hood   Brushes ')).toBe(carryKey('hood brushes'));
  });

  it('keeps today’s ticks', () => {
    expect([...ticksThatApply(ticks(TODAY, ['ladder', 'harness']), TODAY, LIST)]).toEqual(['ladder', 'harness']);
  });

  it('forgets an earlier day’s ticks, and starts empty with no file', () => {
    expect(ticksThatApply(ticks(YESTERDAY, ['ladder']), TODAY, LIST).size).toBe(0);
    expect(ticksThatApply(null, TODAY, LIST).size).toBe(0);
  });

  it('drops a thing whose visits all left the sheet, with its tick', () => {
    const now = [line('Ladder'), line('Hood brushes')];
    expect([...ticksThatApply(ticks(TODAY, ['ladder', 'harness']), TODAY, now)]).toEqual(['ladder']);
  });

  it('brings a new thing in unticked', () => {
    const now = [...LIST, line('Gloves')];
    const applied = ticksThatApply(ticks(TODAY, ['ladder']), TODAY, now);
    expect(applied.has('gloves')).toBe(false);
    expect(packedCount(now, applied)).toEqual({ packed: 1, total: 4 });
  });

  it('saves a tick for today only, in the list’s order, without what has left the list', () => {
    const before = ticks(TODAY, ['hood brushes', 'gone thing']);
    expect(withTick(before, TODAY, LIST, 'Ladder', true)).toEqual(ticks(TODAY, ['ladder', 'hood brushes']));
  });

  it('starts a new day’s file on the first tick, leaving the earlier day behind', () => {
    expect(withTick(ticks(YESTERDAY, ['harness']), TODAY, LIST, 'ladder', true)).toEqual(ticks(TODAY, ['ladder']));
  });

  it('unticks', () => {
    expect(withTick(ticks(TODAY, ['ladder', 'harness']), TODAY, LIST, 'Harness', false)).toEqual(ticks(TODAY, ['ladder']));
  });

  it('counts what is packed', () => {
    expect(packedCount(LIST, new Set(['ladder', 'harness']))).toEqual({ packed: 2, total: 3 });
    expect(packedCount([], new Set())).toEqual({ packed: 0, total: 0 });
  });
});

describe('Still to do today', () => {
  const items: SheetToDoDto[] = [
    { kind: 'FINISH', outletName: 'Spice Route', visitId: 'v1', inspectionId: null },
    { kind: 'PHOTOS', outletName: 'Biryani House', visitId: 'v2', inspectionId: null },
    { kind: 'SIGN_OFF', outletName: 'Cafe Nilgiri', visitId: 'v3', inspectionId: null },
    { kind: 'INSPECTION', outletName: 'Tandoori Nights', visitId: null, inspectionId: 'i1' },
  ];
  const nothingWaiting = () => false;

  it('shows from 4 pm in India, and not before', () => {
    expect(stillToDoShown(items, indiaMoment(TODAY, '15:59'), nothingWaiting)).toEqual([]);
    expect(stillToDoShown(items, indiaMoment(TODAY, '16:00'), nothingWaiting)).toEqual(items);
  });

  it('leaves out a visit whose Finish is on this phone waiting to be sent, and nothing else', () => {
    const shown = stillToDoShown(items, indiaMoment(TODAY, '18:30'), (visitId) => visitId === 'v1' || visitId === 'v3');
    expect(shown.map((item) => item.kind)).toEqual(['PHOTOS', 'SIGN_OFF', 'INSPECTION']);
  });
});
