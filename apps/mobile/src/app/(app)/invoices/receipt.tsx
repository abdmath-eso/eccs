import Ionicons from '@expo/vector-icons/Ionicons';
import type { PaymentResultDto } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney, invoiceTitle, paymentMethod } from '@/lib/billing';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

/**
 * The receipt shown straight after paying, and again from the payment's line
 * on the invoice. What a payment confirmation should carry: a clear "received"
 * with its mark, the amount, what it paid, how, the reference to quote if
 * anything is questioned, the date and time, and what is left on the invoice.
 *
 * Laid out as payment apps' success screens are (Google Pay, PhonePe): the tick
 * and "Payment received" are the top of the screen, with no separate title over
 * them and no Back beside Done (22 Oct 2026). The words under the tick are the
 * screen's heading for a screen reader, which hears "Receipt" with them.
 */
// Values longer than this many characters go under their label rather than beside it.
const LONG_VALUE = 18;

export default function ReceiptScreen() {
  const theme = useTheme();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const { t, api, language } = useSession();

  const [receipt, setReceipt] = useState<PaymentResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.billing
      .receipt(paymentId)
      .then((fresh) => {
        if (cancelled) return;
        setReceipt(fresh);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, t, { 404: 'bill.notFound' }));
      });
    return () => {
      cancelled = true;
    };
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, paymentId, attempt]);

  async function openPdf(invoiceId: string) {
    if (opening) return;
    setOpening(true);
    setPdfError(null);
    try {
      const { path } = await api.billing.pdf(invoiceId);
      await Linking.openURL(api.fileUrl(path));
    } catch (e) {
      setPdfError(errorMessage(e, t));
    } finally {
      setOpening(false);
    }
  }

  if (!receipt) {
    return (
      <Screen back title={t('bill.receipt')}>
        <ErrorText message={error} onRetry={() => setAttempt((n) => n + 1)} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const { payment, invoice } = receipt;
  const succeeded = payment.status === 'SUCCEEDED';
  const name = invoiceTitle(invoice, t, language);

  const row = (label: string, value: string) =>
    value.length > LONG_VALUE ? (
      <View style={styles.stacked}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="default">{value}</ThemedText>
      </View>
    ) : (
    <View style={styles.row}>
      <ThemedText type="default" themeColor="textSecondary" style={styles.rowLabel}>
        {label}
      </ThemedText>
      <ThemedText type="default" style={styles.rowValue}>
        {value}
      </ThemedText>
    </View>
  );

  return (
    <Screen footer={<Button label={t('common.done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/invoices'))} />}>
      <View style={styles.head} accessibilityRole="alert">
        <Ionicons
          name={succeeded ? 'checkmark-circle' : 'close-circle'}
          size={72}
          color={succeeded ? theme.primary : theme.danger}
        />
        <ThemedText
          type="subtitle"
          style={styles.centre}
          accessibilityRole="header"
          accessibilityLabel={`${t('bill.receipt')}: ${succeeded ? t('bill.receiptTitle') : t('bill.payFailed')}`}>
          {succeeded ? t('bill.receiptTitle') : t('bill.payFailed')}
        </ThemedText>
        <ThemedText type="title" style={styles.total}>
          {formatMoney(payment.amountPaise, language)}
        </ThemedText>
      </View>

      {payment.gateway === 'sample' && <Notice tone="sample" text={t('bill.sampleDone')} />}

      <Card>
        <View style={styles.box}>
          {row(t('bill.invoice'), ltrText(invoice.number))}
          {/* What it paid for as the invoice shows it: the title, and the plan or the visit's day on a line
              of its own under it, not run together with a comma (22 Oct 2026). */}
          <View style={styles.stacked}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('bill.whatFor')}
            </ThemedText>
            <ThemedText type="default">{name.title}</ThemedText>
            {name.detail && (
              <ThemedText type="small" themeColor="textSecondary">
                {name.detail}
              </ThemedText>
            )}
          </View>
          {row(t('bill.paidBy'), paymentMethod(payment, t))}
          {payment.reference && row(t('bill.referenceLabel'), ltrText(payment.reference))}
          {row(t('bill.paidAt'), formatDateTime(payment.paidAt ?? payment.createdAt, language))}
        </View>
      </Card>

      {succeeded && (
        <View style={styles.stateRow}>
          <Ionicons
            name={invoice.duePaise > 0 ? 'time-outline' : 'checkmark-circle'}
            size={24}
            color={invoice.duePaise > 0 ? theme.warning : theme.primary}
          />
          <ThemedText type="default" style={styles.flex}>
            {invoice.duePaise > 0
              ? t('bill.receiptLeft', { amount: formatMoney(invoice.duePaise, language) })
              : t('bill.receiptPaidInFull')}
          </ThemedText>
        </View>
      )}

      <View style={styles.actions}>
        <Button
          icon="document-text-outline"
          label={t('bill.openPdf')}
          variant="secondary"
          loading={opening}
          onPress={() => void openPdf(invoice.id)}
        />
        <ErrorText message={pdfError} onRetry={() => void openPdf(invoice.id)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.three },
  centre: { textAlign: 'center', fontSize: 24, lineHeight: 30 },
  total: { fontSize: 36, lineHeight: 44 },
  flex: { flex: 1 },
  box: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: Spacing.half },
  rowLabel: { flex: 1 },
  rowValue: { flexShrink: 1 },
  // A long value (a name, a period, what a payment was for) goes under its label instead of beside it,
  // as key-value lists do on a phone (SAP Fiori's key-value cell, the Singapore design system's
  // stacked description list). Beside it, it squeezed the label into "For the / period" (22 Oct 2026).
  stacked: { gap: Spacing.half, paddingVertical: Spacing.half },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  actions: { gap: Spacing.two, marginTop: Spacing.two },
});
