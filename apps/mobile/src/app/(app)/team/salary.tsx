import Ionicons from '@expo/vector-icons/Ionicons';
import { can, shiftMonth, type SalaryOutletMonthDto } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { MonthStepper, OutletChips, SALARY_STATE, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
import { useDirection } from '@/lib/direction';
import { indiaToday } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

const MONTHS_BACK = 12;

/**
 * The salary tracker for a month: one row per person with what there is to pay,
 * what has been paid and what is still owed. A record book only: it pays nobody.
 */
export default function SalaryMonthScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { forwardIcon } = useDirection();
  const { outletId, outlets, choose } = useOutlet();
  const [month, setMonth] = useState(() => indiaToday().slice(0, 7));

  const allowed = can(user?.memberships ?? [], 'salary', 'read');
  const { data, error, reload } = useLoaded<SalaryOutletMonthDto>(allowed && outletId ? `${outletId}|${month}` : null, () =>
    api.team.salaryMonth(outletId!, month),
  );

  if (!allowed) return <Redirect href="/" />;
  const thisMonth = (data?.today ?? indiaToday()).slice(0, 7);
  const owed = data?.people.reduce((total, person) => total + Math.max(person.balancePaise, 0), 0) ?? 0;

  return (
    <Screen back title={t('team.pay.title')} subtitle={t('team.pay.notPayroll')} onRefresh={reload}>
      <OutletChips outlets={outlets} outletId={outletId} onChoose={choose} />
      <MonthStepper month={month} thisMonth={thisMonth} earliest={shiftMonth(thisMonth, -MONTHS_BACK)} onChange={setMonth} />

      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}

      {data && data.people.length > 0 && (
        <View style={[styles.total, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">
            {t(month === thisMonth ? 'team.pay.totalOwedSoFar' : 'team.pay.totalOwed')}
          </ThemedText>
          <ThemedText type="subtitle">{formatMoney(owed, language)}</ThemedText>
        </View>
      )}
      {data?.people.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('team.month.empty')}
        </ThemedText>
      )}

      {data?.people.map((person) => {
        const state = SALARY_STATE[person.state];
        return (
          <Pressable
            key={person.staffId}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/team/pay', params: { staffId: person.staffId, month } })}
            style={({ pressed }) => [styles.card, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.text}>
              <ThemedText type="default" style={styles.bold}>
                {person.name}
              </ThemedText>
              <View style={styles.state}>
                <Ionicons name={state.icon} size={18} color={theme[state.tone]} />
                <ThemedText type="smallBold" style={{ color: theme[state.tone] }}>
                  {t(state.label)}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {t('team.pay.rowFigures', {
                  payable: formatMoney(Math.max(person.payablePaise, 0), language),
                  paid: formatMoney(person.paidPaise, language),
                })}
              </ThemedText>
            </View>
            <View style={styles.amount}>
              <ThemedText type="small" themeColor="textSecondary">
                {t(person.balancePaise < 0 ? 'team.pay.overpaid' : 'team.pay.stillOwed')}
              </ThemedText>
              <ThemedText type="default" style={styles.bold}>
                {formatMoney(Math.abs(person.balancePaise), language)}
              </ThemedText>
            </View>
            <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  text: { flex: 1, gap: Spacing.half },
  state: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  amount: { alignItems: 'flex-end' },
  bold: { fontWeight: 700 },
});
