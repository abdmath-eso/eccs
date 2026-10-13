import Ionicons from '@expo/vector-icons/Ionicons';
import { can, type AttendanceDayDto } from '@eccs/shared';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { DayFactsLine, EnrolledMark, FlagList } from '@/components/attendance-parts';
import { DAY_MARK, DayCounts, useLoaded, type DayMark } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { addDays, formatDayLong } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/**
 * One day's attendance for the outlet, to read. Nobody marks attendance here
 * any more: each person clocks in and out by face on the PIN screen, and the
 * day's status is worked out from those times. The Head Chef sees today; the
 * Manager any day; the Owner can also open a person's day and correct it.
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
  const allowed = can(memberships, 'staff', 'read');
  // The Owner and Manager also open a person's day, the month and the photos; the Head Chef only sees who is in.
  const manages = can(memberships, 'attendance', 'read');

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
            <ThemedText type="default" style={styles.dayName}>
              {formatDayLong(data.date, language)}
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

      <ThemedText type="small" themeColor="textSecondary">
        {t('att.day.how')}
      </ThemedText>

      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}

      {data?.people.length === 0 && (
        <>
          <ThemedText type="default" themeColor="textSecondary">
            {t(manages ? 'team.att.empty' : 'team.att.emptyChef')}
          </ThemedText>
          {manages && <Button icon="person-add-outline" label={t('team.people.add')} onPress={() => router.push('/team/person')} />}
        </>
      )}

      {data?.people.map((person) => {
        const mark = DAY_MARK[person.status ?? 'NONE'];
        return (
          <Pressable
            key={person.staffId}
            accessibilityRole={manages ? 'button' : 'text'}
            disabled={!manages}
            onPress={() => router.push({ pathname: '/team/day', params: { staffId: person.staffId, date: data.date } })}
            style={({ pressed }) => [styles.card, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.nameText}>
              <View style={styles.nameRow}>
                <ThemedText type="default" style={[styles.bold, styles.flex]}>
                  {person.name}
                </ThemedText>
                <View style={styles.status}>
                  <Ionicons name={mark.icon} size={22} color={theme[mark.tone]} />
                  <ThemedText type="smallBold">{t(mark.label)}</ThemedText>
                </View>
              </View>
              {(person.jobTitle || person.usualDayOff) && (
                <ThemedText type="small" themeColor="textSecondary">
                  {[person.jobTitle, person.usualDayOff ? t('team.att.usualOff') : null].filter(Boolean).join(' · ')}
                </ThemedText>
              )}
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
            </View>
            {manages && <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />}
          </Pressable>
        );
      })}

      {manages && data && data.people.length > 0 && (
        <Button icon="calendar-outline" variant="secondary" label={t('team.att.monthSummary')} onPress={() => router.push('/team/month')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dayBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dayTitle: { flex: 1, alignItems: 'center' },
  dayName: { fontWeight: 700, fontSize: 18, textAlign: 'center' },
  todayLink: { minHeight: MinTouchSize - Spacing.three, justifyContent: 'center', paddingHorizontal: Spacing.two },
  arrow: { minHeight: MinTouchSize, minWidth: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.3 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  nameText: { flex: 1, gap: Spacing.half },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  bold: { fontWeight: 700 },
});
