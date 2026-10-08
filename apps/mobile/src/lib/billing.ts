import type Ionicons from '@expo/vector-icons/Ionicons';
import type { LanguageCode, MessageKey, Translator } from '@eccs/i18n';
import type { InvoiceSummaryDto, PaymentDto } from '@eccs/shared';
import type { ComponentProps } from 'react';

import { formatDate } from './format';

// What the Invoices screens share: how money is written, and the words and
// icon that say where an invoice stands.

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
  /** In words: "Overdue. Days late: 3", "To pay by 15 Oct 2026", "Paid". */
  label: string;
}

/** Where an invoice stands, in words with an icon of its own, never by colour alone. */
export function invoiceState(invoice: InvoiceSummaryDto, t: Translator, language: LanguageCode): InvoiceState {
  if (invoice.status === 'VOID') return { icon: 'close-circle-outline', tone: 'textSecondary', label: t('bill.stateVoid') };
  if (invoice.status === 'PAID') return { icon: 'checkmark-circle', tone: 'primary', label: t('bill.statePaid') };
  if (invoice.overdueDays > 0) {
    return { icon: 'alert-circle', tone: 'danger', label: t('bill.stateOverdue', { count: invoice.overdueDays }) };
  }
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
