import Ionicons from '@expo/vector-icons/Ionicons';
import type { BuddyChatSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showsBuddy } from '@/lib/buddy';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { BUDDY_RULES } from '@eccs/shared';

/**
 * ECCS Buddy's recent chats, newest first: tap one to carry on, or delete it. Each is removed by
 * itself 30 days after its last message, which the list says once at the top, as chat apps that
 * keep history for a set time do (ChatGPT's temporary chats, WhatsApp's disappearing messages).
 */
export default function BuddyChatsScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const notify = useSnackbar();
  const [chats, setChats] = useState<BuddyChatSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BuddyChatSummaryDto | null>(null);
  const allowed = showsBuddy(user?.memberships);
  const severalOutlets = new Set(chats?.map((chat) => chat.outletName)).size > 1;

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setChats(await api.buddy.chats());
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, allowed]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function remove(chat: BuddyChatSummaryDto) {
    setDeleting(null);
    try {
      await api.buddy.removeChat(chat.id);
      setChats((current) => current?.filter((entry) => entry.id !== chat.id) ?? null);
      notify(t('buddy.recent.deleted'));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  return (
    <Screen back title={t('buddy.recent')} subtitle={t('buddy.recent.keep', { days: BUDDY_RULES.keepDays })} onRefresh={load}>
      <ErrorText message={error} onRetry={() => void load()} />
      {chats === null && !error && <ActivityIndicator color={theme.primary} />}
      {chats?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('buddy.recent.empty')}
        </ThemedText>
      )}
      {/* The rows in one list, so the page's gap between sections does not open up between them. */}
      <View>
      {chats?.map((chat) => (
        <View key={chat.id} style={[styles.row, { borderColor: theme.border }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace({ pathname: '/buddy', params: { chatId: chat.id } })}
            style={({ pressed }) => [styles.open, pressed && { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="default" numberOfLines={2}>
              {chat.title}
            </ThemedText>
            {/* When, and the outlet only when the chats are about more than one. The removal date is said once, at the top. */}
            <ThemedText type="small" themeColor="textSecondary">
              {[formatDateTime(chat.updatedAt, language), severalOutlets ? chat.outletName : null].filter(Boolean).join(' · ')}
            </ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('buddy.recent.delete')} onPress={() => setDeleting(chat)} style={styles.delete}>
            {/* Grey on the list; red is kept for the question that confirms it. */}
            <Ionicons name="trash-outline" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
      ))}
      </View>
      <ConfirmDialog
        visible={deleting !== null}
        message={t('buddy.recent.deleteConfirm')}
        confirmLabel={t('buddy.recent.delete')}
        danger
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, gap: Spacing.two },
  open: { flex: 1, gap: Spacing.half, paddingVertical: Spacing.three, minHeight: MinTouchSize },
  delete: { width: MinTouchSize, height: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
});
