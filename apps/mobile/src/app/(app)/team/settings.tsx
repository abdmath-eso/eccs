import Ionicons from '@expo/vector-icons/Ionicons';
import { can, isSalaryDivisor, SALARY_DIVISOR_PRESETS, STAFF_RULES, type AttendanceSettingsDto } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { OutletChips, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
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

/** Which way of dividing a month's salary is chosen: the month's own days, one of the usual fixed numbers, or the Owner's own. */
type DivisorChoice = 'CALENDAR' | 'OTHER' | (typeof SALARY_DIVISOR_PRESETS)[number];

const choiceOf = (days: number | null): DivisorChoice =>
  days === null ? 'CALENDAR' : (SALARY_DIVISOR_PRESETS.find((preset) => preset === days) ?? 'OTHER');

/**
 * The outlet's attendance and pay settings. The Owner sets them; the Manager
 * can see them.
 *
 * Hours: how many make a full day and a half day. Eight and four hours are
 * where attendance products usually start (SalaryBox and Zoho People both use
 * them as their example).
 *
 * Pay days: the number a month's salary is divided by to get one day's pay.
 * The choices are the ones Indian payroll products offer: the actual days of
 * the month (Zoho Payroll, RazorpayX, greytHR's examples), a fixed 30, a fixed
 * 26 (SalaryBox's "30-Day Month" and "26-Day Month"), or any fixed number
 * (Keka: "any fixed value from 20-31 days"). Each choice says what it means
 * with a sum in rupees, because the words alone ("calendar days") mean little
 * to someone who has not run payroll.
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
    <Screen back title={t('att.settings.title')}>
      <OutletChips outlets={outlets} outletId={outletId} onChoose={choose} />
      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}
      {/* A fresh form for each outlet, so one outlet's settings are never saved to another. */}
      {data && <SettingsForm key={data.outletId} settings={data} editable={isOwner} />}
    </Screen>
  );
}

function SettingsForm({ settings, editable }: { settings: AttendanceSettingsDto; editable: boolean }) {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const [full, setFull] = useState(typedHours(settings.fullDayMinutes));
  const [half, setHalf] = useState(typedHours(settings.halfDayMinutes));
  const [choice, setChoice] = useState<DivisorChoice>(choiceOf(settings.salaryDivisorDays));
  const [other, setOther] = useState(choiceOf(settings.salaryDivisorDays) === 'OTHER' ? String(settings.salaryDivisorDays) : '');
  const [errors, setErrors] = useState<{ full?: string; half?: string; other?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const range = { min: STAFF_RULES.divisorMin, max: STAFF_RULES.divisorMax };
  const money = (paise: number) => formatMoney(paise, language);
  // The sums shown under each choice: a round salary divided by that many days.
  const example = (salaryRupees: number, days: number) => ({
    salary: money(salaryRupees * 100),
    rate: money(Math.round((salaryRupees * 100) / days)),
  });

  async function save() {
    const fullDayMinutes = parseHours(full);
    const halfDayMinutes = parseHours(half);
    const otherDays = /^\d{1,2}$/.test(other.trim()) ? Number(other.trim()) : null;
    // The same limits the server keeps: a full day of 1 to 16 hours, a half day of half an hour to 12 and
    // shorter than the full day, and a divisor that is a whole number of days from 20 to 31.
    const found: { full?: string; half?: string; other?: string } = {
      ...((fullDayMinutes === null || fullDayMinutes < 60 || fullDayMinutes > 16 * 60) && { full: t('att.settings.badFull') }),
      ...((halfDayMinutes === null || halfDayMinutes < 30 || halfDayMinutes > 12 * 60) && { half: t('att.settings.badHalf') }),
      ...(choice === 'OTHER' && (otherDays === null || !isSalaryDivisor(otherDays)) && { other: t('att.divisor.bad', range) }),
    };
    if (!found.half && fullDayMinutes !== null && halfDayMinutes !== null && halfDayMinutes >= fullDayMinutes) {
      found.half = t('att.settings.halfShorter');
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || fullDayMinutes === null || halfDayMinutes === null) return;
    const salaryDivisorDays = choice === 'CALENDAR' ? null : choice === 'OTHER' ? otherDays : choice;

    setBusy(true);
    setSaveError(null);
    try {
      await api.attendance.saveSettings(settings.outletId, { fullDayMinutes, halfDayMinutes, salaryDivisorDays });
      notify(t('common.saved'));
      router.back();
    } catch (e) {
      setSaveError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  /** One choice: a radio mark, its name, and a sentence with a sum in rupees saying what it means. */
  const option = (value: DivisorChoice, title: string, hint: string) => {
    const selected = choice === value;
    return (
      <Pressable
        key={String(value)}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected, disabled: !editable }}
        disabled={!editable}
        onPress={() => {
          setChoice(value);
          setErrors((current) => ({ ...current, other: undefined }));
        }}
        style={({ pressed }) => [styles.option, { borderTopColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={26} color={selected ? theme.primary : theme.textSecondary} />
        <View style={styles.optionText}>
          <ThemedText type="default" style={selected && styles.bold}>
            {title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        </View>
      </Pressable>
    );
  };

  return (
    <>
      {/* ── Hours ── */}
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('att.settings.hours')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('att.settings.how', { hour: settings.dayStartsAtHour })}
      </ThemedText>
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

      {/* ── The days a month's salary is divided by ── */}
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.heading}>
        {t('att.divisor.title')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('att.divisor.help')}
      </ThemedText>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('att.divisor.title')}>
        {option(
          'CALENDAR',
          t('att.divisor.calendar'),
          t('att.divisor.calendarHint', {
            salary: example(30000, 30).salary,
            rate30: example(30000, 30).rate,
            rate31: example(30000, 31).rate,
            rate28: example(30000, 28).rate,
          }),
        )}
        {option(30, t('att.divisor.fixed', { days: 30 }), t('att.divisor.fixed30Hint', example(30000, 30)))}
        {option(26, t('att.divisor.fixed', { days: 26 }), t('att.divisor.fixed26Hint', example(26000, 26)))}
        {option('OTHER', t('att.divisor.other'), t('att.divisor.otherHint', { ...range, ...example(28000, 28) }))}
      </View>
      {choice === 'OTHER' && (
        <TextField
          label={t('att.divisor.otherLabel')}
          value={other}
          onChangeText={(text) => {
            setOther(text.replace(/[^0-9]/g, ''));
            setErrors((current) => ({ ...current, other: undefined }));
          }}
          keyboardType="number-pad"
          maxLength={2}
          editable={editable}
          error={errors.other}
        />
      )}
      <ThemedText type="small" themeColor="textSecondary">
        {t('att.divisor.kept')}
      </ThemedText>

      <ThemedText type="small" themeColor="textSecondary">
        {t(editable ? 'att.settings.applies' : 'att.settings.ownerOnly')}
      </ThemedText>
      <ErrorText message={saveError} />
      {editable && <Button label={t('team.save')} loading={busy} onPress={() => void save()} />}
    </>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: Spacing.three },
  bold: { fontWeight: 700 },
  // A plain row with a thin line above, tall enough for a thumb.
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouchSize + Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  optionText: { flex: 1, gap: Spacing.half },
});
