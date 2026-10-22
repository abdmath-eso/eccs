import Ionicons from '@expo/vector-icons/Ionicons';
import { can, localize, type ChecklistRunDto, type ChecklistRunSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { StatusChip } from '@/components/ui/status-chip';
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
  // The day of the last week opened to show its checklists, if any.
  const [openDay, setOpenDay] = useState<string | null>(null);

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
  // The last week one line per day, newest first; a day opens to its checklists (22 Oct 2026: they
  // were 28 cards, each repeating its date and "Missed").
  const earlierDays: { date: string; rows: ChecklistRunSummaryDto[] }[] = [];
  for (const row of history.filter((entry) => entry.date !== today).sort((a, b) => b.date.localeCompare(a.date))) {
    const last = earlierDays[earlierDays.length - 1];
    if (last?.date === row.date) last.rows.push(row);
    else earlierDays.push({ date: row.date, rows: [row] });
  }

  return (
    <Screen
      back
      title={t('checklists.title')}
      onRefresh={async () => {
        // Pulling down also sends anything still waiting, without waiting for the next automatic try.
        outbox.kick();
        await load();
      }}>
      <OutletPicker
        outlets={outlets}
        outletId={outletId}
        onChoose={(nextOutletId) => {
          setError(null);
          choose(nextOutletId);
        }}
      />

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (runs === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}
      {runs?.length === 0 && <EmptyState icon="clipboard-outline" title={t('checklists.empty')} />}

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
          // The same card as Home's: the title, one state label under it, the progress line, the arrow.
          <Card key={run.id} variant="filled" onPress={() => open(run.id)} chevron>
            <View style={styles.cardHeader}>
              <ThemedText type="default" style={styles.cardTitle}>
                {localize(run.title, language)}
              </ThemedText>
              {/* Red warnings in the corner (the founder's choice, 5 Oct 2026): past its due time, and problems reported inside. */}
              {run.isOverdue && (
                <Ionicons name="time-outline" size={26} color={theme.danger} accessibilityLabel={t('checklists.overdue')} />
              )}
              {problems > 0 && (
                <Ionicons
                  name="alert-circle"
                  size={26}
                  color={theme.danger}
                  accessibilityLabel={t('checklists.hasProblems', { count: problems })}
                />
              )}
            </View>
            {/* Not shown as "Submitted" until the server has it: until then nobody else can see it. */}
            <StatusBadge
              status={view.submitPending ? 'IN_PROGRESS' : run.status}
              reviewed={run.reviewedAt !== null}
              overdue={run.isOverdue}
            />
            {view.submitPending ? (
              <UnsentMark sending={hasSignal} text={t('offline.submitWaiting')} />
            ) : (
              view.unsent > 0 && <UnsentMark sending={hasSignal} text={t('offline.runUnsent', { count: view.unsent })} />
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {t('checklists.progress', { done, total: run.items.length })}
              {run.dueTime && run.status !== 'SUBMITTED'
                ? ` · ${t('checklists.due', { time: formatTime(run.dueTime, language) })}`
                : ''}
            </ThemedText>
            {problems > 0 && (
              <ThemedText type="small" themeColor="danger">
                {t('checklists.hasProblems', { count: problems })}
              </ThemedText>
            )}
          </Card>
        );
      })}

      {mayEditLists && outletId && (
        <Button
          label={t('checklists.editLists')}
          variant="secondary"
          onPress={() => router.push({ pathname: '/checklists/setup', params: { outletId } })}
        />
      )}

      {earlierDays.length > 0 && (
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
          {t('checklists.recent')}
        </ThemedText>
      )}
      {/* Plain rows with thin lines between them, one per day (Material 3 lists; an expanding row, as
          Android's grouped notifications open): the day, how it went, and its checklists when opened. */}
      {earlierDays.length > 0 && (
        <View>
          {earlierDays.map((day, index) => {
            const missed = day.rows.filter((row) => row.status !== 'SUBMITTED').length;
            const problems = day.rows.reduce((sum, row) => sum + row.problemCount, 0);
            const isOpen = openDay === day.date;
            return (
              <View key={day.date}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  onPress={() => setOpenDay(isOpen ? null : day.date)}
                  style={({ pressed }) => [
                    styles.dayRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    pressed && { backgroundColor: theme.backgroundElement },
                  ]}>
                  <View style={styles.dayText}>
                    <ThemedText type="default" style={styles.dayTitle}>
                      {formatDayShort(day.date, language)}
                    </ThemedText>
                    {missed > 0 ? (
                      <StatusChip tone="bad" icon="alert" label={t('checklists.dayMissed', { count: missed, total: day.rows.length })} />
                    ) : (
                      <StatusChip tone="good" icon="checkmark" label={t('checklists.dayAllIn', { total: day.rows.length })} />
                    )}
                    {problems > 0 && (
                      <ThemedText type="small" themeColor="danger">
                        {t('checklists.problems', { count: problems })}
                      </ThemedText>
                    )}
                  </View>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={22} color={theme.textSecondary} />
                </Pressable>
                {isOpen && (
                  // The day's checklists, set in under their day, each opening as before.
                  <View style={styles.dayRuns}>
                    {day.rows.map((row) => (
                      <ListRow
                        key={row.id}
                        divider
                        strong={false}
                        title={localize(row.title, language)}
                        below={
                          <>
                            <StatusBadge status={row.status} reviewed={row.reviewedAt !== null} />
                            {row.problemCount > 0 && (
                              <ThemedText type="small" themeColor="danger">
                                {t('checklists.problems', { count: row.problemCount })}
                              </ThemedText>
                            )}
                          </>
                        }
                        onPress={() => open(row.id)}
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  sectionGap: { marginTop: Spacing.three },
  // As tall as a shared list row (ui/list-row), so the week reads as one plain list.
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouchSize + Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  dayText: { flex: 1, gap: Spacing.one },
  dayTitle: { fontWeight: 700 },
  // Set in by the phone margin, as Material 3 insets the lines of nested items.
  dayRuns: { paddingStart: Spacing.three },
});
