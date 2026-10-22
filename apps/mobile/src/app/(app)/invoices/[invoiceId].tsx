import Ionicons from '@expo/vector-icons/Ionicons';
import { gstStateLabel, type InvoiceDto, type PaymentDto } from '@eccs/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney, invoiceState, invoiceTitle, paymentMethod } from '@/lib/billing';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

/** A rate without a needless ".0": 9, 2.5. */
const rate = (percent: number) => `${Number(percent.toFixed(2))}%`;

/**
 * One invoice: where it stands, what it is for, how the amount is made up
 * (the price before GST, then each tax), what has been paid, and the invoice
 * itself as a PDF. The Owner pays from the button pinned at the bottom.
 */
// Values longer than this many characters go under their label rather than beside it.
const LONG_VALUE = 18;

export default function InvoiceScreen() {
  const theme = useTheme();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const { t, api, language, user } = useSession();

  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const isOwner = user?.memberships.some((membership) => membership.role === 'OWNER') ?? false;

  const load = useCallback(async () => {
    try {
      setInvoice(await api.billing.invoice(invoiceId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t, { 404: 'bill.notFound' }));
    }
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, invoiceId]);

  // Reloads on coming back from paying, so the invoice shows as paid.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Opens the invoice as a PDF in the phone's viewer. The server may take a few seconds to make it. */
  async function openPdf() {
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

  if (!invoice) {
    return (
      <Screen back title={t('bill.invoice')}>
        <ErrorText message={error} onRetry={() => void load()} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const state = invoiceState(invoice, t, language);
  const stateColor = theme[state.tone];
  const owing = invoice.duePaise > 0;
  // The tax rate is written beside each tax when every line is taxed alike, which is the usual case.
  const rates = new Set(invoice.lines.map((line) => line.gstRatePercent));
  const oneRate = rates.size === 1 ? [...rates][0]! : null;
  const taxLabel = (name: string, share: number) => (oneRate === null ? name : `${name} ${rate(oneRate * share)}`);

  const row = (label: string, value: string, strong = false) =>
    value.length > LONG_VALUE ? (
      <View style={styles.stacked}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="default" style={strong && styles.strong}>
          {value}
        </ThemedText>
      </View>
    ) : (
    <View style={styles.row}>
      <ThemedText type="default" themeColor={strong ? 'text' : 'textSecondary'} style={[styles.rowLabel, strong && styles.strong]}>
        {label}
      </ThemedText>
      <ThemedText type="default" style={[styles.rowValue, strong && styles.strong]}>
        {value}
      </ThemedText>
    </View>
  );

  // One payment, as a row of a plain list: one that went through opens its receipt; a failed one has
  // nothing more to show. Its mark and its words say which.
  const payment = (entry: PaymentDto, index: number) => {
    const succeeded = entry.status === 'SUCCEEDED';
    const amount = formatMoney(entry.amountPaise, language);
    return (
      <ListRow
        key={entry.id}
        divider={index > 0}
        leading={<Ionicons name={succeeded ? 'checkmark-circle' : 'close-circle'} size={24} color={succeeded ? theme.primary : theme.danger} />}
        title={`${amount} · ${paymentMethod(entry, t)}`}
        subtitle={`${succeeded ? t('bill.paymentReceived') : t('bill.paymentFailed')} · ${formatDateTime(entry.paidAt ?? entry.createdAt, language)}`}
        below={
          entry.reference ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('bill.reference', { reference: ltrText(entry.reference) })}
            </ThemedText>
          ) : undefined
        }
        onPress={succeeded ? () => router.push({ pathname: '/invoices/receipt', params: { paymentId: entry.id } }) : undefined}
        accessibilityLabel={succeeded ? `${t('bill.seeReceipt')}: ${amount}` : undefined}
      />
    );
  };
  // What it is for, short and in the person's language, when the invoice is for one thing (a plan's
  // cycle or one visit), as it nearly always is; otherwise each of its lines as written.
  const name = invoice.lines.length === 1 ? invoiceTitle(invoice, t, language) : null;

  return (
    <Screen
      back
      title={t('bill.invoice')}
      subtitle={ltrText(invoice.number)}
      onRefresh={load}
      footer={
        owing ? (
          isOwner ? (
            <Button
              icon="card-outline"
              label={t('bill.payAmount', { amount: formatMoney(invoice.duePaise, language) })}
              onPress={() => router.push({ pathname: '/invoices/pay', params: { invoiceId: invoice.id } })}
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {t('bill.ownerPays')}
            </ThemedText>
          )
        ) : undefined
      }>
      <ErrorText message={error} onRetry={() => void load()} />

      {/* Where it stands, first: the amount still to pay (or the total), and the state in words. */}
      <Card borderColor={invoice.overdueDays > 0 ? theme.danger : undefined}>
        <View style={styles.box}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {owing ? t('bill.leftToPay') : t('bill.total')}
          </ThemedText>
          <ThemedText type="title" style={styles.total}>
            {formatMoney(owing ? invoice.duePaise : invoice.totalPaise, language)}
          </ThemedText>
          <View style={styles.stateRow}>
            <Ionicons name={state.icon} size={24} color={stateColor} />
            <ThemedText type="smallBold" style={[styles.stateText, { color: stateColor }]}>
              {state.label}
            </ThemedText>
          </View>
          {invoice.status === 'VOID' && invoice.voidReason && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('bill.voidReason', { reason: invoice.voidReason })}
            </ThemedText>
          )}
        </View>
      </Card>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
        {t('bill.whatFor')}
      </ThemedText>
      {name ? (
        <View style={styles.line}>
          <View style={styles.lineWords}>
            <ThemedText type="default" style={styles.strong}>
              {name.title}
            </ThemedText>
            {name.detail && (
              <ThemedText type="small" themeColor="textSecondary">
                {name.detail}
              </ThemedText>
            )}
          </View>
          <ThemedText type="default">{formatMoney(invoice.lines[0]!.taxablePaise, language)}</ThemedText>
        </View>
      ) : (
        invoice.lines.map((line, index) => (
          <View key={index} style={styles.line}>
            <ThemedText type="default" style={styles.rowLabel}>
              {line.description}
            </ThemedText>
            <ThemedText type="default">{formatMoney(line.taxablePaise, language)}</ThemedText>
          </View>
        ))
      )}

      <Card>
        <View style={styles.box}>
          {row(t('bill.beforeGst'), formatMoney(invoice.subtotalPaise, language))}
          {invoice.interState ? (
            row(taxLabel('IGST', 1), formatMoney(invoice.igstPaise, language))
          ) : (
            <>
              {row(taxLabel('CGST', 0.5), formatMoney(invoice.cgstPaise, language))}
              {row(taxLabel('SGST', 0.5), formatMoney(invoice.sgstPaise, language))}
            </>
          )}
          <View style={[styles.rule, { backgroundColor: theme.border }]} />
          {row(t('bill.total'), formatMoney(invoice.totalPaise, language), true)}
          {invoice.paidPaise > 0 && row(t('bill.paidSoFar'), formatMoney(invoice.paidPaise, language))}
          {owing && invoice.paidPaise > 0 && row(t('bill.leftToPay'), formatMoney(invoice.duePaise, language), true)}
        </View>
      </Card>

      <View style={styles.facts}>
        {row(t('bill.issuedOn'), formatDate(invoice.issueDate, language))}
        {row(t('bill.dueOn'), formatDate(invoice.dueDate, language))}
        {invoice.periodStart &&
          invoice.periodEnd &&
          row(
            t('bill.period'),
            t('bill.periodDates', {
              from: formatDate(invoice.periodStart, language),
              until: formatDate(invoice.periodEnd, language),
            }),
          )}
        {row(t('bill.billedTo'), invoice.billTo.legalName || invoice.billTo.name)}
        {invoice.billTo.gstin && row('GSTIN', ltrText(invoice.billTo.gstin))}
        {row(t('bill.placeOfSupply'), ltrText(gstStateLabel(invoice.placeOfSupply)))}
      </View>

      {invoice.payments.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('bill.payments')}
          </ThemedText>
          <View>{invoice.payments.map(payment)}</View>
        </>
      )}

      <View style={styles.sectionGap}>
        <Button
          icon="document-text-outline"
          label={t('bill.openPdf')}
          variant="secondary"
          loading={opening}
          onPress={() => void openPdf()}
        />
        <ErrorText message={pdfError} onRetry={() => void openPdf()} />
      </View>
      {invoice.visitId && (
        <Button
          label={t('cert.seeVisit')}
          variant="link"
          onPress={() => router.push({ pathname: '/services/[visitId]', params: { visitId: invoice.visitId! } })}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: Spacing.three, gap: Spacing.two },
  box: { gap: Spacing.one },
  total: { fontSize: 36, lineHeight: 44 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stateText: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  lineWords: { flex: 1, gap: Spacing.half },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: Spacing.half },
  rowLabel: { flex: 1 },
  rowValue: { flexShrink: 1 },
  // A long value (a name, a period, what a payment was for) goes under its label instead of beside it,
  // as key-value lists do on a phone (SAP Fiori's key-value cell, the Singapore design system's
  // stacked description list). Beside it, it squeezed the label into "For the / period" (22 Oct 2026).
  stacked: { gap: Spacing.half, paddingVertical: Spacing.half },
  strong: { fontWeight: 700 },
  rule: { height: 1, marginVertical: Spacing.one },
  facts: { gap: Spacing.half },
});
