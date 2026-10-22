import type { LanguageCode, Translator } from '@eccs/i18n';
import {
  FOOD_LABEL_RULES,
  formatLabelMoment,
  formatLabelWeekday,
  indiaWeekday,
  isShelfLifeAllowed,
  shelfLifeParts,
  toShelfLifeHours,
  type Allergen,
  type LabelPrintData,
  type ShelfLifeUnit,
  type StorageType,
} from '@eccs/shared';
import { isRightToLeft } from '@eccs/i18n';

// The wording of food labels, in one place, so the label on the screen, the
// printed label and the lists all say the same thing.

/** The facts a label is made of. A label from the server has them all; so does one made on the phone with no signal. */
export interface LabelFacts {
  itemName: string;
  /** Where it is kept; null when nobody has said, and then the label says nothing about it. */
  storage: StorageType | null;
  allergens: readonly Allergen[];
  preparedAt: string;
  expiresAt: string;
  /** Always the person who printed it. */
  preparedByName: string;
}

/** A shelf life as people say it: "8 hours", "1 day", "3 days". */
export function shelfLifeText(hours: number, t: Translator): string {
  const { value, unit } = shelfLifeParts(hours);
  if (value === 1) return t(unit === 'DAYS' ? 'labels.dayOne' : 'labels.hourOne');
  return t(unit === 'DAYS' ? 'labels.days' : 'labels.hours', { count: value });
}

/** How long a label keeps, as chosen on a form: one of the common lengths, or "another length" typed as a number. */
export interface ShelfLifeChoice {
  /** One of the common lengths, in hours; null while none is chosen. */
  preset: number | null;
  /** True when "another length" is chosen, and then `number` and `unit` say it. */
  other: boolean;
  number: string;
  unit: ShelfLifeUnit;
}

/** The choice a form starts with: nothing for a new label; a saved label's own length, on its button if it has one. */
export function shelfLifeChoice(hours?: number | null): ShelfLifeChoice {
  if (hours === undefined || hours === null) return { preset: null, other: false, number: '', unit: 'HOURS' };
  if ((FOOD_LABEL_RULES.shelfLifePresets as readonly number[]).includes(hours)) return { preset: hours, other: false, number: '', unit: 'HOURS' };
  const { value, unit } = shelfLifeParts(hours);
  return { preset: null, other: true, number: String(value), unit };
}

/** The length chosen, in hours; null while none is chosen or the number typed is not a whole number from an hour to a year. */
export function chosenHours(choice: ShelfLifeChoice): number | null {
  const typed = /^\d{1,4}$/.test(choice.number.trim()) ? toShelfLifeHours(Number(choice.number.trim()), choice.unit) : null;
  const hours = choice.other ? typed : choice.preset;
  return hours !== null && isShelfLifeAllowed(hours) ? hours : null;
}

/**
 * When a label was last printed, for the list: the time if it was today ("10:02 am"), otherwise the
 * day and month ("13 Oct"), with no weekday, so "Printed 13 Oct" stays on one line (22 Oct 2026:
 * "Last printed Tue, 13 Oct" broke across two). Always Indian time.
 */
export function printedWhen(at: string, now: number, language: LanguageCode): string {
  const day = (moment: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(moment);
  const locale = `${language.toLowerCase()}-IN-u-nu-latn`;
  try {
    const today = day(new Date(at)) === day(new Date(now));
    return new Intl.DateTimeFormat(
      locale,
      today ? { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' } : { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' },
    )
      .format(new Date(at))
      // Non-breaking spaces, so "13 Oct" or "10:02 am" never splits across two lines.
      .replace(/\s/g, ' ');
  } catch {
    return at.slice(0, 10);
  }
}

/** "Milk, Tree nuts", in the app's language. */
export const allergensText = (allergens: readonly Allergen[], t: Translator) =>
  allergens.map((allergen) => t(`labels.allergen.${allergen}`)).join(', ');

/**
 * Everything printed on a label, worded in the app's language. The item's
 * name is left exactly as the kitchen wrote it. The day mark is the use-by
 * day: that is the day a cook has to act on.
 */
export function labelPrintData(
  label: LabelFacts,
  outletName: string,
  t: Translator,
  language: LanguageCode,
): LabelPrintData {
  // Who prepared it, then where it is kept if anyone has said. Nothing is printed for storage that was never set.
  const by = t('labels.print.by', { name: label.preparedByName });
  const lines = [label.storage ? `${by} · ${t(`labels.storageKeep.${label.storage}`)}` : by];
  if (label.allergens.length > 0) lines.push(t('labels.print.allergens', { list: allergensText(label.allergens, t) }));
  return {
    itemName: label.itemName,
    preparedHeading: t('labels.print.prepared'),
    preparedText: formatLabelMoment(label.preparedAt, language),
    useByHeading: t('labels.print.useBy'),
    useByText: formatLabelMoment(label.expiresAt, language),
    dayWord: formatLabelWeekday(label.expiresAt, language),
    dayIndex: indiaWeekday(label.expiresAt),
    lines,
    outletName,
    rtl: isRightToLeft(language),
  };
}
