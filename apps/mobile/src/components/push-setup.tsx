import Ionicons from '@expo/vector-icons/Ionicons';
import { createTranslator } from '@eccs/i18n';
import { readPushData } from '@eccs/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useSnackbar } from '@/components/ui/snackbar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openNotificationLink } from '@/lib/notification-link';
import {
  announcePushArrived,
  countPushOpen,
  loadNotifications,
  onPushQuestionWanted,
  preparePush,
  pushSupported,
  rememberPushAsked,
  setPushUser,
  syncPush,
  wasPushAsked,
} from '@/lib/push';
import { useSession } from '@/lib/session';

// A tap can reach the app twice (once as "the tap that opened the app", once
// as a live event). Each notification is opened only the first time.
const opened = new Set<string>();

// Android's guidance is to let people get to know the app before asking, for
// example from the third time it is opened.
const ASK_FROM_OPEN = 3;

/**
 * Push notifications for the person logged in. Mounted once, in the layout of
 * the logged-in screens, so it starts at login and stops at Lock or logout.
 *   - Registers this phone as theirs (the token is taken away again on Lock;
 *     see `signOut` in lib/session.tsx).
 *   - Once per phone, asks in the app's own words whether to turn
 *     notifications on, and only on "Turn on" shows the phone's own question.
 *     It asks when the person first opens the Notifications screen (they have
 *     tapped the bell, so the reason is plain), or else from the third time
 *     the app is opened; never on the first visit. "Not now" is not asked
 *     again; the Notifications screen keeps a way to turn them on.
 *   - Opens the right screen when a notification is tapped, also when the tap
 *     is what started the app.
 *   - Tells the bell when one arrives while the app is open.
 * In Expo Go and the browser preview it does nothing.
 */
export function PushSetup() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const notify = useSnackbar();
  const { t, api, user, language, newPin, linkedDevice } = useSession();
  const userId = user?.id ?? null;
  const [asking, setAsking] = useState(false);
  const [turningOn, setTurningOn] = useState(false);

  // The handler and Android's channels; again when the language changes, so the
  // channel names in the phone's settings follow it.
  useEffect(() => {
    void preparePush(createTranslator(language));
  }, [language]);

  // Register the phone for this person. If notifications are not allowed yet and the
  // phone has never been asked, ask: but not on the first visits, before the person
  // has seen what the app is for. (Opening the Notifications screen asks sooner.)
  useEffect(() => {
    if (!pushSupported || !userId) return;
    setPushUser(userId);
    let cancelled = false;
    void (async () => {
      await preparePush(createTranslator(language));
      const state = await syncPush(api);
      const opens = await countPushOpen();
      if (!cancelled && state === 'off' && opens >= ASK_FROM_OPEN && !(await wasPushAsked())) setAsking(true);
    })();
    return () => {
      cancelled = true;
      setPushUser(null);
    };
    // The language is handled by the effect above; it must not register the phone again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, userId]);

  // The Notifications screen asks for the question the first time it is opened.
  useEffect(() => onPushQuestionWanted(() => setAsking(true)), []);

  // Coming back to the app (perhaps from the phone's settings, where notifications
  // were just allowed or blocked): look again.
  useEffect(() => {
    if (!pushSupported || !userId) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void syncPush(api);
    });
    return () => subscription.remove();
  }, [api, userId]);

  // Notifications arriving and being tapped.
  useEffect(() => {
    if (!pushSupported || !userId) return;
    let stopped = false;
    const subscriptions: { remove: () => void }[] = [];

    void loadNotifications().then((Notifications) => {
      if (!Notifications || stopped) return;

      const openFrom = (response: import('expo-notifications').NotificationResponse) => {
        const { identifier, content } = response.notification.request;
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
        if (opened.has(identifier)) return;
        opened.add(identifier);
        const data = readPushData(content.data);
        // Not ours, or meant for whoever used this phone before: leave the app where it is.
        if (!data || data.userId !== userId) return;
        if (data.notificationId) api.notifications.markRead(data.notificationId).catch(() => undefined);
        if (data.link) openNotificationLink(data.link);
        else router.push('/notifications');
      };

      subscriptions.push(
        Notifications.addNotificationReceivedListener(() => announcePushArrived()),
        Notifications.addNotificationResponseReceivedListener(openFrom),
        // The phone was given a new token (rare: after a restore, or Google refreshing it).
        Notifications.addPushTokenListener(() => void syncPush(api)),
      );
      // The tap that started the app, or that was waiting behind the PIN pad.
      void Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (response && !stopped) openFrom(response);
        })
        .catch(() => undefined);
    });

    return () => {
      stopped = true;
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [api, userId]);

  function answer(turnOn: boolean) {
    void rememberPushAsked();
    if (!turnOn) {
      setAsking(false);
      return;
    }
    setTurningOn(true);
    void syncPush(api, { ask: true }).then((state) => {
      setTurningOn(false);
      setAsking(false);
      if (state === 'on' || state === 'serverOff') notify(t('push.turnedOn'));
    });
  }

  // A PIN that is shown only once comes first; the question waits until it is put away.
  const visible = asking && !newPin;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => answer(false)}>
      <DirectionView style={[styles.backdrop, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={[styles.card, { backgroundColor: theme.background }]}>
          <View style={styles.icon}>
            <Ionicons name="notifications" size={40} color={theme.primary} />
          </View>
          <ThemedText type="subtitle" style={styles.title} accessibilityRole="header">
            {t('push.ask.title')}
          </ThemedText>
          <ThemedText type="default">{t('push.ask.body')}</ThemedText>
          {linkedDevice && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('push.ask.shared')}
            </ThemedText>
          )}
          <Button icon="notifications" label={t('push.ask.yes')} onPress={() => answer(true)} loading={turningOn} />
          <Button label={t('push.ask.notNow')} variant="secondary" onPress={() => answer(false)} disabled={turningOn} />
        </View>
      </DirectionView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: MaxContentWidth - Spacing.six,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  icon: { alignItems: 'center' },
  title: { fontSize: 22, lineHeight: 28, textAlign: 'center' },
});
