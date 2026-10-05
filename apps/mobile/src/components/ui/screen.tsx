import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  /** Shows a back button that returns to the previous screen. */
  back?: boolean;
  /** Extra control on the right of the header. */
  headerRight?: ReactNode;
  children: ReactNode;
}

/** Standard page frame: safe area, optional back button and title, scrolling body. */
export function Screen({ title, subtitle, back, headerRight, children }: ScreenProps) {
  const theme = useTheme();
  const { t } = useSession();

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {(back || headerRight) && (
              <View style={styles.header}>
                {back ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
                    style={styles.back}>
                    <ThemedText type="default" themeColor="primary">
                      ‹ {t('common.back')}
                    </ThemedText>
                  </Pressable>
                ) : (
                  <View />
                )}
                {headerRight}
              </View>
            )}
            {title && (
              <ThemedText type="subtitle" style={styles.title}>
                {title}
              </ThemedText>
            )}
            {subtitle && (
              <ThemedText type="default" themeColor="textSecondary">
                {subtitle}
              </ThemedText>
            )}
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: Spacing.four, gap: Spacing.three },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { minHeight: MinTouchSize, justifyContent: 'center', paddingRight: Spacing.three },
  title: { fontSize: 28, lineHeight: 36 },
});
