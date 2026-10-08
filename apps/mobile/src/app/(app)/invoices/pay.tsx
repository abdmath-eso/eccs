import Ionicons from '@expo/vector-icons/Ionicons';
import { ONLINE_PAYMENT_METHODS, type InvoiceDto, type OnlinePaymentMethod } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

const METHOD_LABEL = { upi: 'bill.methodUpi', card: 'bill.methodCard', netbanking: 'bill.methodNetbanking' } as const;

/**
 * The sample payment screen. It stands where a real payment provider's
 * checkout will be, and says plainly, at the top and again on the buttons,
 * that it is a sample and that no money moves. The Owner picks how they would
 * pay, then either completes the payment or makes it fail, so both endings can
 * be tried.
 *
 * Like any checkout: the amount and what it is for stay in view, there is one
 * main button, and a payment that is sent twice (a double tap, a retry on a
 * weak signal) is still one payment, because the server decides each payment
 * once.
 */
export default function PayScreen() {
  const theme = useTheme();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const { t, api, language } = useSession();

  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [method, setMethod] = useState<OnlinePaymentMethod>('upi');
  // The payment the server has open for this invoice, kept so that trying again finishes that one.
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'success' | 'fail' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shown after a payment that did not go through.
  const [failure, setFailure] = useState<string | null>(null);
  // What to send again when the last try never reached the server.
  const [retry, setRetry] = useState<'success' | 'fail' | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.billing
      .invoice(invoiceId)
      .then((fresh) => {
        if (cancelled) return;
        setInvoice(fresh);
        setLoadError(null);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e, t, { 404: 'bill.notFound' }));
      });
    return () => {
      cancelled = true;
    };
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, invoiceId, attempt]);

  const pay = useCallback(
    async (outcome: 'success' | 'fail') => {
      if (busy) return;
      setBusy(outcome);
      setError(null);
      setFailure(null);
      setRetry(null);
      try {
        // Start (or carry on with) the payment, then report how it ended.
        const id = paymentId ?? (await api.billing.startPayment(invoiceId, { method })).payment.id;
        setPaymentId(id);
        const result = await api.billing.confirmPayment(id, { outcome });
        if (result.payment.status === 'SUCCEEDED') {
          // The receipt takes this screen's place, so Back from it returns to the invoice, not to paying again.
          router.replace({ pathname: '/invoices/receipt', params: { paymentId: result.payment.id } });
          return;
        }
        // It failed: that payment is finished, and the next try starts a new one.
        setPaymentId(null);
        setInvoice(result.invoice);
        setFailure(t('bill.payFailed'));
      } catch (e) {
        setError(errorMessage(e, t, { 409: 'bill.payNothing', 403: 'bill.ownerPays' }));
        setRetry(outcome);
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, invoiceId, method, paymentId, busy],
  );

  if (!invoice) {
    return (
      <Screen back title={t('bill.payTitle')}>
        <ErrorText message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const amount = formatMoney(invoice.duePaise, language);
  const owing = invoice.duePaise > 0;

  return (
    <Screen
      back
      title={t('bill.payTitle')}
      footer={
        owing ? (
          <>
            <ErrorText message={error} onRetry={retry ? () => void pay(retry) : undefined} />
            <Button
              icon="checkmark-circle-outline"
              label={t('bill.payAmount', { amount })}
              hint={t('bill.sampleHint')}
              loading={busy === 'success'}
              disabled={busy !== null}
              onPress={() => void pay('success')}
            />
            <Button
              icon="close-circle-outline"
              label={t('bill.payFail')}
              variant="secondary"
              loading={busy === 'fail'}
              disabled={busy !== null}
              onPress={() => void pay('fail')}
            />
          </>
        ) : undefined
      }>
      {/* Unmistakable, and first: this is not a real payment. */}
      <View style={[styles.sample, { borderColor: theme.warning }]} accessibilityRole="alert">
        <Ionicons name="flask" size={28} color={theme.warning} />
        <View style={styles.sampleWords}>
          <ThemedText type="default" style={styles.strong}>
            {t('bill.sampleTitle')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('bill.sampleBody')}
          </ThemedText>
        </View>
      </View>

      <View style={[styles.box, { borderColor: theme.border }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('bill.youPay')}
        </ThemedText>
        <ThemedText type="title" style={styles.total}>
          {amount}
        </ThemedText>
        <ThemedText type="default">{invoice.lines[0]?.description ?? invoice.description}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('bill.number', { number: ltrText(invoice.number) })} · {t('bill.inclGst')}
        </ThemedText>
      </View>

      {!owing && (
        <View style={styles.stateRow}>
          <Ionicons name="checkmark-circle" size={24} color={theme.primary} />
          <ThemedText type="default" themeColor="primary" style={styles.flex}>
            {t('bill.payNothing')}
          </ThemedText>
        </View>
      )}

      {owing && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('bill.payHow')}
          </ThemedText>
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('bill.payHow')}>
            {ONLINE_PAYMENT_METHODS.map((value) => (
              <OptionChip
                key={value}
                label={t(METHOD_LABEL[value])}
                selected={value === method}
                // The way of paying is fixed once a payment is open; a failed or new one can choose again.
                disabled={busy !== null || paymentId !== null}
                onPress={() => setMethod(value)}
              />
            ))}
          </View>
        </>
      )}

      {failure && (
        <View style={[styles.sample, { borderColor: theme.danger }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Ionicons name="close-circle" size={28} color={theme.danger} />
          <View style={styles.sampleWords}>
            <ThemedText type="default" themeColor="danger" style={styles.strong}>
              {failure}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('bill.payFailedHelp')}
            </ThemedText>
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sample: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three },
  sampleWords: { flex: 1, gap: Spacing.one },
  strong: { fontWeight: 700 },
  box: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  total: { fontSize: 36, lineHeight: 44 },
  sectionGap: { marginTop: Spacing.three },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  flex: { flex: 1 },
});
