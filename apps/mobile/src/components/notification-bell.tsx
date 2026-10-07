import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

// A badge has room for two digits; anything more is shown as "99+".
const MOST_SHOWN = 99;

/**
 * The bell that opens the notifications list, with the number not yet read on
 * it. The number is fetched each time the screen the bell is on comes into
 * view, so it is right after coming back from the list.
 */
export function NotificationBell() {
  const theme = useTheme();
  const { t, api } = useSession();
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api.notifications
        .unreadCount()
        .then(({ unreadCount }) => !cancelled && setUnread(unreadCount))
        // With no signal the bell simply keeps the number it had; the list itself reports the failure.
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [api]),
  );

  return (
    <Pressable
      accessibilityRole="button"
      // The number is read out in words, since the badge is only a picture to a screen reader.
      accessibilityLabel={unread > 0 ? t('notif.openUnread', { count: unread }) : t('notif.open')}
      onPress={() => router.push('/notifications')}
      style={({ pressed }) => [styles.bell, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <Ionicons name={unread > 0 ? 'notifications' : 'notifications-outline'} size={28} color={theme.text} />
      {unread > 0 && (
        <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.background }]}>
          <ThemedText type="smallBold" style={[styles.count, { color: theme.background }]}>
            {unread > MOST_SHOWN ? `${MOST_SHOWN}+` : unread}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: {
    width: MinTouchSize,
    height: MinTouchSize,
    borderRadius: MinTouchSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    // The far corner of the bell: top right, or top left in Urdu.
    end: 2,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontSize: 12, lineHeight: 16 },
});
