import Ionicons from '@expo/vector-icons/Ionicons';
import { can, type AttendanceDayDto } from '@eccs/shared';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { DayFactsLine, EnrolledMark, FlagList } from '@/components/attendance-parts';
import { DayCounts, DayMarkChip, useLoaded, type DayMark } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { addDays, formatDayLong, formatDayShort } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/**
 * One day's attendance for the outlet, to read. Nobody marks attendance here
 * any more: each person clocks in and out by face on the PIN screen, and the
 * day's status is worked out from those times. The Manager sees any day; the
 * Owner can also open a person's day and correct it. The Head Chef has no
 * attendance page (founder, 13 Oct 2026).
 */
export default function AttendanceDayScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { backIcon, forwardIcon } = useDirection();
  const { outletId, outlets, choose } = useOutlet();
  const params = useLocalSearchParams<{ date?: string }>();
  // Empty means today, whatever today is when the screen is opened.
  const [date, setDate] = useState<string | null>(params.date ?? null);

  const memberships = user?.memberships ?? [];
  const allowed = can(memberships, 'attendance', 'read');

  const { data, error, reload } = useLoaded<AttendanceDayDto>(
    allowed && outletId ? `${outletId}|${date ?? 'today'}` : null,
    () => api.team.day(outletId!, date ?? undefined),
  );

  if (!allowed) return <Redirect href="/" />;

  const counts: Record<DayMark, number> = { PRESENT: 0, HALF_DAY: 0, ABSENT: 0, LEAVE: 0, WEEKLY_OFF: 0, NONE: 0 };
  for (const person of data?.people ?? []) counts[person.status ?? 'NONE'] += 1;

  return (
    <Screen
      back
      title={t('team.att.title')}
      // How attendance is recorded is read once, so it is folded away at the end (22 Oct 2026).
      about={t('att.day.how')}
      onRefresh={reload}
      footer={data && data.people.length > 0 ? <DayCounts counts={counts} /> : undefined}>
      <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />

      {/* ── The day, and for whoever may look back, moving to another day ── */}
      {data && (
        <View style={styles.dayBar}>
          {data.earliestDate < data.today && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('team.att.prevDay')}
              disabled={data.date <= data.earliestDate}
              onPress={() => setDate(addDays(data.date, -1))}
              style={[styles.arrow, data.date <= data.earliestDate && styles.faded]}>
              <Ionicons name={backIcon} size={28} color={theme.primary} />
            </Pressable>
          )}
          <View style={styles.dayTitle}>
            {/* Short ("Thu, 22 Oct"), so it stays on one line between the arrows. */}
            <ThemedText type="default" style={styles.dayName} accessibilityLabel={formatDayLong(data.date, language)}>
              {formatDayShort(data.date, language)}
            </ThemedText>
            {data.date === data.today ? (
              <ThemedText type="small" themeColor="primary">
                {t('hist.today')}
              </ThemedText>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setDate(null)} style={styles.todayLink}>
                <ThemedText type="small" themeColor="primary">
                  {t('team.att.backToToday')}
                </ThemedText>
              </Pressable>
            )}
          </View>
          {data.earliestDate < data.today && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('team.att.nextDay')}
              disabled={data.date >= data.today}
              onPress={() => setDate(addDays(data.date, 1))}
              style={[styles.arrow, data.date >= data.today && styles.faded]}>
              <Ionicons name={forwardIcon} size={28} color={theme.primary} />
            </Pressable>
          )}
        </View>
      )}
      {/* The month's view is one tap from the top, rather than after every person's row. */}
      {data && data.people.length > 0 && (
        <Button icon="calendar-outline" variant="link" align="start" label={t('team.att.monthSummary')} onPress={() => router.push('/team/month')} />
      )}

      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}

      {data?.people.length === 0 && (
        <>
          <ThemedText type="default" themeColor="textSecondary">
            {t('team.att.empty')}
          </ThemedText>
          <Button icon="person-add-outline" label={t('team.people.add')} onPress={() => router.push('/team/person')} />
        </>
      )}

      {/* The same plain rows as the Staff list and the Salary tracker, with where each person stands under
          the job line and the arrow alone at the end (Material's three-line list item: the status is
          supporting content). At the row's end the status squeezed the words, so "Face not added" broke
          on every row in Telugu (22 Oct 2026). */}
      <View>
        {data?.people.map((person, index) => (
          <ListRow
            key={person.staffId}
            title={person.name}
            subtitle={[person.jobTitle, person.usualDayOff ? t('team.att.usualOff') : null].filter(Boolean).join(' · ') || null}
            below={
              <>
                <DayMarkChip mark={person.status ?? 'NONE'} />
                <DayFactsLine facts={person} />
                {/* A status that may still change: the day is running, or the Owner has something to settle. */}
                {person.provisional && person.status !== null && data.date !== data.today && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('att.provisional')}
                  </ThemedText>
                )}
                {person.source === 'OWNER' && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('att.setByOwner')}
                  </ThemedText>
                )}
                <FlagList flags={person.flags} />
                {!person.enrolled && <EnrolledMark enrolled={false} />}
              </>
            }
            divider={index > 0}
            onPress={() => router.push({ pathname: '/team/day', params: { staffId: person.staffId, date: data.date } })}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dayBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dayTitle: { flex: 1, alignItems: 'center' },
  dayName: { fontWeight: 700, fontSize: 18, textAlign: 'center' },
  todayLink: { minHeight: MinTouchSize - Spacing.three, justifyContent: 'center', paddingHorizontal: Spacing.two },
  arrow: { minHeight: MinTouchSize, minWidth: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.3 },
});
