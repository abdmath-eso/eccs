import { localize, sopSteps, type SopDto } from '@eccs/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/** One SOP, as numbered steps to follow. The Owner or Manager can change or delete their own. */
export default function SopScreen() {
  const theme = useTheme();
  const { sopId } = useLocalSearchParams<{ sopId: string }>();
  const { t, api, language } = useSession();
  const [sop, setSop] = useState<SopDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reloads when coming back from editing.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const loaded = await api.sops.get(sopId);
          if (cancelled) return;
          setSop(loaded);
          setError(null);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e, t));
        }
      })();
      return () => {
        cancelled = true;
      };
      // `t` changes with language; reloading for that is unnecessary.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, sopId]),
  );

  async function remove() {
    setConfirming(false);
    setDeleting(true);
    try {
      await api.sops.remove(sopId);
      router.back();
    } catch (e) {
      setError(errorMessage(e, t));
      setDeleting(false);
    }
  }

  const title = sop ? localize(sop.title, language) : undefined;

  return (
    <Screen back title={title}>
      <ErrorText message={error} />
      {!sop && !error && <ActivityIndicator color={theme.primary} />}

      {sop && (
        <>
          <ThemedText type="small" themeColor={sop.isCustom ? 'primary' : 'textSecondary'}>
            {t(`sopCategory.${sop.category}`)} · {t(sop.isCustom ? 'sops.yours' : 'sops.byEccs')}
          </ThemedText>

          <View style={styles.steps}>
            {sopSteps(sop, language).map((step, index) => (
              <View key={index} style={[styles.step, { backgroundColor: theme.backgroundElement }]}>
                <View style={[styles.number, { backgroundColor: theme.primary }]}>
                  <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                    {index + 1}
                  </ThemedText>
                </View>
                <ThemedText type="default" style={styles.stepText}>
                  {step}
                </ThemedText>
              </View>
            ))}
          </View>

          {sop.canEdit && sop.outletId && (
            <View style={styles.actions}>
              <Button
                label={t('sops.edit')}
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/sops/edit', params: { outletId: sop.outletId!, sopId: sop.id } })
                }
              />
              <Button
                label={t('sops.delete')}
                variant="danger"
                loading={deleting}
                onPress={() => setConfirming(true)}
              />
            </View>
          )}
        </>
      )}

      <ConfirmDialog
        visible={confirming}
        message={t('sops.deleteConfirm', { name: title ?? '' })}
        confirmLabel={t('sops.delete')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  steps: { gap: Spacing.two },
  step: { flexDirection: 'row', gap: Spacing.three, borderRadius: Spacing.three, padding: Spacing.three },
  number: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1 },
  actions: { gap: Spacing.two, marginTop: Spacing.three },
});
