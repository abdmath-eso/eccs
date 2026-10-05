import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { LanguagePicker } from '@/components/language-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/lib/session';

/** First screen on a phone that is not linked to a restaurant yet. */
export default function WelcomeScreen() {
  const { t, linkedDevice } = useSession();

  // A linked phone goes straight to the PIN pad.
  if (linkedDevice) return <Redirect href="/pin" />;

  return (
    <Screen>
      <View style={styles.brand}>
        <ThemedText type="title" themeColor="primary">
          {t('app.name')}
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          {t('app.tagline')}
        </ThemedText>
      </View>

      <LanguagePicker />

      <View style={styles.actions}>
        <Button
          label={t('welcome.haveCode')}
          hint={t('welcome.haveCodeHint')}
          onPress={() => router.push('/code')}
        />
        <Button
          label={t('welcome.owner')}
          hint={t('welcome.ownerHint')}
          variant="secondary"
          onPress={() => router.push({ pathname: '/phone', params: { mode: 'owner' } })}
        />
        <Button
          label={t('welcome.eccs')}
          variant="link"
          onPress={() => router.push({ pathname: '/phone', params: { mode: 'eccs' } })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  center: { textAlign: 'center' },
  actions: { gap: Spacing.three, marginTop: Spacing.three },
});
