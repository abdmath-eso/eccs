import Ionicons from '@expo/vector-icons/Ionicons';
import { topScoreFactors, type HygieneScoreDto, type ScoreExplanationDto } from '@eccs/shared';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AiNote } from '@/components/ai-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAiFeatures } from '@/lib/ai';
import { isNoSignal, useOutbox } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';

type Shown =
  | { key: string; status: 'loading' | 'failed' | 'noSignal' }
  | { key: string; status: 'shown'; explanation: ScoreExplanationDto };

/**
 * "Why this score?" (14 Oct 2026): for the Owner and the Manager, a quiet button
 * that opens three short sentences written by AI from the score's own numbers: what
 * pulled it down most, and the one or two things to do first. It follows Microsoft's
 * guidelines for human-AI interaction: it says it was written by AI and that the
 * numbers are the app's (G2, G11), and asks "Helpful?" with a thumb up or down
 * (G15). If AI cannot answer, it says so and points to the plain list of what is
 * costing points, which is always on screen. Without signal it says "Needs signal".
 * Hidden when AI is off, for the Head Chef (no breakdown), and when nothing is
 * costing points.
 */
export function ScoreExplain({ score }: { score: HygieneScoreDto }) {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const features = useAiFeatures();
  const { online } = useOutbox();
  const [shown, setShown] = useState<Shown | null>(null);
  const [vote, setVote] = useState<{ id: string; helpful: boolean } | null>(null);

  const losing = score.detail ? topScoreFactors(score.detail.components).length > 0 : false;
  if (!features['explain-score'] || !score.detail || score.score === null || !losing) return null;

  // An answer belongs to one outlet, day and language; after a change it is closed again.
  const key = `${score.outletId}|${score.date}|${language}`;
  const current = shown?.key === key ? shown : null;
  const offline = online === false;

  async function open() {
    setShown({ key, status: 'loading' });
    try {
      const explanation = await api.scores.explain(score.outletId);
      setShown((now) => (now?.key === key ? { key, status: 'shown', explanation } : now));
    } catch (e) {
      setShown((now) => (now?.key === key ? { key, status: isNoSignal(e) ? 'noSignal' : 'failed' } : now));
    }
  }

  function rate(explanation: ScoreExplanationDto, helpful: boolean) {
    setVote({ id: explanation.aiRequestId, helpful });
    void api.ai.outcome(explanation.aiRequestId, helpful ? 'HELPFUL' : 'NOT_HELPFUL').catch(() => undefined);
  }

  const explanation = current?.status === 'shown' ? current.explanation : null;
  const helpful = explanation ? (vote?.id === explanation.aiRequestId ? vote.helpful : explanation.helpful) : null;
  const thumb = (up: boolean) => {
    const chosen = helpful === up;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(up ? 'ai.helpfulYes' : 'ai.helpfulNo')}
        accessibilityState={{ selected: chosen }}
        onPress={() => explanation && rate(explanation, up)}
        style={[styles.thumb, { borderColor: chosen ? theme.primary : theme.outline }]}>
        <Ionicons
          name={up ? (chosen ? 'thumbs-up' : 'thumbs-up-outline') : chosen ? 'thumbs-down' : 'thumbs-down-outline'}
          size={22}
          color={chosen ? theme.primary : theme.textSecondary}
        />
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <Button
        variant="link"
        icon="sparkles-outline"
        label={current ? t('ai.hide') : t('ai.whyScore')}
        hint={offline && !current ? t('ai.needsSignal') : undefined}
        disabled={offline && !current}
        onPress={() => (current ? setShown(null) : void open())}
      />
      {current?.status === 'loading' && <ActivityIndicator color={theme.primary} accessibilityLabel={t('ai.working')} />}
      {(current?.status === 'failed' || current?.status === 'noSignal') && (
        <ThemedText type="small" themeColor="textSecondary">
          {current.status === 'noSignal' ? t('ai.needsSignal') : t('ai.explainFailed')}
        </ThemedText>
      )}
      {explanation && (
        <View style={[styles.box, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
          {explanation.sentences.map((sentence, index) => (
            <ThemedText key={index} type="default">
              {sentence}
            </ThemedText>
          ))}
          <AiNote text={t('ai.writtenNote')} />
          <View style={styles.helpful}>
            <ThemedText type="small" themeColor="textSecondary">
              {helpful === null ? t('ai.helpful') : t('ai.thanks')}
            </ThemedText>
            {thumb(true)}
            {thumb(false)}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  box: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  helpful: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  thumb: {
    minWidth: MinTouchSize,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: MinTouchSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
