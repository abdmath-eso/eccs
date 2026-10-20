import { z } from "zod";
import type { LocalizedText } from "./checklists.js";
import { visitSlotWindow, VISIT_SLOTS, type VisitSlot, type VisitStatus } from "./services.js";

// The day's sheet (20 Oct 2026; docs/CONSOLE_PLAN.md 4.1 part 4 and 4.11, the founder's design
// page 1): one per Supervisor with visits that day. The visits in time order, each with its
// address, a map link and the note from the outlet's last visit; and what to carry, from each
// kind of service's "What to carry" in Catalogue, merged so each thing is listed once with the
// visits that need it. Today shows it to the office, "Send the day's sheet" sends it to the
// Supervisor's phone (where it sits at the top of the jobs list, ticks kept on the phone for the
// day), and in the evening the phone adds what the Evening close still lists for their visits.
// Quantities of chemicals come later, with stock; route optimisation is out of the first version,
// so the order is by time.
//
// Pattern: the technician's day in Jobber's and ServiceTitan's mobile apps (today's jobs in time
// order with the arrival window, the address and a directions link, the job's notes, prefetched for
// the day so it works without signal) and a job-materials pick list (each item once, with the job
// it is for, ticked as the van is loaded).

export const DAY_SHEET_RULES = {
  /** The most things one kind of service can list to carry. */
  maxCarryItems: 20,
  /** The longest one thing ("Hood brushes, large"). */
  carryItemMax: 60,
} as const;

// ───────────────────────── What to carry ─────────────────────────

/** One thing to carry, cleaned: spaces collapsed and trimmed; empty when there is nothing. */
export const cleanCarryItem = (text: string) => text.replace(/\s+/g, " ").trim();

/** The key two lists share for the same thing: "Ladder" and " ladder " are one. */
const carryKey = (text: string) => cleanCarryItem(text).toLowerCase();

/** A kind of service's list, cleaned: empty lines dropped, a repeat kept once, in the order typed. */
export function cleanCarryList(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = cleanCarryItem(raw);
    if (!item || seen.has(carryKey(item))) continue;
    seen.add(carryKey(item));
    out.push(item);
  }
  return out;
}

/** Catalogue: the list for one kind of service, one thing per entry. */
export const carryItemsSchema = z
  .array(z.string().max(DAY_SHEET_RULES.carryItemMax, `Keep each thing under ${DAY_SHEET_RULES.carryItemMax} letters`))
  .max(DAY_SHEET_RULES.maxCarryItems, `List at most ${DAY_SHEET_RULES.maxCarryItems} things`)
  .transform(cleanCarryList);

/** One thing on the merged list, and the visits that need it, in the order of the day. */
export interface CarryItemDto {
  /** As the first visit's service lists it. */
  item: string;
  visits: { visitId: string; outletName: string; time: string | null }[];
}

/**
 * The day's list: every visit's things, each listed once with the visits that need it. In the
 * order of the day: a thing comes where the first visit that needs it lists it.
 */
export function mergeCarryList(visits: readonly { visitId: string; outletName: string; time: string | null; items: readonly string[] }[]): CarryItemDto[] {
  const merged = new Map<string, CarryItemDto>();
  for (const visit of visits) {
    for (const item of cleanCarryList(visit.items)) {
      const key = carryKey(item);
      const entry = merged.get(key) ?? { item, visits: [] };
      if (!entry.visits.some((known) => known.visitId === visit.visitId)) {
        entry.visits.push({ visitId: visit.visitId, outletName: visit.outletName, time: visit.time });
      }
      merged.set(key, entry);
    }
  }
  return [...merged.values()];
}

// ───────────────────────── The visits ─────────────────────────

/** A link that opens the outlet in a maps app: by its saved place when there is one, else by its address. */
export function mapLink(outlet: { latitude: number | null; longitude: number | null; address: string | null }): string | null {
  if (outlet.latitude !== null && outlet.longitude !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${outlet.latitude},${outlet.longitude}`;
  }
  const address = outlet.address?.trim();
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
}

/** The "HH:mm" an arrival window starts at; null after closing or with no time. */
const startOf = (slot: VisitSlot | null) => (slot ? (visitSlotWindow(slot)?.start ?? null) : null);

/**
 * The sheet's visits as they stand, as one string: a visit added, removed, moved to another
 * time or given to someone else changes it. "Send the day's sheet" keeps it, so the console can
 * say "changed since" when the visits moved after sending.
 */
export function daySheetKey(visits: readonly { visitId: string; slot: VisitSlot | null }[]): string {
  return [...visits]
    .map((visit) => `${visit.visitId}@${visit.slot ?? "-"}`)
    .sort()
    .join("|");
}

/** Time order, with visits after closing (or with no time set) last. */
export function sortSheetVisits<T extends { slot: VisitSlot | null; outletName: string }>(visits: readonly T[]): T[] {
  const rank = (slot: VisitSlot | null) => (slot ? VISIT_SLOTS.indexOf(slot) : VISIT_SLOTS.length);
  return [...visits].sort((a, b) => rank(a.slot) - rank(b.slot) || a.outletName.localeCompare(b.outletName));
}

export interface DaySheetVisitDto {
  visitId: string;
  /** "HH:mm" it starts; null after closing or with no time. */
  time: string | null;
  slot: VisitSlot | null;
  outletName: string;
  /** Street and city. */
  address: string | null;
  /** Opens the outlet in a maps app. */
  mapUrl: string | null;
  serviceName: LocalizedText;
  status: VisitStatus;
  /** The outside firm doing its share of the work, if any. */
  partnerName: string | null;
  /** A free follow-up visit (Quality): no invoice. */
  free: boolean;
  /** What the Supervisor wrote at the outlet's last visit, if anything. */
  lastNote: string | null;
  /** This visit's own things to carry. */
  carry: string[];
}

/** Something the Evening close still lists for one of the Supervisor's visits, for "Still to do today" on the phone. */
export type SheetToDoKind = "FINISH" | "PHOTOS" | "INSPECTION" | "RETURNED" | "SIGN_OFF";

export interface SheetToDoDto {
  kind: SheetToDoKind;
  outletName: string;
  /** The visit to open (FINISH, PHOTOS, RETURNED, SIGN_OFF), or the inspection (INSPECTION). */
  visitId: string | null;
  inspectionId: string | null;
}

/** The order "Still to do today" lists them in: the Supervisor's own work first, what waits on the restaurant last. */
export const SHEET_TO_DO_ORDER: readonly SheetToDoKind[] = ["FINISH", "PHOTOS", "RETURNED", "INSPECTION", "SIGN_OFF"];

/** "Still to do today" from the day's facts about the Supervisor's own visits (the Evening close's lines, per visit). */
export function sheetToDo(facts: {
  visits: readonly { visitId: string; outletName: string; finished: boolean; hasBefore: boolean; hasAfter: boolean; awaitingSignOff: boolean }[];
  inspections: readonly { inspectionId: string; outletName: string }[];
  returned: readonly { visitId: string; outletName: string }[];
}): SheetToDoDto[] {
  const items: SheetToDoDto[] = [];
  for (const visit of facts.visits) {
    if (!visit.finished) items.push({ kind: "FINISH", outletName: visit.outletName, visitId: visit.visitId, inspectionId: null });
    else if (!visit.hasBefore || !visit.hasAfter) items.push({ kind: "PHOTOS", outletName: visit.outletName, visitId: visit.visitId, inspectionId: null });
    if (visit.awaitingSignOff) items.push({ kind: "SIGN_OFF", outletName: visit.outletName, visitId: visit.visitId, inspectionId: null });
  }
  for (const visit of facts.returned) items.push({ kind: "RETURNED", outletName: visit.outletName, visitId: visit.visitId, inspectionId: null });
  for (const inspection of facts.inspections) {
    items.push({ kind: "INSPECTION", outletName: inspection.outletName, visitId: null, inspectionId: inspection.inspectionId });
  }
  return items.sort((a, b) => SHEET_TO_DO_ORDER.indexOf(a.kind) - SHEET_TO_DO_ORDER.indexOf(b.kind));
}

/** When the sheet was last sent, and whether the visits have changed since. */
export interface DaySheetSentStateDto {
  at: string;
  byName: string;
  /** The visits moved, came or went after it was sent. */
  changedSince: boolean;
}

export interface DaySheetDto {
  /** The India date it is for. */
  date: string;
  supervisorId: string;
  supervisorName: string;
  /** In time order. */
  visits: DaySheetVisitDto[];
  /** Merged: each thing once, with the visits that need it. */
  carry: CarryItemDto[];
  /** Null until the office sends it. */
  sent: DaySheetSentStateDto | null;
  /** The Super Admin or the Ops Manager may send it (and again once it has changed). */
  canSend: boolean;
  /**
   * What the Evening close still lists for these visits (the phone shows it from 4 pm as "Still to
   * do today"); worked out for the Supervisor's own sheet, empty on the office's copies.
   */
  stillToDo: SheetToDoDto[];
}

/** POST /today/sheets/:supervisorId/send: the day it is for, so a page left open past midnight cannot send the next day's. */
export const sendDaySheetSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the day as YYYY-MM-DD") });
export type SendDaySheetInput = z.input<typeof sendDaySheetSchema>;

/** What Send answers. */
export interface DaySheetSentDto {
  supervisorId: string;
  date: string;
  sentAt: string;
  /** 1 when the Supervisor was told, 0 when the notification could not be written. */
  told: number;
}

/** "Sent at 6:10 am", "Sent at 6:10 am; changed since". The console's English. */
export function sentWords(sent: Pick<DaySheetSentStateDto, "changedSince"> & { time: string }): string {
  return sent.changedSince ? `Sent at ${sent.time}; changed since` : `Sent at ${sent.time}`;
}

/** The time a sheet's visit starts, for the merged list ("for the 3:30 pm visit"). */
export const sheetVisitTime = (slot: VisitSlot | null) => startOf(slot);
