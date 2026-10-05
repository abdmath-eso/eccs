import { normalizePhone } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

type Mode = 'owner' | 'eccs' | 'reset';

/**
 * Asks for a mobile number and sends a one-time code. Used by ECCS staff,
 * by an owner setting up for the first time, and by an owner who forgot
 * their PIN (mode "reset").
 */
export default function PhoneScreen() {
  const { t, api } = useSession();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = params.mode === 'eccs' || params.mode === 'reset' ? params.mode : 'owner';
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = mode === 'eccs' ? t('phone.titleEccs') : mode === 'reset' ? t('phone.titleReset') : t('phone.titleOwner');

  async function submit() {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError(t('error.phone'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.auth.requestOtp(normalized);
      router.push({ pathname: '/otp', params: { phone: normalized, mode } });
    } catch (e) {
      setError(errorMessage(e, t, { 400: 'error.phone' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={title} subtitle={t('phone.help')}>
      <TextField
        value={phone}
        onChangeText={setPhone}
        placeholder={t('phone.placeholder')}
        keyboardType="phone-pad"
        autoComplete="tel"
        autoFocus
        maxLength={16}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <ErrorText message={error} />
      <Button label={t('phone.send')} onPress={submit} loading={busy} disabled={phone.trim().length < 10} />
    </Screen>
  );
}
