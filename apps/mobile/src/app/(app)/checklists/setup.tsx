import Ionicons from '@expo/vector-icons/Ionicons';
import type { LanguageCode, Translator } from '@eccs/i18n';
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
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';

type Item = OutletChecklistDto['items'][number];
type Removal = { kind: 'item'; item: Item } | { kind: 'list'; list: OutletChecklistDto };

/**
 * Shapes what is typed on the number pad into a time: digits only, at most
 * four, with the colon put in after the hour. An hour cannot start with 3 to
 * 9, so "9" becomes "09" and "930" reads as 09:30.
 */
function maskTime(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length > 0 && Number(digits[0]) > 2) digits = `0${digits}`;
  digits = digits.slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/**
 * What to say under a due-time field for what has been typed so far: the
 * time read back in words once it is complete, what is wrong as soon as it
 * cannot be a real time, and otherwise how to type it.
 */
function readTime(typed: string, language: LanguageCode, t: Translator) {
  const digits = typed.replace(/\D/g, '');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  const impossible = (digits.length >= 2 && hours > 23) || (digits.length === 4 && minutes > 59);
  if (impossible) return { time: null, complete: false, hint: null, error: t('error.timeNotReal') };
  if (digits.length === 4) {
    const time = `${digits.slice(0, 2)}:${digits.slice(2)}`;
    return { time, complete: true, hint: t('checklists.due', { time: formatTime(time, language) }), error: null };
  }
  return { time: null, complete: false, hint: t('setup.timeHint'), error: null };
}

/**
 * Where the Owner or Manager shapes the daily checklists for their kitchen:
 * add items to any checklist, change due times, and create extra checklists
 * such as a mid-day one. ECCS's basic checklists and items stay in place.
 */
export default function ChecklistSetupScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const notify = useSnackbar();
  const { outletId } = useLocalSearchParams<{ outletId: string }>();
  const [lists, setLists] = useState<OutletChecklistDto[] | null>(null);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  // What went wrong and which control it belongs to, so it is shown beside that control.
  const [failure, setFailure] = useState<{ at: string; message: string } | null>(null);
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
      .catch((e) => !cancelled && setFailure({ at: 'load', message: errorMessage(e, t) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, allowed]);

  /** Loads the checklists again: for pull-to-refresh and "Try again". */
  async function load() {
    try {
      setLists(await api.checklists.setup(outletId));
      setFailure((current) => (current?.at === 'load' ? null : current));
    } catch (e) {
      setFailure({ at: 'load', message: errorMessage(e, t) });
    }
  }

  if (!allowed) return <Redirect href="/" />;

  const failedAt = (at: string) => (failure?.at === at ? failure.message : null);
  const newRead = readTime(newTime, language, t);

  /**
   * Runs a change that returns the updated lists, showing a spinner on the
   * control named by `key` and, if it fails, the error beside that control.
   */
  async function change(key: string, action: () => Promise<OutletChecklistDto[]>, savedMessage: string): Promise<boolean> {
    setBusy(key);
    setFailure(null);
    try {
      setLists(await action());
      notify(savedMessage);
      return true;
    } catch (e) {
      setFailure({ at: key, message: errorMessage(e, t) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createList() {
    const title = newName.trim();
    if (title.length < 2) {
      setFailure({ at: 'newName', message: t('setup.nameNeeded') });
      return;
    }
    const read = readTime(newTime, language, t);
    if (read.error) return;
    if (newTime && !read.complete) {
      setFailure({ at: 'newTime', message: t('error.timeDigits') });
      return;
    }
    const created = await change(
      'new',
      () => api.checklists.createList({ outletId, title, ...(read.time && { dueTime: read.time }) }),
      t('setup.listAdded'),
    );
    if (created) {
      setCreating(false);
      setNewName('');
      setNewTime('');
    }
  }

  async function saveTime(list: OutletChecklistDto) {
    const typed = timeDrafts[list.id] ?? '';
    const read = readTime(typed, language, t);
    if (read.error) return;
    if (typed && !read.complete) {
      setFailure({ at: `time:${list.id}`, message: t('error.timeDigits') });
      return;
    }
    // An empty box means the checklist has no due time.
    const saved = await change(
      `time:${list.id}`,
      () => api.checklists.updateList(list.id, { dueTime: read.time }),
      t('common.saved'),
    );
    if (saved) setTimeDrafts(({ [list.id]: _saved, ...rest }) => rest);
  }

  async function confirmRemoval() {
    if (!removal) return;
    const target = removal;
    setRemoval(null);
    await change(
      target.kind === 'item' ? `remove:${target.item.id}` : `removeList:${target.list.id}`,
      () => (target.kind === 'item' ? api.checklists.removeItem(target.item.id) : api.checklists.removeList(target.list.id)),
      t('setup.removed'),
    );
  }

  return (
    <Screen back title={t('setup.title')} subtitle={t('setup.help')} onRefresh={load}>
      <ErrorText message={failedAt('load')} onRetry={() => void load()} />
      {lists === null && !failedAt('load') && <ActivityIndicator color={theme.primary} />}

      {lists?.map((list) => {
        const timeDraft = timeDrafts[list.id];
        const timeChanged = timeDraft !== undefined && timeDraft !== (list.dueTime ?? '');
        const read = readTime(timeDraft ?? list.dueTime ?? '', language, t);
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
              onChangeText={(text) => {
                setTimeDrafts((current) => ({ ...current, [list.id]: maskTime(text) }));
                setFailure(null);
              }}
              placeholder={t('setup.dueTimePlaceholder')}
              keyboardType="number-pad"
              maxLength={5}
              hint={read.hint}
              error={read.error ?? failedAt(`time:${list.id}`)}
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
                <View style={styles.itemHeader}>
                  <Ionicons
                    name={item.photoRequired ? 'camera' : 'checkmark-circle-outline'}
                    size={24}
                    color={theme.textSecondary}
                    accessibilityLabel={t(item.photoRequired ? 'setup.photoNeeded' : 'setup.tickOnly')}
                  />
                  <View style={styles.itemText}>
                    <ThemedText type="default">
                      {index + 1}. {localize(item.label, language)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.isCustom ? t('checklists.yourItem') : t('setup.basic')}
                      {' · '}
                      {t(item.photoRequired ? 'setup.photoNeeded' : 'setup.tickOnly')}
                    </ThemedText>
                  </View>
                </View>
                {item.isCustom && (
                  <>
                    <View style={styles.itemActions}>
                      <View style={styles.itemAction}>
                        <Button
                          fill
                          label={t(item.photoRequired ? 'setup.makeTickOnly' : 'setup.makePhoto')}
                          variant="secondary"
                          loading={busy === `proof:${item.id}`}
                          onPress={() =>
                            void change(
                              `proof:${item.id}`,
                              () => api.checklists.updateItem(item.id, { photoRequired: !item.photoRequired }),
                              t('common.saved'),
                            )
                          }
                        />
                      </View>
                      <Button
                        label={t('setup.remove')}
                        variant="danger"
                        loading={busy === `remove:${item.id}`}
                        onPress={() => setRemoval({ kind: 'item', item })}
                      />
                    </View>
                    <ErrorText message={failedAt(`proof:${item.id}`) ?? failedAt(`remove:${item.id}`)} />
                  </>
                )}
              </View>
            ))}

            <ChecklistItemSearch outletChecklistId={list.id} onAdded={setLists} />

            {list.isCustom && (
              <>
                <ErrorText message={failedAt(`removeList:${list.id}`)} />
                <Button
                  label={t('setup.removeList')}
                  variant="link"
                  loading={busy === `removeList:${list.id}`}
                  onPress={() => setRemoval({ kind: 'list', list })}
                />
              </>
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
              onChangeText={(text) => {
                setNewName(text);
                setFailure(null);
              }}
              placeholder={t('setup.listNamePlaceholder')}
              maxLength={60}
              autoFocus
              error={failedAt('newName')}
            />
            <TextField
              label={t('setup.dueTime')}
              value={newTime}
              onChangeText={(text) => {
                setNewTime(maskTime(text));
                setFailure(null);
              }}
              placeholder={t('setup.dueTimePlaceholder')}
              keyboardType="number-pad"
              maxLength={5}
              hint={newRead.hint}
              error={newRead.error ?? failedAt('newTime')}
            />
            <ErrorText message={failedAt('new')} />
            <Button label={t('setup.createList')} onPress={() => void createList()} loading={busy === 'new'} />
            <Button label={t('common.cancel')} variant="secondary" onPress={() => setCreating(false)} />
          </View>
        ) : (
          <Button
            label={`+  ${t('setup.newList')}`}
            hint={t('setup.newListHelp')}
            variant="secondary"
            onPress={() => setCreating(true)}
          />
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
  item: { gap: Spacing.two, borderBottomWidth: 1, paddingBottom: Spacing.two },
  itemHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  itemActions: { flexDirection: 'row', gap: Spacing.two },
  itemAction: { flex: 1 },
  itemText: { flex: 1, gap: Spacing.half },
});
