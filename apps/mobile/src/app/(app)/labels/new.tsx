import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import type { MessageKey } from '@eccs/i18n';
import {
  DEFAULT_LABEL_SIZE,
  findSameName,
  FOOD_LABEL_RULES,
  formatLabelMoment,
  isShelfLifeAllowed,
  toShelfLifeHours,
  useByFor as addShelfLife,
  type CreateFoodLabelInput,
  type FoodItemDto,
  type ShelfLifeUnit,
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
const SIZES: PrintJob['size'][] = ['L50X30', 'L50X25', 'ROLL58'];
const UNITS: ShelfLifeUnit[] = ['HOURS', 'DAYS'];

/** Now, to the minute: that is what the label prints. Only ever asked for when a button is pressed. */
const thisMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE;

// What the server says when a label's times break a rule, in the app's words.
// The app sets the times itself now, so in practice only a phone whose clock
// is wrong can meet the first of these.
const PROBLEM_KEYS: Record<string, MessageKey> = {
  PREPARED_IN_FUTURE: 'labels.error.PREPARED_IN_FUTURE',
  PREPARED_TOO_OLD: 'labels.error.PREPARED_TOO_OLD',
  USE_BY_BEFORE_PREPARED: 'labels.error.USE_BY_BEFORE_PREPARED',
  USE_BY_TOO_FAR: 'labels.error.USE_BY_TOO_FAR',
  OVERRIDE_NOT_ALLOWED: 'labels.error.OVERRIDE_NOT_ALLOWED',
  OVERRIDE_NEEDS_REASON: 'labels.error.OVERRIDE_NEEDS_REASON',
};

/** What the label is for: one of the outlet's saved labels, or a new name just typed. */
type Choice = { kind: 'saved'; item: FoodItemDto } | { kind: 'new'; name: string };

/**
 * Making a label, for anyone in the kitchen and for anything (the founder's
 * rule, 9 Oct 2026). One field finds a saved label or starts a new one:
 *  - tap a saved label (the ones used most recently are first), then Print; or
 *  - type a new name, tap how long it keeps ("8 hours", "1 day"), then Print.
 *    The new label is saved for the outlet, so next time it is one tap.
 *
 * Nobody sets a time. "Prepared" is the minute Print is pressed and "use by"
 * is that minute plus how long the food keeps; the screen says so before
 * printing and shows the real times afterwards. Who prepared it, how many
 * copies, a note and the label size are under "More options". Without signal
 * the label still prints, with the phone's time, and its record is sent later.
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
  const [typed, setTyped] = useState('');
  const [size, setSize] = useState<PrintJob['size']>(DEFAULT_LABEL_SIZE as PrintJob['size']);

  // The label being made.
  const [choice, setChoice] = useState<Choice | null>(null);
  // When this label was started. Only used to draw the day mark on the picture before printing.
  const [openedMs, setOpenedMs] = useState(0);
  // How long a new label keeps: one of the buttons, or "another length" typed as a number of hours or days.
  const [presetHours, setPresetHours] = useState<number | null>(null);
  const [other, setOther] = useState(false);
  const [otherNumber, setOtherNumber] = useState('');
  const [otherUnit, setOtherUnit] = useState<ShelfLifeUnit>('HOURS');
  const [byName, setByName] = useState('');
  const [copies, setCopies] = useState(1);
  const [note, setNote] = useState('');
  const [showMore, setShowMore] = useState(false);

  // Once saved, the label is fixed: `id` is the server's, or null while it waits on the phone for signal.
  const [saved, setSaved] = useState<{ facts: LabelFacts; id: string | null; isNew: boolean } | null>(null);
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
      // No signal: the list as it was last time, kept on the phone. With no list at all a
      // new label can still be typed, so that is not an error to stop on.
      const noSignal = isNoSignal(e);
      const kept = noSignal ? await keptLabelChoices(outletId) : null;
      if (kept || noSignal) {
        setItems(kept?.items ?? []);
        setNames(kept?.names ?? []);
        setOutletName(kept?.outletName ?? knownOutletName);
        setFromPhone(true);
        setLoadError(null);
      } else {
        setLoadError(errorMessage(e, t));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, knownOutletName]);

  // Reloads on coming back from the starter list or from changing a saved label.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function start(chosen: Choice) {
    setChoice(chosen);
    setOpenedMs(thisMinute());
    setPresetHours(null);
    setOther(false);
    setOtherNumber('');
    setOtherUnit('HOURS');
    setByName(myName);
    setCopies(1);
    setNote('');
    setShowMore(false);
    setSaved(null);
    setError(null);
    setMessage(null);
    setPrintNote(null);
  }

  function startAgain() {
    setChoice(null);
    setSaved(null);
    setTyped('');
    setError(null);
    setMessage(null);
    setPrintNote(null);
    void load();
  }

  if (!user || !membership) return null;

  // ───────────────────────── Step 1: find a saved label, or name a new one ─────────────────────────

  if (!choice) {
    const list = items ?? [];
    const name = typed.trim().replace(/\s+/g, ' ');
    const words = name.toLowerCase().split(' ').filter(Boolean);
    const matching = list.filter((entry) => words.every((word) => entry.name.toLowerCase().includes(word)));
    // A name the outlet already has (capitals and extra spaces aside) is offered, not made a second time.
    const same = findSameName(list, name);
    const canCreate = name.length >= 2 && !same;
    const recent = words.length === 0 ? matching.filter((entry) => entry.lastUsedAt).slice(0, FOOD_LABEL_RULES.recentItems) : [];
    const rest = matching.filter((entry) => !recent.includes(entry) && entry !== same);

    const row = (entry: FoodItemDto, highlighted = false) => (
      <Pressable
        key={entry.id}
        accessibilityRole="button"
        accessibilityLabel={`${entry.name}. ${t('labels.keeps', { life: shelfLifeText(entry.shelfLifeHours, t) })}`}
        onPress={() => start({ kind: 'saved', item: entry })}
        style={({ pressed }) => [
          styles.item,
          { borderColor: highlighted ? theme.primary : theme.outline },
          pressed && { backgroundColor: theme.backgroundElement },
        ]}>
        <View style={styles.itemWords}>
          <ThemedText type="default" style={styles.itemName}>
            {entry.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[t('labels.keeps', { life: shelfLifeText(entry.shelfLifeHours, t) }), entry.storage && t(`labels.storage.${entry.storage}`)]
              .filter(Boolean)
              .join(' · ')}
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

        {/* One field both finds a saved label and starts a new one, so there is no separate "add" screen to go to. */}
        <TextField
          label={t('labels.name')}
          hint={t('labels.nameHint')}
          value={typed}
          onChangeText={setTyped}
          maxLength={60}
          returnKeyType="next"
          onSubmitEditing={() => {
            if (same) start({ kind: 'saved', item: same });
            else if (canCreate) start({ kind: 'new', name });
          }}
        />

        {canCreate && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('labels.createNew', { name })}
            onPress={() => start({ kind: 'new', name })}
            style={({ pressed }) => [styles.item, { borderColor: theme.primary }, pressed && { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="add-circle" size={28} color={theme.primary} />
            <ThemedText type="default" themeColor="primary" style={[styles.itemWords, styles.itemName]}>
              {t('labels.createNew', { name })}
            </ThemedText>
          </Pressable>
        )}

        {same && (
          <>
            <ThemedText type="default">{t('labels.exists', { name: same.name })}</ThemedText>
            {row(same, true)}
          </>
        )}

        {items !== null && list.length === 0 && name.length === 0 && (
          <ThemedText type="default" themeColor="textSecondary">
            {t('labels.noSaved')}
          </ThemedText>
        )}

        {recent.length > 0 && (
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('labels.recent')}
          </ThemedText>
        )}
        {recent.map((entry) => row(entry))}
        {recent.length > 0 && rest.length > 0 && (
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
            {t('labels.allItems')}
          </ThemedText>
        )}
        {rest.map((entry) => row(entry))}
        {list.length > 0 && matching.length === 0 && !canCreate && (
          <ThemedText type="default" themeColor="textSecondary">
            {t('labels.noMatch')}
          </ThemedText>
        )}

        {/* The starter list is a shortcut for filling the list quickly, never the way in. It needs signal. */}
        {!fromPhone && items !== null && name.length === 0 && (
          <Button icon="sparkles-outline" label={t('labels.items.fromStarter')} variant="link" onPress={() => router.push('/labels/starter')} />
        )}
      </Screen>
    );
  }

  // ───────────────────────── Step 2: how long it keeps (new labels only), then Print ─────────────────────────

  // A saved label as it is now: a Manager may have just changed it on the Items screen and come back.
  const item = choice.kind === 'saved' ? (items?.find((entry) => entry.id === choice.item.id) ?? choice.item) : null;
  const itemName = item?.name ?? (choice.kind === 'new' ? choice.name : '');
  const otherHours = /^\d{1,4}$/.test(otherNumber.trim()) ? toShelfLifeHours(Number(otherNumber), otherUnit) : null;
  const typedHours = other ? otherHours : presetHours;
  // How long this label keeps, in hours; null while a new label's length is not yet chosen or is outside the limits.
  const lifeHours = item ? item.shelfLifeHours : typedHours !== null && isShelfLifeAllowed(typedHours) ? typedHours : null;

  const factsFor = (preparedMs: number, hours: number): LabelFacts => ({
    itemName,
    storage: item?.storage ?? null,
    allergens: item?.allergens ?? [],
    preparedAt: new Date(preparedMs).toISOString(),
    expiresAt: addShelfLife(new Date(preparedMs), hours).toISOString(),
    preparedByName: byName || myName,
    quantityNote: note.trim() || null,
  });
  const printDataFor = (facts: LabelFacts) => labelPrintData(facts, outletName || knownOutletName, t, language);
  const jobFor = (facts: LabelFacts): PrintJob => ({ labels: Array.from({ length: copies }, () => printDataFor(facts)), size });

  // The picture. Once printed it shows the label exactly as it went out. Before that the
  // times are not known yet (they are the moment Print is pressed), so it says so in words;
  // only the day mark is worked out, from when this screen was opened.
  const provisional = printDataFor(factsFor(openedMs, lifeHours ?? 0));
  const preview = saved
    ? printDataFor(saved.facts)
    : {
        ...provisional,
        preparedText: t('labels.preview.prepared'),
        useByText: lifeHours ? t('labels.preview.useBy', { life: shelfLifeText(lifeHours, t) }) : t('labels.preview.useByUnset'),
        dayWord: lifeHours ? provisional.dayWord : '',
      };

  /**
   * Saves the label once, at the press of Print: "prepared" is this minute
   * and "use by" is this minute plus how long the food keeps. It goes to the
   * server, or onto the phone to send later when there is no signal (still
   * with this minute as its time). Answers with what the label says and its
   * id on the server (null while it waits on the phone), or false if it
   * could not be saved.
   */
  async function save(): Promise<{ facts: LabelFacts; id: string | null } | false> {
    if (saved) return saved;
    if (!choice || !outletId || !user) return false;
    if (lifeHours === null) {
      setError(t(other ? 'labels.items.lifeNeeded' : 'labels.chooseKeeps'));
      return false;
    }
    const pressed = Date.now();
    const draft = factsFor(Math.floor(pressed / MINUTE) * MINUTE, lifeHours);
    const isNew = choice.kind === 'new';
    const input: CreateFoodLabelInput & { preparedAt: string } = {
      ...(item ? { foodItemId: item.id } : { newItem: { outletId, name: itemName, shelfLifeHours: lifeHours } }),
      preparedAt: draft.preparedAt,
      ...(draft.preparedByName !== myName && { preparedByName: draft.preparedByName }),
      ...(draft.quantityNote && { quantityNote: draft.quantityNote }),
      copies,
    };
    setSaving(true);
    setError(null);
    try {
      const label = await api.foodLabels.create(input);
      setSaved({ facts: label, id: label.id, isNew });
      return { facts: label, id: label.id };
    } catch (e) {
      if (isNoSignal(e)) {
        await queueLabel({ userId: user.id, outletId, input: { ...input, madeAt: new Date(pressed).toISOString() }, facts: draft });
        setSaved({ facts: draft, id: null, isNew: false });
        setMessage(t('labels.savedOnPhone'));
        return { facts: draft, id: null };
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

  /** The main button: save, then straight to the phone's print screen. Pressed again, it prints the same label with the same times. */
  async function print(route: PrintRoute) {
    const kept = await save();
    if (!kept) return;
    void rememberLabelSize(size);
    try {
      report(await sendLabels(jobFor(kept.facts), route, api), kept.id);
    } catch {
      report('unavailable', null);
    }
  }

  async function otherWays() {
    const kept = await save();
    if (!kept) return;
    void rememberLabelSize(size);
    setSheet(jobFor(kept.facts));
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
    <Screen back backLabel={t('labels.changeItem')} onBack={saved ? () => router.back() : () => setChoice(null)} footer={footer}>
      <FoodLabelPreview label={preview} size={size} />

      {saved ? (
        <ThemedText type="default" style={styles.strong}>
          {t('labels.printedTimes', {
            prepared: formatLabelMoment(saved.facts.preparedAt, language),
            useBy: formatLabelMoment(saved.facts.expiresAt, language),
          })}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {t('labels.timesAtPrint')}
        </ThemedText>
      )}

      {saved && (
        <View style={styles.savedLine}>
          <Ionicons name="checkmark-circle" size={24} color={theme.primary} />
          <ThemedText type="default" style={styles.savedText}>
            {message ?? (saved.isNew ? t('labels.savedNew', { name: saved.facts.itemName }) : t('labels.saved'))}
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
          {item ? (
            <>
              <ThemedText type="default" style={styles.strong}>
                {t('labels.keeps', { life: shelfLifeText(item.shelfLifeHours, t) })}
              </ThemedText>
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
              {/* Changing how long a saved label keeps, or where it is stored, is for the Owner and the Manager. */}
              {manages && !fromPhone && (
                <Button
                  label={t('labels.items.change')}
                  variant="link"
                  onPress={() => router.push({ pathname: '/labels/item', params: { itemId: item.id } })}
                />
              )}
            </>
          ) : (
            <>
              {/* A length, never a clock time: a few common ones to tap, and any other as a number of hours or days. */}
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
                {t('labels.keepsQuestion')}
              </ThemedText>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('labels.keepsQuestion')}>
                {FOOD_LABEL_RULES.shelfLifePresets.map((hours) => (
                  <OptionChip
                    key={hours}
                    label={shelfLifeText(hours, t)}
                    selected={!other && presetHours === hours}
                    onPress={() => {
                      setOther(false);
                      setPresetHours(hours);
                      setError(null);
                    }}
                  />
                ))}
                <OptionChip
                  label={t('labels.otherLength')}
                  selected={other}
                  onPress={() => {
                    setOther(true);
                    setError(null);
                  }}
                />
              </View>
              {other && (
                <>
                  <TextField
                    label={t('labels.otherLengthNumber')}
                    value={otherNumber}
                    onChangeText={(value) => {
                      setOtherNumber(value);
                      setError(null);
                    }}
                    error={otherNumber.trim() !== '' && lifeHours === null ? t('labels.items.lifeNeeded') : null}
                    keyboardType="number-pad"
                    maxLength={4}
                    autoFocus
                  />
                  <View style={styles.chips} accessibilityRole="radiogroup">
                    {UNITS.map((option) => (
                      <OptionChip key={option} label={t(`labels.unit.${option}`)} selected={otherUnit === option} onPress={() => setOtherUnit(option)} />
                    ))}
                  </View>
                </>
              )}
              <ThemedText type="small" themeColor="textSecondary">
                {t('labels.keepsHelp')}
              </ThemedText>
            </>
          )}

          <Button
            icon={showMore ? 'chevron-up' : 'chevron-down'}
            label={t(showMore ? 'labels.hideOptions' : 'labels.moreOptions')}
            variant="link"
            onPress={() => setShowMore(!showMore)}
          />

          {showMore && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary">
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
            </>
          )}

          {/* For a kitchen with no label printer: an A4 sheet, or the label as a picture or PDF for another app. */}
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
  strong: { fontWeight: 700 },
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
});
