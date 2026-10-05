import { LANGUAGE_CODES, LANGUAGE_NAMES } from '@eccs/i18n';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/** Three buttons, each showing a language in its own script. */
export function LanguagePicker() {
  const theme = useTheme();
  const { language, setLanguage, t } = useSession();

  return (
    <View style={styles.row} accessibilityLabel={t('common.language')}>
      {LANGUAGE_CODES.map((code) => {
        const selected = code === language;
        return (
          <Pressable
            key={code}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => void setLanguage(code).catch(() => undefined)}
            style={[
              styles.option,
              { borderColor: selected ? theme.primary : theme.border },
              selected && { backgroundColor: theme.backgroundElement },
            ]}>
            <ThemedText type="default" themeColor={selected ? 'primary' : 'text'} style={styles.label}>
              {LANGUAGE_NAMES[code]}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  option: {
    flex: 1,
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  label: { fontWeight: 700 },
});
