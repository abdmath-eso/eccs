import Ionicons from '@expo/vector-icons/Ionicons';
import type { AiTranslationDto } from '@eccs/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAiFeatures } from '@/lib/ai';
import { useSession } from '@/lib/session';

// Small shared pieces for the AI features (14 Oct 2026). They follow Microsoft's
// guidelines for human-AI interaction (HAX): say plainly what the AI did and that it
// may be wrong (G1, G2), keep the original one tap away and correction easy (G9),
// and say why something is shown (G11). Every AI-made thing carries the same small
// sparkles mark, so it is recognised without reading.

/** One quiet line saying something was made by AI. */
export function AiNote({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.note}>
      <Ionicons name="sparkles-outline" size={16} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.noteText}>
        {text}
      </ThemedText>
    </View>
  );
}

/**
 * The small sparkles mark beside a field the AI filled in, with no words: the one line
 * at the top of the form says what it means ("Read by AI. Check each field before
 * saving."), so the note is not repeated under every field. Screen readers hear
 * `label`. The same pattern as the AI marks design systems put beside a field's label
 * (ServiceTitan's Anvil "AI marks", Cloudscape's generative-AI icon).
 */
export function AiMark({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <Ionicons name="sparkles" size={16} color={theme.primary} accessible accessibilityRole="image" accessibilityLabel={label} />
  );
}

/**
 * "Other languages filled in by AI." Shown on the screens where the restaurant writes
 * its own checklist items, SOPs and label names, while that feature is on: directly
 * under the box where they type, and only once something is typed (`typed`), so it
 * sits beside what it is about and not at the top of an empty screen.
 */
export function OtherLanguagesNote({ typed }: { typed: boolean }) {
  const { t } = useSession();
  const features = useAiFeatures();
  return features['translate-content'] && typed ? <AiNote text={t('ai.otherLanguages')} /> : null;
}

/**
 * A message shown in the reader's language when it was translated, the way messaging
 * apps do it (Microsoft Teams' inline translation, LinkedIn's "See translation"): the
 * translation, a "Translated by AI" mark, and "See original" to switch to the words as
 * written (and "See translation" back). With no translation, the message as written and
 * nothing else. The mark does not name the language it came from: an English language
 * name inside Telugu text read oddly on the first pictures.
 */
export function TranslatableText({ original, translation }: { original: string; translation?: AiTranslationDto | null }) {
  const theme = useTheme();
  const { t } = useSession();
  const [showOriginal, setShowOriginal] = useState(false);

  if (!translation) return <ThemedText type="default">{original}</ThemedText>;
  return (
    <View style={styles.translatable}>
      <ThemedText type="default">{showOriginal ? original : translation.text}</ThemedText>
      <View style={styles.translatedRow}>
        {!showOriginal && (
          <>
            <Ionicons name="language-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              {t('ai.translatedByAi')}
            </ThemedText>
          </>
        )}
        <Pressable
          accessibilityRole="button"
          hitSlop={14}
          onPress={() => setShowOriginal((current) => !current)}
          style={styles.switch}>
          <ThemedText type="smallBold" themeColor="primary">
            {showOriginal ? t('ai.seeTranslation') : t('ai.seeOriginal')}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  noteText: { flex: 1 },
  translatable: { gap: Spacing.one },
  translatedRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  switch: { paddingVertical: Spacing.one },
});
