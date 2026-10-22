import { can, localize, SOP_CATEGORIES, sopSteps, type SopDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { OptionSheet } from '@/components/ui/option-sheet';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/** The SOP library: ECCS's standard procedures and the outlet's own, grouped by category. */
export default function SopsScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const [sops, setSops] = useState<SopDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const mayAdd = can(user?.memberships ?? [], 'sopTemplates', 'create');

  // Reloads whenever the screen comes back into view, so an SOP just added or changed shows.
  useFocusEffect(
    useCallback(() => {
      if (!outletId) return;
      let cancelled = false;
      (async () => {
        try {
          const list = await api.sops.list(outletId);
          if (cancelled) return;
          setSops(list);
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
    }, [api, outletId]),
  );

  /** Loads the list again: for pulling down to refresh and for "Try again". */
  async function reload() {
    if (!outletId) return;
    setError(null);
    try {
      setSops(await api.sops.list(outletId));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  /** "1 step", "5 steps". */
  const stepCount = (count: number) => (count === 1 ? t('sops.stepOne') : t('sops.stepCount', { count }));

  return (
    // What SOPs are is read once, so it is folded away at the end; the list comes first (22 Oct 2026).
    <Screen back title={t('sops.title')} about={t(mayAdd ? 'sops.helpAdd' : 'sops.help')} onRefresh={reload}>
      <OutletPicker
        outlets={outlets}
        outletId={outletId}
        onChoose={(nextOutletId) => {
          setSops(null);
          setError(null);
          choose(nextOutletId);
        }}
      />

      <ErrorText message={error} onRetry={() => void reload()} />
      {(outletLoading || (sops === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}
      {sops?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('sops.empty')}
        </ThemedText>
      )}

      {/* One "Add SOP" that asks which way, as an app's single "New" button opens a short list of what
          can be made (Google Drive's New sheet), instead of two big buttons above the list. */}
      {mayAdd && outletId && sops !== null && (
        <Button icon="add" label={t('sops.addButton')} onPress={() => setAdding(true)} />
      )}

      {SOP_CATEGORIES.map((category) => {
        const inCategory = sops?.filter((sop) => sop.category === category) ?? [];
        if (inCategory.length === 0) return null;
        return (
          <View key={category} style={styles.group}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t(`sopCategory.${category}`)}
            </ThemedText>
            {inCategory.map((sop) => (
              <Card
                key={sop.id}
                variant="filled"
                chevron
                onPress={() => router.push({ pathname: '/sops/[sopId]', params: { sopId: sop.id } })}>
                <View style={styles.rowText}>
                  <ThemedText type="default" style={styles.rowTitle}>
                    {localize(sop.title, language)}
                  </ThemedText>
                  <ThemedText type="small" themeColor={sop.isCustom ? 'primary' : 'textSecondary'}>
                    {t(sop.isCustom ? 'sops.yours' : 'sops.byEccs')} · {stepCount(sopSteps(sop, language).length)}
                  </ThemedText>
                </View>
              </Card>
            ))}
          </View>
        );
      })}

      {outletId && (
        <OptionSheet
          visible={adding}
          title={t('sops.addButton')}
          onClose={() => setAdding(false)}
          options={[
            {
              label: t('sops.fromLibrary'),
              icon: 'library-outline',
              onPress: () => {
                setAdding(false);
                router.push({ pathname: '/sops/library', params: { outletId } });
              },
            },
            {
              label: t('sops.writeOwn'),
              icon: 'create-outline',
              onPress: () => {
                setAdding(false);
                router.push({ pathname: '/sops/edit', params: { outletId } });
              },
            },
          ]}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two, marginTop: Spacing.two },
  rowText: { gap: Spacing.half },
  rowTitle: { fontWeight: 700 },
});
