import { localize, mapLink, type VisitStatus, type VisitSummaryDto } from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { CompactAction } from '@/components/lead-parts';
import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { ErrorText } from '@/components/ui/error-text';
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

/**
 * Opens a place in the phone's maps app. Returns false when the phone could not open it, so the
 * screen can say so beside the button (as the day sheet does).
 */
export async function openInMaps(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

interface VisitCardProps {
  visit: VisitSummaryDto;
  showOutlet?: boolean;
  /** Shown under the status: for a Supervisor, that work on this visit is saved on the phone and not sent yet. */
  mark?: ReactNode;
}

/**
 * One service visit in a list. Tapping it opens the visit.
 *
 * For ECCS staff, who go to the outlet, a Map button sits at the card's end, beside the part that
 * opens the visit and never inside it (a button within a button cannot be pressed on its own on the
 * web, and screen readers merge the two), as on the day's sheet. PATTERN FOLLOWED: Dynamics 365 Field
 * Service's booking tiles, with a directions icon on each tile that opens the phone's maps app
 * (learn.microsoft.com, "Field Service mobile: do work"), and Jobber's visit, with Directions under the
 * client's address (help.getjobber.com).
 */
export function VisitCard({ visit, showOutlet, mark }: VisitCardProps) {
  const theme = useTheme();
  const { t, language } = useSession();
  const { forwardIcon } = useDirection();
  const [mapFailed, setMapFailed] = useState(false);
  const missed = visitMissed(visit);
  // ECCS staff have every visit given to them, so "Supervisor assigned" on each one says nothing.
  const quietStatus = showOutlet && !missed && (visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED');
  const when = [formatDayShort(visit.date, language), formatSlot(visit.slot, language, t)].filter(Boolean).join(' · ');
  // Found by the address: the list's visits do not carry the outlet's saved place.
  const map = showOutlet ? mapLink({ latitude: null, longitude: null, address: visit.outletAddress }) : null;
  const open = () => router.push({ pathname: '/services/[visitId]', params: { visitId: visit.id } });

  // The words in a column.
  const body = (
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
              <Ionicons name="location-outline" size={18} color={theme.textSecondary} style={styles.pin} />
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
  );

  if (!map) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={open}
        style={({ pressed }) => [
          styles.card,
          styles.row,
          { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
        ]}>
        {body}
        {/* The arrow that says it opens, centred at the end, as on every other row. */}
        <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => [styles.opens, pressed && styles.pressed]}>
          {body}
        </Pressable>
        <CompactAction
          tonal
          icon="navigate-outline"
          label={t('sheet.map')}
          accessibilityLabel={t('sheet.mapOpen', { outlet: visit.outletName })}
          onPress={() => {
            setMapFailed(false);
            void openInMaps(map).then((opened) => setMapFailed(!opened));
          }}
        />
      </View>
      <ErrorText message={mapFailed ? t('vendors.directionsFailed') : null} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: MinTouchSize * 1.6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  opens: { flex: 1 },
  pressed: { opacity: 0.7 },
  body: { flex: 1, gap: Spacing.two },
  title: { fontWeight: 700, fontSize: 18 },
  place: { gap: Spacing.half },
  address: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  // The pin on the address's first line, not halfway down a two-line address.
  pin: { marginTop: 1 },
  addressText: { flex: 1 },
});
