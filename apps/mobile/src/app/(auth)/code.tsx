import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/** Links this phone to a restaurant, once, using the outlet's restaurant code. */
export default function RestaurantCodeScreen() {
  const { t, api, linkDevice } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const device = await api.auth.linkDevice({ code, deviceName: Device.modelName ?? undefined });
      await linkDevice(device);
      router.replace('/pin');
    } catch (e) {
      setError(errorMessage(e, t, { 400: 'error.restaurantCode', 404: 'error.restaurantCode' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={t('code.title')} subtitle={t('code.help')}>
      <TextField
        label={t('code.title')}
        value={code}
        onChangeText={(next) => {
          setCode(next);
          if (error) setError(null);
        }}
        error={error}
        placeholder={t('code.placeholder')}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        // The code is not a password or a saved detail: keep password and autofill managers away from it.
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Button label={t('code.link')} onPress={submit} loading={busy} disabled={code.trim().length < 5} />
    </Screen>
  );
}
