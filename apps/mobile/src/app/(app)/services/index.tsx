import { isEccsRole, localize, type BookingDto, type VisitSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { VisitCard } from '@/components/visit-card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { dayBucket, formatDayShort, formatSlot, indiaToday } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// Past visits shown before the person has to look in the history calendar.
const MAX_PAST = 10;

/**
 * Service visits. For a restaurant: book a service, see what is coming up,
 * sign off finished work and open past reports. For ECCS staff: the visits
 * to carry out (a Supervisor sees their own), set out by day.
 */
export default function ServicesScreen() {
  const theme = useTheme();
  const { t, api, language, user } = useSession();
  const notify = useSnackbar();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const role = user?.memberships[0]?.role;
  const eccs = role !== undefined && isEccsRole(role);

  const [open, setOpen] = useState<VisitSummaryDto[] | null>(null);
  const [past, setPast] = useState<VisitSummaryDto[]>([]);
  const [requests, setRequests] = useState<BookingDto[]>([]);
  const [cancelling, setCancelling] = useState<BookingDto | null>(null);
  /** A request that could not be cancelled, so the message shows on that request. */
  const [cancelFailed, setCancelFailed] = useState<{ id: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ECCS staff see every outlet they work at; a restaurant looks at one outlet at a time.
  const forOutlet = eccs ? undefined : (outletId ?? undefined);
  const ready = eccs || outletId !== null;

  const load = useCallback(async () => {
    if (!ready) return;
    const filter = forOutlet ? { outletId: forOutlet } : {};
    try {
      const [upcoming, closed, asked] = await Promise.all([
        api.visits.list({ ...filter, state: 'open' }),
        api.visits.list({ ...filter, state: 'closed' }),
        eccs ? Promise.resolve([]) : api.bookings.list({ ...filter, requestedOnly: true }),
      ]);
      setOpen(upcoming);
      setPast(closed.filter((visit) => visit.status === 'APPROVED' || visit.status === 'IN_REVIEW').slice(0, MAX_PAST));
      setRequests(asked);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, eccs, forOutlet, ready]);

  // Reloads on coming back, so a new request or a signed-off visit shows.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function cancelRequest(booking: BookingDto) {
    setCancelling(null);
    setCancelFailed(null);
    try {
      await api.bookings.cancel(booking.id);
    } catch (e) {
      setCancelFailed({ id: booking.id, message: errorMessage(e, t) });
      return;
    }
    notify(t('svc.requestCancelled'));
    await load();
  }

  const all = open ?? [];
  const toSignOff = eccs ? [] : all.filter((visit) => visit.status === 'COMPLETED');
  const upcoming = all.filter((visit) => !toSignOff.includes(visit));

  // For ECCS staff the list is a work plan: what is under way first, then by day.
  const today = indiaToday();
  const underWay = all.filter((visit) => visit.status === 'IN_PROGRESS');
  // Finished: with ECCS for checking, or approved and with the restaurant for sign-off.
  const awaiting = all.filter((visit) => visit.status === 'IN_REVIEW' || visit.status === 'COMPLETED');
  const planned = all.filter((visit) => !underWay.includes(visit) && !awaiting.includes(visit));
  const onDay = (bucket: ReturnType<typeof dayBucket>) =>
    planned.filter((visit) => dayBucket(visit.date, today) === bucket);

  const heading = (text: string) => (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
      {text}
    </ThemedText>
  );
  const group = (title: string, visits: VisitSummaryDto[], empty?: string) =>
    (visits.length > 0 || empty) && (
      <>
        {heading(title)}
        {visits.length === 0 && (
          <ThemedText type="default" themeColor="textSecondary">
            {empty}
          </ThemedText>
        )}
        {visits.map((visit) => (
          <VisitCard key={visit.id} visit={visit} showOutlet={eccs} />
        ))}
      </>
    );

  return (
    <Screen
      back
      title={t(eccs ? 'svc.titleEccs' : 'svc.title')}
      subtitle={t(eccs ? (role === 'SUPERVISOR' ? 'svc.helpSupervisor' : 'svc.helpAdmin') : 'svc.help')}
      onRefresh={load}>
      {!eccs && outlets.length > 1 && (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => {
                if (outlet.id === outletId) return;
                setOpen(null);
                choose(outlet.id);
              }}
            />
          ))}
        </View>
      )}

      {!eccs && <Button label={t('svc.book')} onPress={() => router.push('/services/book')} disabled={!outletId} />}

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (open === null && !error)) && <ActivityIndicator color={theme.primary} />}

      {group(t('svc.toSignOff'), toSignOff)}

      {requests.length > 0 && (
        <>
          {heading(t('svc.requests'))}
          {requests.map((booking) => (
            <View key={booking.id} style={[styles.request, { borderColor: theme.border }]}>
              <ThemedText type="default" style={styles.requestTitle}>
                {localize(booking.serviceName, language)}
              </ThemedText>
              <ThemedText type="default">
                {t('svc.askedFor', {
                  date: [
                    formatDayShort(booking.preferredDate, language),
                    formatSlot(booking.preferredSlot, language, t),
                  ]
                    .filter(Boolean)
                    .join(' · '),
                })}
              </ThemedText>
              <ThemedText type="small" themeColor="warning">
                {t('svc.requestWaiting')}
              </ThemedText>
              <Button label={t('svc.cancelRequest')} variant="link" onPress={() => setCancelling(booking)} />
              <ErrorText message={cancelFailed?.id === booking.id ? cancelFailed.message : null} />
            </View>
          ))}
        </>
      )}

      {open !== null && eccs && (
        <>
          {group(t('svc.underWay'), underWay)}
          {group(t('svc.overdue'), onDay('past'))}
          {group(t('svc.today'), onDay('today'), t('home.noVisitsToday'))}
          {group(t('svc.tomorrow'), onDay('tomorrow'))}
          {group(t('svc.later'), onDay('later'))}
          {group(t('svc.awaitingSignOff'), awaiting)}
        </>
      )}
      {open !== null && !eccs && group(t('svc.upcoming'), upcoming, t('svc.noUpcoming'))}
      {open !== null && group(t('svc.past'), past, t('svc.noPast'))}

      <ConfirmDialog
        visible={cancelling !== null}
        message={t('svc.cancelRequestConfirm', {
          name: cancelling ? localize(cancelling.serviceName, language) : '',
        })}
        confirmLabel={t('svc.cancelRequest')}
        danger
        onConfirm={() => cancelling && void cancelRequest(cancelling)}
        onCancel={() => setCancelling(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sectionGap: { marginTop: Spacing.four },
  request: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  requestTitle: { fontWeight: 700, fontSize: 18 },
});
