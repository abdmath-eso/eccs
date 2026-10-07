import Ionicons from '@expo/vector-icons/Ionicons';
import {
  topScoreFactors,
  type HygieneScoreDto,
  type ScoreBand,
  type ScoreHistoryPointDto,
  type ScoreReason,
} from '@eccs/shared';
import { router } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDayShort } from '@/lib/format';
import { useSession } from '@/lib/session';
import { rememberOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Each band has its own picture as well as its own colour, so it reads without colour.
const BAND_ICON: Record<ScoreBand, IconName> = {
  EXCELLENT: 'ribbon',
  GOOD: 'checkmark-circle',
  FAIR: 'remove-circle',
  NEEDS_ATTENTION: 'alert-circle',
};

/** The sentence for one thing that cost points, e.g. "Checklists not handed in this week: 2 of 14". */
export function useReasonText() {
  const { t } = useSession();
  return (reason: ScoreReason) =>
    t(`score.reason.${reason.code}`, { count: reason.count, total: reason.total ?? reason.count });
}

/**
 * The score itself: the number out of 100, the word for its band with a picture,
 * and whether it went up or down since last week. Before there is enough to go
 * on it says so instead of showing a number.
 */
export function ScoreHeadline({ score }: { score: HygieneScoreDto }) {
  const theme = useTheme();
  const { t } = useSession();

  if (score.score === null || score.band === null) {
    return (
      <View style={styles.headlineText}>
        <ThemedText type="subtitle">{t('score.notYet')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('score.notYetHelp', { count: 3 })}
        </ThemedText>
      </View>
    );
  }

  const bandColor =
    score.band === 'NEEDS_ATTENTION' ? theme.danger : score.band === 'FAIR' ? theme.warning : theme.primary;
  const band = t(`score.band.${score.band}`);
  const change = score.change;

  return (
    <View style={styles.headline} accessible accessibilityLabel={t('score.a11y', { score: score.score, band })}>
      <View style={styles.numberRow}>
        <ThemedText type="title" style={styles.number}>
          {score.score}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.outOf}>
          {t('score.outOf')}
        </ThemedText>
      </View>
      <View style={styles.headlineText}>
        <View style={[styles.band, { borderColor: bandColor }]}>
          <Ionicons name={BAND_ICON[score.band]} size={18} color={bandColor} />
          <ThemedText type="smallBold" style={{ color: bandColor }}>
            {band}
          </ThemedText>
        </View>
        {change !== null && (
          <View style={styles.change}>
            {/* The arrow and the word both say which way it went. */}
            <Ionicons
              name={change > 0 ? 'arrow-up' : change < 0 ? 'arrow-down' : 'remove'}
              size={16}
              color={change > 0 ? theme.primary : change < 0 ? theme.danger : theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.changeText}>
              {change === 0 ? t('score.same') : t(change > 0 ? 'score.up' : 'score.down', { points: Math.abs(change) })}
            </ThemedText>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * The hygiene score on the home screen, for the outlet chosen there. The Owner
 * and Manager also see the one or two things costing the most points, and can
 * tap through to the full breakdown; the Head Chef sees the number and band.
 * `stamp` changes whenever Home reloads, so the score is fetched again with it.
 */
export function ScoreCard({ outletId, stamp }: { outletId: string; stamp: number }) {
  const theme = useTheme();
  const { t, api } = useSession();
  const { forwardIcon } = useDirection();
  const reasonText = useReasonText();
  const [loaded, setLoaded] = useState<HygieneScoreDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.scores
      .get(outletId)
      .then((fresh) => {
        if (cancelled) return;
        setLoaded(fresh);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, t));
      });
    return () => {
      cancelled = true;
    };
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, stamp, attempt]);

  // After the Owner picks another outlet, the last outlet's score must not be shown as this one's.
  const score = loaded?.outletId === outletId ? loaded : null;

  if (!score) {
    return (
      <View style={[styles.card, { borderColor: theme.border }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('score.title')}
        </ThemedText>
        {error ? <ErrorText message={error} onRetry={() => setAttempt((n) => n + 1)} /> : <ActivityIndicator color={theme.primary} />}
      </View>
    );
  }

  const factors = score.detail ? topScoreFactors(score.detail.components) : [];
  const body = (
    <>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('score.title')}
      </ThemedText>
      <ScoreHeadline score={score} />
      {score.detail && score.score !== null && (
        <View style={styles.factors}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t(factors.length > 0 ? 'score.costing' : 'score.nothingLost')}
          </ThemedText>
          {factors.map((factor) => (
            <View key={factor.reason.code} style={styles.factor}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.warning} />
              <ThemedText type="small" style={styles.factorText}>
                {reasonText(factor.reason)}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
      {score.detail && (
        <View style={styles.more}>
          <ThemedText type="smallBold" themeColor="primary" style={styles.factorText}>
            {t('score.seeDetails')}
          </ThemedText>
          <Ionicons name={forwardIcon} size={18} color={theme.primary} />
        </View>
      )}
    </>
  );

  // The Head Chef has no breakdown to open.
  if (!score.detail) return <View style={[styles.card, { borderColor: theme.border }]}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t('score.seeDetails')}
      // The score screen works on one outlet at a time and remembers which.
      onPress={() => void rememberOutlet(outletId).then(() => router.push('/score'))}
      style={({ pressed }) => [styles.card, { borderColor: theme.outline }, pressed && { backgroundColor: theme.backgroundElement }]}>
      {body}
    </Pressable>
  );
}

const TREND_DAYS = 30;
const TREND_HEIGHT = 96;

/**
 * The score over the last 30 days as one thin bar per day, from 0 at the bottom
 * to 100 at the top; a day with no score leaves a gap. Touching or sliding along
 * the chart picks a day, whose date and score are written out underneath, so the
 * exact numbers never depend on judging a bar by eye. Time always runs from left
 * to right, in Urdu too, as charts do.
 */
export function ScoreTrend({ history, today }: { history: ScoreHistoryPointDto[]; today: string }) {
  const theme = useTheme();
  const { t, language } = useSession();
  const [picked, setPicked] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  if (history.length < 2) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        {t('score.trendEmpty')}
      </ThemedText>
    );
  }

  const first = addDays(today, -(TREND_DAYS - 1));
  const days = Array.from({ length: TREND_DAYS }, (_, index) => addDays(first, index));
  const byDate = new Map(history.map((point) => [point.date, point.score]));
  const latest = history[history.length - 1]!;
  const shown = history.find((point) => point.date === picked) ?? latest;
  const values = history.map((point) => point.score);

  /** Picks the day with a score that is nearest to where the finger is. */
  const pick = (event: GestureResponderEvent) => {
    if (width <= 0) return;
    const index = Math.min(TREND_DAYS - 1, Math.max(0, Math.floor((event.nativeEvent.locationX / width) * TREND_DAYS)));
    const nearest = [...history].sort(
      (a, b) => Math.abs(days.indexOf(a.date) - index) - Math.abs(days.indexOf(b.date) - index),
    )[0];
    if (nearest) setPicked(nearest.date);
  };

  return (
    <View style={styles.trend}>
      <View style={styles.trendScale}>
        <ThemedText type="small" themeColor="textSecondary">
          100
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          0
        </ThemedText>
      </View>
      <View style={styles.trendBody}>
        <DirectionView
          direction="ltr"
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('score.trendA11y', { min: Math.min(...values), max: Math.max(...values), latest: latest.score })}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={pick}
          onResponderMove={pick}
          style={[styles.trendPlot, { borderColor: theme.border }]}>
          {days.map((day) => {
            const value = byDate.get(day);
            return (
              // The bars take no touches themselves, so the finger's place is measured across the whole chart.
              <View key={day} pointerEvents="none" style={styles.trendSlot}>
                {value !== undefined && (
                  <View
                    style={[
                      styles.trendBar,
                      { height: Math.max((value / 100) * TREND_HEIGHT, 2), backgroundColor: theme.primary },
                      day !== shown.date && styles.trendBarQuiet,
                    ]}
                  />
                )}
              </View>
            );
          })}
        </DirectionView>
        <DirectionView direction="ltr" style={styles.trendDates}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDayShort(first, language)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDayShort(today, language)}
          </ThemedText>
        </DirectionView>
        <ThemedText type="smallBold" accessibilityLiveRegion="polite">
          {t('score.trendDay', { date: formatDayShort(shown.date, language), score: shown.score })}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('score.trendTap')}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    minHeight: MinTouchSize,
  },
  headline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  numberRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  number: { fontSize: 52, lineHeight: 58, fontWeight: 700 },
  outOf: { fontSize: 13 },
  headlineText: { flex: 1, minWidth: 140, gap: Spacing.one },
  band: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1.5,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.half,
  },
  change: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  changeText: { flex: 1 },
  factors: { gap: Spacing.one },
  factor: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one + Spacing.half },
  factorText: { flex: 1 },
  more: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.one },
  trend: { flexDirection: 'row', gap: Spacing.two },
  trendScale: { height: TREND_HEIGHT, justifyContent: 'space-between', alignItems: 'flex-end' },
  trendBody: { flex: 1, gap: Spacing.one },
  trendPlot: {
    // Time runs left to right whatever the language: the box is a DirectionView set to "ltr".
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: TREND_HEIGHT,
    gap: 2,
    borderBottomWidth: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  trendSlot: { flex: 1, height: TREND_HEIGHT, justifyContent: 'flex-end' },
  trendBar: { borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  trendBarQuiet: { opacity: 0.45 },
  trendDates: { flexDirection: 'row', justifyContent: 'space-between' },
});
