import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import type { MessageKey } from '@eccs/i18n';
import {
  DEFAULT_LABEL_SIZE,
  findSameName,
  FOOD_LABEL_RULES,
  formatLabelWhen,
  useByFor as addShelfLife,
  type FoodItemDto,
  type FoodLabelDto,
} from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { LabelPrintSheet } from '@/components/label-print-sheet';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { NumberDialog } from '@/components/ui/number-dialog';
import { OptionChip } from '@/components/ui/option-chip';
import { OptionSheet } from '@/components/ui/option-sheet';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { takeAddedLabel } from '@/lib/label-added';
import { recallLabelSize, rememberLabelSize, sendLabels, type PrintJob, type PrintOutcome, type PrintRoute } from '@/lib/label-print';
import { keepLabelChoices, keptLabelChoices, queuedLabels, queueLabel, sendQueuedLabels } from '@/lib/label-queue';
import { labelPrintData, shelfLifeText, type LabelFacts } from '@/lib/labels';
import { newId } from '@/lib/offline/files';
import { isNoSignal } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

const MINUTE = 60_000;
const MAX = FOOD_LABEL_RULES.maxCopies;
const SIZES: PrintJob['size'][] = ['L50X30', 'L50X25', 'ROLL58'];

// What the server says when a label's "prepared" time breaks a rule, in the app's words.
// The app sets that time itself, so only a phone whose clock is wrong can meet these.
const PROBLEM_KEYS: Record<string, MessageKey> = {
  PREPARED_IN_FUTURE: 'labels.error.PREPARED_IN_FUTURE',
  PREPARED_TOO_OLD: 'labels.error.PREPARED_TOO_OLD',
};

/** One label of a batch once its record is made: what the sticker says, and its id on the server (null while it waits on the phone). */
interface SavedRow {
  itemId: string;
  copies: number;
  facts: LabelFacts;
  labelId: string | null;
}

/**
 * A batch whose Print was pressed but which has not gone to the printer yet.
 * Each label in it keeps the id it was first sent with, so pressing Print
 * again after something failed makes no second record of the ones already
 * saved. Forgotten once the batch prints, and after a few minutes.
 */
interface PendingBatch {
  at: number;
  rows: Record<string, { clientId: string; copies: number; saved: SavedRow | null }>;
}
const PENDING_MS = 10 * MINUTE;

interface RowProps {
  item: FoodItemDto;
  count: number;
  /** For the Owner and the Manager: tapping the name opens the saved label to change it. */
  canEdit: boolean;
  /** When the list was loaded, to say "last printed" as a time today or as a day. */
  now: number;
  onChange: (itemId: string, next: number) => void;
  onType: (item: FoodItemDto) => void;
  onEdit: (itemId: string) => void;
}

/**
 * One saved label with its number: minus, how many, plus. The list can be a
 * hundred rows long on a slow phone, so a row is drawn again only when its
 * own number or details change, not on every tap elsewhere.
 */
const LabelRow = memo(function LabelRow({ item, count, canEdit, now, onChange, onType, onEdit }: RowProps) {
  const theme = useTheme();
  const { t, language } = useSession();
  const chosen = count > 0;
  const keeps = t('labels.keeps', { life: shelfLifeText(item.shelfLifeHours, t) });
  const last = item.lastUsedAt ? t('labels.lastPrinted', { when: formatLabelWhen(item.lastUsedAt, new Date(now), language) }) : null;

  const words = (
    <>
      <ThemedText type="default" style={styles.name}>
        {item.name}
      </ThemedText>
      {/* The pencil is on the smaller line, so the name keeps the whole width on a narrow phone. */}
      <View style={styles.keepsLine}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.keeps}>
          {keeps}
        </ThemedText>
        {canEdit && <Ionicons name="create-outline" size={20} color={theme.primary} />}
      </View>
      {last && (
        <ThemedText type="small" themeColor="textSecondary">
          {last}
        </ThemedText>
      )}
    </>
  );

  return (
    // A chosen row has a coloured edge, a filled background and a bigger, heavier number: never colour alone.
    <View style={[styles.row, { borderColor: chosen ? theme.primary : theme.border }, chosen && { backgroundColor: theme.backgroundElement }]}>
      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[t('labels.changeNamed', { name: item.name }), keeps, last].filter(Boolean).join('. ')}
          onPress={() => onEdit(item.id)}
          style={({ pressed }) => [styles.words, pressed && styles.pressed]}>
          {words}
        </Pressable>
      ) : (
        <View style={styles.words}>{words}</View>
      )}

      {/* Minus, the number, plus, in reading order: in Urdu the row runs right to left, so minus is on the right. */}
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('labels.fewerOf', { name: item.name })}
          accessibilityState={{ disabled: !chosen }}
          disabled={!chosen}
          onPress={() => onChange(item.id, count - 1)}
          style={({ pressed }) => [styles.step, { borderColor: theme.outline }, !chosen && styles.off, pressed && styles.pressed]}>
          <Ionicons name="remove" size={26} color={theme.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('labels.countOf', { name: item.name, count })}
          onPress={() => onType(item)}
          style={styles.count}>
          <ThemedText
            type="default"
            themeColor={chosen ? 'text' : 'textSecondary'}
            style={chosen ? styles.countChosen : styles.countText}
            accessibilityLiveRegion="polite">
            {count}
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('labels.moreOf', { name: item.name })}
          accessibilityState={{ disabled: count >= MAX }}
          disabled={count >= MAX}
          onPress={() => onChange(item.id, count + 1)}
          style={({ pressed }) => [styles.step, { borderColor: theme.outline }, count >= MAX && styles.off, pressed && styles.pressed]}>
          <Ionicons name="add" size={26} color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
});

/**
 * Food labels: the outlet's saved labels, each with a number beside it. The
 * cook taps plus for what was just prepared and presses Print once; every
 * sticker says what it is, who printed it, when, and when to use it by
 * (the founder's design, 9 Oct 2026, after the Jolt label app). Nothing is
 * chosen or typed on the way: "prepared" is the minute Print is pressed, "use
 * by" is that minute plus how long the label keeps, and "prepared by" is the
 * person signed in.
 *
 * Something that is not on the list is added with a name and how long it
 * keeps (the Owner, the Manager and the Head Chef all can). Changing or
 * removing a saved label is for the Owner and the Manager only. Without
 * signal the list comes from the phone's own copy, the labels still print,
 * and their records are sent later.
 */
export default function FoodLabelsScreen() {
  const theme = useTheme();
  const notify = useSnackbar();
  const { t, api, language, user } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [items, setItems] = useState<FoodItemDto[] | null>(null);
  // True when the list is the phone's own copy, because there is no signal.
  const [fromPhone, setFromPhone] = useState(false);
  const [keptOutletName, setKeptOutletName] = useState('');
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);

  // How many of each label is wanted, by the saved label's id. Searching and filtering never touch it.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [chosenOnly, setChosenOnly] = useState(false);
  const [typing, setTyping] = useState<FoodItemDto | null>(null);

  const [size, setSize] = useState<PrintJob['size']>(DEFAULT_LABEL_SIZE as PrintJob['size']);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [waysOpen, setWaysOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const pending = useRef<PendingBatch | null>(null);

  const membership = user?.memberships[0];
  const manages = membership?.role === 'OWNER' || membership?.role === 'MANAGER';
  const userId = user?.id;
  const outletName = outlets.find((outlet) => outlet.id === outletId)?.name ?? membership?.outletName ?? keptOutletName;

  const load = useCallback(async () => {
    if (!outletId || !userId) return;
    try {
      // Labels printed without signal go up first, so "last printed" is right in the list that comes back.
      const { refused } = await sendQueuedLabels(api, userId);
      if (refused > 0) notify(t('labels.queue.refused', { count: refused }));
      const [list, rememberedSize] = await Promise.all([api.foodLabels.items(outletId), recallLabelSize()]);
      setItems(list);
      setFromPhone(false);
      if (rememberedSize) setSize(rememberedSize);
      setError(null);
      void keepLabelChoices(outletId, { items: list, outletName });
    } catch (e) {
      // No signal: the list as it was last time, kept on the phone, so the labels on it can still be printed.
      const kept = isNoSignal(e) ? await keptLabelChoices(outletId) : null;
      if (kept) {
        setItems(kept.items);
        setKeptOutletName(kept.outletName);
        setFromPhone(true);
        setError(null);
      } else {
        setError(isNoSignal(e) ? t('labels.noSignalList') : errorMessage(e, t));
      }
    }
    setLoadedAt(Date.now());
    setWaiting((await queuedLabels(userId, outletId)).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, userId, outletName]);

  // Reloads on coming back from adding or changing a label; the numbers stay as they were.
  // A label just added comes back with its number already at one, ready to print.
  useFocusEffect(
    useCallback(() => {
      const added = outletId ? takeAddedLabel(outletId) : null;
      if (added) {
        setCounts((current) => ({ ...current, [added]: Math.max(current[added] ?? 0, 1) }));
        setSearch('');
      }
      void load();
    }, [load, outletId]),
  );

  const change = useCallback((itemId: string, next: number) => {
    setProblem(null);
    setCounts((current) => ({ ...current, [itemId]: Math.min(MAX, Math.max(0, next)) }));
  }, []);
  const edit = useCallback((itemId: string) => router.push({ pathname: '/labels/item', params: { itemId } }), []);

  if (!user || !membership) return null;

  // Always in order of name, so each label stays where the cook expects to find it.
  const sorted = [...(items ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = sorted.filter((item) => (counts[item.id] ?? 0) > 0);
  const total = chosen.reduce((sum, item) => sum + (counts[item.id] ?? 0), 0);
  const onlyChosen = chosenOnly && chosen.length > 0;

  const name = search.trim().replace(/\s+/g, ' ');
  const words = name.toLowerCase().split(' ').filter(Boolean);
  const shown = (onlyChosen ? chosen : sorted).filter((item) => words.every((word) => item.name.toLowerCase().includes(word)));
  // A name the outlet already has (capitals and extra spaces aside) is on the list, not added a second time.
  // Adding and changing need signal, so neither is offered while the list is the phone's own copy.
  const canAdd = !fromPhone && items !== null;
  const canAddTyped = canAdd && name.length >= 2 && !findSameName(sorted, name);

  const addLabel = (typed?: string) => {
    router.push(typed ? { pathname: '/labels/new', params: { name: typed } } : '/labels/new');
  };

  function clear() {
    setCounts({});
    setChosenOnly(false);
    setProblem(null);
    pending.current = null;
  }

  /**
   * Makes the record of every chosen label, at the press of Print: "prepared"
   * is this minute for all of them. Each goes to the server, or onto the
   * phone to send later when there is no signal. Answers with what each
   * sticker says, or null if one was refused (the rest are kept for the next
   * press, so nothing is recorded twice).
   */
  async function saveBatch(): Promise<{ rows: SavedRow[]; offline: boolean } | null> {
    if (!outletId || !user) return null;
    const pressed = Date.now();
    const preparedAt = new Date(Math.floor(pressed / MINUTE) * MINUTE).toISOString();
    const madeAt = new Date(pressed).toISOString();

    const earlier = pending.current && pressed - pending.current.at < PENDING_MS ? pending.current : null;
    const batch: PendingBatch = { at: earlier?.at ?? pressed, rows: {} };
    for (const item of chosen) {
      const copies = counts[item.id] ?? 0;
      const before = earlier?.rows[item.id];
      // A label whose number was changed since is a different request, so it gets a new id.
      batch.rows[item.id] = before && before.copies === copies ? before : { clientId: newId(), copies, saved: null };
    }
    pending.current = batch;

    let offline = false;
    for (const item of chosen) {
      const row = batch.rows[item.id]!;
      if (row.saved) {
        offline ||= row.saved.labelId === null;
        continue;
      }
      const input = { foodItemId: item.id, preparedAt, copies: row.copies, clientId: row.clientId };
      let label: FoodLabelDto | null = null;
      if (!offline) {
        try {
          label = await api.foodLabels.create(input);
        } catch (e) {
          if (!isNoSignal(e)) {
            const key = e instanceof ApiError && e.code ? PROBLEM_KEYS[e.code] : undefined;
            setProblem(`${item.name}: ${key ? t(key) : errorMessage(e, t, { 409: 'labels.error.retired' })}`);
            return null;
          }
          // No signal for one means no signal for the rest: they are kept on the phone without trying each.
          offline = true;
        }
      }
      if (label) {
        row.saved = { itemId: item.id, copies: row.copies, facts: label, labelId: label.id };
      } else {
        await queueLabel({ userId: user.id, outletId, input: { ...input, madeAt } });
        row.saved = {
          itemId: item.id,
          copies: row.copies,
          facts: {
            itemName: item.name,
            storage: item.storage,
            allergens: item.allergens,
            preparedAt,
            expiresAt: addShelfLife(preparedAt, item.shelfLifeHours).toISOString(),
            preparedByName: user.name,
          },
          labelId: null,
        };
      }
    }
    return { rows: chosen.map((item) => batch.rows[item.id]!.saved!), offline };
  }

  /** After the print screen (or the share screen) has taken the batch: note it, say so, and set every number back to zero. */
  function finish(outcome: PrintOutcome, batch: { rows: SavedRow[]; offline: boolean }) {
    if (outcome !== 'sent') {
      // The records are made; the numbers stay, so Print can be pressed again without recording them twice.
      setProblem(t(outcome === 'needsSignal' ? 'labels.print.needsSignal' : 'labels.print.unavailable'));
      return;
    }
    for (const row of batch.rows) if (row.labelId) void api.foodLabels.markPrinted(row.labelId).catch(() => undefined);
    pending.current = null;
    const count = batch.rows.reduce((sum, row) => sum + row.copies, 0);
    notify(batch.offline ? t('labels.savedOnPhone') : count === 1 ? t('labels.sentOne') : t('labels.sentCount', { count }));
    const printed = new Map(batch.rows.map((row) => [row.itemId, row.facts.preparedAt]));
    setItems((list) => list?.map((item) => (printed.has(item.id) ? { ...item, lastUsedAt: printed.get(item.id)! } : item)) ?? list);
    setCounts({});
    setChosenOnly(false);
    if (batch.offline && outletId) void queuedLabels(user!.id, outletId).then((list) => setWaiting(list.length));
  }

  /** Print: one job holding each chosen label as many times as its number, sent the chosen way (the phone's print screen for the main button). */
  async function print(route: PrintRoute) {
    if (busy || total === 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const batch = await saveBatch();
      if (!batch) return;
      void rememberLabelSize(size);
      const job: PrintJob = {
        labels: batch.rows.flatMap((row) => {
          const data = labelPrintData(row.facts, outletName, t, language);
          return Array.from({ length: row.copies }, () => data);
        }),
        size,
      };
      let outcome: PrintOutcome;
      try {
        outcome = await sendLabels(job, route, api);
      } catch {
        outcome = 'unavailable';
      }
      finish(outcome, batch);
    } finally {
      setBusy(false);
    }
  }

  const listed = items !== null && sorted.length > 0;

  const footer = listed ? (
    <>
      <ErrorText message={problem} />
      {total === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {t('labels.pickHint')}
        </ThemedText>
      ) : (
        <View style={styles.summary}>
          <ThemedText type="default" style={styles.summaryText}>
            {chosen.length === 1 ? t('labels.chosenOne') : t('labels.chosenCount', { count: chosen.length })}
          </ThemedText>
          <Button label={t('common.clear')} variant="link" disabled={busy} onPress={clear} />
        </View>
      )}
      <Button
        icon="print-outline"
        label={total === 0 ? t('labels.print.system') : total === 1 ? t('labels.printOne') : t('labels.printCount', { count: total })}
        disabled={total === 0}
        loading={busy}
        onPress={() => void print('SYSTEM')}
      />
      {/* For a kitchen with no label printer: an A4 sheet, or the labels as a PDF or picture for another app. The label size is in there too. */}
      {total > 0 && <Button icon="share-outline" label={t('labels.otherWays')} variant="link" disabled={busy} onPress={() => setWaysOpen(true)} />}
    </>
  ) : undefined;

  return (
    <Screen
      back
      title={t('labels.title')}
      onRefresh={load}
      footer={footer}>
      <OutletPicker
        outlets={outlets}
        outletId={outletId}
        onChoose={(nextOutletId) => {
          // Another outlet has its own labels: the list and the numbers start again.
          setItems(null);
          setError(null);
          clear();
          choose(nextOutletId);
        }}
      />

      {listed && (
        <View style={styles.searchLine}>
          <View style={styles.searchField}>
            <TextField
              label={t('common.search')}
              value={search}
              onChangeText={setSearch}
              maxLength={60}
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          {search !== '' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('labels.clearSearch')}
              onPress={() => setSearch('')}
              style={({ pressed }) => [styles.clearSearch, pressed && styles.pressed]}>
              <Ionicons name="close-circle" size={28} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (items === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}
      {fromPhone && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('labels.noSignalItems')}
        </ThemedText>
      )}

      {waiting > 0 && (
        <View style={[styles.notice, { borderColor: theme.warning }]}>
          <Ionicons name="cloud-offline-outline" size={22} color={theme.warning} />
          <ThemedText type="default" style={styles.noticeText}>
            {t('labels.queue.waiting', { count: waiting })}
          </ThemedText>
        </View>
      )}

      {/* Shown once something is chosen, to look over the batch before printing. */}
      {chosen.length > 0 && (
        <View style={styles.chips}>
          <OptionChip label={t('labels.chosenOnly')} selected={chosenOnly} onPress={() => setChosenOnly(!chosenOnly)} />
        </View>
      )}

      {canAddTyped && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('labels.addTyped', { name })}
          onPress={() => addLabel(name)}
          style={({ pressed }) => [styles.addRow, { borderColor: theme.primary }, pressed && { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="add-circle" size={28} color={theme.primary} />
          <ThemedText type="default" themeColor="primary" style={styles.addText}>
            {t('labels.addTyped', { name })}
          </ThemedText>
        </Pressable>
      )}

      {/* Nothing saved yet: the first labels are added one at a time, or many at once from the starter list. */}
      {items !== null && sorted.length === 0 && !fromPhone && (
        <>
          <ThemedText type="default" themeColor="textSecondary">
            {t('labels.noSaved')}
          </ThemedText>
          <Button icon="add" label={t('labels.add')} onPress={() => addLabel()} />
          {manages ? (
            <Button icon="sparkles-outline" label={t('labels.items.fromStarter')} variant="secondary" onPress={() => router.push('/labels/starter')} />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {t('labels.starterAsk')}
            </ThemedText>
          )}
        </>
      )}

      {listed && shown.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('labels.noMatch')}
        </ThemedText>
      )}

      {shown.map((item) => (
        <LabelRow
          key={item.id}
          item={item}
          count={counts[item.id] ?? 0}
          canEdit={manages && !fromPhone}
          now={loadedAt}
          onChange={change}
          onType={setTyping}
          onEdit={edit}
        />
      ))}

      {/* Under the list, with adding one: until 22 Oct 2026 "Manage labels" sat in the top bar, where
          its words pushed Buddy's button off the screen in Telugu and on a small phone. */}
      {listed && (canAdd || manages) && (
        <View style={styles.listEnd}>
          {canAdd && <Button icon="add" label={t('labels.add')} variant="link" align="start" onPress={() => addLabel()} />}
          {manages && <Button icon="list-outline" label={t('labels.manage')} variant="link" align="start" onPress={() => router.push('/labels/items')} />}
        </View>
      )}

      {typing && (
        <NumberDialog
          title={t('labels.howMany', { name: typing.name })}
          value={counts[typing.id] ?? 0}
          max={MAX}
          rangeMessage={t('labels.countRange', { max: MAX })}
          confirmLabel={t('common.done')}
          onConfirm={(value) => {
            change(typing.id, value);
            setTyping(null);
          }}
          onCancel={() => setTyping(null)}
        />
      )}

      <LabelPrintSheet
        visible={waysOpen}
        oneKind={chosen.length === 1}
        onClose={() => setWaysOpen(false)}
        onChoose={(route) => void print(route)}
        extra={{ label: t('labels.sizeNow', { size: t(`labels.size.${size}`) }), icon: 'resize-outline', onPress: () => setSizeOpen(true) }}
      />

      <OptionSheet
        visible={sizeOpen}
        title={t('labels.size')}
        onClose={() => setSizeOpen(false)}
        options={SIZES.map((option) => ({
          label: t(`labels.size.${option}`),
          // The size in use carries a filled mark, the others an empty one.
          icon: option === size ? 'radio-button-on' : 'radio-button-off',
          onPress: () => {
            setSize(option);
            void rememberLabelSize(option);
            setSizeOpen(false);
          },
        }))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  searchLine: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.one },
  searchField: { flex: 1 },
  clearSearch: { width: MinTouchSize, height: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
  // On a narrow phone, or in a language with longer words, the stepper moves under the name (to the
  // row's end) rather than squeezing the name into a column a few letters wide.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingStart: Spacing.three,
    paddingEnd: Spacing.two,
    paddingVertical: Spacing.two,
  },
  // The name's side and the stepper are kept apart, so a tap meant for one never lands on the other.
  words: { flexGrow: 1, flexShrink: 1, flexBasis: 150, minHeight: MinTouchSize, justifyContent: 'center', paddingEnd: Spacing.two },
  name: { fontWeight: 700, fontSize: 18 },
  keepsLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  keeps: { flexShrink: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', marginStart: 'auto' },
  listEnd: { gap: Spacing.half },
  step: {
    width: MinTouchSize,
    height: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  off: { opacity: 0.35 },
  pressed: { opacity: 0.6 },
  count: { minWidth: 36, height: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 20 },
  countChosen: { fontSize: 22, fontWeight: 800 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize + Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  addText: { flex: 1, fontWeight: 700 },
  hint: { textAlign: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  summaryText: { flex: 1, fontWeight: 700 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  noticeText: { flex: 1 },
});
