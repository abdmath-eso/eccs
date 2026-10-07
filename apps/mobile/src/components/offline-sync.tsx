import Ionicons from '@expo/vector-icons/Ionicons';
import { localize } from '@eccs/shared';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isTabRoute } from '@/lib/navigation';
import { checklistCache } from '@/lib/offline/checklist-cache';
import { outbox, useOutbox } from '@/lib/offline/outbox';
import type { OutboxNotice } from '@/lib/offline/outbox-core';
import { useSession } from '@/lib/session';

// How long "All sent" stays up before the line goes away.
const ALL_SENT_MS = 4000;

/**
 * Keeps checklist answers flowing to the server whenever the app is open, on
 * any screen, and always says where things stand in one quiet line above the
 * bottom bar:
 *   - no signal, and how many answers are saved on the phone waiting;
 *   - sending, and how many are left;
 *   - all sent (briefly).
 * It also tells the person, once, when answers saved on the phone could not
 * be added to a checklist (someone else submitted it first, say).
 * Mounted once, in the layout of the logged-in screens.
 */
export function OfflineSync() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { t, user, language } = useSession();
  const box = useOutbox();
  // The "all sent" moment whose message has already been shown for long enough.
  const [allSentSeen, setAllSentSeen] = useState<number | null>(null);

  const userId = user?.id ?? null;
  const userName = user?.name ?? null;

  // Tell the outbox and the saved checklists who is using the phone. Only that
  // person's answers are sent; anyone else's wait on the phone for them.
  useEffect(() => {
    if (userId) void checklistCache.load(userId);
    outbox.setUser(userId, userName);
    void outbox.init();
  }, [userId, userName]);

  // Logging out takes this component away: stop sending straight away.
  useEffect(
    () => () => {
      outbox.setUser(null);
      checklistCache.close();
    },
    [],
  );

  // Try again as soon as the app is opened again, and (in a browser) when the connection comes back.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') outbox.kick();
    });
    const online = () => outbox.kick();
    const inBrowser = Platform.OS === 'web' && typeof window !== 'undefined';
    if (inBrowser) window.addEventListener('online', online);
    return () => {
      subscription.remove();
      if (inBrowser) window.removeEventListener('online', online);
    };
  }, []);

  const allSentAt = box.allSentAt;
  useEffect(() => {
    if (allSentAt === null) return;
    const timer = setTimeout(() => setAllSentSeen(allSentAt), ALL_SENT_MS);
    return () => clearTimeout(timer);
  }, [allSentAt]);

  if (!user) return null;

  const count = box.ops.length;
  const noSignal = box.online === false;
  const onChecklists = pathname.startsWith('/checklists');

  // What the line says, if anything. Text and an icon together, never colour alone.
  let line: { icon: 'cloud-offline' | 'cloud-done' | 'time' | null; text: string; color: string; retry?: boolean } | null =
    null;
  if (count > 0 && box.phase === 'sending' && !noSignal) {
    line = { icon: null, text: t('offline.sending', { count }), color: theme.textSecondary };
  } else if (count > 0 && noSignal) {
    line = { icon: 'cloud-offline', text: t('offline.noSignalWaiting', { count }), color: theme.warning, retry: true };
  } else if (count > 0) {
    line = { icon: 'time', text: t('offline.retrying', { count }), color: theme.warning, retry: true };
  } else if (noSignal && onChecklists) {
    // Elsewhere in the app nothing is saved for later, so this promise is only made here.
    line = { icon: 'cloud-offline', text: t('offline.noSignal'), color: theme.warning, retry: true };
  } else if (allSentAt !== null && allSentSeen !== allSentAt) {
    line = { icon: 'cloud-done', text: t('offline.allSent'), color: theme.primary };
  }

  /** Says plainly what happened to the answers that were not added. */
  const noticeText = (shown: OutboxNotice): string => {
    const name = localize(shown.title ?? checklistCache.getRun(shown.runId)?.title, language);
    const title = name ? `“${name}”` : t('offline.thisChecklist');
    if (shown.reason === 'submittedByOther') {
      return t(shown.count > 0 ? 'offline.conflictSubmitted' : 'offline.conflictSubmittedNone', {
        name: shown.by ?? t('offline.someone'),
        title,
        count: shown.count,
      });
    }
    if (shown.reason === 'closed') return t('offline.conflictClosed', { title, count: shown.count });
    return shown.count > 0 ? t('offline.rejected', { title, count: shown.count }) : t('offline.submitRejected', { title });
  };

  const notice = box.notices[0];
  // Screens without the bottom bar reach the bottom edge, so keep clear of the home indicator there.
  const aboveBottomBar = isTabRoute(pathname, user.memberships[0]?.role);

  return (
    <>
      {line && (
        <Pressable
          accessibilityRole={line.retry ? 'button' : 'text'}
          accessibilityLabel={line.retry ? `${line.text}. ${t('offline.tryNow')}` : line.text}
          accessibilityLiveRegion="polite"
          disabled={!line.retry}
          onPress={() => outbox.kick()}
          style={[
            styles.strip,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
              paddingBottom: Spacing.two + (aboveBottomBar ? 0 : insets.bottom),
            },
          ]}>
          <View style={styles.row}>
            {line.icon ? (
              <Ionicons name={line.icon} size={22} color={line.color} />
            ) : (
              <ActivityIndicator size="small" color={theme.primary} />
            )}
            <ThemedText type="small" style={styles.text}>
              {line.text}
            </ThemedText>
            {line.retry && (
              <ThemedText type="smallBold" themeColor="primary">
                {t('offline.tryNow')}
              </ThemedText>
            )}
          </View>
        </Pressable>
      )}

      {notice && (
        <Modal visible transparent animationType="fade" onRequestClose={() => outbox.dismissNotice(notice.id)}>
          <View style={styles.backdrop}>
            <View style={[styles.card, { backgroundColor: theme.background }]} accessibilityRole="alert">
              <Ionicons name="alert-circle" size={32} color={theme.warning} />
              <ThemedText type="default">{noticeText(notice)}</ThemedText>
              <Button label={t('common.close')} onPress={() => outbox.dismissNotice(notice.id)} />
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  strip: {
    borderTopWidth: 1,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  row: {
    width: '100%',
    maxWidth: MaxContentWidth,
    minHeight: MinTouchSize - Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  text: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: MaxContentWidth - Spacing.six,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
