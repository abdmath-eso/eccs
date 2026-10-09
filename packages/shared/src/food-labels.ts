import { z } from "zod";
import type { Language } from "./roles.js";

// Food labels: what was prepared, when, and when it must be used by.
//
// Anyone in the kitchen who makes labels can make one for whatever they want:
// they type its name and say how long it keeps ("8 hours", "1 day"), never a
// clock time. That is saved for the outlet as a "food item" (a saved label),
// so next time it is one tap. "Prepared" is the moment Print is pressed and
// "use by" is that moment plus how long the food keeps (the founder's rule,
// 9 Oct 2026). Where it is stored and its allergens are optional extras that
// a Manager or the Owner can add. Every label that has been made stays on the "what is in the fridge" list until
// someone marks it used up or thrown away, so the list shows what must be used
// today and what has already gone past its time.
//
// This file holds the rules (the arithmetic, the limits, the grouping by day
// in India) and the label's printed layout, so the app and the server always
// agree. Nothing here changes the hygiene score.

// ───────────────────────── Lists ─────────────────────────

/** Where the food is kept. The order is the one shown on screen: the fridge is by far the commonest. */
export const STORAGE_TYPES = ["CHILLED", "FROZEN", "AMBIENT"] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];

/**
 * Allergens a label can warn about. The first nine are the eight groups in
 * FSSAI's Labelling and Display Regulations 2020 (peanuts and tree nuts are
 * one group there and two here, because a kitchen handles them differently);
 * sesame and mustard are added because Indian kitchens use both every day and
 * they are on the European list of fourteen.
 */
export const ALLERGENS = [
  "GLUTEN",
  "MILK",
  "EGG",
  "PEANUT",
  "TREE_NUT",
  "SOY",
  "FISH",
  "CRUSTACEAN",
  "SESAME",
  "MUSTARD",
  "SULPHITE",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const SHELF_LIFE_UNITS = ["HOURS", "DAYS"] as const;
export type ShelfLifeUnit = (typeof SHELF_LIFE_UNITS)[number];

export const FOOD_LABEL_STATUSES = ["LIVE", "USED", "DISCARDED"] as const;
export type FoodLabelStatus = (typeof FOOD_LABEL_STATUSES)[number];

/** Why food was thrown away. */
export const DISCARD_REASONS = ["EXPIRED", "SPOILED", "OTHER"] as const;
export type DiscardReason = (typeof DISCARD_REASONS)[number];

/** Where a live label sits on the "in the fridge now" list. */
export type FoodLabelGroup = "EXPIRED" | "TODAY" | "LATER";

/** The limits. Sample values chosen during the build; the founder can change them here. */
export const FOOD_LABEL_RULES = {
  /** An item keeps for at least an hour and at most a year. */
  minShelfLifeHours: 1,
  maxShelfLifeHours: 365 * 24,
  /**
   * The lengths offered as big buttons when a new label is made, in hours:
   * 4, 8 and 12 hours, then 1, 2, 3, 5 and 7 days. Anything else is typed
   * under "another length". They are only the commonest choices, not advice.
   */
  shelfLifePresets: [4, 8, 12, 24, 48, 72, 120, 168],
  /** "Prepared" can be set back this far, for food made earlier in the shift or last night. */
  maxBackdateHours: 24,
  /** A phone clock this far ahead of the server's is still taken as "now". */
  clockToleranceMinutes: 5,
  /** A label made with no signal can arrive this late and still be accepted. */
  maxQueuedHours: 72,
  /** Even a Manager's or Owner's override cannot put use-by further than this after "prepared". */
  maxUseByDays: 366,
  maxCopies: 20,
  /** A label marked used up or thrown away by mistake can be put back for this long. */
  undoMinutes: 10,
  /** How many of the items used most recently are offered first when making a label. */
  recentItems: 6,
} as const;

// ───────────────────────── Shelf life ─────────────────────────

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Shelf life is stored in hours. "3 days" on screen is 72 hours. */
export function toShelfLifeHours(value: number, unit: ShelfLifeUnit): number {
  return unit === "DAYS" ? value * 24 : value;
}

/** How a stored shelf life is shown: whole days when it divides evenly into days ("1 day", "3 days"), otherwise hours. */
export function shelfLifeParts(hours: number): { value: number; unit: ShelfLifeUnit } {
  return hours >= 24 && hours % 24 === 0 ? { value: hours / 24, unit: "DAYS" } : { value: hours, unit: "HOURS" };
}

/** Whether a number of hours is a whole number inside the limits (an hour to a year). */
export function isShelfLifeAllowed(hours: number): boolean {
  return Number.isInteger(hours) && hours >= FOOD_LABEL_RULES.minShelfLifeHours && hours <= FOOD_LABEL_RULES.maxShelfLifeHours;
}

// ───────────────────────── Names ─────────────────────────

/**
 * A label's name as it is compared with others: capitals, spaces at the ends
 * and doubled spaces do not count, so "paneer  Marination " is the same label
 * as "Paneer marination". Only for comparing; the name is kept as typed.
 */
export function looseLabelName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The saved label that already has this name, compared loosely, if there is one. */
export function findSameName<T extends { name: string }>(items: readonly T[], name: string): T | undefined {
  const wanted = looseLabelName(name);
  return wanted ? items.find((item) => looseLabelName(item.name) === wanted) : undefined;
}

// ───────────────────────── Use-by arithmetic and limits ─────────────────────────

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

/** The latest use-by the item's shelf life allows: prepared plus the shelf life, to the minute. */
export function useByFor(preparedAt: Date | string, shelfLifeHours: number): Date {
  return new Date(toDate(preparedAt).getTime() + shelfLifeHours * HOUR_MS);
}

/** What is wrong with a label's times. Each has its own sentence in the app. */
export type LabelTimeProblem =
  | "PREPARED_IN_FUTURE"
  | "PREPARED_TOO_OLD"
  | "USE_BY_BEFORE_PREPARED"
  | "USE_BY_TOO_FAR"
  | "OVERRIDE_NOT_ALLOWED"
  | "OVERRIDE_NEEDS_REASON";

export interface LabelTimesCheck {
  problem: LabelTimeProblem | null;
  /** True when use-by is later than the shelf life allows, which only a Manager or Owner may do, with a reason. */
  overridden: boolean;
}

/**
 * Checks a label's two times against the rules:
 *  - "prepared" is not in the future and not more than a day back;
 *  - "use by" is after "prepared";
 *  - "use by" is not later than the item's shelf life allows, unless a
 *    Manager or Owner says so and gives a reason;
 *  - and never more than about a year, whoever asks.
 * `now` is the moment the label is being made.
 */
export function checkLabelTimes(input: {
  preparedAt: Date | string;
  expiresAt: Date | string;
  shelfLifeHours: number;
  now: Date | string;
  /** Whether this person may go past the shelf life (Manager or Owner). */
  mayOverride: boolean;
  overrideReason?: string | null | undefined;
}): LabelTimesCheck {
  const prepared = toDate(input.preparedAt).getTime();
  const expires = toDate(input.expiresAt).getTime();
  const now = toDate(input.now).getTime();
  const fail = (problem: LabelTimeProblem, overridden = false): LabelTimesCheck => ({ problem, overridden });

  if (prepared > now + FOOD_LABEL_RULES.clockToleranceMinutes * 60_000) return fail("PREPARED_IN_FUTURE");
  if (prepared < now - FOOD_LABEL_RULES.maxBackdateHours * HOUR_MS) return fail("PREPARED_TOO_OLD");
  if (expires <= prepared) return fail("USE_BY_BEFORE_PREPARED");

  // A minute's leeway, so a time rounded to the minute on the phone is not taken for an override.
  const overridden = expires > useByFor(new Date(prepared), input.shelfLifeHours).getTime() + 60_000;
  if (!overridden) return { problem: null, overridden: false };
  if (!input.mayOverride) return fail("OVERRIDE_NOT_ALLOWED", true);
  if (expires > prepared + FOOD_LABEL_RULES.maxUseByDays * DAY_MS) return fail("USE_BY_TOO_FAR", true);
  if (!input.overrideReason?.trim()) return fail("OVERRIDE_NEEDS_REASON", true);
  return { problem: null, overridden: true };
}

// ───────────────────────── Days in India ─────────────────────────

// India is five and a half hours ahead of UTC all year (no summer time), so
// the Indian calendar day can be worked out with plain arithmetic.
const INDIA_OFFSET_MS = 5.5 * HOUR_MS;

/** The calendar day in India, as YYYY-MM-DD, that a moment falls on. */
export function indiaDay(at: Date | string): string {
  return new Date(toDate(at).getTime() + INDIA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The day of the week in India: 0 is Sunday, 6 is Saturday. */
export function indiaWeekday(at: Date | string): number {
  return new Date(toDate(at).getTime() + INDIA_OFFSET_MS).getUTCDay();
}

/**
 * Where a live label belongs on the list:
 *  EXPIRED once its use-by moment has passed;
 *  TODAY when it runs out later today (the Indian calendar day);
 *  LATER otherwise. A label that runs out at midnight exactly belongs to the
 *  day that is starting, so it is LATER until midnight and EXPIRED from then.
 */
export function labelGroup(expiresAt: Date | string, now: Date | string): FoodLabelGroup {
  const expires = toDate(expiresAt);
  const at = toDate(now);
  if (expires.getTime() <= at.getTime()) return "EXPIRED";
  return indiaDay(expires) === indiaDay(at) ? "TODAY" : "LATER";
}

/** Splits live labels into the three groups, each with the soonest use-by first. */
export function groupLabels<T extends { expiresAt: string }>(labels: readonly T[], now: Date | string): Record<FoodLabelGroup, T[]> {
  const groups: Record<FoodLabelGroup, T[]> = { EXPIRED: [], TODAY: [], LATER: [] };
  for (const label of [...labels].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))) {
    groups[labelGroup(label.expiresAt, now)].push(label);
  }
  return groups;
}

// ───────────────────────── The day mark ─────────────────────────

/**
 * Kitchens mark each day of the week so a glance at a shelf shows what is
 * oldest ("day dots"). The usual colours are below (DayMark's and NCCO's
 * convention: Monday blue through Sunday black). A thermal label printer
 * prints black only, and about one man in twelve cannot tell some colours
 * apart, so every day also has its own shape and the day is always written
 * as a word; colour is an extra on the phone's screen, never the only sign.
 * Index 0 is Sunday.
 */
export const DAY_MARKS = [
  { shape: "stripes", color: "#111111" },
  { shape: "circle", color: "#1D4ED8" },
  { shape: "triangle", color: "#EAB308" },
  { shape: "square", color: "#C62828" },
  { shape: "diamond", color: "#7C4A21" },
  { shape: "star", color: "#15803D" },
  { shape: "cross", color: "#EA580C" },
] as const;
export type DayShape = (typeof DAY_MARKS)[number]["shape"];

// ───────────────────────── Words on the label ─────────────────────────

/** The locale for a language, asking for ordinary digits (0-9) in every script. */
const localeFor = (language: Language) => (language === "EN" ? "en-IN" : `${language.toLowerCase()}-IN-u-nu-latn`);

/**
 * A moment as it is printed on a label: day name, date, month in words and
 * the time, in India, for example "Fri, 9 Oct, 4:30 pm". The month is a word
 * so 4/10 can never be read as 10 April, and the day name is there because a
 * cook thinks "use it by Monday", not "by the 12th".
 */
export function formatLabelMoment(at: Date | string, language: Language): string {
  const date = toDate(at);
  try {
    return new Intl.DateTimeFormat(localeFor(language), {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/** The day of the week in full, in India, for example "Monday". */
export function formatLabelWeekday(at: Date | string, language: Language): string {
  const date = toDate(at);
  try {
    return new Intl.DateTimeFormat(localeFor(language), { timeZone: "Asia/Kolkata", weekday: "long" }).format(date);
  } catch {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][indiaWeekday(date)]!;
  }
}

// ───────────────────────── The printed label ─────────────────────────

/**
 * Label sizes. 50 x 25 mm is the commonest direct-thermal stock sold in India
 * and 50 x 30 mm the next (and what the small Bluetooth label printers take);
 * "ROLL58" is a 58 mm receipt roll, of which about 48 mm can be printed. "A4"
 * is not a label size but a sheet of 24 for an ordinary office printer: three
 * across and eight down at 63.5 x 33.9 mm, which is also the commonest A4
 * sticker sheet, so it works on plain paper (cut and tape) or on stickers.
 */
export const LABEL_SIZES = {
  L50X30: { widthMm: 50, heightMm: 30 },
  L50X25: { widthMm: 50, heightMm: 25 },
  ROLL58: { widthMm: 48, heightMm: 40 },
  A4: { widthMm: 63.5, heightMm: 33.9 },
} as const;
export type LabelSize = keyof typeof LABEL_SIZES;
export const LABEL_SIZE_KEYS = Object.keys(LABEL_SIZES) as LabelSize[];
export const DEFAULT_LABEL_SIZE: LabelSize = "L50X30";

/** How an A4 sheet of 24 is laid out, in millimetres. */
export const LABEL_SHEET = { columns: 3, rows: 8, marginTopMm: 12.9, marginSideMm: 7.25, columnGapMm: 2.5 } as const;
export const LABELS_PER_SHEET = LABEL_SHEET.columns * LABEL_SHEET.rows;

/** Thermal label printers print 8 dots to the millimetre (203 dpi); a label image is made at that. */
export const LABEL_DOTS_PER_MM = 8;

/**
 * Everything printed on one label, already worded in the reader's language.
 * The item's name is exactly what the kitchen typed.
 */
export interface LabelPrintData {
  itemName: string;
  preparedHeading: string;
  preparedText: string;
  useByHeading: string;
  useByText: string;
  /** The use-by day as a word, and which day it is (0 Sunday to 6 Saturday) for its shape. */
  dayWord: string;
  dayIndex: number;
  /** Smaller lines under the dates: who prepared it, then where it is kept, allergens and the batch note when there are any. */
  lines: string[];
  outletName: string;
  /** True when the app is in Urdu, so the label reads right to left. */
  rtl: boolean;
}

const text = (max: number) => z.string().max(max);

export const labelPrintDataSchema = z.object({
  itemName: text(120),
  preparedHeading: text(40),
  preparedText: text(60),
  useByHeading: text(40),
  useByText: text(60),
  dayWord: text(40),
  dayIndex: z.number().int().min(0).max(6),
  lines: z.array(text(200)).max(6),
  outletName: text(120),
  rtl: z.boolean(),
});

/** Asks the server to draw one label as a picture. */
export const renderLabelSchema = z.object({
  size: z.enum(["L50X30", "L50X25", "ROLL58"]),
  label: labelPrintDataSchema,
});
export type RenderLabelInput = z.input<typeof renderLabelSchema>;

/** A label drawn as a black-and-white PNG, at the dots a thermal printer uses. */
export interface LabelImageDto {
  pngBase64: string;
  widthPx: number;
  heightPx: number;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The day shapes as drawings, black on white, on a 24 by 24 grid.
const SHAPE_SVG: Record<DayShape, string> = {
  circle: '<circle cx="12" cy="12" r="10"/>',
  triangle: '<path d="M12 2 23 22H1z"/>',
  square: '<path d="M3 3h18v18H3z"/>',
  diamond: '<path d="M12 1 23 12 12 23 1 12z"/>',
  star: '<path d="M12 1l3.2 7.2 7.8.8-5.9 5.2 1.7 7.7L12 17.9 5.2 21.9l1.7-7.7L1 9l7.8-.8z"/>',
  cross: '<path d="M8.5 2h7v6.5H22v7h-6.5V22h-7v-6.5H2v-7h6.5z"/>',
  stripes: '<path d="M2 3h20v4.5H2zM2 9.75h20v4.5H2zM2 16.5h20V21H2z"/>',
};

/** The drawing for a day's shape, for a web page. */
export const dayShapeSvg = (dayIndex: number) =>
  `<svg viewBox="0 0 24 24" fill="#000">${SHAPE_SVG[DAY_MARKS[dayIndex % 7]!.shape]}</svg>`;

function labelBody(label: LabelPrintData): string {
  return `<div class="label"${label.rtl ? ' dir="rtl"' : ""}>
  <div class="name">${escapeHtml(label.itemName)}</div>
  <div class="prepared"><span class="heading">${escapeHtml(label.preparedHeading)}</span> ${escapeHtml(label.preparedText)}</div>
  <div class="useby"><span class="heading">${escapeHtml(label.useByHeading)}</span> <b>${escapeHtml(label.useByText)}</b></div>
  <div class="foot">
    <div class="day">${dayShapeSvg(label.dayIndex)}<b>${escapeHtml(label.dayWord)}</b></div>
    <div class="lines">${label.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}<div class="outlet">${escapeHtml(label.outletName)}</div></div>
  </div>
</div>`;
}

/**
 * The labels as a web page that a printer's page matches exactly: one label
 * to a page for a label printer, or 24 to a page for an A4 sheet. The phone's
 * own print system (or the server's browser, for a picture) draws the page,
 * so the printer receives a finished picture and never has to know a script
 * or own a font: Telugu, Urdu or Tamil come out as they look on the screen.
 * Everything is black on white because a thermal printer has no other colour.
 */
export function labelsHtml(labels: readonly LabelPrintData[], size: LabelSize): string {
  const { widthMm, heightMm } = LABEL_SIZES[size];
  const sheet = size === "A4";
  // Every measurement inside a label is in "em", and one em is a thirtieth of
  // the label's height, so a shorter label is the same label drawn smaller.
  const em = heightMm / 30;
  const page = sheet
    ? `@page { size: A4; margin: ${LABEL_SHEET.marginTopMm}mm ${LABEL_SHEET.marginSideMm}mm 0; }
  .sheet { display: grid; grid-template-columns: repeat(${LABEL_SHEET.columns}, ${widthMm}mm); column-gap: ${LABEL_SHEET.columnGapMm}mm; break-after: page; }
  .sheet:last-child { break-after: auto; }
  .label { outline: 0.2mm dashed #999; outline-offset: -0.1mm; }`
    : `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  .label { break-after: page; }
  .label:last-child { break-after: auto; }`;

  const bodies = labels.map(labelBody);
  const content = sheet
    ? Array.from({ length: Math.ceil(bodies.length / LABELS_PER_SHEET) }, (_, index) =>
        `<div class="sheet">${bodies.slice(index * LABELS_PER_SHEET, (index + 1) * LABELS_PER_SHEET).join("")}</div>`,
      ).join("")
    : bodies.join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  ${page}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: "Noto Sans", "Nirmala UI", Roboto, "Segoe UI", system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .label { width: ${widthMm}mm; height: ${heightMm}mm; font-size: ${em.toFixed(3)}mm; padding: 1.4em 1.8em; overflow: hidden; display: flex; flex-direction: column; break-inside: avoid; }
  .name { font-size: 4.6em; line-height: 1.12; font-weight: 800; max-height: 2.24em; overflow: hidden; }
  .heading { font-size: 0.8em; font-weight: 700; text-transform: uppercase; }
  .prepared { font-size: 2.7em; line-height: 1.25; margin-top: 0.2em; white-space: nowrap; overflow: hidden; }
  .useby { font-size: 3.2em; line-height: 1.25; margin-top: 0.15em; padding: 0.1em 0.35em; border: 0.14em solid #000; white-space: nowrap; overflow: hidden; }
  .foot { display: flex; gap: 1.2em; margin-top: 0.6em; flex: 1; min-height: 0; overflow: hidden; }
  .day { display: flex; flex-direction: column; align-items: center; gap: 0.3em; font-size: 2.1em; line-height: 1.1; max-width: 9em; text-align: center; }
  .day svg { width: 2.6em; height: 2.6em; }
  .lines { flex: 1; min-width: 0; font-size: 2.1em; line-height: 1.2; }
  .lines div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .outlet { font-size: 0.85em; }
</style></head>
<body>${content}</body></html>`;
}

// ───────────────────────── Requests ─────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const moment = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Enter a date and time");

const shelfLifeHours = z
  .number()
  .int("Shelf life must be a whole number of hours")
  .min(FOOD_LABEL_RULES.minShelfLifeHours, "Shelf life must be at least an hour")
  .max(FOOD_LABEL_RULES.maxShelfLifeHours, "Shelf life cannot be more than a year");

const allergens = z
  .array(z.enum(ALLERGENS))
  .max(ALLERGENS.length)
  .transform((list) => ALLERGENS.filter((allergen) => list.includes(allergen)));

export const createFoodItemSchema = z.object({
  outletId: z.string().min(1),
  /** As the kitchen writes it, in any language. */
  name: z.string().trim().min(2, "Give the item a name").max(60),
  /** Where it is kept. Optional: a label needs only a name and how long it keeps. */
  storage: z.enum(STORAGE_TYPES).nullish(),
  shelfLifeHours,
  allergens: allergens.default([]),
  note: optionalText(120),
  /** Set when the item was added from the starter list, so the list can show it as added. */
  starterKey: optionalText(60),
});
export type CreateFoodItemInput = z.input<typeof createFoodItemSchema>;

export const updateFoodItemSchema = z.object({
  name: z.string().trim().min(2, "Give the item a name").max(60).optional(),
  /** Null clears it: the label then prints no storage line. */
  storage: z.enum(STORAGE_TYPES).nullable().optional(),
  shelfLifeHours: shelfLifeHours.optional(),
  allergens: allergens.optional(),
  /** An empty note clears it. */
  note: z.string().trim().max(120).optional(),
  /** False retires the item (it is no longer offered for new labels); true brings it back. */
  isActive: z.boolean().optional(),
});
export type UpdateFoodItemInput = z.input<typeof updateFoodItemSchema>;

const foodLabelFields = z.object({
  /** The saved label this one is made from. Give this, or `newItem`, not both. */
  foodItemId: z.string().min(1).optional(),
  /**
   * A label for something new, made on the spot: its name and how long it
   * keeps. The server saves it for the outlet, so it is a one-tap choice next
   * time, and makes the label, in one go (so it also works from a phone that
   * had no signal). If the outlet already has a saved label of that name
   * (compared loosely), that one is used and no second one is made.
   */
  newItem: z
    .object({
      outletId: z.string().min(1),
      name: z.string().trim().min(2, "Give the label a name").max(60),
      shelfLifeHours,
    })
    .optional(),
  /**
   * The moment Print was pressed on the phone. "Use by" is this plus how long
   * the food keeps. Left out, "prepared" is the moment the server is asked.
   */
  preparedAt: moment.optional(),
  /** The app no longer sends a use-by of its own choosing; the server still accepts one within the limits. */
  expiresAt: moment.optional(),
  /** Who prepared it, when that is not the person making the label. */
  preparedByName: optionalText(60),
  /** Quantity or batch, for example "2 kg" or "Tray 3". */
  quantityNote: optionalText(60),
  copies: z.number().int().min(1).max(FOOD_LABEL_RULES.maxCopies).default(1),
  /** Needed, from a Manager or Owner, when "use by" is later than the shelf life allows. */
  overrideReason: optionalText(200),
  /**
   * For a label made with no signal: an id chosen on the phone, so sending it
   * twice makes one label, and the moment it was made, which the limits are
   * then measured from.
   */
  clientId: z.string().min(8).max(64).optional(),
  madeAt: moment.optional(),
});

export const createFoodLabelSchema = foodLabelFields.refine(
  (input) => (input.foodItemId === undefined) !== (input.newItem === undefined),
  { message: "Choose a saved label, or give a new one a name", path: ["foodItemId"] },
);
export type CreateFoodLabelInput = z.input<typeof createFoodLabelSchema>;

export const closeFoodLabelSchema = z
  .object({
    outcome: z.enum(["USED", "DISCARDED"]),
    /** Why it was thrown away. Needed for DISCARDED only. */
    reason: z.enum(DISCARD_REASONS).optional(),
    note: optionalText(200),
  })
  .refine((input) => input.outcome !== "DISCARDED" || input.reason !== undefined, {
    message: "Say why it was thrown away",
    path: ["reason"],
  });
export type CloseFoodLabelInput = z.input<typeof closeFoodLabelSchema>;

// ───────────────────────── Answers ─────────────────────────

export interface FoodItemDto {
  id: string;
  outletId: string;
  /** As the kitchen wrote it. */
  name: string;
  /** Where it is kept; null when nobody has said. */
  storage: StorageType | null;
  shelfLifeHours: number;
  allergens: Allergen[];
  note: string | null;
  /** False once retired: kept for the labels already made, not offered for new ones. */
  isActive: boolean;
  starterKey: string | null;
  /** How many labels have ever been made for it. An item with none can be deleted outright. */
  labelCount: number;
  /** When a label was last made for it; the most recent come first when choosing. */
  lastUsedAt: string | null;
}

/** What "remove" did: deleted an item no label was ever made for, or retired one that has labels. */
export interface FoodItemRemovalDto {
  deleted: boolean;
  /** The retired item; null when it was deleted. */
  item: FoodItemDto | null;
}

export interface FoodLabelDto {
  id: string;
  outletId: string;
  foodItemId: string;
  /** The name, storage and allergens as they were when the label was made. */
  itemName: string;
  storage: StorageType | null;
  allergens: Allergen[];
  preparedAt: string;
  expiresAt: string;
  preparedByName: string;
  quantityNote: string | null;
  copies: number;
  status: FoodLabelStatus;
  /** Where it sits on the list while live; null once used up or thrown away. */
  group: FoodLabelGroup | null;
  /** Set when a Manager or Owner put use-by later than the shelf life allows. */
  overrideReason: string | null;
  overrideByName: string | null;
  discardReason: DiscardReason | null;
  closeNote: string | null;
  closedAt: string | null;
  closedByName: string | null;
  /** When it was last sent to a printer or shared, if ever. */
  printedAt: string | null;
  createdAt: string;
}

/** What is in the fridge now: every live label at the outlet, in three groups, soonest use-by first. */
export interface FoodLabelBoardDto {
  outletId: string;
  outletName: string;
  /** The server's time when the list was made. */
  now: string;
  expired: FoodLabelDto[];
  today: FoodLabelDto[];
  later: FoodLabelDto[];
}

/** The two numbers shown on Home. */
export interface FoodLabelCountsDto {
  outletId: string;
  /** Live labels that run out later today. */
  today: number;
  /** Live labels already past their use-by, not yet marked used up or thrown away. */
  expired: number;
}

/** Names to choose "prepared by" from: the outlet's logins and its staff list. */
export interface FoodLabelPeopleDto {
  names: string[];
}

// ───────────────────────── Starter list ─────────────────────────

export interface StarterFoodItem {
  key: string;
  /** English only for now. Once added, the kitchen can rename it in its own language. */
  name: string;
  storage: StorageType;
  shelfLifeHours: number;
  allergens: readonly Allergen[];
}

const starter = (
  key: string,
  name: string,
  storage: StorageType,
  hours: number,
  allergenList: readonly Allergen[] = [],
): StarterFoodItem => ({ key, name, storage, shelfLifeHours: hours, allergens: allergenList });

/**
 * Common items in an Indian restaurant kitchen, to add in one tap and then
 * change. An optional shortcut: a kitchen can equally type its own names
 * when making a label. SAMPLE DATA: the shelf lives are cautious suggestions, not rules
 * and not FSSAI figures (FSSAI sets temperatures and first-in-first-out, not
 * a number of days for each dish). They follow the usual guidance for food
 * prepared in-house: about three days in a fridge at 5°C or below counting
 * the day it was made (UK Food Standards Agency advice; well inside the US
 * Food Code's seven-day ceiling), one to two days for rice, stocks, gravies
 * and anything with dairy or raw meat, one month in a freezer at -18°C, and
 * the same day for anything thawed. Each kitchen must set its own figures
 * for its own fridge, recipes and portion sizes.
 */
export const STARTER_FOOD_ITEMS: readonly StarterFoodItem[] = [
  starter("cooked-rice", "Cooked rice", "CHILLED", 24),
  starter("biryani", "Biryani (cooked)", "CHILLED", 24),
  starter("cooked-dal", "Cooked dal", "CHILLED", 48),
  starter("curry-base", "Curry base gravy (onion and tomato)", "CHILLED", 48),
  starter("makhani-gravy", "Makhani gravy", "CHILLED", 48, ["MILK", "TREE_NUT"]),
  starter("white-gravy", "White gravy (cashew)", "CHILLED", 48, ["MILK", "TREE_NUT"]),
  starter("salan", "Mirchi ka salan", "CHILLED", 48, ["PEANUT", "SESAME"]),
  starter("cooked-chicken", "Cooked chicken", "CHILLED", 72),
  starter("cooked-mutton", "Cooked mutton", "CHILLED", 72),
  starter("stock", "Stock (chicken or vegetable)", "CHILLED", 48),
  starter("boiled-chana", "Boiled chana or rajma", "CHILLED", 48),
  starter("boiled-potato", "Boiled potatoes", "CHILLED", 48),
  starter("boiled-eggs", "Boiled eggs", "CHILLED", 48, ["EGG"]),
  starter("boiled-noodles", "Boiled noodles", "CHILLED", 24, ["GLUTEN"]),
  starter("marinated-chicken", "Marinated raw chicken", "CHILLED", 24),
  starter("marinated-mutton", "Marinated raw mutton", "CHILLED", 24),
  starter("marinated-fish", "Marinated raw fish", "CHILLED", 24, ["FISH"]),
  starter("marinated-prawns", "Marinated raw prawns", "CHILLED", 24, ["CRUSTACEAN"]),
  starter("marinated-paneer", "Marinated paneer", "CHILLED", 24, ["MILK"]),
  starter("kebab-mince", "Kebab mix (raw mince)", "CHILLED", 24),
  starter("thawed-meat", "Thawed meat or fish", "CHILLED", 24),
  starter("ginger-garlic-paste", "Ginger-garlic paste", "CHILLED", 72),
  starter("chopped-onion", "Chopped onions", "CHILLED", 24),
  starter("chopped-tomato", "Chopped tomatoes", "CHILLED", 24),
  starter("chopped-herbs", "Chopped coriander and mint", "CHILLED", 24),
  starter("cut-vegetables", "Cut vegetables", "CHILLED", 48),
  starter("cut-fruit", "Cut fruit", "CHILLED", 24),
  starter("paneer", "Paneer (opened or cut)", "CHILLED", 48, ["MILK"]),
  starter("curd", "Curd (opened)", "CHILLED", 72, ["MILK"]),
  starter("raita", "Raita", "CHILLED", 24, ["MILK"]),
  starter("milk", "Milk (opened or boiled)", "CHILLED", 48, ["MILK"]),
  starter("cream", "Cream (opened)", "CHILLED", 72, ["MILK"]),
  starter("khoya", "Khoya", "CHILLED", 72, ["MILK"]),
  starter("mayonnaise", "Mayonnaise (opened)", "CHILLED", 72, ["EGG"]),
  starter("green-chutney", "Green chutney", "CHILLED", 48),
  starter("coconut-chutney", "Coconut chutney", "CHILLED", 24),
  starter("tamarind-chutney", "Tamarind chutney", "CHILLED", 168),
  starter("idli-dosa-batter", "Idli and dosa batter", "CHILLED", 72),
  starter("chapati-dough", "Chapati dough", "CHILLED", 24, ["GLUTEN"]),
  starter("naan-dough", "Naan dough", "CHILLED", 24, ["GLUTEN", "MILK"]),
  starter("frozen-gravy", "Cooked gravy (frozen)", "FROZEN", 720),
  starter("frozen-chicken", "Raw chicken portions (frozen)", "FROZEN", 720),
  starter("frozen-kebabs", "Kebabs, shaped (frozen)", "FROZEN", 720),
  starter("frozen-paratha", "Parathas, half cooked (frozen)", "FROZEN", 720, ["GLUTEN"]),
  starter("fried-onions", "Fried onions (birista)", "AMBIENT", 168),
  starter("house-masala", "Ground spice mix (house masala)", "AMBIENT", 720),
];

/** Starter items whose name contains every word typed; all of them when nothing is typed. */
export function searchStarterItems(query: string): StarterFoodItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return STARTER_FOOD_ITEMS.filter((item) => words.every((word) => item.name.toLowerCase().includes(word)));
}
