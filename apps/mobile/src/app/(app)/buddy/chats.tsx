import Ionicons from '@expo/vector-icons/Ionicons';
import type { BuddyChatSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
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
 * itself 30 days after its last message, which "About this screen" says once, as chat apps that
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
    <Screen
      back
      title={t('buddy.recent')}
      // When chats are removed is read once, so it is folded away at the end (22 Oct 2026: two lines under the title).
      about={t('buddy.recent.keep', { days: BUDDY_RULES.keepDays })}
      onRefresh={load}>
      <ErrorText message={error} onRetry={() => void load()} />
      {chats === null && !error && <ActivityIndicator color={theme.primary} />}
      {chats?.length === 0 && <EmptyState icon="chatbubbles-outline" title={t('buddy.recent.empty')} body={t('buddy.recent.emptyBody')} />}
      {/* The app's plain list rows, one list with a thin line between rows. Delete sits beside each row, not
          inside it: a button inside the row's own button is out of a screen reader's reach on an iPhone. */}
      <View>
        {chats?.map((chat, index) => (
          <View key={chat.id} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
            <View style={styles.open}>
              <ListRow
                title={chat.title}
                // When, and the outlet only when the chats are about more than one.
                subtitle={[formatDateTime(chat.updatedAt, language), severalOutlets ? chat.outletName : null].filter(Boolean).join(' · ')}
                // No arrow: the delete button takes the row's end, as chat apps list past conversations.
                chevron={false}
                onPress={() => router.replace({ pathname: '/buddy', params: { chatId: chat.id } })}
              />
            </View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  open: { flex: 1 },
  delete: { width: MinTouchSize, height: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
});
