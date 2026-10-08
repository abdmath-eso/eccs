import { createTranslator, type MessageKey } from '@eccs/i18n';
import {
  ISSUE_CATEGORIES,
  localize,
  notificationWordingParams,
  VISIT_SLOTS,
  visitSlotWindow,
  type Language,
  type NotificationParamValue,
  type NotificationType,
} from '@eccs/shared';

// The wording of a notification in any of the app's languages, for a push
// notification. The list inside the app words each notification on the phone
// (apps/mobile/src/app/(app)/notifications.tsx) from the sentences in
// packages/i18n; a push is shown by the phone itself before the app is open, so
// the server has to do the same job here, from the same sentences, so that the
// push and the list read alike. Dates and times follow
// apps/mobile/src/lib/format.ts: keep the two in step.

// "-u-nu-latn" asks for ordinary digits (0-9), as everywhere else in the app.
const LOCALES: Record<Language, string> = {
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

function clock(hhmm: string, language: Language): string {
  const [hours, minutes] = hhmm.split(':').map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return hhmm;
  return new Intl.DateTimeFormat(LOCALES[language], { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(
    new Date(Date.UTC(2000, 0, 1, hours, minutes)),
  );
}

function date(isoDate: string, language: Language): string {
  const at = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return isoDate;
  return new Intl.DateTimeFormat(LOCALES[language], { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(at);
}

/**
 * A notification's title and body in one language, with its values filled in.
 * A sentence that has not been translated yet comes out in English (the
 * dictionary falls back by itself).
 */
export function wordInLanguage(
  language: Language,
  type: NotificationType,
  params: Record<string, NotificationParamValue>,
): { title: string; body: string } {
  const t = createTranslator(language);
  const values = notificationWordingParams(params, {
    text: (value) => localize(value, language),
    date: (value) => date(value, language),
    slot: (value) => {
      const known = VISIT_SLOTS.find((slot) => slot === value);
      if (!known) return value ?? t('notif.noTime');
      const window = visitSlotWindow(known);
      return window ? `${clock(window.start, language)} – ${clock(window.end, language)}` : t('slot.AFTER_CLOSING');
    },
    category: (value) => {
      const known = ISSUE_CATEGORIES.find((category) => category === value);
      return known ? t(`category.${known}`) : value;
    },
  });
  return {
    title: t(`notif.${type}.title` as MessageKey, values),
    body: t(`notif.${type}.body` as MessageKey, values).trim(),
  };
}

/** The words of the test push sent from the console. */
export function testPushWording(language: Language): { title: string; body: string } {
  const t = createTranslator(language);
  return { title: t('push.test.title'), body: t('push.test.body') };
}
