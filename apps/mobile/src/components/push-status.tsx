import type { MessageKey } from '@eccs/i18n';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Notice, type NoticeTone } from '@/components/ui/notice';
import { useSnackbar } from '@/components/ui/snackbar';
import { syncPush, usePushState, wantPushQuestion, wasPushAsked, type PushState, pushFailure } from '@/lib/push';
import { useSession } from '@/lib/session';

// The app's one notice box (22 Oct 2026; it was an outlined box of its own): information when
// there is simply nothing to show or nothing sent yet, a warning when something stands in the way.
const LINES: Record<Exclude<PushState, 'checking' | 'on'>, { tone: NoticeTone; text: MessageKey }> = {
  serverOff: { tone: 'info', text: 'push.status.serverOff' },
  off: { tone: 'info', text: 'push.status.off' },
  blocked: { tone: 'warning', text: 'push.status.blocked' },
  failed: { tone: 'warning', text: 'push.status.failed' },
  unavailable: { tone: 'info', text: 'push.status.unavailable' },
};

/**
 * One plain line saying whether this phone shows ECCS's notifications, with
 * the way to turn them on when it does not: the phone's own question if it can
 * still be asked, otherwise the phone's settings (once someone has said no
 * twice, Android stops asking and only the settings can change it).
 */
export function PushStatus() {
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

  // Nothing to say while all is well: a line that always reads "notifications are on"
  // only takes room (founder, 8 Oct 2026). It appears when there is something to do
  // or to know: off, blocked, failed, the server not sending, or not available here.
  if (state === 'checking' || state === 'on') return null;
  const line = LINES[state];

  function turnOn() {
    setBusy(true);
    void syncPush(api, { ask: true }).then((next) => {
      setBusy(false);
      if (next === 'on' || next === 'serverOff') notify(t('push.turnedOn'));
    });
  }

  return (
    <Notice tone={line.tone} text={t(line.text)}>
      {state === 'off' && <Button icon="notifications" label={t('push.ask.yes')} onPress={turnOn} loading={busy} />}
      {state === 'failed' && pushFailure() && (
        // The technical reason, as the phone gave it: for whoever is helping to put it right.
        <ThemedText type="small" themeColor="textSecondary" selectable>
          {pushFailure()}
        </ThemedText>
      )}
      {state === 'failed' && <Button label={t('common.retry')} variant="secondary" onPress={turnOn} loading={busy} />}
      {state === 'blocked' && (
        <Button
          icon="settings-outline"
          label={t('push.openSettings')}
          variant="secondary"
          onPress={() => void Linking.openSettings().catch(() => undefined)}
        />
      )}
    </Notice>
  );
}
