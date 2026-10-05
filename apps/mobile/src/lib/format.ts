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
