import Ionicons from '@expo/vector-icons/Ionicons';
import type { LanguageCode, MessageKey } from '@eccs/i18n';
import { shiftMonth, type AttendanceStatus, type AttendanceTotals, type SalaryState } from '@eccs/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { OptionSheet } from '@/components/ui/option-sheet';
import { MinTouchSize, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatMonth } from '@/lib/format';
import { useSession } from '@/lib/session';

// What the staff screens (people, attendance, salary) share: how each kind of
// day is drawn, the month stepper, typing money, and loading a screen's data.

type IconName = ComponentProps<typeof Ionicons>['name'];

/** A kind of day, or "none" for a day nobody has marked. */
export type DayMark = AttendanceStatus | 'NONE';

// Every kind of day has its own picture and its own word. The colour only helps:
// someone who cannot tell the colours apart, or reads little, still has the shape.
export const DAY_MARK: Record<DayMark, { icon: IconName; tone: ThemeColor; label: MessageKey }> = {
  PRESENT: { icon: 'checkmark-circle', tone: 'primary', label: 'team.status.PRESENT' },
  HALF_DAY: { icon: 'contrast', tone: 'warning', label: 'team.status.HALF_DAY' },
  ABSENT: { icon: 'close-circle', tone: 'danger', label: 'team.status.ABSENT' },
  LEAVE: { icon: 'umbrella', tone: 'info', label: 'team.status.LEAVE' },
  WEEKLY_OFF: { icon: 'moon', tone: 'textSecondary', label: 'team.status.WEEKLY_OFF' },
  NONE: { icon: 'ellipse-outline', tone: 'textSecondary', label: 'team.status.NONE' },
};

/** The order the kinds of day are listed in, everywhere. */
export const DAY_MARK_ORDER: DayMark[] = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'WEEKLY_OFF', 'NONE'];

/** A month's totals as one count per kind of day. */
export const countsOf = (totals: AttendanceTotals): Record<DayMark, number> => ({
  PRESENT: totals.present,
  HALF_DAY: totals.halfDay,
  ABSENT: totals.absent,
  LEAVE: totals.leave,
  WEEKLY_OFF: totals.weeklyOff,
  NONE: totals.notMarked,
});

/** A row of counts, each with its picture and word: "✓ Present 22". Kinds with nothing are left out unless `all`. */
export function DayCounts({ counts, all }: { counts: Record<DayMark, number>; all?: boolean }) {
  const theme = useTheme();
  const { t } = useSession();
  return (
    <View style={styles.counts}>
      {DAY_MARK_ORDER.filter((mark) => all || counts[mark] > 0).map((mark) => (
        <View key={mark} style={styles.count} accessible accessibilityLabel={`${t(DAY_MARK[mark].label)}: ${counts[mark]}`}>
          <Ionicons name={DAY_MARK[mark].icon} size={18} color={theme[DAY_MARK[mark].tone]} />
          <ThemedText type="small" themeColor="textSecondary">
            {t(DAY_MARK[mark].label)}
          </ThemedText>
          <ThemedText type="smallBold">{counts[mark]}</ThemedText>
        </View>
      ))}
    </View>
  );
}

/** Where a month's pay stands, in words with a picture of its own. */
export const SALARY_STATE: Record<SalaryState, { icon: IconName; tone: ThemeColor; label: MessageKey }> = {
  DUE: { icon: 'time-outline', tone: 'textSecondary', label: 'team.pay.state.DUE' },
  PART_PAID: { icon: 'pie-chart-outline', tone: 'warning', label: 'team.pay.state.PART_PAID' },
  SETTLED: { icon: 'checkmark-circle', tone: 'primary', label: 'team.pay.state.SETTLED' },
  OVERPAID: { icon: 'arrow-undo-circle-outline', tone: 'info', label: 'team.pay.state.OVERPAID' },
};

interface MonthStepperProps {
  /** YYYY-MM */
  month: string;
  /** This month: the stepper does not go past it. */
  thisMonth: string;
  /** The earliest month that can be opened; none means no limit. */
  earliest?: string;
  onChange: (month: string) => void;
}

/** The month's name with an arrow either side. Months still to come cannot be opened. */
export function MonthStepper({ month, thisMonth, earliest, onChange }: MonthStepperProps) {
  const theme = useTheme();
  const { t, language } = useSession();
  // In Urdu the arrows swap sides, so "earlier" still points to where the reading started.
  const { backIcon, forwardIcon } = useDirection();
  const canGoBack = earliest === undefined || month > earliest;
  const canGoAhead = month < thisMonth;
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('hist.prev')}
        disabled={!canGoBack}
        onPress={() => onChange(shiftMonth(month, -1))}
        style={[styles.arrow, !canGoBack && styles.faded]}>
        <Ionicons name={backIcon} size={28} color={theme.primary} />
      </Pressable>
      <ThemedText type="subtitle" style={styles.stepperTitle}>
        {formatMonth(month, language)}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('hist.next')}
        disabled={!canGoAhead}
        onPress={() => onChange(shiftMonth(month, 1))}
        style={[styles.arrow, !canGoAhead && styles.faded]}>
        <Ionicons name={forwardIcon} size={28} color={theme.primary} />
      </Pressable>
    </View>
  );
}

/**
 * The Owner's choice of outlet, shown only when they have more than one.
 *
 * One line that names the outlet in view and opens the list when tapped. It was
 * a chip for every outlet, which took a row each on a phone and pushed the
 * screen's own content down (the founder found the attendance screen cluttered,
 * 12 Oct 2026). A single line that opens a list is how apps let someone switch
 * between a few places (Material's exposed dropdown menu).
 */
export function OutletChips({
  outlets,
  outletId,
  onChoose,
}: {
  outlets: { id: string; name: string }[];
  outletId: string | null;
  onChoose: (outletId: string) => void;
}) {
  const theme = useTheme();
  const { t } = useSession();
  const [open, setOpen] = useState(false);
  if (outlets.length < 2) return null;
  const current = outlets.find((outlet) => outlet.id === outletId)?.name ?? '';
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('checklists.chooseOutlet')}: ${current}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.outlet, { borderColor: theme.outline }, pressed && { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="storefront-outline" size={20} color={theme.primary} />
        <ThemedText type="default" numberOfLines={1} style={styles.outletName}>
          {current || t('checklists.chooseOutlet')}
        </ThemedText>
        <Ionicons name="chevron-down" size={20} color={theme.textSecondary} />
      </Pressable>
      <OptionSheet
        visible={open}
        title={t('checklists.chooseOutlet')}
        onClose={() => setOpen(false)}
        options={outlets.map((outlet) => ({
          label: outlet.name,
          // The outlet in view carries a filled mark, the others an empty one.
          icon: outlet.id === outletId ? ('radio-button-on' as const) : ('radio-button-off' as const),
          onPress: () => {
            setOpen(false);
            onChoose(outlet.id);
          },
        }))}
      />
    </>
  );
}

/** The name of a day of the week (0 Sunday to 6 Saturday) in the app's language. */
export function weekdayName(day: number, language: LanguageCode): string {
  try {
    // 1 January 2023 was a Sunday.
    return new Intl.DateTimeFormat(`${language.toLowerCase()}-IN-u-nu-latn`, { timeZone: 'UTC', weekday: 'long' }).format(
      new Date(Date.UTC(2023, 0, 1 + day)),
    );
  } catch {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] ?? '';
  }
}

/**
 * Reads an amount typed in rupees ("12500", "12,500", "12500.50") and returns
 * it in paise, or null if it is not an amount. An empty box is zero.
 */
export function parseRupees(text: string): number | null {
  const cleaned = text.replace(/[,\s₹]/g, '');
  if (cleaned === '') return 0;
  if (!/^\d{1,8}(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** An amount in paise as it is typed into a box: "12500" or "12500.50". Zero is an empty box. */
export function typedRupees(paise: number): string {
  if (paise === 0) return '';
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

/**
 * Loads what a screen shows, again each time the screen comes back into view
 * and whenever `key` changes (the outlet, the month). While `key` is null
 * nothing is loaded. What was loaded for another key is never shown.
 */
export function useLoaded<T>(key: string | null, load: () => Promise<T>) {
  const { t } = useSession();
  const [loaded, setLoaded] = useState<{ key: string; data: T } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (key === null) return;
      let cancelled = false;
      (async () => {
        try {
          const data = await load();
          if (cancelled) return;
          setLoaded({ key, data });
          setError(null);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e, t));
        }
      })();
      return () => {
        cancelled = true;
      };
      // `load` is made afresh on every draw and `t` changes with the language; only the key matters.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]),
  );

  return {
    data: loaded && loaded.key === key ? loaded.data : null,
    error,
    /** For pull-to-refresh and "Try again". */
    async reload() {
      if (key === null) return;
      try {
        const data = await load();
        setLoaded({ key, data });
        setError(null);
      } catch (e) {
        setError(errorMessage(e, t));
      }
    },
    /** Puts in place what the server answered after a change, without loading again. */
    set(data: T) {
      if (key !== null) setLoaded({ key, data });
    },
  };
}

const styles = StyleSheet.create({
  counts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  count: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stepperTitle: { flex: 1, textAlign: 'center', fontSize: 22, lineHeight: 30 },
  arrow: { minHeight: MinTouchSize, minWidth: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.3 },
  outlet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  outletName: { flex: 1, fontWeight: 700 },
});
