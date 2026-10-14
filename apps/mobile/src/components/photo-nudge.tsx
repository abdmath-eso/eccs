import Ionicons from '@expo/vector-icons/Ionicons';
import type { PhotoNudge } from '@eccs/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/**
 * The nudge at the camera (14 Oct 2026): a quiet notice under a checklist proof photo,
 * with Retake and Keep it, when AI found the photo clearly unusable as proof ("This
 * photo looks blurred. Retake?") or clearly showing the check not done ("This may not
 * be done yet: Two bottles still have water in them.").
 *
 * Patterns: real-time capture feedback in identity-check apps (didit, iDenfy, Shufti
 * Pro: "too dark", "blurred", "retake"): say it at once and let the person retake, never
 * refuse the photo. For "not done", AI photo verification in frontline task apps
 * (Xenia's AI photo verification, Palexy, CosaNostra) checks each photo against what the
 * task asks and flags the exceptions without blocking; here the flag goes only to the
 * person who took the photo, who decides. Microsoft HAX G2 (say it can be wrong: "Checked
 * by AI, which can be wrong") and G9 (overriding it is one tap: Keep it). It never marks
 * the item, never changes the answer, never stops Submit, and nobody else ever sees it.
 */
export function PhotoNudgeNotice({
  nudge,
  check,
  reason,
  onRetake,
  onKeep,
}: {
  nudge: PhotoNudge;
  /** The check's wording, for "doesn't seem to show …". */
  check: string;
  /** NOT_DONE only: what looks not done, in the person's language. */
  reason: string | null;
  onRetake: () => void;
  onKeep: () => void;
}) {
  const theme = useTheme();
  const { t } = useSession();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.box, { borderColor: theme.outline }]}>
      <View style={styles.row}>
        <Ionicons name="sparkles-outline" size={20} color={theme.warning} />
        <ThemedText type="default" style={styles.text}>
          {t(`ai.nudge.${nudge}`, { check, reason: reason ?? '' })}
        </ThemedText>
      </View>
      <View style={styles.row}>
        <View style={styles.text}>
          <Button icon="camera" label={t('ai.nudge.retake')} variant="secondary" onPress={onRetake} />
        </View>
        <View style={styles.text}>
          <Button label={t('ai.nudge.keep')} variant="link" onPress={onKeep} />
        </View>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {t('ai.nudge.mayBeWrong')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderStyle: 'dashed', borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1 },
});
