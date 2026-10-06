import type { LanguageCode } from '@eccs/i18n';

const LOCALES: Record<LanguageCode, string> = { EN: 'en-IN', TE: 'te-IN', HI: 'hi-IN' };

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
