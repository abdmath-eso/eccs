import { localize, type VisitStatus, type VisitSummaryDto } from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { StatusChip } from '@/components/ui/status-chip';
import { useTheme } from '@/hooks/use-theme';
import { dayBucket, formatDayShort, formatSlot, indiaToday } from '@/lib/format';
import { useDirection } from '@/lib/direction';
import { useSession } from '@/lib/session';

/** A visit booked for a day that has passed and never started: it did not happen. */
export const visitMissed = (visit: { status: VisitStatus; date: string }, today = indiaToday()) =>
  (visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED') && dayBucket(visit.date, today) === 'past';

/**
 * Where a service visit stands. A visit whose day has passed without it starting says "Not done",
 * as the calendar does, rather than still "Booked" (22 Oct 2026).
 */
export function VisitStatusBadge({ status, missed }: { status: VisitStatus; missed?: boolean }) {
  const { t } = useSession();
  if (missed) return <StatusChip tone="bad" icon="alert" label={t('visitState.NOT_DONE')} />;
  const label = t(`visitStatus.${status}`);
  switch (status) {
    case 'APPROVED':
      return <StatusChip tone="good" icon="checkmark" label={label} />;
    case 'COMPLETED':
    case 'IN_REVIEW':
      return <StatusChip tone="warn" icon="hourglass-outline" label={label} />;
    case 'IN_PROGRESS':
      return <StatusChip tone="info" icon="construct-outline" label={label} />;
    case 'CANCELLED':
      return <StatusChip tone="neutral" icon="close" label={label} />;
    default:
      return <StatusChip tone="neutral" icon="calendar-outline" label={label} />;
  }
}

interface VisitCardProps {
  visit: VisitSummaryDto;
  showOutlet?: boolean;
  /** Shown under the status: for a Supervisor, that work on this visit is saved on the phone and not sent yet. */
  mark?: ReactNode;
}

/** One service visit in a list. Tapping it opens the visit. */
export function VisitCard({ visit, showOutlet, mark }: VisitCardProps) {
  const theme = useTheme();
  const { t, language } = useSession();
  const { forwardIcon } = useDirection();
  const missed = visitMissed(visit);
  // ECCS staff have every visit given to them, so "Supervisor assigned" on each one says nothing.
  const quietStatus = showOutlet && !missed && (visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED');
  const when = [formatDayShort(visit.date, language), formatSlot(visit.slot, language, t)].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/services/[visitId]', params: { visitId: visit.id } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      {/* The words in a column, and the arrow that says it opens centred at the end, as on every other row. */}
      <View style={styles.body}>
        <ThemedText type="default" style={styles.title}>
          {localize(visit.serviceName, language)}
        </ThemedText>
        <ThemedText type="default">{when}</ThemedText>
        {showOutlet && (
          <View style={styles.place}>
            <ThemedText type="default">{visit.outletName}</ThemedText>
            {/* ECCS staff need to know where to go without opening the visit. */}
            {visit.outletAddress && (
              <View style={styles.address}>
                <Ionicons name="location-outline" size={18} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.addressText}>
                  {visit.outletAddress}
                </ThemedText>
              </View>
            )}
          </View>
        )}
        {!quietStatus && <VisitStatusBadge status={visit.status} missed={missed} />}
        {mark}
        {visit.fromPlan && !showOutlet && (
          <ThemedText type="small" themeColor="textSecondary">
            {t('svc.fromPlan')}
          </ThemedText>
        )}
      </View>
      <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: MinTouchSize * 1.6,
  },
  body: { flex: 1, gap: Spacing.two },
  title: { fontWeight: 700, fontSize: 18 },
  place: { gap: Spacing.half },
  address: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  addressText: { flex: 1 },
});
