import Ionicons from '@expo/vector-icons/Ionicons';
import { can, type AttendanceReviewDto, type PunchDto } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { DayFactsLine, FlagList, PUNCH_KIND, PUNCH_METHOD } from '@/components/attendance-parts';
import { DAY_MARK, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDayLong, formatTimeOfDay } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/**
 * What is waiting for the Owner: clock-ins the camera was unsure of, ones a
 * Manager vouched for, and days that cannot be counted by themselves (no
 * clock-out, a very short day). Each is shown with its photo where there is
 * one, as time clocks that keep a photo with every punch do (Jibble flags a
 * doubtful entry for the manager to look at). The Manager can read the list;
 * only the Owner can settle anything.
 */
export default function AttendanceReviewScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const notify = useSnackbar();
  const { outletId, outlets, choose } = useOutlet();
  const [voiding, setVoiding] = useState<PunchDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const memberships = user?.memberships ?? [];
  const allowed = can(memberships, 'attendance', 'read');
  const isOwner = can(memberships, 'attendance', 'update');
  const { data, error: loadError, reload } = useLoaded<AttendanceReviewDto>(allowed && outletId ? outletId : null, () =>
    api.attendance.review(outletId!),
  );

  if (!allowed) return <Redirect href="/" />;

  async function looksRight(punch: PunchDto) {
    setBusy(punch.id);
    setError(null);
    try {
      await api.attendance.reviewPunch(punch.id);
      await reload();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function voidPunch(punch: PunchDto, reason: string) {
    setBusy(punch.id);
    setVoidError(null);
    try {
      await api.attendance.voidPunch(punch.id, reason);
      setVoiding(null);
      notify(t('common.saved'));
      await reload();
    } catch (e) {
      setVoidError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  const openDay = (staffId: string, date: string) => router.push({ pathname: '/team/day', params: { staffId, date } });
  const nothing = data !== null && data.punches.length === 0 && data.days.length === 0;

  return (
    <Screen back title={t('att.review.title')} subtitle={t(isOwner ? 'att.review.help' : 'att.review.helpReadOnly')} onRefresh={reload}>
      <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />
      <ErrorText message={loadError} onRetry={() => void reload()} />
      <ErrorText message={error} />
      {!data && !loadError && <ActivityIndicator color={theme.primary} />}

      {nothing && (
        <View style={styles.empty}>
          <Ionicons name="checkmark-done-circle-outline" size={56} color={theme.primary} />
          <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
            {t('att.review.empty')}
          </ThemedText>
        </View>
      )}

      {/* ── Clock-ins and clock-outs to look at ── */}
      {data && data.punches.length > 0 && (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('att.review.punches', { count: data.punches.length })}
        </ThemedText>
      )}
      {data?.punches.map((punch) => (
        <View key={punch.id} style={[styles.card, { borderColor: theme.border }]}>
          <View style={styles.row}>
            {punch.photoPath ? (
              <Image source={{ uri: api.fileUrl(punch.photoPath) }} style={styles.photo} accessibilityLabel={t('att.punch.photo')} />
            ) : (
              <View style={[styles.photo, styles.noPhoto, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="image-outline" size={28} color={theme.textSecondary} />
              </View>
            )}
            <View style={styles.flex}>
              <ThemedText type="default" style={styles.bold}>
                {punch.staffName}
              </ThemedText>
              <View style={styles.row}>
                <Ionicons name={PUNCH_KIND[punch.kind].icon} size={20} color={theme.primary} />
                <ThemedText type="default" style={styles.flexText}>
                  {t(PUNCH_KIND[punch.kind].label)} · {formatTimeOfDay(punch.at, language)}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {[formatDayLong(punch.day, language), t(PUNCH_METHOD[punch.method]), punch.createdByName].filter(Boolean).join(' · ')}
              </ThemedText>
              {punch.flag && <FlagList flags={[punch.flag]} />}
            </View>
          </View>
          {isOwner && (
            <View style={styles.actions}>
              <View style={styles.flexButton}>
                <Button
                  fill
                  variant="secondary"
                  icon="checkmark-circle-outline"
                  label={t('att.looksRight')}
                  loading={busy === punch.id}
                  disabled={busy !== null}
                  onPress={() => void looksRight(punch)}
                />
              </View>
              <View style={styles.flexButton}>
                <Button
                  fill
                  variant="danger"
                  icon="close-circle-outline"
                  label={t('att.void')}
                  disabled={busy !== null}
                  onPress={() => {
                    setVoidError(null);
                    setVoiding(punch);
                  }}
                />
              </View>
            </View>
          )}
          <Button variant="link" label={t(isOwner ? 'att.review.fixDay' : 'att.review.openDay')} onPress={() => openDay(punch.staffId, punch.day)} />
        </View>
      ))}

      {/* ── Days that cannot be counted without the Owner ── */}
      {data && data.days.length > 0 && (
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.heading}>
          {t('att.review.days', { count: data.days.length })}
        </ThemedText>
      )}
      {data?.days.map((day) => {
        const mark = DAY_MARK[day.status ?? 'NONE'];
        return (
          <View key={`${day.staffId}|${day.date}`} style={[styles.card, { borderColor: theme.border }]}>
            <ThemedText type="default" style={styles.bold}>
              {day.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatDayLong(day.date, language)}
            </ThemedText>
            <View style={styles.row}>
              <Ionicons name={mark.icon} size={20} color={theme[mark.tone]} />
              <ThemedText type="smallBold">{t(mark.label)}</ThemedText>
              {day.provisional && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.flexText}>
                  {t('att.provisional')}
                </ThemedText>
              )}
            </View>
            <DayFactsLine facts={day} />
            <FlagList flags={day.flags} />
            <Button
              variant="secondary"
              icon={isOwner ? 'create-outline' : 'eye-outline'}
              label={t(isOwner ? 'att.review.fixDay' : 'att.review.openDay')}
              onPress={() => openDay(day.staffId, day.date)}
            />
          </View>
        );
      })}

      {voiding && (
        <ReasonDialog
          title={t('att.void.title', { kind: t(PUNCH_KIND[voiding.kind].label), time: formatTimeOfDay(voiding.at, language) })}
          message={t('att.void.help')}
          confirmLabel={t('att.void')}
          danger
          busy={busy === voiding.id}
          error={voidError}
          onCancel={() => setVoiding(null)}
          onConfirm={(reason) => void voidPunch(voiding, reason)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: Spacing.half },
  flexText: { flexShrink: 1 },
  flexButton: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  photo: { width: 88, height: 88, borderRadius: Spacing.two },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.two },
  bold: { fontWeight: 700 },
  center: { textAlign: 'center' },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  heading: { marginTop: Spacing.two },
});
