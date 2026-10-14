import Ionicons from '@expo/vector-icons/Ionicons';
import { LANGUAGE_NAMES, type LanguageCode } from '@eccs/i18n';
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
 * "Other languages filled in by AI." Shown once on the screens where the restaurant
 * writes its own checklist items, SOPs and label names, while that feature is on.
 */
export function OtherLanguagesNote() {
  const { t } = useSession();
  const features = useAiFeatures();
  return features['translate-content'] ? <AiNote text={t('ai.otherLanguages')} /> : null;
}

/**
 * A message shown in the reader's language when it was translated, the way messaging
 * apps do it (Microsoft Teams' inline translation): the translation, a "Translated
 * from English" mark, and "See original" to switch to the words as written (and "See
 * translation" back). With no translation, the message as written and nothing else.
 */
export function TranslatableText({ original, translation }: { original: string; translation?: AiTranslationDto | null }) {
  const theme = useTheme();
  const { t } = useSession();
  const [showOriginal, setShowOriginal] = useState(false);

  if (!translation) return <ThemedText type="default">{original}</ThemedText>;
  const from = translation.from === 'other' ? null : LANGUAGE_NAMES[translation.from.toUpperCase() as LanguageCode];
  return (
    <View style={styles.translatable}>
      <ThemedText type="default">{showOriginal ? original : translation.text}</ThemedText>
      <View style={styles.translatedRow}>
        {!showOriginal && (
          <>
            <Ionicons name="language-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              {from ? t('ai.translatedFrom', { language: from }) : t('ai.translated')}
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
