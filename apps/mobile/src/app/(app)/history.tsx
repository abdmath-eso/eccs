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
  type ChecklistRunSummaryDto,
} from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, View, type ScrollView } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDayLong, formatMonth, formatSlot, indiaToday, weekdayNames } from '@/lib/format';
import { useDirection } from '@/lib/direction';
import { useSession } from '@/lib/session';
import { rememberOutlet, useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

// What a mark in a day cell is about. The picture says the kind of thing and nothing else.
const KINDS = ['checklists', 'service', 'licence', 'holiday'] as const;
type Kind = (typeof KINDS)[number];
const KIND_ICON: Record<Kind, IconName> = {
  checklists: 'checkbox',
  service: 'sparkles',
  licence: 'document-text',
  holiday: 'flag',
};

// How it stands. The colour says this and nothing else.
const STATUSES = ['fine', 'attention', 'missed', 'planned'] as const;
type Status = (typeof STATUSES)[number];
const WORST_FIRST: Status[] = ['missed', 'attention', 'planned', 'fine'];

interface Mark {
  kind: Kind;
  status: Status;
  /** Shown beside the icon where it helps, e.g. "2/3" checklists done. */
  count?: string;
}

// How far a finger must travel sideways across the month for it to count as a swipe.
const SWIPE_DISTANCE = 48;

/** The month a swipe leads to: one later (1) or earlier (-1), staying within the year either side of today. */
function monthAfterSwipe(month: string, by: 1 | -1): string {
  const thisMonth = indiaToday().slice(0, 7);
  const next = shiftMonth(month, by);
  return next < shiftMonth(thisMonth, -CALENDAR_MONTHS_BACK) || next > shiftMonth(thisMonth, CALENDAR_MONTHS_AHEAD)
    ? month
    : next;
}

/**
 * The outlet's calendar, a month at a time. Each day carries small icons for
 * its checklists, ECCS services, licences falling due and holidays, coloured
 * by how they stand; tapping a day shows them in full underneath.
 */
export default function HistoryScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  // In Urdu the grid runs from the right (Sunday on the right), and the arrows and the swipe swap sides.
  const { direction, backIcon, forwardIcon } = useDirection();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const [month, setMonth] = useState(() => indiaToday().slice(0, 7));
  const [selected, setSelected] = useState(() => indiaToday());
  const [data, setData] = useState<CalendarMonthDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const dayPanelRef = useRef<View>(null);
  // Where the chosen day's panel starts within the scrolling page.
  const dayPanelY = useRef(0);
  // Set when a day is tapped, so its details are brought into view once they are drawn.
  const revealDay = useRef(false);

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

  /** Loads the month again: for pulling down to refresh and for "Try again". */
  async function reload() {
    if (!outletId) return;
    setError(null);
    try {
      setData(await api.calendar.month(outletId, month));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  const today = data?.today ?? indiaToday();
  const thisMonth = today.slice(0, 7);
  // While another month or outlet is loading, the grid shows its dates without marks.
  const shown = data && data.month === month && data.outletId === outletId ? data : null;
  const byDate = new Map(shown?.days.map((day) => [day.date, day]));

  const show = (nextMonth: string, date?: string) => {
    setMonth(nextMonth);
    setSelected(date ?? (nextMonth === thisMonth ? today : `${nextMonth}-01`));
  };
  const canGoBack = month > shiftMonth(thisMonth, -CALENDAR_MONTHS_BACK);
  const canGoAhead = month < shiftMonth(thisMonth, CALENDAR_MONTHS_AHEAD);

  // Swiping across the month moves a month, like the arrows. The touch handlers are made
  // once, so they work from the month and day held at that moment rather than from this draw.
  // There is one set for each reading direction: in Urdu the page turns the other way.
  const [swipes] = useState(() => {
    const swipeFor = (sign: 1 | -1) =>
      PanResponder.create({
        // Only a clearly sideways move is taken, so scrolling the page up and down still works.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_event, gesture) => {
          // A finger moving left brings the next month in, as when turning a page
          // (a finger moving right, in Urdu, where pages turn the other way).
          const dx = gesture.dx * sign;
          const by = dx <= -SWIPE_DISTANCE ? 1 : dx >= SWIPE_DISTANCE ? -1 : 0;
          if (by === 0) return;
          setMonth((current) => monthAfterSwipe(current, by));
          // The chosen day is always in the month on show, so it can be moved the same way.
          setSelected((current) => {
            const from = current.slice(0, 7);
            const to = monthAfterSwipe(from, by);
            if (to === from) return current;
            const now = indiaToday();
            return to === now.slice(0, 7) ? now : `${to}-01`;
          });
        },
      });
    return { ltr: swipeFor(1), rtl: swipeFor(-1) };
  });
  const swipe = swipes[direction];

  // After a day is tapped and its details are drawn, scrolls just far enough to show them
  // if they are below the bottom of the screen. The day's title is never pushed off the top.
  useEffect(() => {
    if (!revealDay.current) return;
    revealDay.current = false;
    const scroll = scrollRef.current;
    const panel = dayPanelRef.current;
    // The part of the scrolling area that can be measured. The browser preview may not have it.
    const frame = typeof scroll?.getNativeScrollRef === 'function' ? scroll.getNativeScrollRef() : null;
    if (!scroll || !panel || !frame) return;
    frame.measureInWindow((_x, scrollTop, _width, scrollHeight) => {
      panel.measureInWindow((_panelX, panelTop, _panelWidth, panelHeight) => {
        const hidden = panelTop + panelHeight - (scrollTop + scrollHeight);
        const move = Math.min(hidden, panelTop - scrollTop);
        if (move <= 0) return;
        // Where the page is scrolled to now, worked out from where the panel sits on screen.
        const position = scrollTop + dayPanelY.current - panelTop;
        scroll.scrollTo({ y: position + move, animated: true });
      });
    });
  }, [selected]);

  const licenceName = (licence: CalendarLicenceDto) => licence.name ?? t(`licenceType.${licence.type}`);

  const statusColor: Record<Status, string> = {
    fine: theme.primary,
    attention: theme.warning,
    missed: theme.danger,
    planned: theme.textSecondary,
  };
  const checklistStatus = (checklist: ChecklistRunSummaryDto): Status =>
    checklist.status === 'MISSED'
      ? 'missed'
      : checklist.problemCount > 0
        ? 'attention'
        : checklist.status === 'SUBMITTED'
          ? 'fine'
          : 'planned';
  const visitStatus = (visit: CalendarVisitDto): Status =>
    visit.state === 'DONE' ? 'fine' : visit.state === 'NOT_DONE' ? 'missed' : 'planned';
  // A licence running out needs attention beforehand, and is a miss once the day has gone.
  const licenceStatus = (date: string): Status => (date < today ? 'missed' : 'attention');
  const worst = (statuses: Status[]) => WORST_FIRST.find((status) => statuses.includes(status)) ?? 'planned';

  /** The marks inside a day cell: one per kind of thing, coloured by the worst of that kind. */
  const marksFor = (day: CalendarDayDto): Mark[] => {
    const marks: Mark[] = [];
    if (day.checklists.length > 0) {
      const done = day.checklists.filter((checklist) => checklist.status === 'SUBMITTED').length;
      marks.push({
        kind: 'checklists',
        status: worst(day.checklists.map(checklistStatus)),
        count: `${done}/${day.checklists.length}`,
      });
    }
    if (day.visits.length > 0) marks.push({ kind: 'service', status: worst(day.visits.map(visitStatus)) });
    if (day.licences.length > 0) marks.push({ kind: 'licence', status: licenceStatus(day.date) });
    if (day.holidays.length > 0) marks.push({ kind: 'holiday', status: 'planned' });
    return marks;
  };

  /** A day's marks in words, for a screen reader: "Checklists 2/3, Missed. ECCS service, Done." */
  const marksInWords = (marks: Mark[]) =>
    marks
      .map((mark) => `${t(`hist.${mark.kind}`)}${mark.count ? ` ${mark.count}` : ''}, ${t(`hist.status.${mark.status}`)}`)
      .join('. ');

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

  const slotName = (slot: string | null) => formatSlot(slot, language, t);

  const visitRow = (visit: CalendarVisitDto, date?: string) => (
    <Pressable
      key={visit.id}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/services/[visitId]', params: { visitId: visit.id } })}
      style={[styles.row, { borderColor: theme.border }]}>
      <View style={[styles.stripe, { backgroundColor: statusColor[visitStatus(visit)] }]} />
      <View style={styles.rowText}>
        <ThemedText type="default" style={styles.rowTitle}>
          {localize(visit.service, language)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {[date ? formatDate(date, language) : null, slotName(visit.slot)].filter(Boolean).join(' · ')}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" style={{ color: statusColor[visitStatus(visit)] }}>
        {visit.state === 'DONE' ? '✓ ' : ''}
        {t(`visitState.${visit.state}`)}
      </ThemedText>
    </Pressable>
  );

  const licenceRow = (licence: CalendarLicenceDto, date: string, showDate: boolean) => (
    <Pressable
      key={licence.id}
      accessibilityRole="button"
      onPress={() => outletId && void rememberOutlet(outletId).then(() => router.push('/documents'))}
      style={[styles.row, { borderColor: theme.border }]}>
      <View style={[styles.stripe, { backgroundColor: statusColor[licenceStatus(date)] }]} />
      <View style={styles.rowText}>
        <ThemedText type="default" style={styles.rowTitle}>
          {licenceName(licence)}
        </ThemedText>
        <ThemedText type="small" style={{ color: statusColor[licenceStatus(date)] }}>
          {showDate
            ? t('docs.expires', { date: formatDate(date, language) })
            : t(date < today ? 'hist.licenceExpired' : 'hist.licenceExpires')}
        </ThemedText>
      </View>
    </Pressable>
  );

  return (
    <Screen back scrollRef={scrollRef} onRefresh={reload}>
      {outlets.length > 1 && (
        <View style={styles.outlets} accessibilityRole="radiogroup" accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => choose(outlet.id)}
            />
          ))}
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
          <Ionicons name={backIcon} size={26} color={theme.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('hist.next')}
          disabled={!canGoAhead}
          onPress={() => show(shiftMonth(month, 1))}
          style={[styles.arrow, !canGoAhead && styles.faded]}>
          <Ionicons name={forwardIcon} size={26} color={theme.primary} />
        </Pressable>
      </View>

      <ErrorText message={error} onRetry={() => void reload()} />

      {/* ── The month. Swiping across it changes month, as the arrows do. ── */}
      <View {...swipe.panHandlers}>
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
              const marks = day ? marksFor(day) : [];
              const checklists = marks.find((mark) => mark.kind === 'checklists');
              const others = marks.filter((mark) => mark.kind !== 'checklists');
              const isToday = date === today;
              const isSelected = date === selected;
              return (
                <Pressable
                  key={column}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={[formatDayLong(date, language), marksInWords(marks)].filter(Boolean).join('. ')}
                  onPress={() => {
                    revealDay.current = true;
                    setSelected(date);
                  }}
                  style={[styles.cell, isSelected && { backgroundColor: theme.backgroundElement }]}>
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
                  {/* Checklists get a line of their own, with how many were done out of how many. */}
                  <View style={styles.marks}>
                    {checklists && (
                      <>
                        <Ionicons name={KIND_ICON.checklists} size={12} color={statusColor[checklists.status]} />
                        <ThemedText style={[styles.markCount, { color: statusColor[checklists.status] }]}>
                          {checklists.count}
                        </ThemedText>
                      </>
                    )}
                  </View>
                  <View style={styles.marks}>
                    {others.map((mark) => (
                      <Ionicons
                        key={mark.kind}
                        name={KIND_ICON[mark.kind]}
                        size={13}
                        color={statusColor[mark.status]}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        {(outletLoading || (!shown && !error && outletId)) && (
          <ActivityIndicator color={theme.primary} style={styles.loading} />
        )}
      </View>

      {/* ── What the marks mean: the picture is the kind of thing, the colour is how it stands ── */}
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          {KINDS.map((kind) => (
            <View key={kind} style={styles.legendItem}>
              <Ionicons name={KIND_ICON[kind]} size={14} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">
                {t(`hist.${kind}`)}
              </ThemedText>
            </View>
          ))}
        </View>
        <View style={styles.legendRow}>
          {STATUSES.map((status) => (
            <View key={status} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: statusColor[status] }]} />
              <ThemedText type="small" themeColor="textSecondary">
                {t(`hist.status.${status}`)}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>

      {/* ── The chosen day ── */}
      <View
        ref={dayPanelRef}
        onLayout={(event) => {
          dayPanelY.current = event.nativeEvent.layout.y;
        }}
        style={[styles.dayPanel, { borderColor: theme.border }]}>
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
                <View style={[styles.stripe, { backgroundColor: statusColor[checklistStatus(checklist)] }]} />
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
              visitRow(entry.visit, entry.date)
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
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  month: { flex: 1, fontSize: 24, lineHeight: 32 },
  todayButton: { minHeight: MinTouchSize, justifyContent: 'center', paddingHorizontal: Spacing.two },
  arrow: { minHeight: MinTouchSize, minWidth: MinTouchSize - 8, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.3 },
  week: { flexDirection: 'row' },
  weekRow: { borderTopWidth: StyleSheet.hairlineWidth },
  weekday: { flex: 1, textAlign: 'center', paddingBottom: Spacing.one },
  // 56 tall, so a six-week month, the legend and the start of the day's list fit one phone screen.
  cell: { flex: 1, height: 56, alignItems: 'center', paddingVertical: 2, borderRadius: Spacing.two },
  number: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  numberText: { fontSize: 14, lineHeight: 18, fontWeight: 600 },
  marks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, height: 14 },
  markCount: { fontSize: 11, lineHeight: 14, fontWeight: 700 },
  loading: { position: 'absolute', top: Spacing.five, alignSelf: 'center' },
  legend: { gap: Spacing.one },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
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
  stripe: { position: 'absolute', start: 0, top: 0, bottom: 0, width: 5 },
  rowText: { flex: 1, gap: Spacing.half },
  rowTitle: { fontWeight: 700 },
  sectionGap: { marginTop: Spacing.three },
});
