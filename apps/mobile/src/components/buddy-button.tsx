import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { BuddyMascot } from '@/components/buddy-mascot';
import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buddyHref, showsBuddy } from '@/lib/buddy';
import { useSession } from '@/lib/session';

/**
 * The way into ECCS Buddy from the top of a screen, for the Owner and the Manager only, always in
 * the same place (the end of the top bar), as AI helpers in business apps put their way in
 * (Atlassian Rovo's persistent button; Shopify Sidekick in the admin's top bar). A floating button
 * was not used: the app's screens already pin their own main button at the bottom, and a second
 * floating one would sit on top of it. Buddy opens on the screen it was tapped from, so its
 * suggested prompts fit that screen.
 *
 * Where the top bar has room (beside Back) it is a pill with Buddy's mascot and the word "Buddy".
 * Beside a screen's big title, and on Home beside the bell, it is the mascot alone in a round button
 * (`compact`), so the title keeps its width; its name ("Ask ECCS Buddy") is read out by screen
 * readers, and the word is learned from Home's "Ask ECCS Buddy" card and the menu entry, which carry
 * it in full. The mascot replaced a sparkle on 19 Oct 2026 (components/buddy-mascot).
 */
export function BuddyButton({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const pathname = usePathname();
  const { t, user } = useSession();
  if (!showsBuddy(user?.memberships)) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('buddy.buttonLabel')}
      onPress={() => router.push(buddyHref(pathname))}
      hitSlop={compact ? 4 : 0}
      style={({ pressed }) => [compact ? styles.round : styles.pill, { borderColor: theme.primary, backgroundColor: pressed ? theme.backgroundSelected : theme.background }]}>
      <BuddyMascot size={compact ? 28 : 22} />
      {!compact && (
        <ThemedText type="smallBold" themeColor="primary">
          {t('buddy.button')}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: MinTouchSize - Spacing.two,
    minWidth: MinTouchSize,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderWidth: 1.5,
    borderRadius: 999,
  },
  round: {
    width: MinTouchSize - Spacing.one,
    height: MinTouchSize - Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 999,
  },
});
