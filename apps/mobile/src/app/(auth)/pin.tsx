import { ApiError } from '@eccs/api-client';
import { AUTH_ERROR, PIN_LENGTH } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { OptionSheet } from '@/components/ui/option-sheet';
import { PinPad } from '@/components/ui/pin-pad';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/** The everyday login: whoever's PIN is entered is who gets logged in. */
export default function PinScreen() {
  const theme = useTheme();
  const { t, api, linkedDevice, unlinkDevice, signIn } = useSession();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [forgotSheet, setForgotSheet] = useState(false);
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
      {/* Attendance, for every employee, needs no login. It comes first, where it is seen without
          scrolling (clocking in is what most staff do here every day), and is kept apart from the
          login below it by a line, with its own picture and words, so nobody takes it for a way to
          log in. Under the keypad (tried on 22 Oct 2026) it fell below the bottom of a phone's
          screen. Not shown on a phone linked to the restaurant as a whole: there is no outlet to
          clock in at. */}
      {linkedDevice.outletName !== null && (
        <View style={[styles.clock, { borderColor: theme.border }]}>
          <Button
            icon="scan-circle-outline"
            label={t('clock.title')}
            hint={t('clock.pinHint')}
            onPress={() => router.push('/clock')}
          />
        </View>
      )}

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

      {/* The title and its dots together, straight above the keys (Square's passcode screen; until
          22 Oct 2026 the Clock in button sat between them). */}
      <PinPad
        value={pin}
        onChange={change}
        disabled={busy || locked}
        error={locked ? t('pin.locked') : error}
        note={locked ? t('pin.unlocksIn', { time: timeLeft }) : null}
      />

      {/* One link for a forgotten PIN; the sheet it opens says what to do, owner or staff. */}
      <View>
        <Button label={t('pin.forgot')} variant="link" onPress={() => setForgotSheet(true)} />
        <Button label={t('pin.changeRestaurant')} variant="link" onPress={() => setConfirmUnlink(true)} />
      </View>

      <OptionSheet
        visible={forgotSheet}
        title={t('pin.forgot')}
        options={[
          {
            label: t('pin.forgotOwnerOption'),
            icon: 'phone-portrait-outline',
            onPress: () => {
              setForgotSheet(false);
              router.push({ pathname: '/phone', params: { mode: 'reset' } });
            },
          },
          // Staff have nothing to do on this phone: the line itself is the answer, and tapping it closes the sheet.
          { label: t('pin.forgotStaffOption'), icon: 'people-outline', onPress: () => setForgotSheet(false) },
        ]}
        onClose={() => setForgotSheet(false)}
      />

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
  header: { alignItems: 'center', gap: Spacing.two },
  title: { fontSize: 28, lineHeight: 36 },
  center: { textAlign: 'center' },
  // A line under the attendance button sets it apart from the login below it.
  clock: { borderBottomWidth: 1, paddingTop: Spacing.three, paddingBottom: Spacing.four },
});
