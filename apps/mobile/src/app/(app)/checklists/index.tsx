import Ionicons from '@expo/vector-icons/Ionicons';
import { can, localize, type ChecklistRunDto, type ChecklistRunSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/** Today's checklists for the outlet, and how the last week went. */
export default function ChecklistsScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const [runs, setRuns] = useState<ChecklistRunDto[] | null>(null);
  const [history, setHistory] = useState<ChecklistRunSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const memberships = user?.memberships ?? [];
  const mayEditLists = can(memberships, 'checklists', 'update');

  // Reloads whenever the screen comes back into view, so progress made on a checklist shows here.
  useFocusEffect(
    useCallback(() => {
      if (!outletId) return;
      let cancelled = false;
      (async () => {
        try {
          const [todayRuns, recent] = await Promise.all([api.checklists.today(outletId), api.checklists.history(outletId, 7)]);
          if (cancelled) return;
          setRuns(todayRuns);
          setHistory(recent);
          setError(null);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e, t));
        }
      })();
      return () => {
        cancelled = true;
      };
      // `t` changes with language; reloading for that is unnecessary.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, outletId]),
  );

  const open = (runId: string) => router.push({ pathname: '/checklists/[runId]', params: { runId } });
  const today = runs?.[0]?.date;
  const earlier = history.filter((row) => row.date !== today);

  return (
    <Screen back title={t('checklists.title')} subtitle={t('checklists.photoRule')}>
      {outlets.length > 1 && (
        <View style={styles.outlets} accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => {
            const selected = outlet.id === outletId;
            return (
              <Pressable
                key={outlet.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setRuns(null);
                  choose(outlet.id);
                }}
                style={[
                  styles.outlet,
                  { borderColor: selected ? theme.primary : theme.border },
                  selected && { backgroundColor: theme.backgroundElement },
                ]}>
                <ThemedText type="small" themeColor={selected ? 'primary' : 'text'}>
                  {outlet.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}

      <ErrorText message={error} />
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
      {runs?.map((run) => {
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
            <StatusBadge status={run.status} reviewed={run.reviewedAt !== null} />
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
              {row.date}
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
  outlet: {
    minHeight: MinTouchSize - 8,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
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
