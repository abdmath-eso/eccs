import Ionicons from '@expo/vector-icons/Ionicons';
import { can, shiftMonth, type AttendanceMonthDto } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { countsOf, DayCounts, MonthStepper, OutletChips, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { indiaToday } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/** How many months back the attendance summary can be opened. */
const MONTHS_BACK = 12;

/** The outlet's attendance for a month: one row per person with their days of each kind. */
export default function AttendanceMonthScreen() {
  const theme = useTheme();
  const { t, api, user } = useSession();
  const { forwardIcon } = useDirection();
  const { outletId, outlets, choose } = useOutlet();
  const [month, setMonth] = useState(() => indiaToday().slice(0, 7));

  const allowed = can(user?.memberships ?? [], 'attendance', 'read');
  const { data, error, reload } = useLoaded<AttendanceMonthDto>(allowed && outletId ? `${outletId}|${month}` : null, () =>
    api.team.month(outletId!, month),
  );

  if (!allowed) return <Redirect href="/" />;
  const thisMonth = (data?.today ?? indiaToday()).slice(0, 7);

  return (
    <Screen back title={t('team.att.monthSummary')} onRefresh={reload}>
      <OutletChips outlets={outlets} outletId={outletId} onChoose={choose} />
      <MonthStepper month={month} thisMonth={thisMonth} earliest={shiftMonth(thisMonth, -MONTHS_BACK)} onChange={setMonth} />

      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}
      {data?.people.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('team.month.empty')}
        </ThemedText>
      )}

      {data?.people.map((person) => (
        <Pressable
          key={person.staffId}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/team/[staffId]', params: { staffId: person.staffId, month } })}
          style={({ pressed }) => [styles.card, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.text}>
            <ThemedText type="default" style={styles.bold}>
              {person.name}
            </ThemedText>
            {person.jobTitle && (
              <ThemedText type="small" themeColor="textSecondary">
                {person.jobTitle}
              </ThemedText>
            )}
            <DayCounts counts={countsOf(person.totals)} />
          </View>
          <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  text: { flex: 1, gap: Spacing.one },
  bold: { fontWeight: 700 },
});
