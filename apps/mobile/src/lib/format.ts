import type { LanguageCode } from '@eccs/i18n';

const LOCALES: Record<LanguageCode, string> = { EN: 'en-IN', TE: 'te-IN', HI: 'hi-IN' };

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
