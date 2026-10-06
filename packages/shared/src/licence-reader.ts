import { isCalendarDate, type LicenceType } from "./licences.js";

// Turns the text read off a licence document (by OCR, or from a PDF's text
// layer) into the details the licence form needs. It is deliberately
// cautious: anything it is not reasonably sure of is left empty for the
// person to type, because a wrong expiry date is worse than a blank one.

/** What could be read from a licence document. Every field may be missing. */
export interface LicenceReadingDto {
  type: LicenceType | null;
  number: string | null;
  /** YYYY-MM-DD */
  issuedOn: string | null;
  /** YYYY-MM-DD */
  expiresOn: string | null;
  /** False if no text at all could be read from the file (for example a scanned PDF or a blurred photo). */
  textFound: boolean;
}

export const EMPTY_READING: LicenceReadingDto = { type: null, number: null, issuedOn: null, expiresOn: null, textFound: false };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const iso = (year: number, month: number, day: number): string | null => {
  const fullYear = year < 100 ? 2000 + year : year;
  const value = `${String(fullYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Licences are not dated before 1990 or decades ahead; anything else is a misread.
  return isCalendarDate(value) && fullYear >= 1990 && fullYear <= 2100 ? value : null;
};

interface FoundDate {
  value: string;
  /** Where in the text the date starts. */
  index: number;
}

/** Every date in the text, in the day-first forms used on Indian documents. */
export function findDates(text: string): FoundDate[] {
  const found: FoundDate[] = [];
  const add = (index: number, value: string | null) => {
    if (value && !found.some((date) => date.index === index)) found.push({ value, index });
  };

  // 31/03/2027, 31-03-2027, 31.03.2027, 31 03 2027 is too loose so spaces are not accepted here.
  for (const m of text.matchAll(/\b(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{4}|\d{2})\b/g)) {
    add(m.index, iso(Number(m[3]), Number(m[2]), Number(m[1])));
  }
  // 2027-03-31
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    add(m.index, iso(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  // 31 March 2027, 31-Mar-2027, 31st Mar, 2027
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-.,]{0,3}([A-Za-z]{3,9})[\s\-.,]{0,3}(\d{4})\b/g)) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month) add(m.index, iso(Number(m[3]), month, Number(m[1])));
  }
  // March 31, 2027
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})[\s.]{1,2}(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[1]!.toLowerCase()];
    if (month) add(m.index, iso(Number(m[3]), month, Number(m[2])));
  }
  return found.sort((a, b) => a.index - b.index);
}

const EXPIRY_WORDS = /valid\s*(?:up\s*to|upto|till|until|through|thru)|validity|expir\w*|date\s+of\s+expiry|renewal\s+due|up\s*to/gi;
const ISSUE_WORDS = /issued?\s*(?:on|date)?|date\s+of\s+issue|valid\s+from|with\s+effect\s+from|w\.?e\.?f\.?|dated?/gi;

/** The first date that follows one of the given phrases closely, on the same or next line. */
function dateAfter(text: string, dates: FoundDate[], words: RegExp, exclude?: string): FoundDate | null {
  for (const match of text.matchAll(words)) {
    const from = match.index + match[0].length;
    const next = dates.find((date) => date.index >= from && date.index - from <= 60 && date.value !== exclude);
    if (next) return next;
  }
  return null;
}

/**
 * If the date is the start of a period written as "01/04/2026 to 31/03/2027",
 * returns the date the period ends on.
 */
function endOfPeriod(text: string, dates: FoundDate[], start: FoundDate): FoundDate | null {
  const next = dates.find((date) => date.index > start.index);
  if (!next || next.value <= start.value) return null;
  // What sits between the two dates, after the first date's own characters.
  const between = text.slice(start.index, next.index).replace(/^[\dA-Za-z/.,\-\s]*?(?=\s(?:to|till|until|upto|up\s+to|through)\b|\s[-–—]\s)/i, "");
  return /^\s*(?:to|till|until|upto|up\s+to|through|[-–—])\s*$/i.test(between) ? next : null;
}

function detectType(text: string): LicenceType | null {
  const lower = text.toLowerCase();
  if (/fssai|food\s+safety\s+and\s+standards/.test(lower)) return "FSSAI";
  if (/fire/.test(lower) && /\bnoc\b|no\s+objection/.test(lower)) return "FIRE_NOC";
  if (/trade\s+licen[cs]e/.test(lower)) return "TRADE_LICENCE";
  if (/pest\s+control|pest\s+management/.test(lower)) return "PEST_CONTROL";
  return null;
}

function findNumber(text: string, type: LicenceType | null): string | null {
  // An FSSAI licence number is 14 digits, often printed with spaces between them.
  if (type === "FSSAI") {
    const spaced = /(?<!\d)(?:\d[ ]?){13}\d(?!\d)/.exec(text);
    if (spaced) return spaced[0].replace(/\s/g, "");
  }
  // Otherwise, whatever follows "Licence No.", "Registration No", "Certificate No", "NOC No" and so on.
  const labelled =
    /(?:licen[cs]e|registration|regn?|certificate|noc|contract|reference|ref)\.?\s*(?:number|no|num|#)\s*\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{3,29})/i.exec(
      text,
    );
  const candidate = labelled?.[1]?.replace(/[/\-]+$/, "");
  // Must contain a digit; a bare word after "No" is a misread.
  return candidate && /\d/.test(candidate) ? candidate.toUpperCase() : null;
}

/**
 * Works out the licence details from the text of a document. `today` (YYYY-MM-DD)
 * is used only to choose between dates when the text gives no other clue.
 */
export function parseLicenceText(text: string, today: string): LicenceReadingDto {
  const cleaned = text.replace(/[ \t]+/g, " ").trim();
  if (cleaned.length < 8) return EMPTY_READING;

  const type = detectType(cleaned);
  const dates = findDates(cleaned);

  let expiresOn: string | null = null;
  let issuedOn: string | null = null;

  const afterExpiryWord = dateAfter(cleaned, dates, EXPIRY_WORDS);
  if (afterExpiryWord) {
    // "Validity: 01/04/2026 to 31/03/2027" names the whole period; the expiry is its end.
    const end = endOfPeriod(cleaned, dates, afterExpiryWord);
    expiresOn = end ? end.value : afterExpiryWord.value;
    if (end) issuedOn = afterExpiryWord.value;
  }
  issuedOn ??= dateAfter(cleaned, dates, ISSUE_WORDS, expiresOn ?? undefined)?.value ?? null;

  // No "valid up to" style wording: if the document shows a clear pair of
  // dates, the later one is taken as the expiry, provided it is not long past.
  const distinct = [...new Set(dates.map((date) => date.value))].sort();
  if (!expiresOn && distinct.length >= 2) {
    const latest = distinct[distinct.length - 1]!;
    if (latest >= today.slice(0, 4) + "-01-01" || latest >= today) expiresOn = latest;
  }
  if (!issuedOn && expiresOn) {
    issuedOn = distinct.find((date) => date < expiresOn!) ?? null;
  }
  // An "issue" date on or after the expiry is a misread.
  if (issuedOn && expiresOn && issuedOn >= expiresOn) issuedOn = null;

  return { type, number: findNumber(cleaned, type), issuedOn, expiresOn, textFound: true };
}
