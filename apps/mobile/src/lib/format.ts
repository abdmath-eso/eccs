import type { LanguageCode, Translator } from '@eccs/i18n';
import { VISIT_SLOTS, visitSlotWindow } from '@eccs/shared';

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

/**
 * When in the day a visit is, as people read it: "10:00 am – 12:00 pm", or
 * "After closing". Anything that is not one of the known windows is shown as it is.
 */
export function formatSlot(slot: string | null, language: LanguageCode, t: Translator): string | null {
  const known = VISIT_SLOTS.find((value) => value === slot);
  if (!known) return slot;
  const window = visitSlotWindow(known);
  return window ? `${formatTime(window.start, language)} – ${formatTime(window.end, language)}` : t('slot.AFTER_CLOSING');
}

/** A calendar date with a short weekday and no year, e.g. "Thu, 8 Oct". */
export function formatDayShort(isoDate: string, language: LanguageCode): string {
  try {
    return new Intl.DateTimeFormat(LOCALES[language], {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${isoDate}T00:00:00Z`));
  } catch {
    return isoDate;
  }
}

/** The pieces of a date for a compact day button: "Thu", "8", "Oct". */
export function dayParts(isoDate: string, language: LanguageCode): { weekday: string; day: string; month: string } {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(LOCALES[language], { timeZone: 'UTC', ...options }).format(date);
    } catch {
      return '';
    }
  };
  return { weekday: part({ weekday: 'short' }), day: String(date.getUTCDate()), month: part({ month: 'short' }) };
}

/** A YYYY-MM-DD date moved by a number of days. */
export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** An amount held in paise as rupees, e.g. "₹1,800". */
export function formatRupees(paise: number, language: LanguageCode): string {
  const rupees = Math.round(paise / 100);
  try {
    return new Intl.NumberFormat(LOCALES[language], { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
      rupees,
    );
  } catch {
    return `₹${rupees}`;
  }
}

/** A length of time in minutes as people say it, e.g. "1.5 hours" or "45 minutes". */
export function formatDuration(minutes: number, language: LanguageCode): string {
  const inHours = minutes >= 60;
  const value = inHours ? Math.round((minutes / 60) * 10) / 10 : minutes;
  try {
    return new Intl.NumberFormat(LOCALES[language], {
      style: 'unit',
      unit: inHours ? 'hour' : 'minute',
      unitDisplay: 'long',
    }).format(value);
  } catch {
    return `${value} ${inHours ? 'h' : 'min'}`;
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

/** Where a YYYY-MM-DD date falls against today in India: for grouping a list of visits by day. */
export function dayBucket(isoDate: string, today: string = indiaToday()): 'past' | 'today' | 'tomorrow' | 'later' {
  if (isoDate < today) return 'past';
  if (isoDate === today) return 'today';
  return isoDate === addDays(today, 1) ? 'tomorrow' : 'later';
}

/**
 * Keeps a date field in the shape DD/MM/YYYY while it is typed on a number pad:
 * only digits are kept and the slashes are put in. `previous` is what the field
 * held before, so a slash is only added while typing forwards and can be deleted.
 */
export function maskTypedDate(next: string, previous: string): string {
  const groups = next.split(/\D+/);
  // "3/" typed by hand means the 3rd, so a finished one-digit day or month gets its zero.
  const digits = groups
    .map((group, index) => (index < 2 && index < groups.length - 1 && group.length === 1 ? `0${group}` : group))
    .join('')
    .slice(0, 8);
  const typing = next.length > previous.length;
  let masked = digits.slice(0, 2);
  if (digits.length > 2 || (digits.length === 2 && typing)) masked += '/';
  masked += digits.slice(2, 4);
  if (digits.length > 4 || (digits.length === 4 && typing)) masked += '/';
  return masked + digits.slice(4);
}
