import type { ApiClient } from '@eccs/api-client';
import { isEccsRole, type InspectionSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { FieldMark, SavedCopyNote } from '@/components/field-sync-parts';
import { InspectionCard } from '@/components/inspection-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { fieldCache } from '@/lib/offline/field-cache';
import { fieldSummary } from '@/lib/offline/field-ops';
import { isNoSignal, outbox, useOutbox } from '@/lib/offline/outbox';
import { useReloadOnSignal } from '@/lib/offline/use-signal';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// How many of a Supervisor's inspections still to do are fetched in full each time
// the list loads, so they can be opened and carried out later with no signal. An
// inspection is large (92 checks), so fewer are kept than visits. A copy fetched
// within the last few minutes is not fetched again.
const KEEP_FOR_OFFLINE = 8;
const FRESH_MS = 5 * 60_000;

/**
 * Fetches each inspection still to do in full, one at a time so a weak signal is
 * not swamped. If one does not get through, the rest are left for next time.
 */
async function keepForOffline(api: ApiClient, inspections: InspectionSummaryDto[]) {
  const toDo = inspections.filter((entry) => entry.status === 'PLANNED' || entry.status === 'IN_PROGRESS');
  for (const inspection of toDo.slice(0, KEEP_FOR_OFFLINE)) {
    if (Date.now() - (fieldCache.savedAt('inspection', inspection.id) ?? 0) < FRESH_MS) continue;
    try {
      fieldCache.putInspection(await api.inspections.get(inspection.id));
    } catch {
      return;
    }
  }
}

/**
 * Inspections. For ECCS staff: the inspections to carry out (a Supervisor sees
 * their own), set out by what needs doing first. For a restaurant's Owner or
 * Manager: the approved inspection reports of their outlet.
 *
 * The list is kept on the phone each time it loads, so with no signal it is
 * shown from there, with the time it was saved. For ECCS staff the inspections
 * still to do are also fetched in full, so each can be carried out without
 * signal; answers still waiting to be sent are marked on its card.
 */
export default function InspectionsScreen() {
  const theme = useTheme();
  const { t, api, user } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const role = user?.memberships[0]?.role;
  const eccs = role !== undefined && isEccsRole(role);

  const box = useOutbox();
  const userId = user?.id ?? null;
  // False only once the server could not be reached; the line at the bottom of the app says so.
  const hasSignal = box.online !== false;
  const [error, setError] = useState<string | null>(null);

  // ECCS staff see every outlet they work at; a restaurant looks at one outlet at a time.
  const forOutlet = eccs ? undefined : (outletId ?? undefined);
  const ready = eccs || outletId !== null;

  // The list as the server last sent it, from the copy kept on the phone.
  const listName = `inspections:${forOutlet ?? 'all'}`;
  const getSaved = useCallback(() => fieldCache.getList<InspectionSummaryDto[]>(listName), [listName]);
  const saved = useSyncExternalStore(fieldCache.subscribe, getSaved, getSaved);
  const inspections = saved?.data ?? null;

  const load = useCallback(async () => {
    if (!ready || !userId) return;
    await fieldCache.load(userId);
    try {
      const list = await api.inspections.list(forOutlet ? { outletId: forOutlet } : {});
      fieldCache.putList(listName, list);
      outbox.noteReachable(true);
      setError(null);
      // In the background, so the list does not wait for it.
      if (eccs) void keepForOffline(api, list);
    } catch (e) {
      const noSignal = isNoSignal(e);
      if (noSignal) outbox.noteReachable(false);
      // With no signal the copy on the phone stays on screen, which is not an error.
      setError(noSignal ? (fieldCache.getList(listName) ? null : t('offline.listNotOnPhone')) : errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, eccs, forOutlet, listName, ready, userId]);

  // Reloads on coming back, so a finished inspection moves to its new place.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // And again the moment the signal comes back.
  useReloadOnSignal(load);

  // An inspection the Supervisor began without signal is under way, though the server has not heard yet.
  const summaries = new Map((inspections ?? []).map((entry) => [entry.id, fieldSummary(box.ops, 'inspection', entry.id)]));
  const all = (inspections ?? []).map((entry): InspectionSummaryDto => {
    const mine = summaries.get(entry.id);
    return mine !== undefined && mine.unsent > 0 && entry.status === 'PLANNED' ? { ...entry, status: 'IN_PROGRESS' } : entry;
  });
  const oldestFirst = (list: InspectionSummaryDto[]) => [...list].sort((a, b) => a.date.localeCompare(b.date));
  // What is half done comes first, then what is planned (soonest first), then what is waiting or final.
  const underWay = all.filter((inspection) => inspection.status === 'IN_PROGRESS');
  const toDo = oldestFirst(all.filter((inspection) => inspection.status === 'PLANNED'));
  const withEccs = all.filter((inspection) => inspection.status === 'SUBMITTED');
  const approved = all.filter((inspection) => inspection.status === 'APPROVED');

  const group = (title: string, list: InspectionSummaryDto[]) =>
    list.length > 0 && (
      <>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
          {title}
        </ThemedText>
        {list.map((inspection) => {
          const mine = summaries.get(inspection.id);
          return (
            <InspectionCard
              key={inspection.id}
              inspection={inspection}
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
      title={t('insp.title')}
      subtitle={t(eccs ? (role === 'SUPERVISOR' ? 'insp.helpSupervisor' : 'insp.helpAdmin') : 'insp.helpRestaurant')}
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

      {eccs && <Button icon="add" label={t('insp.start')} onPress={() => router.push('/inspections/start')} />}

      <ErrorText message={error} onRetry={() => void load()} />
      {/* No signal: this is the phone's own copy, and how old it is. */}
      {!hasSignal && saved && <SavedCopyNote at={saved.at} />}
      {(outletLoading || (inspections === null && !error)) && <ActivityIndicator color={theme.primary} />}

      {inspections !== null && all.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t(eccs ? 'insp.none' : 'insp.noReports')}
        </ThemedText>
      )}

      {eccs ? (
        <>
          {group(t('insp.underWay'), underWay)}
          {group(t('insp.toDo'), toDo)}
          {group(t('insp.withEccs'), withEccs)}
          {group(t('insp.approved'), approved)}
        </>
      ) : (
        // A restaurant is only ever sent approved reports, newest first.
        all.map((inspection) => <InspectionCard key={inspection.id} inspection={inspection} />)
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sectionGap: { marginTop: Spacing.four },
});
