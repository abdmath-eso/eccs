import type { LanguageCode, Translator } from '@eccs/i18n';
import {
  formatLabelMoment,
  formatLabelWeekday,
  indiaWeekday,
  shelfLifeParts,
  type Allergen,
  type LabelPrintData,
  type StorageType,
} from '@eccs/shared';
import { isRightToLeft } from '@eccs/i18n';

// The wording of food labels, in one place, so the label on the screen, the
// printed label and the lists all say the same thing.

/** The facts a label is made of. A label from the server has them all; so does one still waiting to be sent. */
export interface LabelFacts {
  itemName: string;
  /** Where it is kept; null when nobody has said, and then the label says nothing about it. */
  storage: StorageType | null;
  allergens: readonly Allergen[];
  preparedAt: string;
  expiresAt: string;
  preparedByName: string;
  quantityNote: string | null;
}

/** A shelf life as people say it: "8 hours", "1 day", "3 days". */
export function shelfLifeText(hours: number, t: Translator): string {
  const { value, unit } = shelfLifeParts(hours);
  if (value === 1) return t(unit === 'DAYS' ? 'labels.dayOne' : 'labels.hourOne');
  return t(unit === 'DAYS' ? 'labels.days' : 'labels.hours', { count: value });
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
  if (label.quantityNote) lines.push(label.quantityNote);
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
