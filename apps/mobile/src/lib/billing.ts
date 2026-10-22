import type Ionicons from '@expo/vector-icons/Ionicons';
import type { LanguageCode, MessageKey, Translator } from '@eccs/i18n';
import type { InvoiceSummaryDto, PaymentDto } from '@eccs/shared';
import type { ComponentProps } from 'react';

import { addDays, formatDate, indiaToday } from './format';

// What the Invoices screens share: how money is written, the words and icon
// that say where an invoice stands, and the invoice's short title.

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * An amount held in paise as it is written on a bill: "₹2,124", or "₹2,124.50"
 * when there are paise. Always ordinary digits, whatever the language.
 */
export function formatMoney(paise: number, language: LanguageCode): string {
  const whole = paise % 100 === 0;
  try {
    return new Intl.NumberFormat(`${language.toLowerCase()}-IN-u-nu-latn`, {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(paise / 100);
  } catch {
    return `₹${(paise / 100).toFixed(whole ? 0 : 2)}`;
  }
}

/** Which colour of the theme a state is drawn in. The icon and the words carry the meaning; the colour only helps. */
export type Tone = 'danger' | 'warning' | 'primary' | 'textSecondary';

export interface InvoiceState {
  icon: IconName;
  tone: Tone;
  /** In words: "Overdue. Days late: 3", "Due today", "To pay by 15 Oct 2026", "Paid". */
  label: string;
}

/**
 * Where an invoice stands, in words with an icon of its own, never by colour alone. One due today
 * or tomorrow says so in amber (22 Oct 2026: "To pay by 22 Oct 2026" in grey looked the same as one
 * due next month), as billing apps mark what falls due soon between "due" and "overdue".
 */
export function invoiceState(invoice: InvoiceSummaryDto, t: Translator, language: LanguageCode): InvoiceState {
  if (invoice.status === 'VOID') return { icon: 'close-circle-outline', tone: 'textSecondary', label: t('bill.stateVoid') };
  if (invoice.status === 'PAID') return { icon: 'checkmark-circle', tone: 'primary', label: t('bill.statePaid') };
  if (invoice.overdueDays > 0) {
    return { icon: 'alert-circle', tone: 'danger', label: t('bill.stateOverdue', { count: invoice.overdueDays }) };
  }
  const today = indiaToday();
  if (invoice.dueDate === today) return { icon: 'time-outline', tone: 'warning', label: t('bill.stateDueToday') };
  if (invoice.dueDate === addDays(today, 1)) return { icon: 'time-outline', tone: 'warning', label: t('bill.stateDueTomorrow') };
  return {
    icon: 'time-outline',
    tone: invoice.status === 'PARTIALLY_PAID' ? 'warning' : 'textSecondary',
    label: t(invoice.status === 'PARTIALLY_PAID' ? 'bill.statePartDue' : 'bill.stateDue', {
      date: formatDate(invoice.dueDate, language),
    }),
  };
}

const METHOD_KEYS: Record<string, MessageKey> = {
  upi: 'bill.methodUpi',
  card: 'bill.methodCard',
  netbanking: 'bill.methodNetbanking',
  cash: 'bill.methodCash',
  cheque: 'bill.methodCheque',
  'bank-transfer': 'bill.methodBankTransfer',
};

/** How a payment was made, in words: "UPI", "Bank transfer". */
export const paymentMethod = (payment: Pick<PaymentDto, 'method'>, t: Translator) =>
  METHOD_KEYS[payment.method] ? t(METHOD_KEYS[payment.method]!) : payment.method;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A day the server wrote in English inside a text it keeps ("15 Oct 2026", "15 Sept 2026",
 * "Friday, 9 October 2026"), as YYYY-MM-DD, or null. For texts stored once in English (an
 * invoice's line, a document's title), so the phone can say the date in the person's language.
 */
export function parseEnglishDay(text: string): string | null {
  const found = /(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})/.exec(text);
  const month = found ? MONTHS.indexOf(found[2]!.slice(0, 3).toLowerCase()) : -1;
  if (!found || month < 0) return null;
  return `${found[3]}-${String(month + 1).padStart(2, '0')}-${found[1]!.padStart(2, '0')}`;
}

/** A plan's cycle as a short range, "15 Oct – 14 Nov 2026": the first year is left out when both days are in one year. */
export function formatPeriod(from: string, until: string, language: LanguageCode): string {
  let start = formatDate(from, language);
  if (from.slice(0, 4) === until.slice(0, 4)) {
    try {
      start = new Intl.DateTimeFormat(`${language.toLowerCase()}-IN-u-nu-latn`, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(
        new Date(`${from}T00:00:00Z`),
      );
    } catch {
      // The full date, as above.
    }
  }
  // A line may break after the dash but never before it.
  return `${start}\u00a0– ${formatDate(until, language)}`;
}

const CYCLE_KEYS = { monthly: 'bill.cycle.monthly', quarterly: 'bill.cycle.quarterly', annual: 'bill.cycle.annual' } as const;

export interface InvoiceTitle {
  /** The cycle a plan's invoice covers, or the service a visit's invoice is for. */
  title: string;
  /** The plan and how often it is invoiced, or the day of the visit. */
  detail: string | null;
}

/**
 * What an invoice is for, in short and in the person's language: a plan's invoice by the cycle it
 * covers ("15 Oct – 14 Nov 2026") with the plan under it ("Essential plan, monthly"); a visit's by the
 * service, with the day of the visit under it. Until 22 Oct 2026 the screens showed the invoice's
 * stored first line: three bold English lines that repeated the outlet's name. The plan, the cycle and
 * the service are read out of that line, which the server writes in a fixed form (billing.service.ts);
 * a line in any other form is shown as it is. The invoice document itself keeps the stored line.
 */
export function invoiceTitle(invoice: InvoiceSummaryDto, t: Translator, language: LanguageCode): InvoiceTitle {
  const stored = invoice.description;
  if (invoice.kind === 'SUBSCRIPTION' && invoice.periodStart && invoice.periodEnd) {
    const plan = /^(.+?) plan \((monthly|quarterly|annual)\) at /.exec(stored);
    return {
      title: formatPeriod(invoice.periodStart, invoice.periodEnd, language),
      detail: plan ? t('bill.planLine', { plan: plan[1]!, cycle: t(CYCLE_KEYS[plan[2] as keyof typeof CYCLE_KEYS]) }) : stored,
    };
  }
  // "Pest control at Spice Route, Gachibowli, visit on 9 Oct 2026, service report SR-2026-00004"
  const at = invoice.outletName ? stored.indexOf(` at ${invoice.outletName}, visit on `) : -1;
  if (invoice.kind === 'VISIT' && at > 0) {
    const day = parseEnglishDay(stored.slice(at + ` at ${invoice.outletName}`.length));
    return { title: stored.slice(0, at), detail: day ? t('bill.visitOn', { date: formatDate(day, language) }) : null };
  }
  return { title: stored, detail: null };
}
