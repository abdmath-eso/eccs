import Ionicons from '@expo/vector-icons/Ionicons';
import type { FoodItemDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
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
  const { forwardIcon } = useDirection();
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
    <Screen back title={t('labels.items.title')} subtitle={t('labels.items.help')} onRefresh={load}>
      <Button icon="add" label={t('labels.items.add')} onPress={() => router.push('/labels/item')} />
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

      {active.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}. ${details(item)}`}
          onPress={() => router.push({ pathname: '/labels/item', params: { itemId: item.id } })}
          style={({ pressed }) => [styles.row, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.words}>
            <ThemedText type="default" style={styles.name}>
              {item.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {details(item)}
            </ThemedText>
            {item.note && (
              <ThemedText type="small" themeColor="textSecondary">
                {item.note}
              </ThemedText>
            )}
          </View>
          <Ionicons name={forwardIcon} size={22} color={theme.textSecondary} />
        </Pressable>
      ))}

      {retired.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
            {t('labels.items.retired')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('labels.items.retiredHelp')}
          </ThemedText>
          {retired.map((item) => (
            <View key={item.id} style={[styles.row, { borderColor: theme.border }]}>
              <View style={styles.words}>
                <ThemedText type="default" themeColor="textSecondary" style={styles.name}>
                  {item.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {details(item)}
                </ThemedText>
              </View>
              <Button
                label={t('labels.items.bringBack')}
                variant="link"
                loading={restoring === item.id}
                onPress={() => void bringBack(item)}
              />
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: Spacing.four },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize + Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  words: { flex: 1 },
  name: { fontWeight: 700 },
});
