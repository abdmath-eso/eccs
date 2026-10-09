import Ionicons from '@expo/vector-icons/Ionicons';
import { can, type AttendanceDayDto, type AttendanceDayPersonDto, type AttendanceStatus } from '@eccs/shared';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { DAY_MARK, DayCounts, OutletChips, useLoaded, type DayMark } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionSheet } from '@/components/ui/option-sheet';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDayLong } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// The three marks made most often get a button each on every row; the two rarer
// ones (paid leave, weekly off) sit behind "More", so a row still fits a narrow phone.
const QUICK: AttendanceStatus[] = ['PRESENT', 'HALF_DAY', 'ABSENT'];

/**
 * One day's attendance for the outlet. "Mark everyone present" does the whole
 * team in one tap; then only the exceptions are changed. Each tap is saved
 * straight away. The Head Chef marks today; the Owner and Manager can also go
 * back and correct earlier days.
 */
export default function AttendanceDayScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { backIcon, forwardIcon } = useDirection();
  const { outletId, outlets, choose } = useOutlet();
  const params = useLocalSearchParams<{ date?: string }>();
  // Empty means today, whatever today is when the screen is opened.
  const [date, setDate] = useState<string | null>(params.date ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [moreFor, setMoreFor] = useState<AttendanceDayPersonDto | null>(null);

  const memberships = user?.memberships ?? [];
  const mayMark = can(memberships, 'attendance', 'create');
  // The Owner and Manager also see the month and manage the people; the Head Chef only marks.
  const manages = can(memberships, 'attendance', 'read');

  const { data, error, reload, set } = useLoaded<AttendanceDayDto>(
    mayMark && outletId ? `${outletId}|${date ?? 'today'}` : null,
    () => api.team.day(outletId!, date ?? undefined),
  );

  if (!mayMark) return <Redirect href="/" />;

  /** Shows the change at once, sends it, and puts back the server's version of the day. */
  async function save(marks: { staffId: string; status: AttendanceStatus | null }[]) {
    if (!data || !outletId || marks.length === 0) return;
    setSaveError(null);
    set({
      ...data,
      people: data.people.map((person) => {
        const mark = marks.find((entry) => entry.staffId === person.staffId);
        return mark ? { ...person, status: mark.status } : person;
      }),
    });
    try {
      set(await api.team.mark({ outletId, date: data.date, marks }));
    } catch (e) {
      setSaveError(errorMessage(e, t));
      // The change did not go through: show the day as the server has it.
      await reload();
    }
  }

  async function markTheRest() {
    if (!data) return;
    setMarkingAll(true);
    await save(
      data.people
        .filter((person) => person.status === null)
        // Someone whose usual day off it is gets "Weekly off" rather than "Present".
        .map((person) => ({ staffId: person.staffId, status: person.usualDayOff ? 'WEEKLY_OFF' : 'PRESENT' })),
    );
    setMarkingAll(false);
  }

  const counts: Record<DayMark, number> = { PRESENT: 0, HALF_DAY: 0, ABSENT: 0, LEAVE: 0, WEEKLY_OFF: 0, NONE: 0 };
  for (const person of data?.people ?? []) counts[person.status ?? 'NONE'] += 1;
  const noneMarked = data !== null && counts.NONE === data.people.length;

  const statusButton = (person: AttendanceDayPersonDto, mark: DayMark, selected: boolean, label: string, onPress: () => void) => (
    <Pressable
      key={mark}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${person.name}: ${label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.statusButton,
        { borderColor: selected ? theme[DAY_MARK[mark].tone] : theme.outline },
        (selected || pressed) && { backgroundColor: theme.backgroundElement },
        selected && styles.statusSelected,
      ]}>
      <Ionicons
        name={mark === 'NONE' ? 'ellipsis-horizontal' : DAY_MARK[mark].icon}
        size={26}
        color={selected ? theme[DAY_MARK[mark].tone] : theme.textSecondary}
      />
      <ThemedText type="small" numberOfLines={2} style={[styles.statusLabel, selected && styles.bold]}>
        {label}
      </ThemedText>
    </Pressable>
  );

  return (
    <Screen
      back
      title={t('team.att.title')}
      onRefresh={reload}
      footer={
        data && data.people.length > 0 ? (
          <>
            <DayCounts counts={counts} />
            {data.editable && counts.NONE > 0 && (
              <Button
                icon="checkmark-done"
                label={t(noneMarked ? 'team.att.markAll' : 'team.att.markRest')}
                loading={markingAll}
                onPress={() => void markTheRest()}
              />
            )}
          </>
        ) : undefined
      }>
      <OutletChips outlets={outlets} outletId={outletId} onChoose={choose} />

      {/* ── The day, and for whoever may correct, moving to another day ── */}
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

      <ErrorText message={error} onRetry={() => void reload()} />
      <ErrorText message={saveError} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}

      {data && !data.editable && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('team.att.locked')}
        </ThemedText>
      )}

      {data?.people.length === 0 && (
        <>
          <ThemedText type="default" themeColor="textSecondary">
            {t(manages ? 'team.att.empty' : 'team.att.emptyChef')}
          </ThemedText>
          {manages && <Button icon="person-add-outline" label={t('team.people.add')} onPress={() => router.push('/team/person')} />}
        </>
      )}

      {data?.people.map((person) => {
        const rare = person.status === 'LEAVE' || person.status === 'WEEKLY_OFF' ? person.status : null;
        return (
          <View key={person.staffId} style={[styles.card, { borderColor: theme.border }]}>
            <View style={styles.nameRow}>
              <View style={styles.nameText}>
                <ThemedText type="default" style={styles.bold}>
                  {person.name}
                </ThemedText>
                {(person.jobTitle || person.usualDayOff) && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {[person.jobTitle, person.usualDayOff ? t('team.att.usualOff') : null].filter(Boolean).join(' · ')}
                  </ThemedText>
                )}
              </View>
              {!data.editable && (
                <View style={styles.readOnly}>
                  <Ionicons name={DAY_MARK[person.status ?? 'NONE'].icon} size={22} color={theme[DAY_MARK[person.status ?? 'NONE'].tone]} />
                  <ThemedText type="smallBold">{t(DAY_MARK[person.status ?? 'NONE'].label)}</ThemedText>
                </View>
              )}
            </View>
            {data.editable && (
              <View style={styles.statusRow} accessibilityRole="radiogroup">
                {QUICK.map((status) =>
                  statusButton(person, status, person.status === status, t(DAY_MARK[status].label), () =>
                    void save([{ staffId: person.staffId, status }]),
                  ),
                )}
                {statusButton(person, rare ?? 'NONE', rare !== null, t(rare ? DAY_MARK[rare].label : 'team.att.more'), () => setMoreFor(person))}
              </View>
            )}
          </View>
        );
      })}

      {manages && data && data.people.length > 0 && (
        <Button icon="calendar-outline" variant="secondary" label={t('team.att.monthSummary')} onPress={() => router.push('/team/month')} />
      )}

      <OptionSheet
        visible={moreFor !== null}
        title={moreFor?.name}
        onClose={() => setMoreFor(null)}
        options={
          moreFor
            ? [
                ...(['LEAVE', 'WEEKLY_OFF'] as const).map((status) => ({
                  label: t(DAY_MARK[status].label),
                  icon: DAY_MARK[status].icon,
                  onPress: () => {
                    setMoreFor(null);
                    void save([{ staffId: moreFor.staffId, status }]);
                  },
                })),
                ...(moreFor.status !== null
                  ? [
                      {
                        label: t('team.att.clear'),
                        icon: 'backspace-outline' as const,
                        onPress: () => {
                          setMoreFor(null);
                          void save([{ staffId: moreFor.staffId, status: null }]);
                        },
                      },
                    ]
                  : []),
              ]
            : []
        }
      />
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
  card: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  nameText: { flex: 1, gap: Spacing.half },
  readOnly: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  statusRow: { flexDirection: 'row', gap: Spacing.two },
  // Tall enough for a wet thumb, with the picture above the word so four fit a narrow phone.
  statusButton: {
    flex: 1,
    minHeight: MinTouchSize + Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.half,
    paddingVertical: Spacing.one,
  },
  statusSelected: { borderWidth: 2 },
  statusLabel: { textAlign: 'center', fontSize: 13, lineHeight: 16 },
  bold: { fontWeight: 700 },
});
