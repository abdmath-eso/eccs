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
  type VisitStatus,
} from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, View, type ScrollView } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Expandable } from '@/components/ui/expandable';
import { ListRow } from '@/components/ui/list-row';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { StatusChip } from '@/components/ui/status-chip';
import { VisitStatusBadge } from '@/components/visit-card';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDayLong, formatDayShort, formatMonth, formatSlot, indiaToday, weekdayNames } from '@/lib/format';
import { useDirection } from '@/lib/direction';
import { useSession } from '@/lib/session';
import { rememberOutlet, useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** A calendar visit, with the visit's own status once the server sends it (see `visitBadge`). */
type CalendarVisit = CalendarVisitDto & { status?: VisitStatus };

// What a mark in a day cell is about. The picture says the kind of thing and nothing else: the
// checklists' clipboard has no tick in it (until 22 Oct 2026 a ticked box beside a red "0/3" read as "done").
const KINDS = ['checklists', 'service', 'licence', 'holiday'] as const;
type Kind = (typeof KINDS)[number];
const KIND_ICON: Record<Kind, IconName> = {
  checklists: 'clipboard',
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
  // One of today's past its due time is red, as Home's count and the "Overdue" label are.
  const checklistStatus = (checklist: ChecklistRunSummaryDto): Status =>
    checklist.status === 'MISSED' || checklist.isOverdue
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
  // "Coming up" starts tomorrow: today's visits and licences are on today, which is chosen when the screen opens.
  const upcoming = data?.upcoming.filter((entry) => entry.date > today) ?? [];
  const nothingOnDay =
    !selectedDay ||
    selectedDay.checklists.length +
      selectedDay.visits.length +
      selectedDay.licences.length +
      selectedDay.holidays.length ===
      0;

  const slotName = (slot: string | null) => formatSlot(slot, language, t);

  /**
   * A visit's state in the shared label, worded as Services words it ("Supervisor assigned", "Not
   * done"), so the two screens say the same thing. The visit's own status is used when the server
   * sends it; until then the calendar's coarser state stands in for it.
   */
  const visitBadge = (visit: CalendarVisit) => {
    // The visit's own status first: a past visit ECCS is still checking is not "Not done". Only one
    // that never started on its day is (the same rule as Services, `visitMissed`).
    if (visit.status) {
      const missed = visit.state === 'NOT_DONE' && (visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED');
      return <VisitStatusBadge status={visit.status} missed={missed} />;
    }
    if (visit.state === 'NOT_DONE') return <VisitStatusBadge status="SCHEDULED" missed />;
    if (visit.state === 'DONE') return <StatusChip tone="good" icon="checkmark" label={t('visitState.DONE')} />;
    return <VisitStatusBadge status={visit.state === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'SCHEDULED'} />;
  };

  // Plain rows with thin lines between them (Material 3 lists), the state label under the title,
  // never beside it, so a long word in another language does not squeeze the name.
  const visitRow = (visit: CalendarVisit, divider: boolean, date?: string) => (
    <ListRow
      key={visit.id}
      divider={divider}
      title={localize(visit.service, language)}
      subtitle={[date ? formatDayShort(date, language) : null, slotName(visit.slot)].filter(Boolean).join(' · ')}
      below={visitBadge(visit)}
      onPress={() => router.push({ pathname: '/services/[visitId]', params: { visitId: visit.id } })}
    />
  );

  const licenceRow = (licence: CalendarLicenceDto, date: string, showDate: boolean, divider: boolean) => (
    <ListRow
      key={licence.id}
      divider={divider}
      title={licenceName(licence)}
      below={
        <StatusChip
          tone={date < today ? 'bad' : 'warn'}
          icon={date < today ? 'alert' : 'hourglass-outline'}
          label={
            showDate
              ? t('docs.expires', { date: formatDate(date, language) })
              : t(date < today ? 'hist.licenceExpired' : 'hist.licenceExpires')
          }
        />
      }
      onPress={() => outletId && void rememberOutlet(outletId).then(() => router.push('/documents'))}
    />
  );

  return (
    <Screen back title={t('tab.calendar')} scrollRef={scrollRef} onRefresh={reload}>
      <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />

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

      {/* ── What the marks mean, folded away once learnt so the chosen day comes straight after the
          month: the picture is the kind of thing, the colour is how it stands ── */}
      <Expandable title={t('hist.legend')} icon="information-circle-outline">
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
      </Expandable>

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

        {/* Each heading has room above it, as "Coming up" does, so it sits with its own rows. */}
        {selectedDay && selectedDay.checklists.length > 0 && (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
              {t('hist.checklists')}
            </ThemedText>
            <View>
              {selectedDay.checklists.map((checklist, index) => (
                <ListRow
                  key={checklist.id}
                  divider={index > 0}
                  title={localize(checklist.title, language)}
                  subtitle={[
                    t('checklists.progress', { done: checklist.doneCount, total: checklist.itemCount }),
                    checklist.submittedByName,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  below={
                    <>
                      <StatusBadge status={checklist.status} reviewed={checklist.reviewedAt !== null} overdue={checklist.isOverdue} />
                      {checklist.problemCount > 0 && (
                        <ThemedText type="small" themeColor="danger">
                          {t('checklists.problems', { count: checklist.problemCount })}
                        </ThemedText>
                      )}
                    </>
                  }
                  onPress={() => router.push({ pathname: '/checklists/[runId]', params: { runId: checklist.id } })}
                />
              ))}
            </View>
          </>
        )}

        {selectedDay && selectedDay.visits.length > 0 && (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
              {t('hist.services')}
            </ThemedText>
            <View>{selectedDay.visits.map((visit, index) => visitRow(visit, index > 0))}</View>
          </>
        )}

        {selectedDay && selectedDay.licences.length > 0 && (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
              {t('hist.licences')}
            </ThemedText>
            <View>{selectedDay.licences.map((licence, index) => licenceRow(licence, selected, false, index > 0))}</View>
          </>
        )}
      </View>

      {/* ── What is coming after today, whichever month is open (today's own are in the day above when it is chosen) ── */}
      {data && data.outletId === outletId && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('hist.upcoming')}
          </ThemedText>
          {upcoming.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('hist.noUpcoming')}
            </ThemedText>
          )}
          <View>
            {upcoming.map((entry, index) =>
              entry.kind === 'visit'
                ? visitRow(entry.visit, index > 0, entry.date)
                : licenceRow(entry.licence, entry.date, true, index > 0),
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  rowTitle: { fontWeight: 700 },
  sectionGap: { marginTop: Spacing.three },
});
