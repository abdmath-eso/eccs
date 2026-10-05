import { OTP_LENGTH } from '@eccs/shared';
import * as Device from 'expo-device';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/** Checks the one-time code. For an owner this also links the phone and may create their PIN. */
export default function OtpScreen() {
  const { t, api, signIn } = useSession();
  const params = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phone = params.phone;
  if (!phone) return <Redirect href="/" />;

  async function verify(entered: string) {
    if (!phone) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.auth.verifyOtp({
        phone,
        code: entered,
        deviceName: Device.modelName ?? undefined,
        resetPin: params.mode === 'reset',
      });
      // Logging in swaps the app to the home screens; a new PIN, if any, is shown there first.
      await signIn(session);
    } catch (e) {
      setCode('');
      setError(errorMessage(e, t, { 400: 'error.wrongCode', 401: 'error.wrongCode' }));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!phone) return;
    setError(null);
    try {
      await api.auth.requestOtp(phone);
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  function change(next: string) {
    const digits = next.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(digits);
    if (digits.length === OTP_LENGTH) void verify(digits);
  }

  return (
    <Screen back title={t('otp.title')} subtitle={t('otp.help', { phone })}>
      <TextField
        value={code}
        onChangeText={change}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        maxLength={OTP_LENGTH}
        editable={!busy}
        style={{ letterSpacing: 8, textAlign: 'center' }}
      />
      <ErrorText message={error} />
      <Button label={t('otp.verify')} onPress={() => verify(code)} loading={busy} disabled={code.length < OTP_LENGTH} />
      <Button label={t('otp.resend')} variant="link" onPress={resend} disabled={busy} />
    </Screen>
  );
}
