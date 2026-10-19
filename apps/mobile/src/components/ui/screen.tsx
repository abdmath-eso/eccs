import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { useState, type ReactNode, type RefObject } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, View, type ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BuddyButton } from '@/components/buddy-button';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { showsBuddy } from '@/lib/buddy';
import { KeyboardFooter, KeyboardScrollView, keyboardHandled } from '@/lib/keyboard';
import { isTabRoute, normalizePath } from '@/lib/navigation';
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
  /** Extra control at the far end of the top bar: the right, or the left in Urdu. */
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
  // In Urdu the back arrow points right, towards where the reading started.
  const { backIcon } = useDirection();
  const [refreshing, setRefreshing] = useState(false);
  // On a screen that shows the bottom bar, the bar itself keeps clear of the home indicator.
  const pathname = usePathname();
  const aboveBottomBar = isTabRoute(pathname, user?.memberships[0]?.role);
  // ECCS Buddy's button, for the Owner and the Manager, at the end of the top bar (or of the title
  // line on a screen with no top bar). Not on Buddy's own screens, nor on Home, which places it
  // beside the bell itself, nor before login.
  const buddy =
    showsBuddy(user?.memberships) && !normalizePath(pathname).startsWith('/buddy') && normalizePath(pathname) !== '/' && !normalizePath(pathname).startsWith('/legal') && normalizePath(pathname) !== '/accept';
  // A main section is reached from the bottom bar and has nowhere to go "back" to,
  // unless the screen steps back within itself.
  const showBack = back && (!aboveBottomBar || onBack !== undefined);
  // While typing, the box being typed in is scrolled to just above the keyboard (lib/keyboard), and the
  // footer rides up with the keyboard so the main button or Buddy's message box stays in view; the body
  // then keeps the box above the footer too. Above the bottom bar the footer stays put under the keyboard,
  // as bottom bars do, so it can never sit on top of the box.
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(0);
  const stickyFooter = Boolean(footer) && !aboveBottomBar;

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
        {/* Where lib/keyboard handles the keyboard (the APK), this one stands aside; elsewhere it works on iPhones only. */}
        <KeyboardAvoidingView style={styles.flex} enabled={!keyboardHandled} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {(showBack || headerRight || (buddy && !title)) && (
            <View style={styles.header}>
              {showBack ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={backLabel ?? t('common.back')}
                  onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
                  style={styles.back}>
                  <Ionicons name={backIcon} size={24} color={theme.primary} />
                  <ThemedText type="default" themeColor="primary" numberOfLines={1}>
                    {backLabel ?? t('common.back')}
                  </ThemedText>
                </Pressable>
              ) : (
                <View />
              )}
              <View style={styles.headerEnd}>
                {headerRight}
                {buddy && <BuddyButton />}
              </View>
            </View>
          )}
          <KeyboardScrollView
            // A screen often shows a loading state first, without `scrollRef`, and passes it
            // once its data has arrived. The browser build only hands over the scroll view
            // when it is first created, so make a fresh one when a ref appears.
            key={scrollRef ? 'scrollable-from-outside' : 'plain'}
            ref={scrollRef}
            bottomOffset={Spacing.four + (stickyFooter ? footerHeight : 0)}
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
            {title &&
              (buddy && !(showBack || headerRight) ? (
                // No top bar: Buddy's button sits at the end of the title's line instead of adding one,
                // as the sparkle alone, so the title keeps its width.
                <View style={styles.titleRow}>
                  <ThemedText type="subtitle" style={[styles.title, styles.titleText]}>
                    {title}
                  </ThemedText>
                  <BuddyButton compact />
                </View>
              ) : (
                <ThemedText type="subtitle" style={styles.title}>
                  {title}
                </ThemedText>
              ))}
            {subtitle && (
              <ThemedText type="default" themeColor="textSecondary">
                {subtitle}
              </ThemedText>
            )}
            {children}
          </KeyboardScrollView>
          {footer &&
            (stickyFooter ? (
              <KeyboardFooter
                bottomInset={insets.bottom}
                onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
                style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.background }]}>
                {footer}
              </KeyboardFooter>
            ) : (
              <View style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.background }]}>{footer}</View>
            ))}
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
    paddingEnd: Spacing.three,
  },
  title: { fontSize: 28, lineHeight: 36 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  titleText: { flex: 1 },
  headerEnd: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
});
