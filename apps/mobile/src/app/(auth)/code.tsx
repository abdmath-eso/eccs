import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
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
        value={code}
        onChangeText={setCode}
        placeholder={t('code.placeholder')}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <ErrorText message={error} />
      <Button label={t('code.link')} onPress={submit} loading={busy} disabled={code.trim().length < 5} />
    </Screen>
  );
}
