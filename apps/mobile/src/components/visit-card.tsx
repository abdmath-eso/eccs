import { localize, type VisitStatus, type VisitSummaryDto } from '@eccs/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDayShort } from '@/lib/format';
import { useSession } from '@/lib/session';

/** A small coloured label for where a service visit stands. */
export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  const theme = useTheme();
  const { t } = useSession();
  const color =
    status === 'APPROVED'
      ? theme.primary
      : status === 'COMPLETED'
        ? theme.warning
        : status === 'IN_PROGRESS'
          ? theme.info
          : status === 'CANCELLED'
            ? theme.textSecondary
            : theme.text;

  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <ThemedText type="smallBold" style={{ color }}>
        {status === 'APPROVED' ? '✓ ' : ''}
        {t(`visitStatus.${status}`)}
      </ThemedText>
    </View>
  );
}

/** One service visit in a list. Tapping it opens the visit. */
export function VisitCard({ visit, showOutlet }: { visit: VisitSummaryDto; showOutlet?: boolean }) {
  const theme = useTheme();
  const { t, language } = useSession();
  const when = [formatDayShort(visit.date, language), visit.slot ? t(`slot.${visit.slot}`) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/services/[visitId]', params: { visitId: visit.id } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <View style={styles.header}>
        <ThemedText type="default" style={styles.title}>
          {localize(visit.serviceName, language)}
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          ›
        </ThemedText>
      </View>
      <ThemedText type="default">{when}</ThemedText>
      {showOutlet && (
        <ThemedText type="small" themeColor="textSecondary">
          {visit.outletName}
        </ThemedText>
      )}
      <VisitStatusBadge status={visit.status} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.half,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    minHeight: MinTouchSize * 1.6,
  },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two },
  title: { flex: 1, fontWeight: 700, fontSize: 18 },
});
