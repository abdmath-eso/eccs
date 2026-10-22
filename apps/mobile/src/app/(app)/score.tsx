import Ionicons from '@expo/vector-icons/Ionicons';
import type { HygieneScoreDto, ScoreComponentKey, ScoreComponentResult } from '@eccs/shared';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScoreExplain } from '@/components/score-explain';
import { ScoreHeadline, ScoreTrend, useReasonText } from '@/components/score-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Expandable } from '@/components/ui/expandable';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// Where each part of the score is put right, and what the button to go there says.
const FIX: Record<ScoreComponentKey, { href: Href; label: 'checklists' | 'documents' | 'inspections' }> = {
  inspection: { href: '/inspections', label: 'inspections' },
  licences: { href: '/documents', label: 'documents' },
  checklists: { href: '/checklists', label: 'checklists' },
};

/** Points as people read them: "7.5", but "30" rather than "30.0". */
const points = (value: number) => String(Math.round(value * 10) / 10);

/**
 * The hygiene score in full: the number, then every part it is made of with its
 * points, what cost points and where to put that right, then the last 30 days.
 * Nothing about the score is hidden: the parts add up to the number.
 */
export default function ScoreScreen() {
  const theme = useTheme();
  const { t, api } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const reasonText = useReasonText();
  const [loaded, setLoaded] = useState<HygieneScoreDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!outletId) return;
    try {
      setLoaded(await api.scores.get(outletId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId]);

  // Reloads on coming back, so fixing something on another screen shows here straight away.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const score = loaded?.outletId === outletId ? loaded : null;
  const detail = score?.detail ?? null;

  const part = (entry: ScoreComponentResult) => {
    const name = t(`score.part.${entry.key}`);
    const fix = FIX[entry.key];
    return (
      // The shared card; a dashed edge, as well as the words, marks a part that is not counted yet.
      <Card key={entry.key} style={!entry.measured && styles.partNotMeasured}>
        <View
          style={styles.partTop}
          accessible
          accessibilityLabel={
            entry.measured
              ? t('score.pointsA11y', { name, earned: points(entry.earned), max: entry.max })
              : `${name}: ${t('score.notMeasured')}`
          }>
          <ThemedText type="default" style={styles.partName}>
            {name}
          </ThemedText>
          <ThemedText type="default" themeColor={entry.measured ? 'text' : 'textSecondary'} style={styles.partPoints}>
            {entry.measured ? t('score.points', { earned: points(entry.earned), max: entry.max }) : t('score.notMeasured')}
          </ThemedText>
        </View>
        {entry.measured && (
          // How much of this part's points were earned. The numbers above say the same thing.
          <View style={[styles.meter, { backgroundColor: theme.backgroundSelected }]}>
            <View style={[styles.meterFill, { width: `${(entry.earned / entry.max) * 100}%`, backgroundColor: theme.primary }]} />
          </View>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          {t(entry.measured ? `score.about.${entry.key}` : `score.empty.${entry.key}`)}
        </ThemedText>
        {entry.key === 'checklists' && entry.measured && score?.checklistsDay === 'YESTERDAY' && (
          <ThemedText type="small" themeColor="textSecondary">
            {t('score.checklistsYesterday')}
          </ThemedText>
        )}
        {entry.reasons.map((reason) => (
          <View key={reason.code} style={styles.reason}>
            <Ionicons
              name={reason.lost > 0 ? 'alert-circle' : 'information-circle-outline'}
              size={20}
              color={reason.lost > 0 ? theme.warning : theme.textSecondary}
            />
            <View style={styles.reasonText}>
              <ThemedText type="small">{reasonText(reason)}</ThemedText>
              {reason.lost > 0 && (
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('score.lost', { points: points(reason.lost) })}
                </ThemedText>
              )}
            </View>
          </View>
        ))}
        {entry.reasons.some((reason) => reason.lost > 0) && (
          <Button variant="secondary" label={t(`score.open.${fix.label}`)} onPress={() => router.push(fix.href)} />
        )}
      </Card>
    );
  };

  return (
    <Screen back title={t('score.title')} onRefresh={load}>
      <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (score === null && !error)) && <ActivityIndicator color={theme.primary} />}

      {score && (
        <>
          <ScoreHeadline score={score} />
          <ScoreExplain score={score} />
          {detail && (
            <>
              {/* The parts first; how they make the number is read once, so it is folded under them
                  (the founder's rule: main part first; Nielsen Norman Group on progressive disclosure). */}
              {detail.components.map(part)}
              <Expandable title={t('score.howTitle')} icon="information-circle-outline">
                <ThemedText type="small">{t('score.how')}</ThemedText>
                {score.provisional && <ThemedText type="small">{t('score.provisionalHelp')}</ThemedText>}
                {detail.possible > 0 && score.score !== null && (
                  <ThemedText type="small">
                    {t('score.total', { earned: points(detail.earned), possible: detail.possible, score: score.score })}
                  </ThemedText>
                )}
              </Expandable>

              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
                {t('score.trend')}
              </ThemedText>
              <ScoreTrend history={detail.history} today={score.date} />
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: Spacing.three },
  partNotMeasured: { borderStyle: 'dashed' },
  partTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  partName: { flex: 1, fontWeight: 700 },
  partPoints: { fontWeight: 700 },
  meter: { height: 8, borderRadius: 4, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  reasonText: { flex: 1, gap: Spacing.half },
});
