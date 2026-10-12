import Ionicons from '@expo/vector-icons/Ionicons';
import { can, type AttendanceDayDto } from '@eccs/shared';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { CountFilter, DayFactsLine, EnrolledMark, FlagList, LookMark, type CountChoice } from '@/components/attendance-parts';
import { DAY_MARK, DAY_MARK_ORDER, OutletChips, useLoaded, type DayMark } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
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
 *
 * Laid out as attendance apps lay a day out (Jibble's daily timesheet,
 * Connecteam's Today tab, Zoho People's day view): the date with an arrow
 * either side, the day's totals in one strip that also filters, then a plain
 * list. A row is the name, the status, and one quiet line of first in, last
 * out and time worked. Anything needing a look is one small warning sign; the
 * words for it, the face, who set the day and the photos are on the person's
 * day, one tap away. (Show first only what is needed first, the rest on
 * request: Nielsen Norman Group, "progressive disclosure".) The Head Chef
 * cannot open a person's day, so for them those few words stay on the row.
 */

/** What the list is narrowed to: everyone, one kind of day, or the days that need a look. */
type Filter = 'ALL' | 'LOOK' | DayMark;

export default function AttendanceDayScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { backIcon, forwardIcon } = useDirection();
  const { outletId, outlets, choose } = useOutlet();
  const params = useLocalSearchParams<{ date?: string }>();
  // Empty means today, whatever today is when the screen is opened.
  const [date, setDate] = useState<string | null>(params.date ?? null);
  const [filter, setFilter] = useState<Filter>('ALL');

  const memberships = user?.memberships ?? [];
  const allowed = can(memberships, 'staff', 'read');
  // The Owner and Manager also open a person's day, the month and the photos; the Head Chef only sees who is in.
  const manages = can(memberships, 'attendance', 'read');

  const { data, error, reload } = useLoaded<AttendanceDayDto>(
    allowed && outletId ? `${outletId}|${date ?? 'today'}` : null,
    () => api.team.day(outletId!, date ?? undefined),
  );

  if (!allowed) return <Redirect href="/" />;

  const people = data?.people ?? [];
  const pastDay = data ? data.date !== data.today : false;
  const counts: Record<DayMark, number> = { PRESENT: 0, HALF_DAY: 0, ABSENT: 0, LEAVE: 0, WEEKLY_OFF: 0, NONE: 0 };
  for (const person of people) counts[person.status ?? 'NONE'] += 1;
  /** True when the day has something to look at: a mark on a punch, or a past day's status that is still a stand-in. */
  const needsLook = (person: AttendanceDayDto['people'][number]) =>
    person.flags.length > 0 || (person.provisional && person.status !== null && pastDay);
  const lookCount = people.filter(needsLook).length;

  // The strip: everyone, then each kind of day that anyone has, then what needs a look.
  const choices: CountChoice<Filter>[] = [
    { key: 'ALL', label: t('att.filter.all'), count: people.length },
    ...DAY_MARK_ORDER.filter((mark) => counts[mark] > 0).map((mark) => ({
      key: mark as Filter,
      label: t(DAY_MARK[mark].label),
      count: counts[mark],
      icon: DAY_MARK[mark].icon,
      tone: DAY_MARK[mark].tone,
    })),
    ...(lookCount > 0
      ? [{ key: 'LOOK' as Filter, label: t('att.needsLook'), count: lookCount, icon: 'alert-circle' as const, tone: 'warning' as const }]
      : []),
  ];
  // A filter left over from another day, with nobody in it on this one, shows everyone.
  const chosen = choices.some((choice) => choice.key === filter) ? filter : 'ALL';
  const shown = people.filter(
    (person) => chosen === 'ALL' || (chosen === 'LOOK' ? needsLook(person) : (person.status ?? 'NONE') === chosen),
  );

  return (
    <Screen back title={t('team.att.title')} onRefresh={reload}>
      <OutletChips outlets={outlets} outletId={outletId} onChoose={choose} />

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

      {/* ── The day's totals, which also narrow the list ── */}
      {people.length > 0 && <CountFilter choices={choices} chosen={chosen} onChoose={setFilter} label={t('att.filter.label')} />}

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

      {/* ── The list: one plain row per person, a thin line between ── */}
      {data && shown.length > 0 && (
        <View>
          {shown.map((person, index) => {
            const mark = DAY_MARK[person.status ?? 'NONE'];
            const hasFacts = person.firstInAt !== null || person.lastOutAt !== null || person.onDuty;
            // With no clock-in to show, the quiet line says what explains the day, or the person's job.
            const fallback = person.usualDayOff ? t('team.att.usualOff') : person.jobTitle;
            return (
              <Pressable
                key={person.staffId}
                accessibilityRole={manages ? 'button' : 'text'}
                disabled={!manages}
                onPress={() => router.push({ pathname: '/team/day', params: { staffId: person.staffId, date: data.date } })}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                  pressed && { backgroundColor: theme.backgroundElement },
                ]}>
                <View style={styles.rowText}>
                  <View style={styles.nameRow}>
                    <ThemedText type="default" numberOfLines={1} style={[styles.bold, styles.flex]}>
                      {person.name}
                    </ThemedText>
                    {needsLook(person) && <LookMark />}
                    <View style={styles.status}>
                      <Ionicons name={mark.icon} size={20} color={theme[mark.tone]} />
                      <ThemedText type="smallBold">{t(mark.label)}</ThemedText>
                    </View>
                  </View>
                  {hasFacts ? (
                    <DayFactsLine facts={person} />
                  ) : fallback ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {fallback}
                    </ThemedText>
                  ) : null}
                  {/* The Head Chef has no day screen to open, so what it would say stays here for them. */}
                  {!manages && (
                    <>
                      {person.provisional && person.status !== null && pastDay && (
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
                  )}
                </View>
                {manages && <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />}
              </Pressable>
            );
          })}
        </View>
      )}

      {manages && data && data.people.length > 0 && (
        <Button icon="calendar-outline" variant="secondary" label={t('team.att.monthSummary')} onPress={() => router.push('/team/month')} />
      )}

      {/* How attendance comes about: said once, quietly, under the list rather than above it. */}
      {data && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('att.day.how')}
        </ThemedText>
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
  // A plain row, no box: taller than the smallest thing a thumb can hit, with air above and below.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize + Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  rowText: { flex: 1, gap: Spacing.one },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  bold: { fontWeight: 700 },
});
