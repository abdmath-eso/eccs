import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ATTENDANCE_DAY_RULES,
  can,
  type AttendanceDayPersonDto,
  type AttendanceStatus,
  type PunchDto,
  type PunchKind,
  type StaffPunchesDto,
} from '@eccs/shared';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { DayFactsLine, EnrolledMark, FlagList, PUNCH_KIND, PUNCH_METHOD } from '@/components/attendance-parts';
import { DAY_MARK, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { OptionSheet } from '@/components/ui/option-sheet';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDateTime, formatDayLong, formatTimeOfDay } from '@/lib/format';
import { useSession } from '@/lib/session';

// One person's day: its status, every clock-in and clock-out with how it was
// made and its photo, and, for the Owner alone, the corrections.
//
// The corrections follow what attendance products do (Zoho People's
// "regularisation", Jibble's and Truein's time adjustments; see
// research_notes/Face attendance/product-patterns.md section 4): one senior
// person may correct, a reason is always typed, the original punch stays on
// show beside the correction (a wrong punch is struck out, never deleted), and
// who did it is shown afterwards.

const STATUSES: AttendanceStatus[] = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'WEEKLY_OFF'];

interface Loaded {
  month: StaffPunchesDto;
  /** The person's row of the outlet's sheet for this day; null if they were not on the staff that day. */
  person: AttendanceDayPersonDto | null;
  /** Whether this reader may correct this day: the Owner, within the time allowed. */
  editable: boolean;
}

// What the Owner is in the middle of changing, while the reason is being typed.
type Asking =
  | { what: 'status'; status: AttendanceStatus | null }
  | { what: 'void'; punch: PunchDto }
  | { what: 'add' };

/**
 * Reads a time typed as "9:30" or "0930" with am or pm chosen beside it.
 * "14:30" is understood as it stands. Null when it is not a time.
 */
function parseClock(text: string, half: 'AM' | 'PM'): { hours: number; minutes: number } | null {
  const match = /^\s*(\d{1,2})[:.\s]?(\d{2})\s*$/.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 23) return null;
  if (hours >= 13 || hours === 0) return { hours, minutes };
  if (half === 'PM' && hours < 12) hours += 12;
  if (half === 'AM' && hours === 12) hours = 0;
  return { hours, minutes };
}

export default function PersonDayScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const notify = useSnackbar();
  const { staffId, date } = useLocalSearchParams<{ staffId: string; date: string }>();
  const [choosing, setChoosing] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The punch being added.
  const [addKind, setAddKind] = useState<PunchKind>('OUT');
  const [addTime, setAddTime] = useState('');
  const [addHalf, setAddHalf] = useState<'AM' | 'PM'>('PM');
  const [timeError, setTimeError] = useState<string | null>(null);

  const allowed = can(user?.memberships ?? [], 'attendance', 'read');
  const { data, error: loadError, reload } = useLoaded<Loaded>(allowed ? `${staffId}|${date}` : null, async () => {
    const month = await api.attendance.punches(staffId, date.slice(0, 7));
    const sheet = await api.team.day(month.outletId, date);
    return { month, person: sheet.people.find((person) => person.staffId === staffId) ?? null, editable: sheet.editable };
  });

  if (!allowed) return <Redirect href="/" />;

  const person = data?.person ?? null;
  const entries = data?.month.days.find((day) => day.date === date)?.entries ?? [];
  const editable = data?.editable === true && person !== null;
  const time = (iso: string) => formatTimeOfDay(iso, language);

  function ask(next: Asking) {
    setAskError(null);
    setTimeError(null);
    setAsking(next);
  }

  /** Sends the correction the Owner was asked the reason for, then shows the day as the server now has it. */
  async function confirm(reason: string) {
    if (!asking || !data) return;
    let change: () => Promise<unknown>;
    if (asking.what === 'status') {
      change = () => api.attendance.correctDay({ outletId: data.month.outletId, staffId, date, status: asking.status, reason });
    } else if (asking.what === 'void') {
      change = () => api.attendance.voidPunch(asking.punch.id, reason);
    } else {
      const typed = parseClock(addTime, addHalf);
      if (!typed) return setTimeError(t('att.add.badTime'));
      // The attendance day runs from 4 am to 4 am: a time before 4 am belongs to the night of this day,
      // which is the next date on the calendar.
      const calendarDate = typed.hours < ATTENDANCE_DAY_RULES.dayStartsAtHour ? addDays(date, 1) : date;
      const at = `${calendarDate}T${String(typed.hours).padStart(2, '0')}:${String(typed.minutes).padStart(2, '0')}:00+05:30`;
      change = () => api.attendance.addPunch({ staffId, at, kind: addKind, reason });
    }
    setBusy(true);
    setAskError(null);
    try {
      await change();
      setAsking(null);
      setAddTime('');
      notify(t('common.saved'));
      await reload();
    } catch (e) {
      // The server's own refusals here are plain sentences worth showing as they are
      // ("That day is too long ago to change"); anything else gets the app's usual wording.
      setAskError(refusal(e) ?? errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function looksRight(punch: PunchDto) {
    setError(null);
    try {
      await api.attendance.reviewPunch(punch.id);
      await reload();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  const mark = DAY_MARK[person?.status ?? 'NONE'];

  return (
    <Screen back title={data?.month.name} subtitle={formatDayLong(date, language)} onRefresh={reload}>
      <ErrorText message={loadError} onRetry={() => void reload()} />
      {!data && !loadError && <ActivityIndicator color={theme.primary} />}

      {data && !person && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('att.day.notOnStaff')}
        </ThemedText>
      )}

      {/* ── The day's status and what the clock-ins add up to ── */}
      {person && (
        <View style={[styles.card, { borderColor: theme.border }]}>
          <View style={styles.row}>
            <Ionicons name={mark.icon} size={32} color={theme[mark.tone]} />
            <ThemedText type="subtitle" style={styles.status}>
              {t(mark.label)}
            </ThemedText>
          </View>
          <DayFactsLine facts={person} />
          {person.provisional && person.status !== null && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('att.provisional')}
            </ThemedText>
          )}
          {person.source === 'OWNER' && (
            <ThemedText type="small" themeColor="textSecondary">
              {[
                person.markedByName ? t('att.setBy', { name: person.markedByName }) : t('att.setByOwner'),
                person.note ? t('att.reasonWas', { reason: person.note }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          )}
          <FlagList flags={person.flags} />
          {!person.enrolled && <EnrolledMark enrolled={false} />}
        </View>
      )}

      <ErrorText message={error} />

      {/* ── Every clock-in and clock-out, oldest first; a voided one stays on show, struck out ── */}
      {data && (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('att.punches')}
        </ThemedText>
      )}
      {data && entries.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('att.noPunches')}
        </ThemedText>
      )}
      {entries.map((punch) => (
        <View key={punch.id} style={[styles.card, { borderColor: theme.border }]}>
          <View style={styles.row}>
            {punch.photoPath && (
              <Image source={{ uri: api.fileUrl(punch.photoPath) }} style={styles.photo} accessibilityLabel={t('att.punch.photo')} />
            )}
            <View style={styles.flex}>
              <View style={styles.row}>
                <Ionicons name={PUNCH_KIND[punch.kind].icon} size={24} color={punch.voided ? theme.textSecondary : theme.primary} />
                <ThemedText type="default" style={[styles.bold, punch.voided && styles.struck]}>
                  {t(PUNCH_KIND[punch.kind].label)} · {time(punch.at)}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {[t(PUNCH_METHOD[punch.method]), punch.createdByName].filter(Boolean).join(' · ')}
              </ThemedText>
              {punch.note && (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('att.reasonWas', { reason: punch.note })}
                </ThemedText>
              )}
              {punch.flag && !punch.voided && <FlagList flags={[punch.flag]} />}
              {punch.reviewedAt && !punch.voided && punch.flag && (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('att.punch.reviewed', { when: formatDateTime(punch.reviewedAt, language) })}
                </ThemedText>
              )}
              {punch.voided && (
                <ThemedText type="small" themeColor="danger">
                  {[
                    punch.voidedByName && punch.voidedAt
                      ? t('att.punch.voidedBy', { name: punch.voidedByName, when: formatDateTime(punch.voidedAt, language) })
                      : t('att.punch.voided'),
                    punch.voidReason ? t('att.reasonWas', { reason: punch.voidReason }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
              )}
            </View>
          </View>
          {editable && !punch.voided && (
            <View style={styles.actions}>
              {punch.flag && !punch.reviewedAt && (
                <View style={styles.flex}>
                  <Button fill variant="secondary" icon="checkmark-circle-outline" label={t('att.looksRight')} onPress={() => void looksRight(punch)} />
                </View>
              )}
              <View style={styles.flex}>
                <Button fill variant="danger" icon="close-circle-outline" label={t('att.void')} onPress={() => ask({ what: 'void', punch })} />
              </View>
            </View>
          )}
        </View>
      ))}

      {/* ── The Owner's corrections ── */}
      {editable && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.heading}>
            {t('att.correct.title')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('att.correct.help')}
          </ThemedText>
          <Button variant="secondary" icon="add-circle-outline" label={t('att.add.title')} onPress={() => ask({ what: 'add' })} />
          <Button variant="secondary" icon="create-outline" label={t('att.status.change')} onPress={() => setChoosing(true)} />
        </>
      )}
      {data && person && !data.editable && can(user?.memberships ?? [], 'attendance', 'update') && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('team.att.locked')}
        </ThemedText>
      )}

      <OptionSheet
        visible={choosing}
        title={t('att.status.change')}
        onClose={() => setChoosing(false)}
        options={[
          ...STATUSES.map((status) => ({
            label: t(DAY_MARK[status].label),
            icon: DAY_MARK[status].icon,
            onPress: () => {
              setChoosing(false);
              ask({ what: 'status', status });
            },
          })),
          // Taking the Owner's own entry away puts the day back to what the clock-ins say.
          ...(person?.source === 'OWNER'
            ? [
                {
                  label: t('att.status.back'),
                  icon: 'refresh' as const,
                  onPress: () => {
                    setChoosing(false);
                    ask({ what: 'status', status: null });
                  },
                },
              ]
            : []),
        ]}
      />

      {asking && (
        <ReasonDialog
          title={
            asking.what === 'status'
              ? asking.status
                ? t('att.status.setTo', { status: t(DAY_MARK[asking.status].label) })
                : t('att.status.back')
              : asking.what === 'void'
                ? t('att.void.title', { kind: t(PUNCH_KIND[asking.punch.kind].label), time: time(asking.punch.at) })
                : t('att.add.title')
          }
          message={asking.what === 'void' ? t('att.void.help') : asking.what === 'add' ? t('att.add.help') : undefined}
          confirmLabel={t(asking.what === 'void' ? 'att.void' : 'team.save')}
          danger={asking.what === 'void'}
          busy={busy}
          error={askError}
          onCancel={() => setAsking(null)}
          onConfirm={(reason) => void confirm(reason)}>
          {asking.what === 'add' && (
            <>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {(['IN', 'OUT'] as const).map((kind) => (
                  <OptionChip key={kind} label={t(PUNCH_KIND[kind].label)} selected={addKind === kind} onPress={() => setAddKind(kind)} />
                ))}
              </View>
              <TextField
                label={t('att.add.time')}
                value={addTime}
                onChangeText={(next) => {
                  setAddTime(next);
                  setTimeError(null);
                }}
                keyboardType="numbers-and-punctuation"
                placeholder="9:30"
                maxLength={5}
                error={timeError}
              />
              <View style={styles.chips} accessibilityRole="radiogroup">
                {(['AM', 'PM'] as const).map((half) => (
                  <OptionChip key={half} label={t(`att.add.${half}`)} selected={addHalf === half} onPress={() => setAddHalf(half)} />
                ))}
              </View>
            </>
          )}
        </ReasonDialog>
      )}
    </Screen>
  );
}

/** The server's own sentence for a correction it refused (a 400 or 409), which says exactly what is wrong. */
function refusal(e: unknown): string | null {
  if (typeof e !== 'object' || e === null || !('status' in e) || !('message' in e)) return null;
  const { status, message } = e as { status: unknown; message: unknown };
  return (status === 400 || status === 409) && typeof message === 'string' ? message : null;
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: Spacing.half },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  status: { flex: 1, fontSize: 24, lineHeight: 30 },
  bold: { fontWeight: 700 },
  struck: { textDecorationLine: 'line-through' },
  photo: { width: 72, height: 72, borderRadius: Spacing.two },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  heading: { marginTop: Spacing.two },
});
