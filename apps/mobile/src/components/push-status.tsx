import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey } from '@eccs/i18n';
import { useEffect, useState, type ComponentProps } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { syncPush, usePushState, wantPushQuestion, wasPushAsked, type PushState } from '@/lib/push';
import { useSession } from '@/lib/session';

type IconName = ComponentProps<typeof Ionicons>['name'];

const LINES: Record<Exclude<PushState, 'checking'>, { icon: IconName; text: MessageKey }> = {
  on: { icon: 'notifications', text: 'push.status.on' },
  serverOff: { icon: 'notifications-outline', text: 'push.status.serverOff' },
  off: { icon: 'notifications-off-outline', text: 'push.status.off' },
  blocked: { icon: 'notifications-off-outline', text: 'push.status.blocked' },
  failed: { icon: 'alert-circle-outline', text: 'push.status.failed' },
  unavailable: { icon: 'notifications-off-outline', text: 'push.status.unavailable' },
};

/**
 * One plain line saying whether this phone shows ECCS's notifications, with
 * the way to turn them on when it does not: the phone's own question if it can
 * still be asked, otherwise the phone's settings (once someone has said no
 * twice, Android stops asking and only the settings can change it).
 */
export function PushStatus() {
  const theme = useTheme();
  const notify = useSnackbar();
  const { t, api } = useSession();
  const state = usePushState();
  const [busy, setBusy] = useState(false);

  // The person has just tapped the bell: the moment our own "turn on notifications?"
  // question makes most sense. It is only ever put once per phone.
  useEffect(() => {
    if (state !== 'off') return;
    void wasPushAsked().then((asked) => {
      if (!asked) wantPushQuestion();
    });
  }, [state]);

  if (state === 'checking') return null;
  const line = LINES[state];

  function turnOn() {
    setBusy(true);
    void syncPush(api, { ask: true }).then((next) => {
      setBusy(false);
      if (next === 'on' || next === 'serverOff') notify(t('push.turnedOn'));
    });
  }

  return (
    <View style={[styles.box, { borderColor: theme.outline }]}>
      <View style={styles.row}>
        <Ionicons name={line.icon} size={22} color={state === 'on' ? theme.primary : theme.textSecondary} />
        <ThemedText type="small" themeColor={state === 'on' ? 'text' : 'textSecondary'} style={styles.text}>
          {t(line.text)}
        </ThemedText>
      </View>
      {state === 'off' && <Button icon="notifications" label={t('push.ask.yes')} onPress={turnOn} loading={busy} />}
      {state === 'failed' && <Button label={t('common.retry')} variant="secondary" onPress={turnOn} loading={busy} />}
      {state === 'blocked' && (
        <Button
          icon="settings-outline"
          label={t('push.openSettings')}
          variant="secondary"
          onPress={() => void Linking.openSettings().catch(() => undefined)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1 },
});
