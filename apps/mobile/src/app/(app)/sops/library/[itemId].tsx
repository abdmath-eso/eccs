import type { SopLibraryItemDto } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/**
 * One ready-made SOP from the library, to read before deciding. Adding it
 * makes a copy in the outlet's own SOPs, which opens so it can be reworded.
 */
export default function SopLibraryItemScreen() {
  const theme = useTheme();
  const { itemId, outletId } = useLocalSearchParams<{ itemId: string; outletId: string }>();
  const { t, api, language } = useSession();
  const [item, setItem] = useState<SopLibraryItemDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const notify = useSnackbar();

  useEffect(() => {
    let cancelled = false;
    api.sops.library
      .get(outletId, itemId)
      .then((loaded) => !cancelled && setItem(loaded))
      .catch((e) => !cancelled && setError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, itemId, language]);

  // The copy takes this screen's place, so Back from it returns to the library list.
  const openCopy = (sopId: string) => router.replace({ pathname: '/sops/[sopId]', params: { sopId } });

  /** Loads the SOP again: for pulling down to refresh and for "Try again". */
  async function reload() {
    setError(null);
    try {
      setItem(await api.sops.library.get(outletId, itemId));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  async function add() {
    setAdding(true);
    setAddError(null);
    try {
      const copy = await api.sops.library.add(outletId, itemId);
      notify(t('soplib.addedDone'));
      openCopy(copy.id);
    } catch (e) {
      setAddError(errorMessage(e, t));
      setAdding(false);
    }
  }

  return (
    <Screen
      back
      title={item?.name}
      onRefresh={reload}
      // The main button stays pinned at the bottom, so it is there without scrolling past every step.
      footer={
        item ? (
          <>
            <ErrorText message={addError} />
            {item.addedSopId ? (
              <Button label={t('soplib.openMine')} variant="secondary" onPress={() => openCopy(item.addedSopId!)} />
            ) : (
              <Button label={t('soplib.add')} hint={t('soplib.addHint')} loading={adding} onPress={() => void add()} />
            )}
          </>
        ) : undefined
      }>
      <ErrorText message={error} onRetry={() => void reload()} />
      {!item && !error && <ActivityIndicator color={theme.primary} />}

      {item && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {t(`sopCategory.${item.category}`)} · {item.sectionLabel ?? item.section}
            {item.frequency ? ` · ${item.frequency}` : ''}
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {item.purpose}
          </ThemedText>

          {item.kind === 'RECIPE' && (
            <View style={[styles.note, { borderColor: theme.warning }]}>
              <ThemedText type="small" themeColor="warning">
                {t('soplib.recipeNote')}
              </ThemedText>
            </View>
          )}

          <View style={styles.steps}>
            {item.steps.map((step, index) => (
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

          {item.controls && (
            <View style={[styles.note, { borderColor: theme.border }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('soplib.takeCare')}
              </ThemedText>
              <ThemedText type="default">{item.controls}</ThemedText>
            </View>
          )}
        </>
      )}

    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { borderWidth: 1.5, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  steps: { gap: Spacing.two },
  step: { flexDirection: 'row', gap: Spacing.three, borderRadius: Spacing.three, padding: Spacing.three },
  number: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1 },
});
