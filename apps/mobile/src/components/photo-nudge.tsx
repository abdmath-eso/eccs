import Ionicons from '@expo/vector-icons/Ionicons';
import type { PhotoNudge } from '@eccs/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/**
 * The nudge at the camera (14 Oct 2026): a quiet notice under a checklist proof photo
 * that AI found clearly unusable as proof ("This photo looks blurred. Retake?"), with
 * Retake and Keep it. It follows the real-time capture feedback of identity-check
 * apps (didit, iDenfy, Shufti Pro: "too dark", "blurred", "retake"): say it at once
 * and let the person retake, never refuse the photo. It never marks or fails the
 * item, and nobody else ever sees it; the label says so (Microsoft HAX G1, G2).
 */
export function PhotoNudgeNotice({
  nudge,
  check,
  onRetake,
  onKeep,
}: {
  nudge: PhotoNudge;
  /** The check's wording, for "doesn't seem to show …". */
  check: string;
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
          {t(`ai.nudge.${nudge}`, { check })}
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
        {t('ai.nudge.note')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderStyle: 'dashed', borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1 },
});
