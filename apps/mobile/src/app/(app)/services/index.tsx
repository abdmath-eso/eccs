import { isEccsRole, isVisitAhead, localize, type BookingDto, type OutletPlanDto, type VisitSummaryDto } from '@eccs/shared';
import type { ApiClient } from '@eccs/api-client';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { FieldMark, SavedCopyNote } from '@/components/field-sync-parts';
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
import { fieldCache } from '@/lib/offline/field-cache';
import { fieldSummary } from '@/lib/offline/field-ops';
import { isNoSignal, outbox, useOutbox } from '@/lib/offline/outbox';
import { useReloadOnSignal } from '@/lib/offline/use-signal';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// Past visits shown before the person has to look in the history calendar.
const MAX_PAST = 10;

// How many of a Supervisor's coming visits are fetched in full each time the list
// loads, so they can be opened and worked on later with no signal. A copy fetched
// within the last few minutes is not fetched again.
const KEEP_FOR_OFFLINE = 15;
const FRESH_MS = 5 * 60_000;

/** Everything this screen shows, as the server last sent it. Kept on the phone under the outlet's name. */
interface VisitLists {
  open: VisitSummaryDto[];
  past: VisitSummaryDto[];
  requests: BookingDto[];
  /** The outlet's plan, whose visits ECCS puts in the diary automatically. */
  plan: OutletPlanDto | null;
}

/**
 * Fetches each coming visit in full, one at a time so a weak signal is not
 * swamped. If one does not get through, the rest are left for next time.
 */
async function keepForOffline(api: ApiClient, visits: VisitSummaryDto[]) {
  for (const visit of visits.filter((entry) => isVisitAhead(entry.status)).slice(0, KEEP_FOR_OFFLINE)) {
    if (Date.now() - (fieldCache.savedAt('visit', visit.id) ?? 0) < FRESH_MS) continue;
    try {
      fieldCache.putVisit(await api.visits.get(visit.id));
    } catch {
      return;
    }
  }
}

/**
 * Service visits. For a restaurant: book a service, see what is coming up,
 * sign off finished work and open past reports. For ECCS staff: the visits
 * to carry out (a Supervisor sees their own), set out by day.
 *
 * The list is kept on the phone each time it loads, so with no signal it is
 * shown from there, with the time it was saved. For ECCS staff the coming
 * visits are also fetched in full, so each can be opened and worked on without
 * signal; work still waiting to be sent is marked on its card.
 */
export default function ServicesScreen() {
  const theme = useTheme();
  const { t, api, language, user } = useSession();
  const notify = useSnackbar();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const role = user?.memberships[0]?.role;
  const eccs = role !== undefined && isEccsRole(role);

  const box = useOutbox();
  const userId = user?.id ?? null;
  // False only once the server could not be reached; the line at the bottom of the app says so.
  const hasSignal = box.online !== false;
  const [cancelling, setCancelling] = useState<BookingDto | null>(null);
  /** A request that could not be cancelled, so the message shows on that request. */
  const [cancelFailed, setCancelFailed] = useState<{ id: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ECCS staff see every outlet they work at; a restaurant looks at one outlet at a time.
  const forOutlet = eccs ? undefined : (outletId ?? undefined);
  const ready = eccs || outletId !== null;

  // The lists as the server last sent them, from the copy kept on the phone.
  const listName = `visits:${forOutlet ?? 'all'}`;
  const getSaved = useCallback(() => fieldCache.getList<VisitLists>(listName), [listName]);
  const saved = useSyncExternalStore(fieldCache.subscribe, getSaved, getSaved);
  const open = saved?.data.open ?? null;
  const past = saved?.data.past ?? [];
  const requests = saved?.data.requests ?? [];
  const plan = saved?.data.plan ?? null;

  const load = useCallback(async () => {
    if (!ready || !userId) return;
    await fieldCache.load(userId);
    const filter = forOutlet ? { outletId: forOutlet } : {};
    try {
      const [upcoming, closed, asked, onPlan] = await Promise.all([
        api.visits.list({ ...filter, state: 'open' }),
        api.visits.list({ ...filter, state: 'closed' }),
        eccs ? Promise.resolve([]) : api.bookings.list({ ...filter, requestedOnly: true }),
        // The plan is extra: if it cannot be read, the visits still show.
        !eccs && forOutlet ? api.plans.forOutlet(forOutlet).catch(() => null) : Promise.resolve(null),
      ]);
      fieldCache.putList(listName, {
        open: upcoming,
        past: closed.filter((visit) => visit.status === 'APPROVED' || visit.status === 'IN_REVIEW').slice(0, MAX_PAST),
        requests: asked,
        plan: onPlan,
      } satisfies VisitLists);
      outbox.noteReachable(true);
      setError(null);
      // In the background, so the list does not wait for it.
      if (eccs) void keepForOffline(api, upcoming);
    } catch (e) {
      const noSignal = isNoSignal(e);
      if (noSignal) outbox.noteReachable(false);
      // With no signal the copy on the phone stays on screen, which is not an error.
      setError(noSignal ? (fieldCache.getList(listName) ? null : t('offline.listNotOnPhone')) : errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, eccs, forOutlet, listName, ready, userId]);

  // Reloads on coming back, so a new request or a signed-off visit shows.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // And again the moment the signal comes back.
  useReloadOnSignal(load);

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

  // A visit the Supervisor checked in to without signal is under way, though the server has not heard yet.
  const summaries = new Map((open ?? []).map((visit) => [visit.id, fieldSummary(box.ops, 'visit', visit.id)]));
  const all = (open ?? []).map((visit): VisitSummaryDto => {
    const mine = summaries.get(visit.id);
    const startedHere = mine !== undefined && mine.unsent > 0 && (visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED');
    return startedHere ? { ...visit, status: 'IN_PROGRESS' } : visit;
  });
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
        {visits.map((visit) => {
          const mine = summaries.get(visit.id);
          return (
            <VisitCard
              key={visit.id}
              visit={visit}
              showOutlet={eccs}
              mark={mine && (mine.unsent > 0 || mine.held > 0) ? <FieldMark summary={mine} hasSignal={hasSignal} /> : undefined}
            />
          );
        })}
      </>
    );

  return (
    <Screen
      back
      title={t(eccs ? 'svc.titleEccs' : 'svc.title')}
      subtitle={t(eccs ? (role === 'SUPERVISOR' ? 'svc.helpSupervisor' : 'svc.helpAdmin') : 'svc.help')}
      onRefresh={async () => {
        // Pulling down also sends anything still waiting, without waiting for the next automatic try.
        outbox.kick();
        await load();
      }}>
      {!eccs && outlets.length > 1 && (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => {
                if (outlet.id === outletId) return;
                setError(null);
                choose(outlet.id);
              }}
            />
          ))}
        </View>
      )}

      {!eccs && <Button label={t('svc.book')} onPress={() => router.push('/services/book')} disabled={!outletId} />}

      <ErrorText message={error} onRetry={() => void load()} />
      {/* No signal: this is the phone's own copy, and how old it is. */}
      {!hasSignal && saved && <SavedCopyNote at={saved.at} />}
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

      {!eccs && plan?.plan && (
        <>
          {heading(t('svc.plan'))}
          <View style={[styles.request, { borderColor: theme.border }]}>
            <ThemedText type="default" style={styles.requestTitle}>
              {localize(plan.plan.name, language)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('svc.planHelp')}
            </ThemedText>
            {plan.services.map((service) => (
              <View key={service.serviceCode} style={[styles.planLine, { borderColor: theme.border }]}>
                <ThemedText type="default" style={styles.planService}>
                  {localize(service.serviceName, language)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('svc.planEvery', { count: service.intervalDays })} ·{' '}
                  {t('svc.planNext', { date: formatDayShort(service.nextDate, language) })}
                </ThemedText>
              </View>
            ))}
          </View>
        </>
      )}
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
  planLine: { borderTopWidth: 1, paddingTop: Spacing.two, gap: Spacing.half },
  planService: { fontWeight: 600 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sectionGap: { marginTop: Spacing.four },
  request: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  requestTitle: { fontWeight: 700, fontSize: 18 },
});
