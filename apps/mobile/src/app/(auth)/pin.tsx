import { ApiError } from '@eccs/api-client';
import { AUTH_ERROR, PIN_LENGTH } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PinPad } from '@/components/ui/pin-pad';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/** The everyday login: whoever's PIN is entered is who gets logged in. */
export default function PinScreen() {
  const { t, api, linkedDevice, unlinkDevice, signIn } = useSession();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  // After too many wrong PINs the server locks this phone for a while. These two hold
  // the clock time the lock ends and the time now, so the wait can be counted down.
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  // Ticks once a second while locked. It compares clock times rather than counting
  // ticks, so the wait stays right if the app was in the background for a while.
  useEffect(() => {
    if (lockedUntil === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= lockedUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  if (!linkedDevice) return <Redirect href="/" />;
  const restaurantName = linkedDevice.outletName ?? linkedDevice.organizationName;

  const secondsLeft = lockedUntil === null ? 0 : Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const locked = secondsLeft > 0;
  const timeLeft = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  async function submit(entered: string) {
    if (!linkedDevice) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.auth.pinLogin({ deviceToken: linkedDevice.deviceToken, pin: entered }));
    } catch (e) {
      setPin('');
      if (e instanceof ApiError && e.code === AUTH_ERROR.deviceNotLinked) {
        await unlinkDevice();
        return;
      }
      if (e instanceof ApiError && e.status === 429 && e.retryAfterSeconds) {
        const started = Date.now();
        setNow(started);
        setLockedUntil(started + e.retryAfterSeconds * 1000);
        return;
      }
      setError(errorMessage(e, t, { 401: 'error.wrongPin', 429: 'error.pinLocked' }));
    } finally {
      setBusy(false);
    }
  }

  function change(next: string) {
    setPin(next);
    if (error) setError(null);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="primary" style={styles.center}>
          {restaurantName}
        </ThemedText>
        <ThemedText type="subtitle" style={[styles.center, styles.title]}>
          {t('pin.title')}
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          {t('pin.help')}
        </ThemedText>
      </View>

      <PinPad
        value={pin}
        onChange={change}
        disabled={busy || locked}
        error={locked ? t('pin.locked') : error}
        note={locked ? t('pin.unlocksIn', { time: timeLeft }) : null}
      />

      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {t('pin.forgotStaff')}
      </ThemedText>

      <View>
        <Button
          label={t('pin.forgotOwner')}
          variant="link"
          onPress={() => router.push({ pathname: '/phone', params: { mode: 'reset' } })}
        />
        <Button label={t('pin.changeRestaurant')} variant="link" onPress={() => setConfirmUnlink(true)} />
      </View>

      <ConfirmDialog
        visible={confirmUnlink}
        message={t('pin.changeRestaurantConfirm', { name: restaurantName })}
        confirmLabel={t('pin.changeRestaurant')}
        danger
        onCancel={() => setConfirmUnlink(false)}
        onConfirm={() => {
          setConfirmUnlink(false);
          void unlinkDevice();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.four },
  title: { fontSize: 28, lineHeight: 36 },
  center: { textAlign: 'center' },
});
