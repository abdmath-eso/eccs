import { can, localize, type OutletChecklistDto } from '@eccs/shared';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

type Item = OutletChecklistDto['items'][number];

/** Where the Owner or Manager adds checks for their own kitchen on top of ECCS's basic list. */
export default function ChecklistSetupScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { outletId } = useLocalSearchParams<{ outletId: string }>();
  const [lists, setLists] = useState<OutletChecklistDto[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyList, setBusyList] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = can(user?.memberships ?? [], 'checklists', 'update', { outletId });

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    api.checklists
      .setup(outletId)
      .then((loaded) => !cancelled && setLists(loaded))
      .catch((e) => !cancelled && setError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, allowed]);

  if (!allowed) return <Redirect href="/" />;

  async function add(listId: string) {
    const label = (drafts[listId] ?? '').trim();
    if (label.length < 2) return;
    setBusyList(listId);
    setError(null);
    try {
      setLists(await api.checklists.addItem(listId, { label }));
      setDrafts((current) => ({ ...current, [listId]: '' }));
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusyList(null);
    }
  }

  async function remove() {
    if (!removing) return;
    const item = removing;
    setRemoving(null);
    setError(null);
    try {
      setLists(await api.checklists.removeItem(item.id));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  return (
    <Screen back title={t('setup.title')} subtitle={t('setup.help')}>
      <ErrorText message={error} />
      {lists === null && !error && <ActivityIndicator color={theme.primary} />}

      {lists?.map((list) => (
        <View key={list.id} style={[styles.card, { borderColor: theme.border }]}>
          <ThemedText type="default" style={styles.listTitle}>
            {localize(list.title, language)}
          </ThemedText>

          {list.items.map((item, index) => (
            <View key={item.id} style={[styles.item, { borderColor: theme.border }]}>
              <View style={styles.itemText}>
                <ThemedText type="default">
                  {index + 1}. {localize(item.label, language)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {item.isCustom ? t('checklists.yourItem') : t('setup.basic')}
                </ThemedText>
              </View>
              {item.isCustom && <Button label={t('setup.remove')} variant="danger" onPress={() => setRemoving(item)} />}
            </View>
          ))}

          <TextField
            value={drafts[list.id] ?? ''}
            onChangeText={(text) => setDrafts((current) => ({ ...current, [list.id]: text }))}
            placeholder={t('setup.addPlaceholder')}
            maxLength={160}
            returnKeyType="done"
            onSubmitEditing={() => void add(list.id)}
          />
          <Button
            label={t('setup.add')}
            onPress={() => void add(list.id)}
            loading={busyList === list.id}
            disabled={(drafts[list.id] ?? '').trim().length < 2}
          />
        </View>
      ))}

      <ConfirmDialog
        visible={removing !== null}
        message={removing ? t('setup.removeConfirm', { name: localize(removing.label, language) }) : ''}
        confirmLabel={t('setup.remove')}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three },
  listTitle: { fontWeight: 700, fontSize: 20 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: 1,
    paddingBottom: Spacing.two,
  },
  itemText: { flex: 1, gap: Spacing.half },
});
