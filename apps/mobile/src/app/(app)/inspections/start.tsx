import type { InspectionOutletDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/**
 * Starts an inspection for today: choose the outlet and go. Giving an
 * inspection to someone else, or planning one for another day, is done by
 * ECCS in the console.
 */
export default function StartInspectionScreen() {
  const theme = useTheme();
  const { t, api } = useSession();

  const [outlets, setOutlets] = useState<InspectionOutletDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.inspections.outlets();
      setOutlets(list);
      // With only one outlet there is nothing to choose.
      if (list.length === 1) setOutletId(list[0]!.id);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function start() {
    if (busy) return;
    if (!outletId) {
      setMissing(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const inspection = await api.inspections.start({ outletId });
      // Back from the inspection should return to the list, not to this form.
      router.replace({ pathname: '/inspections/[inspectionId]', params: { inspectionId: inspection.id } });
    } catch (e) {
      setError(errorMessage(e, t));
      setBusy(false);
    }
  }

  const footer = outlets !== null && outlets.length > 0 && (
    <>
      <ErrorText message={error ?? (missing && !outletId ? t('insp.needOutlet') : null)} />
      <Button label={t('insp.startNow')} loading={busy} onPress={() => void start()} />
    </>
  );

  return (
    <Screen back title={t('insp.start')} subtitle={t('insp.startHelp')} onRefresh={load} footer={footer || undefined}>
      <ErrorText message={loadError} onRetry={() => void load()} />
      {outlets === null && !loadError && <ActivityIndicator color={theme.primary} />}
      {outlets !== null && outlets.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('insp.noOutlets')}
        </ThemedText>
      )}
      {outlets !== null && outlets.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('insp.chooseOutlet')}
          </ThemedText>
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('insp.chooseOutlet')}>
            {outlets.map((outlet) => (
              <OptionChip
                key={outlet.id}
                label={outlet.name === outlet.organizationName ? outlet.name : `${outlet.name} · ${outlet.organizationName}`}
                selected={outlet.id === outletId}
                onPress={() => setOutletId(outlet.id)}
              />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { gap: Spacing.two },
});
