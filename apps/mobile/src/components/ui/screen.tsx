import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { useState, type ReactNode, type RefObject } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isTabRoute } from '@/lib/navigation';
import { useSession } from '@/lib/session';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  /** Shows a back button that returns to the previous screen. */
  back?: boolean;
  /** What the back button says, when "Back" is not specific enough. */
  backLabel?: string;
  /** What the back button does, when it should stay on this screen (for example to step back within it). */
  onBack?: () => void;
  /** Extra control on the right of the top bar. */
  headerRight?: ReactNode;
  /**
   * Pinned under the scrolling body and always in view: the screen's main button,
   * with progress or what is still missing. Use it wherever the main action would
   * otherwise sit at the end of a long scroll.
   */
  footer?: ReactNode;
  /** Makes the body pull-to-refresh. Give the function that loads the screen's data. */
  onRefresh?: () => Promise<unknown>;
  /** To scroll the body from outside, for example to the first unanswered item. */
  scrollRef?: RefObject<ScrollView | null>;
  children: ReactNode;
}

/**
 * Standard page frame: a top bar that stays put (back button, extra control),
 * a scrolling body that can be pulled down to refresh, and an optional footer
 * pinned at the bottom.
 */
export function Screen({
  title,
  subtitle,
  back,
  backLabel,
  onBack,
  headerRight,
  footer,
  onRefresh,
  scrollRef,
  children,
}: ScreenProps) {
  const theme = useTheme();
  const { t, user } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  // On a screen that shows the bottom bar, the bar itself keeps clear of the home indicator.
  const aboveBottomBar = isTabRoute(usePathname(), user?.memberships[0]?.role);
  // A main section is reached from the bottom bar and has nowhere to go "back" to,
  // unless the screen steps back within itself.
  const showBack = back && (!aboveBottomBar || onBack !== undefined);

  async function refresh() {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // The screen's own loader reports what went wrong.
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea} edges={aboveBottomBar ? ['top', 'left', 'right'] : undefined}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {(showBack || headerRight) && (
            <View style={styles.header}>
              {showBack ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={backLabel ?? t('common.back')}
                  onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
                  style={styles.back}>
                  <Ionicons name="chevron-back" size={24} color={theme.primary} />
                  <ThemedText type="default" themeColor="primary" numberOfLines={1}>
                    {backLabel ?? t('common.back')}
                  </ThemedText>
                </Pressable>
              ) : (
                <View />
              )}
              {headerRight}
            </View>
          )}
          <ScrollView
            // A screen often shows a loading state first, without `scrollRef`, and passes it
            // once its data has arrived. The browser build only hands over the scroll view
            // when it is first created, so make a fresh one when a ref appears.
            key={scrollRef ? 'scrollable-from-outside' : 'plain'}
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void refresh()}
                  tintColor={theme.primary}
                  colors={[theme.primary]}
                />
              ) : undefined
            }>
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
          {footer && <View style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.background }]}>{footer}</View>}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: Spacing.four, paddingTop: Spacing.two, gap: Spacing.three },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    minHeight: MinTouchSize,
  },
  back: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    minHeight: MinTouchSize,
    paddingRight: Spacing.three,
  },
  title: { fontSize: 28, lineHeight: 36 },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
});
