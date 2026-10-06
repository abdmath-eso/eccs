import Ionicons from '@expo/vector-icons/Ionicons';
import {
  CALENDAR_MONTHS_AHEAD,
  CALENDAR_MONTHS_BACK,
  daysInMonth,
  localize,
  shiftMonth,
  type CalendarDayDto,
  type CalendarLicenceDto,
  type CalendarMonthDto,
  type CalendarVisitDto,
} from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDayLong, formatMonth, indiaToday, weekdayNames } from '@/lib/format';
import { useSession } from '@/lib/session';
import { rememberOutlet, useOutlet } from '@/lib/use-outlet';

// A day cell shows at most this many labels; the rest are counted as "+2".
const MAX_LABELS = 3;

interface Label {
  key: string;
  text: string;
  color: string;
}

/**
 * The outlet's calendar, a month at a time. Each day carries small coloured
 * labels for its checklists, ECCS services, licences falling due and
 * holidays; tapping a day shows them in full underneath.
 */
export default function HistoryScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const [month, setMonth] = useState(() => indiaToday().slice(0, 7));
  const [selected, setSelected] = useState(() => indiaToday());
  const [data, setData] = useState<CalendarMonthDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reloads when the month or outlet changes, and whenever the screen comes back into view.
  useFocusEffect(
    useCallback(() => {
      if (!outletId) return;
      let cancelled = false;
      (async () => {
        try {
          const result = await api.calendar.month(outletId, month);
          if (cancelled) return;
          setData(result);
          setError(null);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e, t));
        }
      })();
      return () => {
        cancelled = true;
      };
      // `t` changes with language; reloading for that is unnecessary.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, outletId, month]),
  );

  const today = data?.today ?? indiaToday();
  const thisMonth = today.slice(0, 7);
  // While another month or outlet is loading, the grid shows its dates without labels.
  const shown = data && data.month === month && data.outletId === outletId ? data : null;
  const byDate = new Map(shown?.days.map((day) => [day.date, day]));

  const show = (nextMonth: string, date?: string) => {
    setMonth(nextMonth);
    setSelected(date ?? (nextMonth === thisMonth ? today : `${nextMonth}-01`));
  };
  const canGoBack = month > shiftMonth(thisMonth, -CALENDAR_MONTHS_BACK);
  const canGoAhead = month < shiftMonth(thisMonth, CALENDAR_MONTHS_AHEAD);

  const licenceName = (licence: CalendarLicenceDto) => licence.name ?? t(`licenceType.${licence.type}`);
  const visitColor = (visit: CalendarVisitDto) => (visit.state === 'NOT_DONE' ? theme.danger : theme.info);

  /** The small labels inside a day cell, most useful first. */
  const labelsFor = (day: CalendarDayDto): Label[] => {
    const labels: Label[] = day.holidays.map((holiday, index) => ({
      key: `holiday-${index}`,
      text: localize(holiday, language),
      color: theme.textSecondary,
    }));
    if (day.checklists.length > 0) {
      const done = day.checklists.filter((checklist) => checklist.status === 'SUBMITTED').length;
      const allDone = done === day.checklists.length;
      const missed = day.checklists.some((checklist) => checklist.status === 'MISSED');
      const problems = day.checklists.some((checklist) => checklist.problemCount > 0);
      labels.push({
        key: 'checklists',
        text: `${allDone ? '✓ ' : ''}${done}/${day.checklists.length}`,
        color: missed ? theme.danger : problems ? theme.warning : allDone ? theme.primary : theme.textSecondary,
      });
    }
    for (const visit of day.visits) {
      labels.push({
        key: visit.id,
        text: `${visit.state === 'DONE' ? '✓ ' : ''}${localize(visit.service, language)}`,
        color: visitColor(visit),
      });
    }
    for (const licence of day.licences) {
      labels.push({
        key: licence.id,
        text: licenceName(licence),
        color: day.date < today ? theme.danger : theme.warning,
      });
    }
    return labels;
  };

  // The month laid out in weeks starting on Sunday, with blanks before the 1st and after the last day.
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const cells: (number | null)[] = [
    ...Array.from({ length: new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() }, () => null),
    ...Array.from({ length: daysInMonth(month) }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));

  const selectedDay = byDate.get(selected);
  const nothingOnDay =
    !selectedDay ||
    selectedDay.checklists.length +
      selectedDay.visits.length +
      selectedDay.licences.length +
      selectedDay.holidays.length ===
      0;

  const legend: [string, string][] = [
    [theme.primary, t('hist.checklists')],
    [theme.info, t('hist.service')],
    [theme.warning, t('hist.licence')],
    [theme.textSecondary, t('hist.holiday')],
  ];

  const visitRow = (visit: CalendarVisitDto, date?: string) => (
    <View key={visit.id} style={[styles.row, { borderColor: theme.border }]}>
      <View style={[styles.stripe, { backgroundColor: visitColor(visit) }]} />
      <View style={styles.rowText}>
        <ThemedText type="default" style={styles.rowTitle}>
          {localize(visit.service, language)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {[date ? formatDate(date, language) : null, visit.slot].filter(Boolean).join(' · ')}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" style={{ color: visit.state === 'DONE' ? theme.primary : visitColor(visit) }}>
        {visit.state === 'DONE' ? '✓ ' : ''}
        {t(`visitState.${visit.state}`)}
      </ThemedText>
    </View>
  );

  const licenceRow = (licence: CalendarLicenceDto, date: string, showDate: boolean) => (
    <Pressable
      key={licence.id}
      accessibilityRole="button"
      onPress={() => outletId && void rememberOutlet(outletId).then(() => router.push('/documents'))}
      style={[styles.row, { borderColor: theme.border }]}>
      <View style={[styles.stripe, { backgroundColor: date < today ? theme.danger : theme.warning }]} />
      <View style={styles.rowText}>
        <ThemedText type="default" style={styles.rowTitle}>
          {licenceName(licence)}
        </ThemedText>
        <ThemedText type="small" themeColor={date < today ? 'danger' : 'warning'}>
          {showDate
            ? t('docs.expires', { date: formatDate(date, language) })
            : t(date < today ? 'hist.licenceExpired' : 'hist.licenceExpires')}
        </ThemedText>
      </View>
    </Pressable>
  );

  return (
    <Screen back>
      {outlets.length > 1 && (
        <View style={styles.outlets} accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => {
            const chosen = outlet.id === outletId;
            return (
              <Pressable
                key={outlet.id}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                onPress={() => choose(outlet.id)}
                style={[
                  styles.outlet,
                  { borderColor: chosen ? theme.primary : theme.border },
                  chosen && { backgroundColor: theme.backgroundElement },
                ]}>
                <ThemedText type="small" themeColor={chosen ? 'primary' : 'text'}>
                  {outlet.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* ── Month title, and moving between months ── */}
      <View style={styles.monthBar}>
        <ThemedText type="subtitle" style={styles.month}>
          {formatMonth(month, language)}
        </ThemedText>
        {month !== thisMonth && (
          <Pressable accessibilityRole="button" onPress={() => show(thisMonth)} style={styles.todayButton}>
            <ThemedText type="default" themeColor="primary">
              {t('hist.today')}
            </ThemedText>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('hist.prev')}
          disabled={!canGoBack}
          onPress={() => show(shiftMonth(month, -1))}
          style={[styles.arrow, !canGoBack && styles.faded]}>
          <Ionicons name="chevron-back" size={26} color={theme.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('hist.next')}
          disabled={!canGoAhead}
          onPress={() => show(shiftMonth(month, 1))}
          style={[styles.arrow, !canGoAhead && styles.faded]}>
          <Ionicons name="chevron-forward" size={26} color={theme.primary} />
        </Pressable>
      </View>

      <ErrorText message={error} />

      {/* ── The month ── */}
      <View>
        <View style={styles.week}>
          {weekdayNames(language).map((name, index) => (
            <ThemedText key={index} type="small" themeColor="textSecondary" style={styles.weekday}>
              {name}
            </ThemedText>
          ))}
        </View>
        {weeks.map((week, weekIndex) => (
          <View key={weekIndex} style={[styles.week, styles.weekRow, { borderColor: theme.border }]}>
            {week.map((dayNumber, column) => {
              if (dayNumber === null) return <View key={column} style={styles.cell} />;
              const date = `${month}-${String(dayNumber).padStart(2, '0')}`;
              const day = byDate.get(date);
              const labels = day ? labelsFor(day) : [];
              const isToday = date === today;
              const isSelected = date === selected;
              return (
                <Pressable
                  key={column}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={formatDayLong(date, language)}
                  onPress={() => setSelected(date)}
                  style={styles.cell}>
                  <View
                    style={[
                      styles.number,
                      isToday && { backgroundColor: theme.primary },
                      isSelected && !isToday && { borderWidth: 2, borderColor: theme.primary },
                    ]}>
                    <ThemedText
                      type="default"
                      style={[
                        styles.numberText,
                        { color: isToday ? theme.onPrimary : column === 0 ? theme.textSecondary : theme.text },
                      ]}>
                      {dayNumber}
                    </ThemedText>
                  </View>
                  {labels.slice(0, MAX_LABELS).map((label) => (
                    <View key={label.key} style={[styles.label, { backgroundColor: `${label.color}26` }]}>
                      <ThemedText
                        numberOfLines={1}
                        ellipsizeMode="clip"
                        style={[styles.labelText, { color: label.color }]}>
                        {label.text}
                      </ThemedText>
                    </View>
                  ))}
                  {labels.length > MAX_LABELS && (
                    <ThemedText style={[styles.labelText, styles.more, { color: theme.textSecondary }]}>
                      +{labels.length - MAX_LABELS}
                    </ThemedText>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
        {(outletLoading || (!shown && !error && outletId)) && (
          <ActivityIndicator color={theme.primary} style={styles.loading} />
        )}
      </View>

      <View style={styles.legend}>
        {legend.map(([color, name]) => (
          <View key={name} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <ThemedText type="small" themeColor="textSecondary">
              {name}
            </ThemedText>
          </View>
        ))}
      </View>

      {/* ── The chosen day ── */}
      <View style={[styles.dayPanel, { borderColor: theme.border }]}>
        <ThemedText type="default" style={styles.dayTitle}>
          {formatDayLong(selected, language)}
          {selected === today ? ` · ${t('hist.today')}` : ''}
        </ThemedText>

        {selectedDay?.holidays.map((holiday, index) => (
          <View key={index} style={[styles.holiday, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('hist.holiday')}
            </ThemedText>
            <ThemedText type="default" style={styles.rowTitle}>
              {localize(holiday, language)}
            </ThemedText>
          </View>
        ))}

        {shown && nothingOnDay && (
          <ThemedText type="default" themeColor="textSecondary">
            {t('hist.nothing')}
          </ThemedText>
        )}

        {selectedDay && selectedDay.checklists.length > 0 && (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('hist.checklists')}
            </ThemedText>
            {selectedDay.checklists.map((checklist) => (
              <Pressable
                key={checklist.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/checklists/[runId]', params: { runId: checklist.id } })}
                style={[styles.row, { borderColor: theme.border }]}>
                <View
                  style={[
                    styles.stripe,
                    {
                      backgroundColor:
                        checklist.status === 'MISSED'
                          ? theme.danger
                          : checklist.problemCount > 0
                            ? theme.warning
                            : checklist.status === 'SUBMITTED'
                              ? theme.primary
                              : theme.textSecondary,
                    },
                  ]}
                />
                <View style={styles.rowText}>
                  <ThemedText type="default" style={styles.rowTitle}>
                    {localize(checklist.title, language)}
                  </ThemedText>
                  <ThemedText type="small" themeColor={checklist.problemCount > 0 ? 'danger' : 'textSecondary'}>
                    {t('checklists.progress', { done: checklist.doneCount, total: checklist.itemCount })}
                    {checklist.problemCount > 0
                      ? ` · ${t('checklists.problems', { count: checklist.problemCount })}`
                      : ''}
                    {checklist.submittedByName ? ` · ${checklist.submittedByName}` : ''}
                  </ThemedText>
                </View>
                <StatusBadge status={checklist.status} reviewed={checklist.reviewedAt !== null} />
              </Pressable>
            ))}
          </>
        )}

        {selectedDay && selectedDay.visits.length > 0 && (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('hist.services')}
            </ThemedText>
            {selectedDay.visits.map((visit) => visitRow(visit))}
          </>
        )}

        {selectedDay && selectedDay.licences.length > 0 && (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('hist.licences')}
            </ThemedText>
            {selectedDay.licences.map((licence) => licenceRow(licence, selected, false))}
          </>
        )}
      </View>

      {/* ── What is coming, whichever month is open ── */}
      {data && data.outletId === outletId && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('hist.upcoming')}
          </ThemedText>
          {data.upcoming.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('hist.noUpcoming')}
            </ThemedText>
          )}
          {data.upcoming.map((entry) =>
            entry.kind === 'visit' ? (
              <Pressable
                key={`visit-${entry.visit.id}`}
                accessibilityRole="button"
                onPress={() => show(entry.date.slice(0, 7), entry.date)}>
                {visitRow(entry.visit, entry.date)}
              </Pressable>
            ) : (
              licenceRow(entry.licence, entry.date, true)
            ),
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  outlets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  outlet: {
    minHeight: MinTouchSize - 8,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  month: { flex: 1, fontSize: 28, lineHeight: 36 },
  todayButton: { minHeight: MinTouchSize, justifyContent: 'center', paddingHorizontal: Spacing.two },
  arrow: { minHeight: MinTouchSize, minWidth: MinTouchSize - 8, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.3 },
  week: { flexDirection: 'row' },
  weekRow: { borderTopWidth: StyleSheet.hairlineWidth },
  weekday: { flex: 1, textAlign: 'center', paddingBottom: Spacing.one },
  cell: { flex: 1, minHeight: 92, alignItems: 'stretch', paddingVertical: Spacing.one, paddingHorizontal: 1, gap: 2 },
  number: {
    alignSelf: 'center',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: { fontSize: 16, lineHeight: 20, fontWeight: 600 },
  label: { borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  labelText: { fontSize: 10, lineHeight: 13, fontWeight: 700 },
  more: { textAlign: 'center' },
  loading: { position: 'absolute', top: Spacing.five, alignSelf: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dayPanel: { borderTopWidth: 1, paddingTop: Spacing.three, gap: Spacing.two },
  dayTitle: { fontWeight: 700, fontSize: 18 },
  holiday: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: MinTouchSize,
    overflow: 'hidden',
  },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  rowText: { flex: 1, gap: Spacing.half },
  rowTitle: { fontWeight: 700 },
  sectionGap: { marginTop: Spacing.three },
});
