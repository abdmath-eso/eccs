import { ApiError } from '@eccs/api-client';
import {
  ALLERGENS,
  FOOD_LABEL_RULES,
  shelfLifeParts,
  STORAGE_TYPES,
  toShelfLifeHours,
  type Allergen,
  type FoodItemDto,
  type ShelfLifeUnit,
  type StorageType,
} from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { OtherLanguagesNote } from '@/components/ai-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

const UNITS: ShelfLifeUnit[] = ['HOURS', 'DAYS'];

/**
 * Adds a saved label, or changes one (when opened with an item's id): its
 * name as the kitchen says it and how long it keeps, and optionally where it
 * is kept, its allergens and a note. For the Owner and the Manager.
 */
export default function FoodItemScreen() {
  const theme = useTheme();
  const notify = useSnackbar();
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const { t, api } = useSession();
  const { outletId } = useOutlet();

  const [existing, setExisting] = useState<FoodItemDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  // Where it is kept is optional: nothing is assumed until someone says.
  const [storage, setStorage] = useState<StorageType | null>(null);
  const [life, setLife] = useState('');
  const [unit, setUnit] = useState<ShelfLifeUnit>('DAYS');
  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [note, setNote] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [lifeError, setLifeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // When changing an item, its details as they are now fill the form.
  useEffect(() => {
    if (!itemId || !outletId) return;
    let cancelled = false;
    api.foodLabels
      .items(outletId, { all: true })
      .then((items) => {
        if (cancelled) return;
        const item = items.find((entry) => entry.id === itemId);
        if (!item) return setLoadError(t('labels.items.gone'));
        const parts = shelfLifeParts(item.shelfLifeHours);
        setExisting(item);
        setName(item.name);
        setStorage(item.storage);
        setLife(String(parts.value));
        setUnit(parts.unit);
        setAllergens(item.allergens);
        setNote(item.note ?? '');
      })
      .catch((e: unknown) => !cancelled && setLoadError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, itemId, outletId]);

  async function save() {
    if (!outletId || saving) return;
    const trimmed = name.trim();
    const amount = Number(life);
    const hours = toShelfLifeHours(amount, unit);
    const lifeOk =
      /^\d{1,4}$/.test(life.trim()) && hours >= FOOD_LABEL_RULES.minShelfLifeHours && hours <= FOOD_LABEL_RULES.maxShelfLifeHours;
    setNameError(trimmed.length < 2 ? t('labels.items.nameNeeded') : null);
    setLifeError(lifeOk ? null : t('labels.items.lifeNeeded'));
    if (trimmed.length < 2 || !lifeOk) return;

    setSaving(true);
    setError(null);
    try {
      const details = { name: trimmed, storage, shelfLifeHours: hours, allergens, note: note.trim() };
      if (existing) await api.foodLabels.updateItem(existing.id, details);
      else await api.foodLabels.createItem({ outletId, ...details });
      notify(t('common.saved'));
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setNameError(t('labels.items.nameTaken'));
      else setError(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setConfirming(false);
    setSaving(true);
    try {
      const { deleted } = await api.foodLabels.removeItem(existing.id);
      notify(t(deleted ? 'labels.items.deleted' : 'labels.items.retiredDone'));
      router.back();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  const toggle = (allergen: Allergen) =>
    setAllergens(allergens.includes(allergen) ? allergens.filter((other) => other !== allergen) : [...allergens, allergen]);

  if (itemId && !existing) {
    return (
      <Screen back title={t('labels.items.change')}>
        <ErrorText message={loadError} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={t(existing ? 'labels.items.change' : 'labels.items.add')}
      footer={
        <>
          <ErrorText message={error} />
          <Button label={t('labels.save')} loading={saving} onPress={() => void save()} />
        </>
      }>
      <TextField
        label={t('labels.items.name')}
        hint={t('labels.items.nameHint')}
        value={name}
        onChangeText={setName}
        error={nameError}
        maxLength={60}
      />
      <OtherLanguagesNote typed={name.trim() !== ''} />

      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('labels.items.storage')}
      </ThemedText>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {STORAGE_TYPES.map((option) => (
          <OptionChip key={option} label={t(`labels.storageKeep.${option}`)} selected={storage === option} onPress={() => setStorage(option)} />
        ))}
        <OptionChip label={t('labels.storage.none')} selected={storage === null} onPress={() => setStorage(null)} />
      </View>

      <TextField
        label={t('labels.items.life')}
        hint={t('labels.items.lifeHint')}
        value={life}
        onChangeText={setLife}
        error={lifeError}
        keyboardType="number-pad"
        maxLength={4}
      />
      <View style={styles.chips} accessibilityRole="radiogroup">
        {UNITS.map((option) => (
          <OptionChip key={option} label={t(`labels.unit.${option}`)} selected={unit === option} onPress={() => setUnit(option)} />
        ))}
      </View>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.gap}>
        {t('labels.items.allergens')}
      </ThemedText>
      <View style={styles.chips}>
        {ALLERGENS.map((allergen) => (
          <OptionChip
            key={allergen}
            label={t(`labels.allergen.${allergen}`)}
            selected={allergens.includes(allergen)}
            onPress={() => toggle(allergen)}
          />
        ))}
      </View>

      <TextField label={t('labels.items.note')} hint={t('labels.items.noteHint')} value={note} onChangeText={setNote} maxLength={120} />

      {existing && (
        <Button
          icon="trash-outline"
          label={t('labels.items.remove')}
          variant="danger"
          disabled={saving}
          onPress={() => setConfirming(true)}
        />
      )}

      <ConfirmDialog
        visible={confirming}
        message={t(existing && existing.labelCount > 0 ? 'labels.items.confirmRetire' : 'labels.items.confirmDelete', {
          name: existing?.name ?? '',
        })}
        confirmLabel={t('labels.items.remove')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  gap: { marginTop: Spacing.two },
});
