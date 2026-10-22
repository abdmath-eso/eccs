import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import { searchStarterItems, type StarterFoodItem } from '@eccs/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { SearchField } from '@/components/ui/search-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { allergensText, shelfLifeText } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/**
 * A starter list of common kitchen items, each added to the outlet's own
 * list in one tap and then changed there. Works like the SOP library's "find
 * a ready-made one": type to narrow it, tap Add, and what is already on the
 * list is marked. The shelf lives are suggestions and the screen says so.
 */
export default function StarterItemsScreen() {
  const theme = useTheme();
  const { t, api } = useSession();
  const { outletId } = useOutlet();
  const [search, setSearch] = useState('');
  // Which starter entries are already on the outlet's list, by key and by name.
  const [added, setAdded] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    if (!outletId) return;
    let cancelled = false;
    api.foodLabels
      .items(outletId)
      .then((items) => {
        if (!cancelled) setAdded(items.flatMap((item) => [item.starterKey ?? '', item.name.toLowerCase()]).filter(Boolean));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, outletId]);

  async function add(entry: StarterFoodItem) {
    if (!outletId || adding) return;
    setAdding(entry.key);
    setFailed(null);
    try {
      await api.foodLabels.createItem({
        outletId,
        name: entry.name,
        storage: entry.storage,
        shelfLifeHours: entry.shelfLifeHours,
        allergens: [...entry.allergens],
        starterKey: entry.key,
      });
      setAdded((list) => [...list, entry.key]);
    } catch (e) {
      // Already on the list under the same name: that is the same as added.
      if (e instanceof ApiError && e.status === 409) setAdded((list) => [...list, entry.key]);
      else setFailed({ key: entry.key, message: errorMessage(e, t) });
    } finally {
      setAdding(null);
    }
  }

  const matching = searchStarterItems(search);

  return (
    <Screen
      back
      title={t('labels.starter.title')}
      // How the list works and why the times are only suggestions, for reading once (22 Oct 2026).
      about={
        <>
          <ThemedText type="small">{t('labels.starter.help')}</ThemedText>
          <ThemedText type="small">{t('labels.starter.caution')}</ThemedText>
        </>
      }>
      {/* The caution that matters before adding anything stays in view, in one line. */}
      <Notice tone="warning" text={t('labels.starter.cautionShort')} />

      <SearchField value={search} onChangeText={setSearch} />

      {matching.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('labels.starter.noMatch')}
        </ThemedText>
      )}

      {/* Plain rows with a compact Add at the end, at least as wide as "Added", so the names keep the
          row's width and every row lines up (Material's list item with a trailing button). */}
      <View>
        {matching.map((entry, index) => {
          const isAdded = added.includes(entry.key) || added.includes(entry.name.toLowerCase());
          const busy = adding === entry.key;
          return (
            <ListRow
              key={entry.key}
              title={entry.name}
              subtitle={[
                t(`labels.storage.${entry.storage}`),
                shelfLifeText(entry.shelfLifeHours, t),
                entry.allergens.length > 0 ? allergensText(entry.allergens, t) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              below={<ErrorText message={failed?.key === entry.key ? failed.message : null} />}
              divider={index > 0}
              trailing={
                isAdded ? (
                  <View style={styles.action}>
                    <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                    <ThemedText type="smallBold" themeColor="primary" style={styles.actionText}>
                      {t('labels.starter.added')}
                    </ThemedText>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('labels.starter.add')}: ${entry.name}`}
                    accessibilityState={{ disabled: adding !== null, busy }}
                    disabled={adding !== null}
                    onPress={() => void add(entry)}
                    style={({ pressed }) => [
                      styles.action,
                      styles.addButton,
                      { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                      adding !== null && !busy && styles.faded,
                    ]}>
                    {busy ? <ActivityIndicator color={theme.text} /> : <Ionicons name="add" size={20} color={theme.text} />}
                    <ThemedText type="smallBold" style={styles.actionText}>
                      {t('labels.starter.add')}
                    </ThemedText>
                  </Pressable>
                )
              }
            />
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // "Add" and "Added" take at least the same room, so the names beside them end on one line, and grow
  // past it rather than break a longer word ("Added" in Telugu or Tamil, 22 Oct 2026).
  action: {
    minWidth: 104,
    minHeight: MinTouchSize - Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  addButton: { borderRadius: Spacing.three },
  actionText: { flexShrink: 1, textAlign: 'center' },
  faded: { opacity: 0.5 },
});
