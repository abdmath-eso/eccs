import Ionicons from '@expo/vector-icons/Ionicons';
import { LANGUAGE_CODES, LANGUAGE_ENGLISH_NAMES, LANGUAGE_NAMES } from '@eccs/i18n';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/**
 * Shows the language in use; tapping it opens the list of languages, each
 * written in its own script so anyone can find theirs whatever the app is
 * currently set to.
 */
export function LanguagePicker() {
  const theme = useTheme();
  const { language, setLanguage, t } = useSession();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('common.language')}: ${LANGUAGE_NAMES[language]}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          { borderColor: theme.border, backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
        ]}>
        <Ionicons name="globe-outline" size={22} color={theme.primary} />
        <ThemedText type="default" style={styles.current}>
          {LANGUAGE_NAMES[language]}
        </ThemedText>
        <Ionicons name="chevron-down" size={20} color={theme.textSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.root}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Spacing.three + insets.bottom }]}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.title}>
              {t('common.language')}
            </ThemedText>
            <ScrollView style={styles.list}>
              {LANGUAGE_CODES.map((code) => {
                const selected = code === language;
                return (
                  <Pressable
                    key={code}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={LANGUAGE_ENGLISH_NAMES[code]}
                    onPress={() => {
                      setOpen(false);
                      void setLanguage(code).catch(() => undefined);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      (pressed || selected) && { backgroundColor: theme.backgroundElement },
                    ]}>
                    <View style={styles.names}>
                      <ThemedText type="default" themeColor={selected ? 'primary' : 'text'} style={styles.native}>
                        {LANGUAGE_NAMES[code]}
                      </ThemedText>
                      {/* The English name too, for someone helping who cannot read the script. */}
                      {LANGUAGE_NAMES[code] !== LANGUAGE_ENGLISH_NAMES[code] && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {LANGUAGE_ENGLISH_NAMES[code]}
                        </ThemedText>
                      )}
                    </View>
                    {selected && <Ionicons name="checkmark" size={24} color={theme.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button label={t('common.cancel')} variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  current: { flex: 1, fontWeight: 700 },
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    maxHeight: '80%',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  title: { paddingHorizontal: Spacing.two },
  list: { flexGrow: 0 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize + Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
  },
  names: { flex: 1 },
  native: { fontWeight: 700, fontSize: 18 },
});
