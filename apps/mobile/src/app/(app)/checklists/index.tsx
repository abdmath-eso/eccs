import Ionicons from '@expo/vector-icons/Ionicons';
import { can, localize, type ChecklistRunDto, type ChecklistRunSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { UnsentMark } from '@/components/unsent-mark';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDayShort, formatTime } from '@/lib/format';
import { checklistCache } from '@/lib/offline/checklist-cache';
import { isNoSignal, outbox, useOutbox } from '@/lib/offline/outbox';
import { applyPending } from '@/lib/offline/outbox-core';
import { useSession } from '@/lib/session';
import { recallOutlet, useOutlet } from '@/lib/use-outlet';

/**
 * Today's checklists for the outlet, and how the last week went.
 *
 * The list is kept on the phone each time it loads, so with no signal it is
 * shown from there and today's checklists can still be opened and filled in.
 * Answers still waiting to be sent are counted in, and marked as not sent yet.
 */
export default function ChecklistsScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { outletId: knownOutletId, outlets, loading: outletLoading, choose } = useOutlet();
  const box = useOutbox();
  const [error, setError] = useState<string | null>(null);

  // An Owner's outlets are listed by the server. With no signal that list is empty,
  // so fall back to the outlet last chosen on this phone.
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void recallOutlet().then((value) => !cancelled && setRemembered(value));
    return () => {
      cancelled = true;
    };
  }, []);
  const outletId = knownOutletId ?? (outletLoading ? null : remembered);

  const userId = user?.id ?? null;
  const myName = user?.name ?? null;
  // False only once the server could not be reached; the line at the bottom of the app says so.
  const hasSignal = box.online !== false;

  // Today's list as the server last sent it, from the copy kept on the phone.
  const getSaved = useCallback(() => checklistCache.getToday(outletId), [outletId]);
  const saved = useSyncExternalStore(checklistCache.subscribe, getSaved, getSaved);
  const runs: ChecklistRunDto[] | null = saved?.runs ?? null;
  const history: ChecklistRunSummaryDto[] = saved?.history ?? [];

  const memberships = user?.memberships ?? [];
  const mayEditLists = can(memberships, 'checklists', 'update');

  // Counts the loads started, so an answer for an outlet the person has since left is ignored.
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    if (!outletId || !userId) return;
    const mine = ++latestLoad.current;
    await checklistCache.load(userId);
    try {
      const [todayRuns, recent] = await Promise.all([api.checklists.today(outletId), api.checklists.history(outletId, 7)]);
      checklistCache.putToday(outletId, todayRuns, recent);
      outbox.noteReachable(true);
      if (mine === latestLoad.current) setError(null);
    } catch (e) {
      const noSignal = isNoSignal(e);
      if (noSignal) outbox.noteReachable(false);
      if (mine !== latestLoad.current) return;
      // With no signal the copy on the phone stays on screen, which is not an error.
      setError(noSignal && checklistCache.getToday(outletId) ? null : errorMessage(e, t));
    }
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, userId]);

  // Reloads whenever the screen comes back into view, so progress made on a checklist shows here.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // And again the moment the signal comes back.
  useEffect(() => {
    let before = outbox.getSnapshot().online;
    return outbox.subscribe(() => {
      const now = outbox.getSnapshot().online;
      if (before === false && now === true) void load();
      before = now;
    });
  }, [load]);

  const open = (runId: string) => router.push({ pathname: '/checklists/[runId]', params: { runId } });
  const today = runs?.[0]?.date;
  const earlier = history.filter((row) => row.date !== today);

  return (
    <Screen
      back
      title={t('checklists.title')}
      subtitle={t('checklists.photoRule')}
      onRefresh={async () => {
        // Pulling down also sends anything still waiting, without waiting for the next automatic try.
        outbox.kick();
        await load();
      }}>
      {outlets.length > 1 && (
        <View style={styles.outlets} accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => {
                setError(null);
                choose(outlet.id);
              }}
            />
          ))}
        </View>
      )}

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (runs === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}
      {runs?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('checklists.empty')}
        </ThemedText>
      )}

      {runs && runs.length > 0 && (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('checklists.today')}
        </ThemedText>
      )}
      {runs?.map((fromServer) => {
        // The server's copy with this person's waiting answers counted in.
        const view = applyPending(fromServer, box.ops, myName);
        const run = view.run;
        const done = run.items.filter((item) => item.response).length;
        const problems = run.items.filter((item) => item.response?.passed === false).length;
        return (
          <Pressable
            key={run.id}
            accessibilityRole="button"
            onPress={() => open(run.id)}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <View style={styles.cardHeader}>
              <ThemedText type="default" style={styles.cardTitle}>
                {localize(run.title, language)}
              </ThemedText>
              {/* Red warnings in the corner: past its due time, and problems reported inside. */}
              {run.isOverdue && (
                <Ionicons name="time" size={28} color={theme.danger} accessibilityLabel={t('checklists.overdue')} />
              )}
              {problems > 0 && (
                <Ionicons
                  name="alert-circle"
                  size={28}
                  color={theme.danger}
                  accessibilityLabel={t('checklists.hasProblems', { count: problems })}
                />
              )}
            </View>
            {/* Not shown as "Submitted" until the server has it: until then nobody else can see it. */}
            <StatusBadge status={view.submitPending ? 'IN_PROGRESS' : run.status} reviewed={run.reviewedAt !== null} />
            {view.submitPending ? (
              <UnsentMark sending={hasSignal} text={t('offline.submitWaiting')} />
            ) : (
              view.unsent > 0 && <UnsentMark sending={hasSignal} text={t('offline.runUnsent', { count: view.unsent })} />
            )}
            <ThemedText type="small" themeColor={run.isOverdue ? 'danger' : 'textSecondary'}>
              {t('checklists.progress', { done, total: run.items.length })}
              {run.dueTime && run.status !== 'SUBMITTED'
                ? ` · ${t('checklists.due', { time: formatTime(run.dueTime, language) })}`
                : ''}
              {run.isOverdue ? ` · ${t('checklists.overdue')}` : ''}
            </ThemedText>
            {problems > 0 && (
              <ThemedText type="small" themeColor="danger">
                {t('checklists.hasProblems', { count: problems })}
              </ThemedText>
            )}
          </Pressable>
        );
      })}

      {mayEditLists && outletId && (
        <Button
          label={t('checklists.editLists')}
          variant="secondary"
          onPress={() => router.push({ pathname: '/checklists/setup', params: { outletId } })}
        />
      )}

      {earlier.length > 0 && (
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
          {t('checklists.recent')}
        </ThemedText>
      )}
      {earlier.map((row) => (
        <Pressable
          key={row.id}
          accessibilityRole="button"
          onPress={() => open(row.id)}
          style={[styles.historyRow, { borderColor: theme.border }]}>
          <View style={styles.historyText}>
            <ThemedText type="default">{localize(row.title, language)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatDayShort(row.date, language)}
              {row.problemCount > 0 ? ` · ${t('checklists.problems', { count: row.problemCount })}` : ''}
            </ThemedText>
          </View>
          {row.problemCount > 0 && (
            <Ionicons
              name="alert-circle"
              size={24}
              color={theme.danger}
              accessibilityLabel={t('checklists.hasProblems', { count: row.problemCount })}
            />
          )}
          <StatusBadge status={row.status} reviewed={row.reviewedAt !== null} />
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  outlets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two, minHeight: MinTouchSize * 1.6 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  sectionGap: { marginTop: Spacing.three },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: MinTouchSize,
  },
  historyText: { flex: 1, gap: Spacing.half },
});
