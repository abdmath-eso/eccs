import Ionicons from '@expo/vector-icons/Ionicons';
import type { InvoiceSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney, invoiceState } from '@/lib/billing';
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
    return (
      <View key={invoice.id} style={[styles.card, { borderColor: invoice.overdueDays > 0 ? theme.danger : theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${invoice.description}. ${amount}. ${state.label}`}
          onPress={() => open(invoice)}
          style={({ pressed }) => [styles.cardBody, pressed && { backgroundColor: theme.backgroundSelected }]}>
          <View style={styles.cardTop}>
            <ThemedText type="default" style={styles.cardTitle}>
              {invoice.description}
            </ThemedText>
            <Ionicons name={forwardIcon} size={22} color={theme.textSecondary} />
          </View>
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
        </Pressable>
        {owing && isOwner && (
          <Button
            icon="card-outline"
            label={t('bill.payNow')}
            onPress={() => router.push({ pathname: '/invoices/pay', params: { invoiceId: invoice.id } })}
          />
        )}
      </View>
    );
  };

  const group = (title: string, list: InvoiceSummaryDto[]) =>
    list.length > 0 && (
      <>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
          {title}
        </ThemedText>
        {list.map(card)}
      </>
    );

  return (
    <Screen back title={t('bill.title')} onRefresh={load}>
      {outlets.length > 1 && (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => {
                if (outlet.id === outletId) return;
                setError(null);
                choose(outlet.id);
              }}
            />
          ))}
        </View>
      )}

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (invoices === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}

      {invoices !== null && (
        // The first thing on the screen: how much there is to pay, or that there is nothing.
        <View style={[styles.summary, { borderColor: overdue.length > 0 ? theme.danger : theme.border }]}>
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
                {all.length === 0 ? t('bill.none') : t('bill.nothingDue')}
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
      )}

      {group(t('bill.toPay'), toPay)}
      {group(t('bill.paid'), paid)}
      {group(t('bill.cancelled'), cancelled)}

      {all.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionGap}>
          {t('bill.gstNote')}
        </ThemedText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sectionGap: { marginTop: Spacing.three },
  summary: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  total: { fontSize: 36, lineHeight: 44 },
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.two, gap: Spacing.two },
  cardBody: { minHeight: MinTouchSize, borderRadius: Spacing.two, padding: Spacing.one, gap: Spacing.one },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700 },
  amount: { fontSize: 24, lineHeight: 30 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stateText: { flex: 1 },
});
