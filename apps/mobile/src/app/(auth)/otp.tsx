import { OTP_LENGTH } from '@eccs/shared';
import * as Device from 'expo-device';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

// How long after a code is sent before another can be asked for.
const RESEND_WAIT_SECONDS = 30;

/** Checks the one-time code. For an owner this also links the phone and may create their PIN. */
export default function OtpScreen() {
  const { t, api, signIn } = useSession();
  const notify = useSnackbar();
  const params = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  // Seconds until a new code can be asked for. A code was sent just before this
  // screen opened, so the wait starts straight away.
  const [wait, setWait] = useState(RESEND_WAIT_SECONDS);

  const waiting = wait > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setWait((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

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
    setResending(true);
    setResendError(null);
    try {
      await api.auth.requestOtp(phone);
      // The old code no longer counts, so clear what was typed and any message about it.
      setCode('');
      setError(null);
      setWait(RESEND_WAIT_SECONDS);
      notify(t('otp.resent'));
    } catch (e) {
      setResendError(errorMessage(e, t));
    } finally {
      setResending(false);
    }
  }

  function change(next: string) {
    const digits = next.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(digits);
    if (error && digits) setError(null);
    if (digits.length === OTP_LENGTH) void verify(digits);
  }

  return (
    <Screen back title={t('otp.title')} subtitle={t('otp.help', { phone: ltrText(phone) })}>
      <TextField
        label={t('otp.label')}
        value={code}
        onChangeText={change}
        error={error}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        maxLength={OTP_LENGTH}
        editable={!busy}
        style={{ letterSpacing: 8, textAlign: 'center' }}
      />
      <Button label={t('otp.verify')} onPress={() => verify(code)} loading={busy} disabled={code.length < OTP_LENGTH} />
      <ErrorText message={resendError} />
      <Button
        label={waiting ? t('otp.resendIn', { seconds: wait }) : t('otp.resend')}
        variant="link"
        onPress={resend}
        loading={resending}
        disabled={busy || waiting}
      />
    </Screen>
  );
}
