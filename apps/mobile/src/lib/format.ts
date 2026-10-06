import type { LanguageCode } from '@eccs/i18n';

// "-u-nu-latn" asks for ordinary digits (0-9). Without it Bengali, Marathi and Urdu
// dates come out in their own numerals, which the rest of the app does not use.
const LOCALES: Record<LanguageCode, string> = {
  EN: 'en-IN',
  HI: 'hi-IN-u-nu-latn',
  TE: 'te-IN-u-nu-latn',
  TA: 'ta-IN-u-nu-latn',
  KN: 'kn-IN-u-nu-latn',
  ML: 'ml-IN-u-nu-latn',
  MR: 'mr-IN-u-nu-latn',
  BN: 'bn-IN-u-nu-latn',
  GU: 'gu-IN-u-nu-latn',
  PA: 'pa-IN-u-nu-latn',
  OR: 'or-IN-u-nu-latn',
  UR: 'ur-IN-u-nu-latn',
};

/** A checklist due time such as "14:30" as people read it, e.g. "2:30 pm". */
export function formatTime(hhmm: string, language: LanguageCode): string {
  const [hours, minutes] = hhmm.split(':').map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return hhmm;
  try {
    return new Intl.DateTimeFormat(LOCALES[language], { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(
      new Date(Date.UTC(2000, 0, 1, hours, minutes)),
    );
  } catch {
    return hhmm;
  }
}

/** A calendar date such as "2027-03-31" as people read it, e.g. "31 Mar 2027". */
export function formatDate(isoDate: string, language: LanguageCode): string {
  try {
    return new Intl.DateTimeFormat(LOCALES[language], {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${isoDate}T00:00:00Z`));
  } catch {
    return isoDate;
  }
}

/** Today's calendar date in India as YYYY-MM-DD, whatever the phone's own time zone. */
export function indiaToday(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  } catch {
    return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  }
}

/** A month such as "2026-10" as people read it, e.g. "October 2026". */
export function formatMonth(month: string, language: LanguageCode): string {
  try {
    return new Intl.DateTimeFormat(LOCALES[language], { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );
  } catch {
    return month;
  }
}

/** A calendar date with its weekday, e.g. "Tuesday, 6 October". */
export function formatDayLong(isoDate: string, language: LanguageCode): string {
  try {
    return new Intl.DateTimeFormat(LOCALES[language], {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(`${isoDate}T00:00:00Z`));
  } catch {
    return isoDate;
  }
}

/** One-letter names of the days of the week, Sunday first, for the top of a calendar. */
export function weekdayNames(language: LanguageCode): string[] {
  try {
    const format = new Intl.DateTimeFormat(LOCALES[language], { timeZone: 'UTC', weekday: 'narrow' });
    // 1 January 2023 was a Sunday.
    return Array.from({ length: 7 }, (_, index) => format.format(new Date(Date.UTC(2023, 0, 1 + index))));
  } catch {
    return ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  }
}

/** Writes a YYYY-MM-DD date the way it is typed in forms here: DD/MM/YYYY. */
export function toTypedDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Reads a date typed the Indian way, day first ("31/03/2027", "31-3-27",
 * "31.03.2027"), and returns it as YYYY-MM-DD, or null if it is not a real date.
 */
export function parseTypedDate(input: string): string | null {
  const match = /^\s*(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})\s*$/.exec(input);
  if (!match) return null;
  const day = match[1]!.padStart(2, '0');
  const month = match[2]!.padStart(2, '0');
  const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** A date and time as people in India read it, e.g. "5 Oct 2026, 4:21 pm". Always Indian time. */
export function formatDateTime(iso: string, language: LanguageCode): string {
  try {
    return new Intl.DateTimeFormat(LOCALES[language], {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}
