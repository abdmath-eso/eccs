import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import { searchStarterItems, type StarterFoodItem } from '@eccs/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
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
    <Screen back title={t('labels.starter.title')} subtitle={t('labels.starter.help')}>
      <View style={[styles.caution, { borderColor: theme.warning }]}>
        <Ionicons name="information-circle" size={22} color={theme.warning} />
        <ThemedText type="small" style={styles.cautionText}>
          {t('labels.starter.caution')}
        </ThemedText>
      </View>

      <TextField label={t('common.search')} value={search} onChangeText={setSearch} autoCorrect={false} returnKeyType="search" />

      {matching.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('labels.starter.noMatch')}
        </ThemedText>
      )}

      {matching.map((entry) => {
        const isAdded = added.includes(entry.key) || added.includes(entry.name.toLowerCase());
        return (
          <View key={entry.key} style={[styles.row, { borderColor: theme.border }]}>
            <View style={styles.words}>
              <ThemedText type="default" style={styles.name}>
                {entry.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[
                  t(`labels.storage.${entry.storage}`),
                  shelfLifeText(entry.shelfLifeHours, t),
                  entry.allergens.length > 0 ? allergensText(entry.allergens, t) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>
              <ErrorText message={failed?.key === entry.key ? failed.message : null} />
            </View>
            {isAdded ? (
              <View style={styles.added}>
                <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
                <ThemedText type="smallBold" themeColor="primary">
                  {t('labels.starter.added')}
                </ThemedText>
              </View>
            ) : (
              <Button
                icon="add"
                label={t('labels.starter.add')}
                variant="secondary"
                loading={adding === entry.key}
                disabled={adding !== null && adding !== entry.key}
                onPress={() => void add(entry)}
              />
            )}
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  caution: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  cautionText: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  words: { flex: 1 },
  name: { fontWeight: 700 },
  added: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two },
});
