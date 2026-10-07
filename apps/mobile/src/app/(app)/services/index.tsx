import { isEccsRole, localize, type BookingDto, type VisitSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { VisitCard } from '@/components/visit-card';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDayShort, formatSlot } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// Past visits shown before the person has to look in the history calendar.
const MAX_PAST = 10;

/**
 * Service visits. For a restaurant: book a service, see what is coming up,
 * sign off finished work and open past reports. For ECCS staff: the visits
 * to carry out (a Supervisor sees their own).
 */
export default function ServicesScreen() {
  const theme = useTheme();
  const { t, api, language, user } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const role = user?.memberships[0]?.role;
  const eccs = role !== undefined && isEccsRole(role);

  const [open, setOpen] = useState<VisitSummaryDto[] | null>(null);
  const [past, setPast] = useState<VisitSummaryDto[]>([]);
  const [requests, setRequests] = useState<BookingDto[]>([]);
  const [cancelling, setCancelling] = useState<BookingDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ECCS staff see every outlet they work at; a restaurant looks at one outlet at a time.
  const forOutlet = eccs ? undefined : (outletId ?? undefined);
  const ready = eccs || outletId !== null;

  const load = useCallback(async () => {
    if (!ready) return;
    const filter = forOutlet ? { outletId: forOutlet } : {};
    const [upcoming, closed, asked] = await Promise.all([
      api.visits.list({ ...filter, state: 'open' }),
      api.visits.list({ ...filter, state: 'closed' }),
      eccs ? Promise.resolve([]) : api.bookings.list({ ...filter, requestedOnly: true }),
    ]);
    setOpen(upcoming);
    setPast(closed.filter((visit) => visit.status === 'APPROVED').slice(0, MAX_PAST));
    setRequests(asked);
    setError(null);
  }, [api, eccs, forOutlet, ready]);

  // Reloads on coming back, so a new request or a signed-off visit shows.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      load().catch((e) => !cancelled && setError(errorMessage(e, t)));
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  async function cancelRequest(booking: BookingDto) {
    setCancelling(null);
    try {
      await api.bookings.cancel(booking.id);
      await load();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  const toSignOff = eccs ? [] : (open ?? []).filter((visit) => visit.status === 'COMPLETED');
  const upcoming = (open ?? []).filter((visit) => !toSignOff.includes(visit));
  const heading = (text: string) => (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
      {text}
    </ThemedText>
  );

  return (
    <Screen
      back
      title={t(eccs ? 'svc.titleEccs' : 'svc.title')}
      subtitle={t(eccs ? (role === 'SUPERVISOR' ? 'svc.helpSupervisor' : 'svc.helpAdmin') : 'svc.help')}>
      {!eccs && outlets.length > 1 && (
        <View style={styles.options} accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => {
            const selected = outlet.id === outletId;
            return (
              <Pressable
                key={outlet.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setOpen(null);
                  choose(outlet.id);
                }}
                style={[
                  styles.option,
                  { borderColor: selected ? theme.primary : theme.border },
                  selected && { backgroundColor: theme.backgroundElement },
                ]}>
                <ThemedText type="default" themeColor={selected ? 'primary' : 'text'}>
                  {outlet.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}

      {!eccs && <Button label={t('svc.book')} onPress={() => router.push('/services/book')} disabled={!outletId} />}

      <ErrorText message={error} />
      {(outletLoading || (open === null && !error)) && <ActivityIndicator color={theme.primary} />}

      {toSignOff.length > 0 && (
        <>
          {heading(t('svc.toSignOff'))}
          {toSignOff.map((visit) => (
            <VisitCard key={visit.id} visit={visit} />
          ))}
        </>
      )}

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
            </View>
          ))}
        </>
      )}

      {open !== null && (
        <>
          {heading(t('svc.upcoming'))}
          {upcoming.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('svc.noUpcoming')}
            </ThemedText>
          )}
          {upcoming.map((visit) => (
            <VisitCard key={visit.id} visit={visit} showOutlet={eccs} />
          ))}

          {heading(t('svc.past'))}
          {past.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('svc.noPast')}
            </ThemedText>
          )}
          {past.map((visit) => (
            <VisitCard key={visit.id} visit={visit} showOutlet={eccs} />
          ))}
        </>
      )}

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
  option: {
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  sectionGap: { marginTop: Spacing.four },
  request: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  requestTitle: { fontWeight: 700, fontSize: 18 },
});
