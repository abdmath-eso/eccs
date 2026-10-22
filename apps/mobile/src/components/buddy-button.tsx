import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { BuddyMascot } from '@/components/buddy-mascot';
import { MinTouchSize } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buddyHref, showsBuddy } from '@/lib/buddy';
import { useSession } from '@/lib/session';

/**
 * The way into ECCS Buddy from the top of a screen, for the Owner and the Manager only, always in
 * the same place (the end of the top bar, or of the title's line), as AI helpers in business apps
 * put their way in (Atlassian Rovo's persistent button; Shopify Sidekick in the admin's top bar). A
 * floating button was not used: the app's screens already pin their own main button at the bottom,
 * and a second floating one would sit on top of it. Buddy opens on the screen it was tapped from,
 * so its suggested prompts fit that screen.
 *
 * One look everywhere (22 Oct 2026): Buddy's mascot in a round 52 button with no ring, like the
 * bell beside it on Home (Material 3: icon buttons in a top bar have no container). Until then it
 * was a ringed circle beside titles and a pill with the word "Buddy" beside Back, which the screen
 * review found inconsistent and which crowded the top bar in longer languages. Its name ("Ask ECCS
 * Buddy") is read out by screen readers; the word is learned from Home's "Ask ECCS Buddy" card and
 * the menu entry, which carry it in full. The mascot replaced a sparkle on 19 Oct 2026.
 */
export function BuddyButton() {
  const theme = useTheme();
  const pathname = usePathname();
  const { t, user } = useSession();
  if (!showsBuddy(user?.memberships)) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('buddy.buttonLabel')}
      onPress={() => router.push(buddyHref(pathname))}
      style={({ pressed }) => [styles.round, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <BuddyMascot size={30} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  round: {
    width: MinTouchSize,
    height: MinTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: MinTouchSize / 2,
  },
});
