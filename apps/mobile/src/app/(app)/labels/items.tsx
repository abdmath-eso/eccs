import type { FoodItemDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { allergensText, shelfLifeText } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/**
 * The outlet's saved labels ("food items"), for the Owner and the Manager:
 * each has a name and how long the food keeps, and optionally where it is
 * kept and its allergens. Anyone who prints labels can add to this list from
 * the Food labels screen; changing and removing are for the Owner and the
 * Manager, here or from that screen. Retired items are kept underneath and
 * can be brought back; the outlet is the one chosen on the labels screen.
 */
export default function FoodItemsScreen() {
  const theme = useTheme();
  const notify = useSnackbar();
  const { t, api } = useSession();
  const { outletId, loading: outletLoading } = useOutlet();
  const [items, setItems] = useState<FoodItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!outletId) return;
    try {
      setItems(await api.foodLabels.items(outletId, { all: true }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId]);

  // Reloads on coming back from adding or changing an item.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function bringBack(item: FoodItemDto) {
    setRestoring(item.id);
    try {
      await api.foodLabels.updateItem(item.id, { isActive: true });
      notify(t('labels.items.broughtBack'));
      await load();
    } catch (e) {
      setError(errorMessage(e, t, { 409: 'labels.items.nameTaken' }));
    } finally {
      setRestoring(null);
    }
  }

  const details = (item: FoodItemDto) =>
    [
      item.storage && t(`labels.storage.${item.storage}`),
      shelfLifeText(item.shelfLifeHours, t),
      item.allergens.length > 0 ? allergensText(item.allergens, t) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const active = (items ?? []).filter((item) => item.isActive).sort((a, b) => a.name.localeCompare(b.name));
  const retired = (items ?? []).filter((item) => !item.isActive);

  return (
    // What the list is for is read once: folded away at the end (22 Oct 2026). The screen keeps the
    // name of the link that opens it, "Manage labels", and calls each entry a label, as the Food labels
    // screen does, rather than "food items" there and "labels" here.
    <Screen back title={t('labels.manage')} about={t('labels.items.help')} onRefresh={load}>
      <Button icon="add" label={t('labels.add')} onPress={() => router.push('/labels/item')} />
      <Button
        icon="sparkles-outline"
        label={t('labels.items.fromStarter')}
        variant="secondary"
        onPress={() => router.push('/labels/starter')}
      />

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (items === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}

      {items !== null && active.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('labels.items.none')}
        </ThemedText>
      )}

      {/* One plain list with thin lines between, as lists of like things are drawn across the app. */}
      <View>
        {active.map((item, index) => (
          <ListRow
            key={item.id}
            title={item.name}
            subtitle={[details(item), item.note].filter(Boolean).join('\n')}
            divider={index > 0}
            accessibilityLabel={`${item.name}. ${details(item)}`}
            onPress={() => router.push({ pathname: '/labels/item', params: { itemId: item.id } })}
          />
        ))}
      </View>

      {retired.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
            {t('labels.items.retired')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('labels.items.retiredHelp')}
          </ThemedText>
          <View>
            {retired.map((item, index) => (
              <ListRow
                key={item.id}
                title={item.name}
                subtitle={details(item)}
                divider={index > 0}
                dimmed
                trailing={
                  <Button
                    label={t('labels.items.bringBack')}
                    variant="link"
                    loading={restoring === item.id}
                    onPress={() => void bringBack(item)}
                  />
                }
              />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: Spacing.two },
});
