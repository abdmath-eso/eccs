import { can, type AttendanceSettingsDto } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { OutletChips, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/** Minutes as hours for typing: 480 is "8", 510 is "8.5". */
const typedHours = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);

/** Hours typed ("8", "8.5", "8,5") as whole minutes, or null if it is not a number. */
function parseHours(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 60);
}

/**
 * How many hours make a full day and a half day at this outlet. The Owner sets
 * them; the Manager can see them. Eight and four hours are where attendance
 * products usually start (SalaryBox and Zoho People both use them as their example).
 */
export default function AttendanceSettingsScreen() {
  const theme = useTheme();
  const { t, api, user } = useSession();
  const { outletId, outlets, choose } = useOutlet();

  const memberships = user?.memberships ?? [];
  const allowed = can(memberships, 'attendance', 'read');
  const isOwner = can(memberships, 'attendance', 'update');
  const { data, error, reload } = useLoaded<AttendanceSettingsDto>(allowed && outletId ? outletId : null, () => api.attendance.settings(outletId!));

  if (!allowed) return <Redirect href="/" />;

  return (
    <Screen back title={t('att.settings.title')} subtitle={t('att.settings.how', { hour: data?.dayStartsAtHour ?? 4 })}>
      <OutletChips outlets={outlets} outletId={outletId} onChoose={choose} />
      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}
      {/* A fresh form for each outlet, so one outlet's hours are never saved to another. */}
      {data && <HoursForm key={data.outletId} settings={data} editable={isOwner} />}
    </Screen>
  );
}

function HoursForm({ settings, editable }: { settings: AttendanceSettingsDto; editable: boolean }) {
  const { t, api } = useSession();
  const notify = useSnackbar();
  const [full, setFull] = useState(typedHours(settings.fullDayMinutes));
  const [half, setHalf] = useState(typedHours(settings.halfDayMinutes));
  const [errors, setErrors] = useState<{ full?: string; half?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const fullDayMinutes = parseHours(full);
    const halfDayMinutes = parseHours(half);
    // The same limits the server keeps: a full day of 1 to 16 hours, a half day of half an hour to 12, and shorter than the full day.
    const found = {
      ...((fullDayMinutes === null || fullDayMinutes < 60 || fullDayMinutes > 16 * 60) && { full: t('att.settings.badFull') }),
      ...((halfDayMinutes === null || halfDayMinutes < 30 || halfDayMinutes > 12 * 60) && { half: t('att.settings.badHalf') }),
    };
    if (!found.half && fullDayMinutes !== null && halfDayMinutes !== null && halfDayMinutes >= fullDayMinutes) {
      found.half = t('att.settings.halfShorter');
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || fullDayMinutes === null || halfDayMinutes === null) return;

    setBusy(true);
    setSaveError(null);
    try {
      await api.attendance.saveSettings(settings.outletId, { fullDayMinutes, halfDayMinutes });
      notify(t('common.saved'));
      router.back();
    } catch (e) {
      setSaveError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TextField
        label={t('att.settings.full')}
        value={full}
        onChangeText={(text) => {
          setFull(text);
          setErrors((current) => ({ ...current, full: undefined }));
        }}
        keyboardType="decimal-pad"
        editable={editable}
        hint={t('att.settings.fullHint')}
        error={errors.full}
      />
      <TextField
        label={t('att.settings.half')}
        value={half}
        onChangeText={(text) => {
          setHalf(text);
          setErrors((current) => ({ ...current, half: undefined }));
        }}
        keyboardType="decimal-pad"
        editable={editable}
        hint={t('att.settings.halfHint')}
        error={errors.half}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {t(editable ? 'att.settings.applies' : 'att.settings.ownerOnly')}
      </ThemedText>
      <ErrorText message={saveError} />
      {editable && <Button label={t('team.save')} loading={busy} onPress={() => void save()} />}
    </>
  );
}
