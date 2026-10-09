import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import type { MessageKey } from '@eccs/i18n';
import {
  DEFAULT_LABEL_SIZE,
  FOOD_LABEL_RULES,
  formatLabelMoment,
  type CreateFoodLabelInput,
  type FoodItemDto,
} from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { FoodLabelPreview } from '@/components/food-label';
import { LabelPrintSheet } from '@/components/label-print-sheet';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import {
  recallLabelSize,
  rememberLabelSize,
  sendLabels,
  type PrintJob,
  type PrintOutcome,
  type PrintRoute,
} from '@/lib/label-print';
import { keepLabelChoices, keptLabelChoices, queueLabel } from '@/lib/label-queue';
import { allergensText, labelPrintData, shelfLifeText, type LabelFacts } from '@/lib/labels';
import { isNoSignal } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SIZES: PrintJob['size'][] = ['L50X30', 'L50X25', 'ROLL58'];

/** Now, to the minute: that is what the label prints. Only ever asked for when a button is pressed. */
const thisMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE;

// What the server says when a label's times break a rule, in the app's words.
const PROBLEM_KEYS: Record<string, MessageKey> = {
  PREPARED_IN_FUTURE: 'labels.error.PREPARED_IN_FUTURE',
  PREPARED_TOO_OLD: 'labels.error.PREPARED_TOO_OLD',
  USE_BY_BEFORE_PREPARED: 'labels.error.USE_BY_BEFORE_PREPARED',
  USE_BY_TOO_FAR: 'labels.error.USE_BY_TOO_FAR',
  OVERRIDE_NOT_ALLOWED: 'labels.error.OVERRIDE_NOT_ALLOWED',
  OVERRIDE_NEEDS_REASON: 'labels.error.OVERRIDE_NEEDS_REASON',
};

/**
 * Making a label. Two steps, built for wet hands and no typing: tap the item
 * (the ones used most recently are first), then tap Print. The app fills in
 * "prepared" as now and "use by" from the item's shelf life; both can be
 * nudged with buttons, within the limits in @eccs/shared. Without signal the
 * label still prints and its record is sent later.
 */
export default function NewLabelScreen() {
  const theme = useTheme();
  const { forwardIcon } = useDirection();
  const { t, api, language, user } = useSession();
  const { outletId, outlets, loading: outletLoading } = useOutlet();

  const [items, setItems] = useState<FoodItemDto[] | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [outletName, setOutletName] = useState('');
  const [fromPhone, setFromPhone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [size, setSize] = useState<PrintJob['size']>(DEFAULT_LABEL_SIZE as PrintJob['size']);

  // The label being made.
  const [item, setItem] = useState<FoodItemDto | null>(null);
  const [preparedMs, setPreparedMs] = useState(0);
  const [expiresMs, setExpiresMs] = useState(0);
  const [byName, setByName] = useState('');
  const [copies, setCopies] = useState(1);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  // Once saved, the label is fixed: `id` is the server's, or null while it waits on the phone for signal.
  const [saved, setSaved] = useState<{ facts: LabelFacts; id: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Said beside the tick when the label was kept on the phone; and what went wrong with printing, if anything.
  const [message, setMessage] = useState<string | null>(null);
  const [printNote, setPrintNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PrintJob | null>(null);

  const membership = user?.memberships[0];
  const manages = membership?.role === 'OWNER' || membership?.role === 'MANAGER';
  const myName = user?.name ?? '';
  const knownOutletName = outlets.find((outlet) => outlet.id === outletId)?.name ?? membership?.outletName ?? '';

  const load = useCallback(async () => {
    if (!outletId) return;
    try {
      const [list, people, rememberedSize] = await Promise.all([
        api.foodLabels.items(outletId),
        api.foodLabels.people(outletId),
        recallLabelSize(),
      ]);
      setItems(list);
      setNames(people.names);
      setOutletName(knownOutletName);
      setFromPhone(false);
      if (rememberedSize) setSize(rememberedSize);
      setLoadError(null);
      void keepLabelChoices(outletId, { items: list, names: people.names, outletName: knownOutletName });
    } catch (e) {
      // No signal: the list as it was last time, kept on the phone.
      const kept = isNoSignal(e) ? await keptLabelChoices(outletId) : null;
      if (kept) {
        setItems(kept.items);
        setNames(kept.names);
        setOutletName(kept.outletName);
        setFromPhone(true);
        setLoadError(null);
      } else {
        setLoadError(errorMessage(e, t));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, knownOutletName]);

  // Reloads on coming back from adding an item, so it is there to pick.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function pick(chosen: FoodItemDto) {
    const now = thisMinute();
    setItem(chosen);
    setPreparedMs(now);
    setExpiresMs(now + chosen.shelfLifeHours * HOUR);
    setByName(myName);
    setCopies(1);
    setNote('');
    setReason('');
    setSaved(null);
    setError(null);
    setMessage(null);
    setPrintNote(null);
  }

  function startAgain() {
    setItem(null);
    setSaved(null);
    setSearch('');
    setError(null);
    setMessage(null);
    setPrintNote(null);
    void load();
  }

  if (!user || !membership) return null;

  // ───────────────────────── Step 1: pick the item ─────────────────────────

  if (!item) {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const matching = (items ?? []).filter((entry) => words.every((word) => entry.name.toLowerCase().includes(word)));
    const recent = words.length === 0 ? matching.filter((entry) => entry.lastUsedAt).slice(0, FOOD_LABEL_RULES.recentItems) : [];
    const rest = matching.filter((entry) => !recent.includes(entry));

    const row = (entry: FoodItemDto) => (
      <Pressable
        key={entry.id}
        accessibilityRole="button"
        accessibilityLabel={entry.name}
        onPress={() => pick(entry)}
        style={({ pressed }) => [styles.item, { borderColor: theme.outline }, pressed && { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.itemWords}>
          <ThemedText type="default" style={styles.itemName}>
            {entry.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t(`labels.storage.${entry.storage}`)} · {shelfLifeText(entry.shelfLifeHours, t)}
          </ThemedText>
        </View>
        <Ionicons name={forwardIcon} size={24} color={theme.textSecondary} />
      </Pressable>
    );

    return (
      <Screen back title={t('labels.make')} subtitle={t('labels.pickHelp')} onRefresh={load}>
        <ErrorText message={loadError} onRetry={() => void load()} />
        {(outletLoading || (items === null && !loadError && outletId)) && <ActivityIndicator color={theme.primary} />}
        {fromPhone && (
          <ThemedText type="small" themeColor="textSecondary">
            {t('labels.noSignalItems')}
          </ThemedText>
        )}

        {items !== null && items.length === 0 && (
          <>
            <ThemedText type="default" themeColor="textSecondary">
              {t(manages ? 'labels.noItemsManager' : 'labels.noItemsChef')}
            </ThemedText>
            {manages && <Button icon="add" label={t('labels.items.add')} onPress={() => router.push('/labels/items')} />}
          </>
        )}

        {items !== null && items.length > 0 && (
          <>
            {/* Typing is optional: with a short list the item is one tap away. */}
            {items.length > FOOD_LABEL_RULES.recentItems && (
              <TextField
                label={t('common.search')}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                returnKeyType="search"
              />
            )}
            {recent.length > 0 && (
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('labels.recent')}
              </ThemedText>
            )}
            {recent.map(row)}
            {recent.length > 0 && rest.length > 0 && (
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
                {t('labels.allItems')}
              </ThemedText>
            )}
            {rest.map(row)}
            {matching.length === 0 && (
              <ThemedText type="default" themeColor="textSecondary">
                {t('labels.noMatch')}
              </ThemedText>
            )}
          </>
        )}
      </Screen>
    );
  }

  // ───────────────────────── Step 2: check and print ─────────────────────────

  const maxExpiresMs = preparedMs + item.shelfLifeHours * HOUR;
  const overridden = expiresMs > maxExpiresMs + MINUTE;
  const draft: LabelFacts = {
    itemName: item.name,
    storage: item.storage,
    allergens: item.allergens,
    preparedAt: new Date(preparedMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    preparedByName: byName || myName,
    quantityNote: note.trim() || null,
  };
  const facts = saved?.facts ?? draft;
  const printData = labelPrintData(facts, outletName || knownOutletName, t, language);
  const job = (): PrintJob => ({ labels: Array.from({ length: copies }, () => printData), size });

  function movePrepared(deltaMs: number | 'now') {
    const now = thisMinute();
    const wanted = deltaMs === 'now' ? now : preparedMs + deltaMs;
    const next = Math.min(now, Math.max(now - FOOD_LABEL_RULES.maxBackdateHours * HOUR, wanted));
    // The food keeps for as long as it did; only the starting moment moves.
    setExpiresMs(next + (expiresMs - preparedMs));
    setPreparedMs(next);
    setError(null);
  }

  function moveUseBy(deltaMs: number | 'full') {
    const ceiling = manages ? preparedMs + FOOD_LABEL_RULES.maxUseByDays * DAY : maxExpiresMs;
    const wanted = deltaMs === 'full' ? maxExpiresMs : expiresMs + deltaMs;
    setExpiresMs(Math.min(ceiling, Math.max(preparedMs + 30 * MINUTE, wanted)));
    setError(null);
  }

  /**
   * Saves the label once: on the server, or on the phone to send later when
   * there is no signal. Answers with the label's id on the server (null while
   * it waits on the phone), or false if it could not be saved.
   */
  async function save(): Promise<{ id: string | null } | false> {
    if (saved) return saved;
    if (!item || !outletId || !user) return false;
    if (overridden && !reason.trim()) {
      setError(t('labels.error.OVERRIDE_NEEDS_REASON'));
      return false;
    }
    const input: CreateFoodLabelInput & { preparedAt: string; expiresAt: string } = {
      foodItemId: item.id,
      preparedAt: draft.preparedAt,
      expiresAt: draft.expiresAt,
      ...(draft.preparedByName !== myName && { preparedByName: draft.preparedByName }),
      ...(draft.quantityNote && { quantityNote: draft.quantityNote }),
      copies,
      ...(overridden && { overrideReason: reason.trim() }),
    };
    setSaving(true);
    setError(null);
    try {
      const label = await api.foodLabels.create(input);
      setSaved({ facts: label, id: label.id });
      return { id: label.id };
    } catch (e) {
      if (isNoSignal(e)) {
        await queueLabel({ userId: user.id, outletId, input: { ...input, madeAt: new Date().toISOString() }, facts: draft });
        setSaved({ facts: draft, id: null });
        setMessage(t('labels.savedOnPhone'));
        return { id: null };
      }
      const key = e instanceof ApiError && e.code ? PROBLEM_KEYS[e.code] : undefined;
      setError(key ? t(key) : errorMessage(e, t, { 409: 'labels.error.retired' }));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function report(outcome: PrintOutcome, labelId: string | null) {
    if (outcome === 'sent') {
      setPrintNote(null);
      if (labelId) void api.foodLabels.markPrinted(labelId).catch(() => undefined);
      return;
    }
    setPrintNote(t(outcome === 'needsSignal' ? 'labels.print.needsSignal' : 'labels.print.unavailable'));
  }

  /** The main button: save, then straight to the phone's print screen. */
  async function print(route: PrintRoute) {
    const kept = await save();
    if (!kept) return;
    void rememberLabelSize(size);
    try {
      report(await sendLabels(job(), route, api), kept.id);
    } catch {
      report('unavailable', null);
    }
  }

  async function otherWays() {
    if (!(await save())) return;
    void rememberLabelSize(size);
    setSheet(job());
  }

  const footer = saved ? (
    <>
      <Button icon="print-outline" label={t('labels.printAgain')} onPress={() => void print('SYSTEM')} />
      <View style={styles.pair}>
        <View style={styles.half}>
          <Button fill icon="add" label={t('labels.another')} variant="secondary" onPress={startAgain} />
        </View>
        <View style={styles.half}>
          <Button fill label={t('common.done')} variant="secondary" onPress={() => router.back()} />
        </View>
      </View>
    </>
  ) : (
    <>
      <ErrorText message={error} />
      <Button
        icon="print-outline"
        label={copies > 1 ? t('labels.printCount', { count: copies }) : t('labels.print')}
        loading={saving}
        onPress={() => void print('SYSTEM')}
      />
    </>
  );

  const names12 = [myName, ...names.filter((name) => name !== myName)].slice(0, 12);

  return (
    <Screen back backLabel={t('labels.changeItem')} onBack={saved ? () => router.back() : () => setItem(null)} footer={footer}>
      <FoodLabelPreview label={printData} size={size} />

      {item.allergens.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('labels.print.allergens', { list: allergensText(item.allergens, t) })}
        </ThemedText>
      )}
      {item.note && (
        <ThemedText type="small" themeColor="textSecondary">
          {item.note}
        </ThemedText>
      )}

      {saved && (
        <View style={styles.savedLine}>
          <Ionicons name="checkmark-circle" size={24} color={theme.primary} />
          <ThemedText type="default" style={styles.savedText}>
            {message ?? t('labels.saved')}
          </ThemedText>
        </View>
      )}
      {printNote && (
        <ThemedText type="default" themeColor="warning">
          {printNote}
        </ThemedText>
      )}
      {saved && <Button icon="share-outline" label={t('labels.otherWays')} variant="link" onPress={() => void otherWays()} />}

      {!saved && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
            {t('labels.preparedAt', { when: formatLabelMoment(draft.preparedAt, language) })}
          </ThemedText>
          <View style={styles.pair}>
            <View style={styles.half}>
              <Button fill label={t('labels.minus15')} variant="secondary" onPress={() => movePrepared(-15 * MINUTE)} />
            </View>
            <View style={styles.half}>
              <Button fill label={t('labels.minusHour')} variant="secondary" onPress={() => movePrepared(-HOUR)} />
            </View>
          </View>
          <Button label={t('labels.preparedNow')} variant="link" onPress={() => movePrepared('now')} />

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
            {t('labels.useByAt', { when: formatLabelMoment(draft.expiresAt, language) })}
          </ThemedText>
          <View style={styles.pair}>
            <View style={styles.half}>
              <Button fill label={t('labels.minusHour')} variant="secondary" onPress={() => moveUseBy(-HOUR)} />
            </View>
            <View style={styles.half}>
              <Button
                fill
                label={t('labels.plusHour')}
                variant="secondary"
                disabled={!manages && expiresMs >= maxExpiresMs}
                onPress={() => moveUseBy(HOUR)}
              />
            </View>
          </View>
          <View style={styles.pair}>
            <View style={styles.half}>
              <Button fill label={t('labels.minusDay')} variant="secondary" onPress={() => moveUseBy(-DAY)} />
            </View>
            <View style={styles.half}>
              <Button
                fill
                label={t('labels.plusDay')}
                variant="secondary"
                disabled={!manages && expiresMs >= maxExpiresMs}
                onPress={() => moveUseBy(DAY)}
              />
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t(manages ? 'labels.keepsManager' : 'labels.keepsChef', { life: shelfLifeText(item.shelfLifeHours, t) })}
          </ThemedText>
          {expiresMs !== maxExpiresMs && <Button label={t('labels.fullLife')} variant="link" onPress={() => moveUseBy('full')} />}

          {/* Only a Manager or the Owner can get here: longer than the item keeps needs their reason. */}
          {overridden && (
            <View style={[styles.override, { borderColor: theme.warning }]}>
              <View style={styles.overrideHeader}>
                <Ionicons name="warning" size={22} color={theme.warning} />
                <ThemedText type="default" style={styles.overrideText}>
                  {t('labels.overrideWarning', { life: shelfLifeText(item.shelfLifeHours, t) })}
                </ThemedText>
              </View>
              <TextField label={t('labels.overrideReason')} value={reason} onChangeText={setReason} maxLength={200} />
            </View>
          )}

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
            {t('labels.preparedBy')}
          </ThemedText>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {names12.map((name) => (
              <OptionChip key={name} label={name} selected={(byName || myName) === name} onPress={() => setByName(name)} />
            ))}
          </View>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
            {t('labels.copies')}
          </ThemedText>
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('labels.fewer')}
              disabled={copies <= 1}
              onPress={() => setCopies(copies - 1)}
              style={[styles.step, { borderColor: theme.outline, opacity: copies <= 1 ? 0.4 : 1 }]}>
              <Ionicons name="remove" size={28} color={theme.text} />
            </Pressable>
            <ThemedText type="subtitle" style={styles.count} accessibilityLiveRegion="polite">
              {copies}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('labels.more')}
              disabled={copies >= FOOD_LABEL_RULES.maxCopies}
              onPress={() => setCopies(copies + 1)}
              style={[styles.step, { borderColor: theme.outline, opacity: copies >= FOOD_LABEL_RULES.maxCopies ? 0.4 : 1 }]}>
              <Ionicons name="add" size={28} color={theme.text} />
            </Pressable>
          </View>

          <TextField
            label={t('labels.quantity')}
            hint={t('labels.quantityHint')}
            value={note}
            onChangeText={setNote}
            maxLength={60}
          />

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
            {t('labels.size')}
          </ThemedText>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {SIZES.map((option) => (
              <OptionChip key={option} label={t(`labels.size.${option}`)} selected={size === option} onPress={() => setSize(option)} />
            ))}
          </View>

          <Button icon="share-outline" label={t('labels.otherWays')} variant="link" onPress={() => void otherWays()} />
        </>
      )}

      <LabelPrintSheet
        job={sheet}
        onClose={() => setSheet(null)}
        onResult={(outcome) => report(outcome, saved?.id ?? null)}
        extra={saved ? undefined : { label: t('labels.saveOnly'), icon: 'save-outline', onPress: () => setSheet(null) }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: Spacing.two },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize + Spacing.three,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  itemWords: { flex: 1 },
  itemName: { fontWeight: 700, fontSize: 18 },
  pair: { flexDirection: 'row', gap: Spacing.two },
  half: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  step: {
    width: MinTouchSize + Spacing.two,
    height: MinTouchSize + Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { minWidth: 48, textAlign: 'center' },
  savedLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  savedText: { flex: 1, fontWeight: 700 },
  override: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  overrideHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  overrideText: { flex: 1 },
});
