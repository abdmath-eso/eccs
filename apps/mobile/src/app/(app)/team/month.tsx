import { can, shiftMonth, type AttendanceMonthDto } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { countsOf, DayCounts, MonthStepper, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { useTheme } from '@/hooks/use-theme';
import { indiaToday } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/** How many months back the attendance summary can be opened. */
const MONTHS_BACK = 12;

/** The outlet's attendance for a month: one row per person with their days of each kind. */
export default function AttendanceMonthScreen() {
  const theme = useTheme();
  const { t, api, user } = useSession();
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
      <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />
      <MonthStepper month={month} thisMonth={thisMonth} earliest={shiftMonth(thisMonth, -MONTHS_BACK)} onChange={setMonth} />

      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}
      {data?.people.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('team.month.empty')}
        </ThemedText>
      )}

      {/* One plain row per person with a thin line between, as on the day's list: the name and their counts.
          Their job is on their own page. */}
      <View>
        {data?.people.map((person, index) => (
          <ListRow
            key={person.staffId}
            title={person.name}
            below={<DayCounts counts={countsOf(person.totals)} />}
            divider={index > 0}
            onPress={() => router.push({ pathname: '/team/[staffId]', params: { staffId: person.staffId, month } })}
          />
        ))}
      </View>
    </Screen>
  );
}
