import Ionicons from '@expo/vector-icons/Ionicons';
import { localize, sopSteps, type SopDto } from '@eccs/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/** One SOP, as numbered steps to follow. The Owner or Manager can change or delete their own. */
export default function SopScreen() {
  const theme = useTheme();
  const { sopId } = useLocalSearchParams<{ sopId: string }>();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const [sop, setSop] = useState<SopDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  /** Loads the SOP again: for pulling down to refresh and for "Try again". */
  async function reload() {
    setError(null);
    try {
      setSop(await api.sops.get(sopId));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  async function remove() {
    setConfirming(false);
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.sops.remove(sopId);
      notify(t('sops.deleted'));
      router.back();
    } catch (e) {
      setDeleteError(errorMessage(e, t));
      setDeleting(false);
    }
  }

  const title = sop ? localize(sop.title, language) : undefined;
  const mayChange = sop !== null && sop.canEdit && !!sop.outletId;

  return (
    <Screen
      back
      title={title}
      onRefresh={reload}
      // Edit sits in the top bar so it is reachable without scrolling past every step.
      headerRight={
        mayChange ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/sops/edit', params: { outletId: sop.outletId!, sopId: sop.id } })}
            style={({ pressed }) => [styles.edit, pressed && { opacity: 0.6 }]}>
            <Ionicons name="create-outline" size={22} color={theme.primary} />
            <ThemedText type="default" themeColor="primary" style={styles.editLabel}>
              {t('sops.edit')}
            </ThemedText>
          </Pressable>
        ) : undefined
      }>
      <ErrorText message={error} onRetry={() => void reload()} />
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

          {/* Deleting is rare and cannot be undone, so it stays at the very end. */}
          {mayChange && (
            <View style={styles.actions}>
              <ErrorText message={deleteError} />
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
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: MinTouchSize,
    paddingLeft: Spacing.three,
  },
  editLabel: { fontWeight: 700 },
  steps: { gap: Spacing.two },
  step: { flexDirection: 'row', gap: Spacing.three, borderRadius: Spacing.three, padding: Spacing.three },
  number: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1 },
  actions: { gap: Spacing.two, marginTop: Spacing.three },
});
