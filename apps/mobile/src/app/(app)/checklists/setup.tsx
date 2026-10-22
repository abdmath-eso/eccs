import Ionicons from '@expo/vector-icons/Ionicons';
import type { LanguageCode, Translator } from '@eccs/i18n';
import { can, localize, type OutletChecklistDto } from '@eccs/shared';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ChecklistItemSearch } from '@/components/checklist-item-search';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
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
 *
 * Laid out as checklist editors are (SafetyCulture's template editor, Google Tasks; 22 Oct 2026):
 * first the outlet's checklists, one row each with its due time and number of items; tapping one
 * opens its own editor, where each item is one row with a Photo switch (Material 3's list item
 * with a trailing switch) and a bin to remove it. Until then every checklist was open at once,
 * each item with two big buttons, over five screens.
 */
export default function ChecklistSetupScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const notify = useSnackbar();
  const { outletId } = useLocalSearchParams<{ outletId: string }>();
  const [lists, setLists] = useState<OutletChecklistDto[] | null>(null);
  // The checklist whose editor is open; null shows the list of checklists.
  const [openId, setOpenId] = useState<string | null>(null);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  // What went wrong and which control it belongs to, so it is shown beside that control.
  const [failure, setFailure] = useState<{ at: string; message: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTime, setNewTime] = useState('');

  const allowed = can(user?.memberships ?? [], 'checklists', 'update', { outletId });

  // In a checklist's editor the phone's own back button returns to the list, as the one on screen does.
  useFocusEffect(
    useCallback(() => {
      // A browser has no such button, and React Native warns if it is asked for one.
      if (openId === null || Platform.OS === 'web') return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setOpenId(null);
        return true;
      });
      return () => subscription.remove();
    }, [openId]),
  );

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
   * Gives back the updated lists, or null if it failed.
   */
  async function change(
    key: string,
    action: () => Promise<OutletChecklistDto[]>,
    savedMessage: string,
  ): Promise<OutletChecklistDto[] | null> {
    setBusy(key);
    setFailure(null);
    try {
      const updated = await action();
      setLists(updated);
      notify(savedMessage);
      return updated;
    } catch (e) {
      setFailure({ at: key, message: errorMessage(e, t) });
      return null;
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
    const before = new Set(lists?.map((list) => list.id));
    const updated = await change(
      'new',
      () => api.checklists.createList({ outletId, title, ...(read.time && { dueTime: read.time }) }),
      t('setup.listAdded'),
    );
    if (updated) {
      setCreating(false);
      setNewName('');
      setNewTime('');
      // The new checklist opens, ready for its items.
      const added = updated.find((list) => !before.has(list.id));
      if (added) setOpenId(added.id);
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
    const updated = await change(
      target.kind === 'item' ? `remove:${target.item.id}` : `removeList:${target.list.id}`,
      () => (target.kind === 'item' ? api.checklists.removeItem(target.item.id) : api.checklists.removeList(target.list.id)),
      t('setup.removed'),
    );
    // A removed checklist has no editor to stay in.
    if (updated && target.kind === 'list') setOpenId(null);
  }

  const removeDialog = (
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
  );

  const opened = openId !== null ? (lists?.find((list) => list.id === openId) ?? null) : null;

  // ── One checklist's editor ──
  if (opened) {
    const timeDraft = timeDrafts[opened.id];
    const timeChanged = timeDraft !== undefined && timeDraft !== (opened.dueTime ?? '');
    const read = readTime(timeDraft ?? opened.dueTime ?? '', language, t);
    return (
      <Screen
        // A fresh screen for each checklist, so it opens at the top.
        key={opened.id}
        back
        backLabel={t('setup.allLists')}
        onBack={() => setOpenId(null)}
        title={localize(opened.title, language)}
        subtitle={opened.isCustom ? t('setup.yourList') : t('setup.basicList')}
        onRefresh={load}>
        <ErrorText message={failedAt('load')} onRetry={() => void load()} />

        {/* The due time is said here once: in the box, read back in words underneath. */}
        <TextField
          label={t('setup.dueTime')}
          value={timeDraft ?? opened.dueTime ?? ''}
          onChangeText={(text) => {
            setTimeDrafts((current) => ({ ...current, [opened.id]: maskTime(text) }));
            setFailure(null);
          }}
          placeholder={t('setup.dueTimePlaceholder')}
          keyboardType="number-pad"
          maxLength={5}
          hint={read.hint}
          error={read.error ?? failedAt(`time:${opened.id}`)}
        />
        {timeChanged && (
          <Button
            label={t('setup.saveTime')}
            variant="secondary"
            onPress={() => void saveTime(opened)}
            loading={busy === `time:${opened.id}`}
          />
        )}

        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
          {t('setup.items')}
        </ThemedText>
        {opened.items.length === 0 && (
          <ThemedText type="default" themeColor="danger">
            {t('checklists.noItems')}
          </ThemedText>
        )}
        {opened.items.length > 0 && (
          <View>
            {opened.items.map((item, index) => {
              const label = localize(item.label, language);
              return (
                <View
                  key={item.id}
                  style={[styles.item, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                  <View style={styles.itemTop}>
                    <View style={styles.itemText}>
                      <ThemedText type="default" style={styles.itemLabel}>
                        {index + 1}. {label}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {item.isCustom ? t('checklists.yourItem') : t('setup.basic')}
                      </ThemedText>
                    </View>
                    {/* The restaurant's own items can be removed (it asks first); ECCS's basic ones stay. */}
                    {item.isCustom && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t('setup.remove')}: ${label}`}
                        disabled={busy !== null}
                        onPress={() => setRemoval({ kind: 'item', item })}
                        style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: theme.backgroundElement }]}>
                        {busy === `remove:${item.id}` ? (
                          <ActivityIndicator color={theme.primary} />
                        ) : (
                          <Ionicons name="trash-outline" size={22} color={theme.textSecondary} />
                        )}
                      </Pressable>
                    )}
                  </View>
                  {item.isCustom ? (
                    // A switch with its words beside it (Material 3): on, staff take a photo; off, a tick is enough.
                    <View style={styles.proof}>
                      <Ionicons name="camera-outline" size={22} color={theme.textSecondary} />
                      <ThemedText type="default" style={styles.proofText}>
                        {t('setup.photoNeeded')}
                      </ThemedText>
                      {busy === `proof:${item.id}` ? (
                        <ActivityIndicator color={theme.primary} style={styles.switchSpace} />
                      ) : (
                        <Switch
                          accessibilityLabel={`${t('setup.photoNeeded')}: ${label}`}
                          value={item.photoRequired}
                          disabled={busy !== null}
                          onValueChange={(photoRequired) =>
                            void change(
                              `proof:${item.id}`,
                              () => api.checklists.updateItem(item.id, { photoRequired }),
                              t('common.saved'),
                            )
                          }
                          trackColor={{ true: theme.primary, false: theme.outline }}
                        />
                      )}
                    </View>
                  ) : (
                    <View style={styles.proof}>
                      <Ionicons
                        name={item.photoRequired ? 'camera-outline' : 'checkmark-circle-outline'}
                        size={22}
                        color={theme.textSecondary}
                      />
                      <ThemedText type="small" themeColor="textSecondary" style={styles.proofText}>
                        {t(item.photoRequired ? 'setup.photoNeeded' : 'setup.tickOnly')}
                      </ThemedText>
                    </View>
                  )}
                  <ErrorText message={failedAt(`proof:${item.id}`) ?? failedAt(`remove:${item.id}`)} />
                </View>
              );
            })}
          </View>
        )}

        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
          {t('setup.addLabel')}
        </ThemedText>
        <ChecklistItemSearch outletChecklistId={opened.id} onAdded={setLists} />

        {/* Only the restaurant's own checklists can be removed: grey with red words, at the end, and it asks first. */}
        {opened.isCustom && (
          <View style={styles.sectionGap}>
            <ErrorText message={failedAt(`removeList:${opened.id}`)} />
            <Button
              icon="trash-outline"
              label={t('setup.removeList')}
              variant="danger"
              loading={busy === `removeList:${opened.id}`}
              onPress={() => setRemoval({ kind: 'list', list: opened })}
            />
          </View>
        )}
        {removeDialog}
      </Screen>
    );
  }

  /** "Due by 1:00 am · 3 items": the facts on a checklist's row in the list. */
  const listFacts = (list: OutletChecklistDto) =>
    [
      list.dueTime ? t('checklists.due', { time: formatTime(list.dueTime, language) }) : null,
      list.items.length === 1 ? t('setup.itemCountOne') : t('setup.itemCount', { count: list.items.length }),
    ]
      .filter(Boolean)
      .join(' · ');

  // ── The outlet's checklists ──
  return (
    <Screen back title={t('setup.title')} about={t('setup.help')} onRefresh={load}>
      <ErrorText message={failedAt('load')} onRetry={() => void load()} />
      {lists === null && !failedAt('load') && <ActivityIndicator color={theme.primary} />}

      {lists && lists.length > 0 && (
        <View>
          {lists.map((list, index) => (
            <ListRow
              key={list.id}
              divider={index > 0}
              title={localize(list.title, language)}
              subtitle={listFacts(list)}
              below={
                list.items.length === 0 ? (
                  <ThemedText type="small" themeColor="danger">
                    {t('checklists.noItems')}
                  </ThemedText>
                ) : undefined
              }
              onPress={() => {
                setFailure(null);
                setOpenId(list.id);
              }}
            />
          ))}
        </View>
      )}

      {lists !== null &&
        (creating ? (
          <Card borderColor={theme.primary}>
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
          </Card>
        ) : (
          <Button
            icon="add"
            label={t('setup.newList')}
            hint={t('setup.newListHelp')}
            variant="secondary"
            onPress={() => setCreating(true)}
          />
        ))}

      {removeDialog}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listTitle: { fontWeight: 700, fontSize: 20 },
  sectionGap: { marginTop: Spacing.two },
  // One item: its words and the bin on top, the Photo switch under them, a thin line between items.
  item: { gap: Spacing.one, paddingVertical: Spacing.two + Spacing.one },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  itemText: { flex: 1, gap: Spacing.half },
  itemLabel: { fontWeight: 700 },
  // The bin's picture on the content's edge, in a full-size tap target (it reaches into the margin).
  iconButton: {
    width: MinTouchSize,
    height: MinTouchSize,
    borderRadius: MinTouchSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: -(Spacing.two + Spacing.one),
    marginTop: -Spacing.two,
  },
  proof: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: MinTouchSize - Spacing.two },
  proofText: { flex: 1 },
  // Where the switch sits, kept while the change is saved, so the row does not jump.
  switchSpace: { width: 52 },
});
