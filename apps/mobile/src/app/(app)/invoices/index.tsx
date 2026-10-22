import Ionicons from '@expo/vector-icons/Ionicons';
import type { InvoiceSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney, invoiceState, invoiceTitle } from '@/lib/billing';
import { ltrText, useDirection } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/**
 * Invoices, for the Owner and the Manager of one outlet.
 *
 * Laid out the way billing apps and customer portals do it: what there is to
 * pay comes first, as one large amount; under it the invoices still to pay,
 * the overdue ones at the top and said so in words with a warning mark; then
 * the paid ones as a record. Each opens to its details and its PDF. The Owner
 * pays from here; the Manager can only read.
 *
 * Each card is titled by what the invoice covers, short and in the person's
 * language ("15 Oct – 14 Nov 2026", the plan in grey under it), as banking and
 * billing apps title a statement by its period (22 Oct 2026; it was the stored
 * English line, three bold lines long).
 */
export default function InvoicesScreen() {
  const theme = useTheme();
  const { t, api, language, user } = useSession();
  const { forwardIcon } = useDirection();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [loaded, setLoaded] = useState<{ outletId: string; invoices: InvoiceSummaryDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOwner = user?.memberships.some((membership) => membership.role === 'OWNER') ?? false;

  const load = useCallback(async () => {
    if (!outletId) return;
    try {
      setLoaded({ outletId, invoices: await api.billing.invoices({ outletId }) });
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId]);

  // Reloads on coming back, so an invoice just paid has moved to "Paid".
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // After the Owner picks another outlet, the last outlet's invoices must not be shown as this one's.
  const invoices = loaded?.outletId === outletId ? loaded.invoices : null;
  const all = invoices ?? [];
  // The longest overdue first, then whatever falls due soonest.
  const toPay = all
    .filter((invoice) => invoice.duePaise > 0)
    .sort((a, b) => b.overdueDays - a.overdueDays || a.dueDate.localeCompare(b.dueDate));
  const paid = all.filter((invoice) => invoice.status === 'PAID');
  const cancelled = all.filter((invoice) => invoice.status === 'VOID');
  const due = toPay.reduce((sum, invoice) => sum + invoice.duePaise, 0);
  const overdue = toPay.filter((invoice) => invoice.overdueDays > 0);
  const overdueAmount = overdue.reduce((sum, invoice) => sum + invoice.duePaise, 0);

  const open = (invoice: InvoiceSummaryDto) =>
    router.push({ pathname: '/invoices/[invoiceId]', params: { invoiceId: invoice.id } });

  const card = (invoice: InvoiceSummaryDto) => {
    const state = invoiceState(invoice, t, language);
    const color = theme[state.tone];
    const owing = invoice.duePaise > 0;
    // What is left on a part-paid invoice; otherwise the invoice's total.
    const amount = formatMoney(owing ? invoice.duePaise : invoice.totalPaise, language);
    const name = invoiceTitle(invoice, t, language);
    return (
      // The card itself is not the button: Pay now sits inside it, and a button inside a button is out of
      // a screen reader's reach on an iPhone. The words open the invoice; Pay now pays it.
      <Card key={invoice.id} borderColor={invoice.overdueDays > 0 ? theme.danger : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[name.title, name.detail, amount, state.label].filter(Boolean).join('. ')}
          onPress={() => open(invoice)}
          style={({ pressed }) => [styles.cardBody, pressed && { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.cardWords}>
            <ThemedText type="default" style={styles.cardTitle}>
              {name.title}
            </ThemedText>
            {name.detail && (
              <ThemedText type="small" themeColor="textSecondary">
                {name.detail}
              </ThemedText>
            )}
            <ThemedText type="subtitle" style={styles.amount}>
              {amount}
            </ThemedText>
            <View style={styles.stateRow}>
              <Ionicons name={state.icon} size={22} color={color} />
              <ThemedText type="smallBold" style={[styles.stateText, { color }]}>
                {state.label}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('bill.number', { number: ltrText(invoice.number) })}
            </ThemedText>
          </View>
          <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
        </Pressable>
        {owing && isOwner && (
          <Button
            icon="card-outline"
            label={t('bill.payNow')}
            // One filled button on a screen: with several invoices to pay, theirs are the softer kind.
            variant={toPay.length > 1 ? 'tonal' : 'primary'}
            onPress={() => router.push({ pathname: '/invoices/pay', params: { invoiceId: invoice.id } })}
          />
        )}
      </Card>
    );
  };

  const group = (title: string | null, list: InvoiceSummaryDto[]) =>
    list.length > 0 && (
      <>
        {title !== null && (
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {title}
          </ThemedText>
        )}
        {list.map(card)}
      </>
    );

  return (
    <Screen back title={t('bill.title')} about={t('bill.gstNote')} onRefresh={load}>
      <OutletPicker
        outlets={outlets}
        outletId={outletId}
        onChoose={(nextOutletId) => {
          setError(null);
          choose(nextOutletId);
        }}
      />

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (invoices === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}

      {invoices !== null && all.length === 0 && (
        <EmptyState icon="receipt-outline" title={t('bill.noneTitle')} body={t('bill.noneBody')} />
      )}

      {invoices !== null && all.length > 0 && (
        // The first thing on the screen: how much there is to pay, or that there is nothing.
        <Card borderColor={overdue.length > 0 ? theme.danger : undefined}>
          <View style={styles.summary}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('bill.toPay')}
            </ThemedText>
            <ThemedText type="title" style={styles.total}>
              {formatMoney(due, language)}
            </ThemedText>
            {due === 0 ? (
              <View style={styles.stateRow}>
                <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
                <ThemedText type="default" themeColor="primary" style={styles.stateText}>
                  {t('bill.nothingDue')}
                </ThemedText>
              </View>
            ) : (
              <>
                <ThemedText type="default" themeColor="textSecondary">
                  {t('bill.unpaidCount', { count: toPay.length })}
                </ThemedText>
                {overdue.length > 0 && (
                  <View style={styles.stateRow}>
                    <Ionicons name="alert-circle" size={22} color={theme.danger} />
                    <ThemedText type="smallBold" themeColor="danger" style={styles.stateText}>
                      {t('bill.overdueAmount', { amount: formatMoney(overdueAmount, language) })}
                    </ThemedText>
                  </View>
                )}
                {!isOwner && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('bill.ownerPays')}
                  </ThemedText>
                )}
              </>
            )}
          </View>
        </Card>
      )}

      {/* Straight under the summary, which says how many there are: a second "To pay" heading would only repeat it. */}
      {group(null, toPay)}
      {group(t('bill.paid'), paid)}
      {group(t('bill.cancelled'), cancelled)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: Spacing.three },
  summary: { gap: Spacing.one },
  total: { fontSize: 36, lineHeight: 44 },
  // The part that opens the invoice reaches 8 past the words on three sides, so its pressed shade has
  // room around them, while the words stay on the card's 16 edge, as every card's do.
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    marginHorizontal: -Spacing.two,
    marginTop: -Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
  },
  cardWords: { flex: 1, gap: Spacing.one },
  cardTitle: { fontWeight: 700 },
  amount: { fontSize: 24, lineHeight: 30 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stateText: { flex: 1 },
});
