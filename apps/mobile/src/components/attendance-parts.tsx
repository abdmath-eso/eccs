import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey, Translator } from '@eccs/i18n';
import type { AttendanceDayFactsDto, DayFlag, PunchKind, PunchMethod } from '@eccs/shared';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatTimeOfDay } from '@/lib/format';
import { useSession } from '@/lib/session';

// What the attendance screens share now that attendance comes from clocking in
// and out by face: how a clock-in and a clock-out are drawn, the marks that ask
// the Owner to look at something, and how time worked is written.

type IconName = ComponentProps<typeof Ionicons>['name'];

// Clocking in and clocking out each have their own picture and their own word,
// so the two are told apart without relying on colour.
export const PUNCH_KIND: Record<PunchKind, { icon: IconName; label: MessageKey }> = {
  IN: { icon: 'log-in-outline', label: 'att.kind.IN' },
  OUT: { icon: 'log-out-outline', label: 'att.kind.OUT' },
};

/** How a punch came about, in words. */
export const PUNCH_METHOD: Record<PunchMethod, MessageKey> = {
  FACE: 'att.method.FACE',
  ASSISTED: 'att.method.ASSISTED',
  CORRECTION: 'att.method.CORRECTION',
};

// Each thing the Owner may need to look at has a picture and words of its own.
export const FLAG: Record<DayFlag, { icon: IconName; label: MessageKey }> = {
  UNSURE_MATCH: { icon: 'help-circle-outline', label: 'att.flag.UNSURE_MATCH' },
  ASSISTED: { icon: 'hand-left-outline', label: 'att.flag.ASSISTED' },
  NO_CLOCK_OUT: { icon: 'exit-outline', label: 'att.flag.NO_CLOCK_OUT' },
  POSSIBLE_SPOOF: { icon: 'warning-outline', label: 'att.flag.POSSIBLE_SPOOF' },
  OFFLINE: { icon: 'cloud-offline-outline', label: 'att.flag.OFFLINE' },
  SHORT_DAY: { icon: 'hourglass-outline', label: 'att.flag.SHORT_DAY' },
  NO_CLOCK_IN: { icon: 'enter-outline', label: 'att.flag.NO_CLOCK_IN' },
};

/** Time worked as people say it: "7 h 45 min", "8 h", "45 min". */
export function formatWorked(minutes: number, t: Translator): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('att.minutes', { minutes: rest });
  if (rest === 0) return t('att.hours', { hours });
  return t('att.hoursMinutes', { hours, minutes: rest });
}

/** The marks on a day or a punch, each as a picture with its words. Nothing when there are none. */
export function FlagList({ flags }: { flags: readonly DayFlag[] }) {
  const theme = useTheme();
  const { t } = useSession();
  if (flags.length === 0) return null;
  return (
    <View style={styles.flags}>
      {flags.map((flag) => (
        <View key={flag} style={styles.flag}>
          <Ionicons name={FLAG[flag].icon} size={18} color={theme.warning} />
          <ThemedText type="smallBold" themeColor="warning">
            {t(FLAG[flag].label)}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/** A day's first clock-in, last clock-out and time worked on one line: "In 10:02 am · Out 6:15 pm · 7 h 45 min". */
export function DayFactsLine({ facts }: { facts: AttendanceDayFactsDto }) {
  const { t, language } = useSession();
  const parts = [
    facts.firstInAt ? t('att.firstIn', { time: formatTimeOfDay(facts.firstInAt, language) }) : null,
    facts.lastOutAt ? t('att.lastOut', { time: formatTimeOfDay(facts.lastOutAt, language) }) : null,
    facts.onDuty ? t('att.onDuty') : null,
    facts.workedMinutes !== null && facts.punches > 0 ? formatWorked(facts.workedMinutes, t) : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {parts.join(' · ')}
    </ThemedText>
  );
}

/** "Face enrolled" or "Face not enrolled", with a picture, for lists of people. */
export function EnrolledMark({ enrolled }: { enrolled: boolean }) {
  const theme = useTheme();
  const { t } = useSession();
  return (
    <View style={styles.flag}>
      <Ionicons name={enrolled ? 'happy-outline' : 'remove-circle-outline'} size={18} color={enrolled ? theme.primary : theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary">
        {t(enrolled ? 'face.enrolled' : 'face.notEnrolled')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flags: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  flag: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
