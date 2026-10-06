import Ionicons from '@expo/vector-icons/Ionicons';
import { can, localize, SOP_CATEGORIES, sopSteps, type SopDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
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

  return (
    <Screen back title={t('sops.title')} subtitle={t(mayAdd ? 'sops.helpAdd' : 'sops.help')}>
      {outlets.length > 1 && (
        <View style={styles.outlets} accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => {
            const selected = outlet.id === outletId;
            return (
              <Pressable
                key={outlet.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setSops(null);
                  choose(outlet.id);
                }}
                style={[
                  styles.outlet,
                  { borderColor: selected ? theme.primary : theme.border },
                  selected && { backgroundColor: theme.backgroundElement },
                ]}>
                <ThemedText type="small" themeColor={selected ? 'primary' : 'text'}>
                  {outlet.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}

      <ErrorText message={error} />
      {(outletLoading || (sops === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}
      {sops?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('sops.empty')}
        </ThemedText>
      )}

      {mayAdd && outletId && sops !== null && (
        <View style={styles.adding}>
          <Button
            label={t('sops.fromLibrary')}
            hint={t('sops.fromLibraryHint')}
            onPress={() => router.push({ pathname: '/sops/library', params: { outletId } })}
          />
          <Button
            label={`+  ${t('sops.writeOwn')}`}
            variant="secondary"
            onPress={() => router.push({ pathname: '/sops/edit', params: { outletId } })}
          />
        </View>
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
              <Pressable
                key={sop.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/sops/[sopId]', params: { sopId: sop.id } })}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                ]}>
                <View style={styles.rowText}>
                  <ThemedText type="default" style={styles.rowTitle}>
                    {localize(sop.title, language)}
                  </ThemedText>
                  <ThemedText type="small" themeColor={sop.isCustom ? 'primary' : 'textSecondary'}>
                    {t(sop.isCustom ? 'sops.yours' : 'sops.byEccs')} ·{' '}
                    {t('sops.stepCount', { count: sopSteps(sop, language).length })}
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={22} color={theme.textSecondary} />
              </Pressable>
            ))}
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  outlets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  outlet: {
    minHeight: MinTouchSize - 8,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  adding: { gap: Spacing.two },
  group: { gap: Spacing.two, marginTop: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: MinTouchSize * 1.3,
  },
  rowText: { flex: 1, gap: Spacing.half },
  rowTitle: { fontWeight: 700 },
});
