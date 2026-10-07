import { normalizePhone } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
  const theme = useTheme();
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
      {/* The label is written here, not by the field, so it sits above the "+91" as well. */}
      <View style={styles.field}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('phone.label')}
        </ThemedText>
        <View style={styles.row}>
          {/* Every number here is Indian, so the country code is shown, not typed. */}
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[styles.prefix, { borderColor: theme.outline, backgroundColor: theme.backgroundSelected }]}>
            <ThemedText style={styles.prefixText}>+91</ThemedText>
          </View>
          <View style={styles.input}>
            <TextField
              accessibilityLabel={`${t('phone.label')}, +91`}
              value={phone}
              onChangeText={(next) => {
                setPhone(next);
                if (error) setError(null);
              }}
              error={error}
              placeholder={t('phone.placeholder')}
              keyboardType="phone-pad"
              autoComplete="tel-national"
              textContentType="telephoneNumber"
              autoFocus
              maxLength={16}
              returnKeyType="done"
              onSubmitEditing={submit}
            />
          </View>
        </View>
      </View>
      <Button label={t('phone.send')} onPress={submit} loading={busy} disabled={phone.trim().length < 10} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  // Same height, edge and corners as the field beside it.
  prefix: {
    height: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  prefixText: { fontSize: 20 },
  input: { flex: 1 },
});
