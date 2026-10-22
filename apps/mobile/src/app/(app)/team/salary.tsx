import { can, shiftMonth, type SalaryOutletMonthDto } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { MonthStepper, SALARY_STATE, toneOf, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { StatusChip } from '@/components/ui/status-chip';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
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
    // That this is a record book, not payroll, is read once: folded away at the end (22 Oct 2026).
    <Screen back title={t('team.pay.title')} about={t('team.pay.notPayroll')} onRefresh={reload}>
      <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />
      <MonthStepper month={month} thisMonth={thisMonth} earliest={shiftMonth(thisMonth, -MONTHS_BACK)} onChange={setMonth} />

      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}

      {data && data.people.length > 0 && (
        <Card variant="filled">
          <ThemedText type="small" themeColor="textSecondary">
            {t(month === thisMonth ? 'team.pay.totalOwedSoFar' : 'team.pay.totalOwed')}
          </ThemedText>
          <ThemedText type="subtitle">{formatMoney(owed, language)}</ThemedText>
        </Card>
      )}
      {data?.people.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('team.month.empty')}
        </ThemedText>
      )}

      {/* The same plain rows as the Staff list and the attendance day: the name, where the month's pay
          stands, and at the end what is still owed. "Paid x of y" only once something has been paid, so
          one amount is not shown twice. */}
      <View>
        {data?.people.map((person, index) => {
          const state = SALARY_STATE[person.state];
          return (
            <ListRow
              key={person.staffId}
              title={person.name}
              subtitle={
                person.paidPaise > 0
                  ? t('team.pay.paidOf', {
                      paid: formatMoney(person.paidPaise, language),
                      payable: formatMoney(Math.max(person.payablePaise, 0), language),
                    })
                  : null
              }
              below={<StatusChip tone={toneOf(state.tone)} icon={state.icon} label={t(state.label)} />}
              trailing={
                <View style={styles.amount}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t(person.balancePaise < 0 ? 'team.pay.overpaid' : 'team.pay.stillOwed')}
                  </ThemedText>
                  <ThemedText type="default" style={styles.bold}>
                    {formatMoney(Math.abs(person.balancePaise), language)}
                  </ThemedText>
                </View>
              }
              divider={index > 0}
              onPress={() => router.push({ pathname: '/team/pay', params: { staffId: person.staffId, month } })}
            />
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  amount: { alignItems: 'flex-end', maxWidth: '45%' },
  bold: { fontWeight: 700 },
});
