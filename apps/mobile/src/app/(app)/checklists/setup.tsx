import { can, localize, type OutletChecklistDto } from '@eccs/shared';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ChecklistItemSearch } from '@/components/checklist-item-search';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';

type Item = OutletChecklistDto['items'][number];
type Removal = { kind: 'item'; item: Item } | { kind: 'list'; list: OutletChecklistDto };

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Accepts a time typed loosely ("9", "930", "9:30", "14.30") and returns HH:MM, or null if it is not a time. */
function parseTime(input: string): string | null {
  const digits = input.trim().replace(/[.\s]/g, ':');
  const match = /^(\d{1,2}):?(\d{2})?$/.exec(digits);
  if (!match) return null;
  const time = `${match[1]!.padStart(2, '0')}:${match[2] ?? '00'}`;
  return TIME_PATTERN.test(time) ? time : null;
}

/**
 * Where the Owner or Manager shapes the daily checklists for their kitchen:
 * add items to any checklist, change due times, and create extra checklists
 * such as a mid-day one. ECCS's basic checklists and items stay in place.
 */
export default function ChecklistSetupScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { outletId } = useLocalSearchParams<{ outletId: string }>();
  const [lists, setLists] = useState<OutletChecklistDto[] | null>(null);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTime, setNewTime] = useState('');

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

  /** Runs a change that returns the updated lists, showing a spinner on the control named by `key`. */
  async function change(key: string, action: () => Promise<OutletChecklistDto[]>): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      setLists(await action());
      return true;
    } catch (e) {
      setError(errorMessage(e, t));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createList() {
    const dueTime = newTime.trim() ? parseTime(newTime) : undefined;
    if (dueTime === null) {
      setError(t('error.time'));
      return;
    }
    const created = await change('new', () =>
      api.checklists.createList({ outletId, title: newName.trim(), ...(dueTime && { dueTime }) }),
    );
    if (created) {
      setCreating(false);
      setNewName('');
      setNewTime('');
    }
  }

  async function saveTime(list: OutletChecklistDto) {
    const typed = (timeDrafts[list.id] ?? '').trim();
    const dueTime = typed ? parseTime(typed) : null;
    if (typed && dueTime === null) {
      setError(t('error.time'));
      return;
    }
    const saved = await change(`time:${list.id}`, () => api.checklists.updateList(list.id, { dueTime }));
    if (saved) setTimeDrafts(({ [list.id]: _saved, ...rest }) => rest);
  }

  async function confirmRemoval() {
    if (!removal) return;
    const target = removal;
    setRemoval(null);
    await change('remove', () =>
      target.kind === 'item' ? api.checklists.removeItem(target.item.id) : api.checklists.removeList(target.list.id),
    );
  }

  return (
    <Screen back title={t('setup.title')} subtitle={t('setup.help')}>
      <ErrorText message={error} />
      {lists === null && !error && <ActivityIndicator color={theme.primary} />}

      {lists?.map((list) => {
        const timeDraft = timeDrafts[list.id];
        const timeChanged = timeDraft !== undefined && timeDraft.trim() !== (list.dueTime ?? '');
        return (
          <View key={list.id} style={[styles.card, { borderColor: theme.border }]}>
            <View>
              <ThemedText type="default" style={styles.listTitle}>
                {localize(list.title, language)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {list.isCustom ? t('setup.yourList') : t('setup.basicList')}
                {list.dueTime ? ` · ${t('checklists.due', { time: formatTime(list.dueTime, language) })}` : ''}
              </ThemedText>
            </View>

            <TextField
              label={t('setup.dueTime')}
              value={timeDraft ?? list.dueTime ?? ''}
              onChangeText={(text) => setTimeDrafts((current) => ({ ...current, [list.id]: text }))}
              placeholder={t('setup.dueTimePlaceholder')}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />
            {timeChanged && (
              <Button
                label={t('setup.saveTime')}
                variant="secondary"
                onPress={() => void saveTime(list)}
                loading={busy === `time:${list.id}`}
              />
            )}

            {list.items.length === 0 && (
              <ThemedText type="default" themeColor="danger">
                {t('checklists.noItems')}
              </ThemedText>
            )}
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
                {item.isCustom && (
                  <Button label={t('setup.remove')} variant="danger" onPress={() => setRemoval({ kind: 'item', item })} />
                )}
              </View>
            ))}

            <ChecklistItemSearch outletChecklistId={list.id} onAdded={setLists} onError={setError} />

            {list.isCustom && (
              <Button label={t('setup.removeList')} variant="link" onPress={() => setRemoval({ kind: 'list', list })} />
            )}
          </View>
        );
      })}

      {lists !== null &&
        (creating ? (
          <View style={[styles.card, { borderColor: theme.primary }]}>
            <ThemedText type="default" style={styles.listTitle}>
              {t('setup.newList')}
            </ThemedText>
            <TextField
              label={t('setup.listName')}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('setup.listNamePlaceholder')}
              maxLength={60}
              autoFocus
            />
            <TextField
              label={t('setup.dueTime')}
              value={newTime}
              onChangeText={setNewTime}
              placeholder={t('setup.dueTimePlaceholder')}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />
            <Button
              label={t('setup.createList')}
              onPress={() => void createList()}
              loading={busy === 'new'}
              disabled={newName.trim().length < 2}
            />
            <Button label={t('common.cancel')} variant="secondary" onPress={() => setCreating(false)} />
          </View>
        ) : (
          <Button label={`+  ${t('setup.newList')}`} hint={t('setup.newListHelp')} variant="secondary" onPress={() => setCreating(true)} />
        ))}

      <ConfirmDialog
        visible={removal !== null}
        message={
          removal === null
            ? ''
            : removal.kind === 'item'
              ? t('setup.removeConfirm', { name: localize(removal.item.label, language) })
              : t('setup.removeListConfirm', { name: localize(removal.list.title, language) })
        }
        confirmLabel={removal?.kind === 'list' ? t('setup.removeList') : t('setup.remove')}
        danger
        onCancel={() => setRemoval(null)}
        onConfirm={() => void confirmRemoval()}
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
