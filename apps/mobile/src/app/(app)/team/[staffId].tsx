import Ionicons from '@expo/vector-icons/Ionicons';
import {
  can,
  daysInMonth,
  shiftMonth,
  weekdayOf,
  worksOn,
  type FaceStatusDto,
  type StaffMonthDto,
} from '@eccs/shared';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { EnrolledMark } from '@/components/attendance-parts';
import { countsOf, DAY_MARK, DayCounts, MonthStepper, useLoaded, type DayMark } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
import { useDirection } from '@/lib/direction';
import { formatDate, formatDayLong, indiaToday, weekdayNames } from '@/lib/format';
import { useSession } from '@/lib/session';

const MONTHS_BACK = 12;

/**
 * One person's record: their month as a calendar with a picture on each day,
 * the totals, and the way into their pay. The pictures come from their
 * clock-ins and clock-outs; tapping a day opens it, with each punch and, for
 * the Owner, the corrections.
 */
export default function PersonRecordScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const params = useLocalSearchParams<{ staffId: string; month?: string }>();
  const [month, setMonth] = useState(() => params.month ?? indiaToday().slice(0, 7));
  const { forwardIcon } = useDirection();

  const memberships = user?.memberships ?? [];
  const allowed = can(memberships, 'attendance', 'read');
  const { data, error, reload } = useLoaded<StaffMonthDto>(allowed ? `${params.staffId}|${month}` : null, () =>
    api.team.personMonth(params.staffId, month),
  );
  // Whether their face is enrolled, for the Owner and Manager. If it cannot be read the row still opens.
  const seesFace = can(memberships, 'staff', 'update');
  const { data: face } = useLoaded<FaceStatusDto | null>(seesFace ? `face|${params.staffId}` : null, () =>
    api.team.faceStatus(params.staffId).catch(() => null),
  );

  if (!allowed) return <Redirect href="/" />;

  const today = data?.today ?? indiaToday();
  const thisMonth = today.slice(0, 7);
  const staff = data?.staff;

  /** What a day shows: its mark, the usual day off where nothing was marked, or nothing yet. Null for a day that does not count. */
  const markOn = (date: string): { mark: DayMark; assumed: boolean } | null => {
    // Days before the person joined (or was added, when they have no joining date) are not theirs.
    if (!data || date > today || !worksOn({ joinedOn: data.staff.countedFrom, leftOn: data.staff.leftOn }, date)) return null;
    const status = data.marks[date];
    if (status) return { mark: status, assumed: false };
    return weekdayOf(date) === data.staff.weeklyOffDay ? { mark: 'WEEKLY_OFF', assumed: true } : { mark: 'NONE', assumed: false };
  };
  /** True when the day has something for the Owner to look at: a mark on a punch, or a status still to be settled. */
  const needsLook = (date: string) => {
    const day = data?.days[date];
    return day !== undefined && (day.flags.length > 0 || (day.provisional && date < today));
  };

  // The month laid out in weeks starting on Sunday, as on the service calendar.
  const cells: (number | null)[] = [
    ...Array.from({ length: weekdayOf(`${month}-01`) }, () => null),
    ...Array.from({ length: daysInMonth(month) }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));

  // Job, pay and leaving date as one line under the name ("Waiter · ₹18,000 a month"), as a contact card
  // puts a person's details under their name, rather than three lines spaced apart (22 Oct 2026).
  const details = staff
    ? [
        staff.jobTitle,
        staff.pay
          ? t(staff.pay.payType === 'DAILY' ? 'team.pay.perDay' : 'team.pay.perMonth', { amount: formatMoney(staff.pay.payPaise, language) })
          : null,
        staff.leftOn ? t('team.people.leftOn', { date: formatDate(staff.leftOn, language) }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  // Whether any day this month carries the "needs a look" sign, to explain it beside the totals.
  const anyLook = data ? Object.keys(data.days).some(needsLook) : false;

  return (
    <Screen back title={staff?.name} subtitle={details || undefined} onRefresh={reload}>

      {/* The day their attendance and pay count from. Someone added before joining dates were asked for has
          none, and is counted from the day they were added; the Owner can put the real date in. */}
      {staff && (
        <View style={styles.startRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.noteText}>
            {t(staff.joinedOn ? 'team.record.joinedOn' : 'team.record.countedFrom', { date: formatDate(staff.countedFrom, language) })}
          </ThemedText>
          {can(memberships, 'attendance', 'update') && (
            <Button
              variant="link"
              label={t('team.record.changeStart')}
              onPress={() => router.push({ pathname: '/team/person', params: { staffId: staff.id } })}
            />
          )}
        </View>
      )}

      {/* The reader's own record: theirs to read, the Owner's to change. Said first, so nothing below surprises. */}
      {staff?.selfLocked && <Notice tone="info" text={t('team.self.locked')} />}

      <MonthStepper month={month} thisMonth={thisMonth} earliest={shiftMonth(thisMonth, -MONTHS_BACK)} onChange={setMonth} />
      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}

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
              const shown = markOn(date);
              const open = shown !== null;
              const look = needsLook(date);
              return (
                <Pressable
                  key={column}
                  accessibilityRole={open ? 'button' : 'text'}
                  accessibilityLabel={[formatDayLong(date, language), shown ? t(DAY_MARK[shown.mark].label) : null, look ? t('att.needsLook') : null]
                    .filter(Boolean)
                    .join('. ')}
                  disabled={!open}
                  onPress={() => router.push({ pathname: '/team/day', params: { staffId: params.staffId, date } })}
                  style={({ pressed }) => [styles.cell, pressed && { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText
                    type="small"
                    style={[styles.number, date === today && styles.todayNumber, { color: shown ? theme.text : theme.textSecondary }, !shown && styles.faded]}>
                    {dayNumber}
                  </ThemedText>
                  {shown && (
                    <Ionicons
                      name={DAY_MARK[shown.mark].icon}
                      size={22}
                      color={theme[DAY_MARK[shown.mark].tone]}
                      // The usual day off, where nobody marked anything, is drawn paler than a mark someone made.
                      style={shown.assumed && styles.assumed}
                    />
                  )}
                  {/* A small warning sign in the corner: something on this day is waiting to be looked at. */}
                  {look && <Ionicons name="alert-circle" size={14} color={theme.warning} style={styles.look} />}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {data && (
        <>
          {/* The totals double as the key to the pictures: each has its picture, word and count. */}
          <DayCounts counts={countsOf(data.totals)} all />
          {/* The small orange sign in a day's corner, in the key as well. */}
          {anyLook && (
            <View style={styles.lookKey}>
              <Ionicons name="alert-circle" size={18} color={theme.warning} />
              <ThemedText type="small" themeColor="textSecondary">
                {t('att.needsLook')}
              </ThemedText>
            </View>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {t('att.month.tapDay')}
          </ThemedText>

          {/* Their face for attendance: where it stands, and for the Owner the way to add or remove it. */}
          {seesFace && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/team/face', params: { staffId: data.staff.id } })}
              style={({ pressed }) => [styles.faceRow, { borderTopColor: theme.border, borderBottomColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="scan-circle-outline" size={28} color={theme.primary} />
              <View style={styles.noteText}>
                <ThemedText type="default" style={styles.bold}>
                  {t('face.title')}
                </ThemedText>
                {face && <EnrolledMark enrolled={face.enrolled} />}
              </View>
              <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
            </Pressable>
          )}

          {/* The light tie to hygiene: only for someone who has their own app login. */}
          {data.checklistsHandedIn !== null && (
            <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="checkbox" size={22} color={theme.primary} />
              <ThemedText type="default" style={styles.noteText}>
                {t('team.record.checklists', { count: data.checklistsHandedIn })}
              </ThemedText>
            </View>
          )}

          {can(memberships, 'salary', 'read') && (
            <Button
              icon="wallet-outline"
              label={t('team.record.pay')}
              onPress={() => router.push({ pathname: '/team/pay', params: { staffId: data.staff.id, month } })}
            />
          )}
          {can(memberships, 'staff', 'update') && !data.staff.selfLocked && (
            <Button
              variant="secondary"
              icon="create-outline"
              label={t('team.person.edit')}
              onPress={() => router.push({ pathname: '/team/person', params: { staffId: data.staff.id } })}
            />
          )}
        </>
      )}

    </Screen>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row' },
  weekRow: { borderTopWidth: StyleSheet.hairlineWidth },
  weekday: { flex: 1, textAlign: 'center', paddingBottom: Spacing.one },
  cell: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', gap: Spacing.half, borderRadius: Spacing.two },
  number: { fontSize: 13, lineHeight: 16, fontWeight: 600 },
  todayNumber: { textDecorationLine: 'underline', fontWeight: 800 },
  faded: { opacity: 0.5 },
  assumed: { opacity: 0.45 },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Spacing.three, padding: Spacing.three },
  noteText: { flex: 1 },
  bold: { fontWeight: 700 },
  look: { position: 'absolute', top: Spacing.one, end: Spacing.one },
  faceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    // A plain row between two thin lines, like the rows of the Staff screen, not one more box.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
  },
  startRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  lookKey: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
