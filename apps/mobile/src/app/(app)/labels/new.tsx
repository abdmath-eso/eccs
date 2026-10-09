import { ApiError } from '@eccs/api-client';
import { findSameName, FOOD_LABEL_RULES, isShelfLifeAllowed, toShelfLifeHours, type ShelfLifeUnit } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/errors';
import { leaveAddedLabel } from '@/lib/label-added';
import { shelfLifeText } from '@/lib/labels';
import { isNoSignal } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

const UNITS: ShelfLifeUnit[] = ['HOURS', 'DAYS'];

/**
 * Adding a label that is not on the list yet: its name, and how long the
 * food keeps ("8 hours", "1 day"; a length, never a clock time). For anyone
 * who prints labels, the Head Chef included. Once saved, the list comes back
 * with the new label's number already at one, ready to print. Where it is
 * kept and its allergens are extras the Owner or the Manager can add
 * afterwards. Saving needs signal; printing what is already on the list
 * does not.
 */
export default function NewLabelScreen() {
  const notify = useSnackbar();
  const params = useLocalSearchParams<{ name?: string }>();
  const { t, api } = useSession();
  const { outletId } = useOutlet();

  // The name comes filled in with what was typed in the list's search box.
  const [name, setName] = useState(params.name ?? '');
  // How long it keeps: one of the buttons, or "another length" typed as a number of hours or days.
  const [presetHours, setPresetHours] = useState<number | null>(null);
  const [other, setOther] = useState(false);
  const [otherNumber, setOtherNumber] = useState('');
  const [otherUnit, setOtherUnit] = useState<ShelfLifeUnit>('HOURS');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const otherHours = /^\d{1,4}$/.test(otherNumber.trim()) ? toShelfLifeHours(Number(otherNumber), otherUnit) : null;
  const typedHours = other ? otherHours : presetHours;
  // In hours; null while no length is chosen or the one typed is outside the limits.
  const lifeHours = typedHours !== null && isShelfLifeAllowed(typedHours) ? typedHours : null;

  /** Back to the list, which sets this label's number to one. */
  function backWith(itemId: string, message: string) {
    if (outletId) leaveAddedLabel(outletId, itemId);
    notify(message);
    router.back();
  }

  async function save() {
    if (!outletId || saving) return;
    const trimmed = name.trim().replace(/\s+/g, ' ');
    setNameError(trimmed.length < 2 ? t('labels.items.nameNeeded') : null);
    setError(lifeHours === null ? t(other ? 'labels.items.lifeNeeded' : 'labels.chooseKeeps') : null);
    if (trimmed.length < 2 || lifeHours === null) return;

    setSaving(true);
    try {
      const item = await api.foodLabels.createItem({ outletId, name: trimmed, shelfLifeHours: lifeHours });
      backWith(item.id, t('labels.savedNamed', { name: item.name }));
    } catch (e) {
      if (isNoSignal(e)) return setError(t('labels.addNeedsSignal'));
      if (e instanceof ApiError && e.code === 'ITEM_NAME_TAKEN') {
        // The list already has a label of this name (someone added it, or it differs only in capitals): use that one.
        const same = await api.foodLabels
          .items(outletId)
          .then((items) => findSameName(items, trimmed))
          .catch(() => undefined);
        if (same) return backWith(same.id, t('labels.alreadyOnList', { name: same.name }));
        return setNameError(t('labels.items.nameTaken'));
      }
      setError(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen
      back
      title={t('labels.add')}
      footer={
        <>
          <ErrorText message={error} />
          <Button icon="checkmark" label={t('labels.saveLabel')} loading={saving} onPress={() => void save()} />
        </>
      }>
      <TextField
        label={t('labels.name')}
        hint={t('labels.items.nameHint')}
        value={name}
        onChangeText={(value) => {
          setName(value);
          setNameError(null);
        }}
        error={nameError}
        maxLength={60}
        autoFocus={!params.name}
      />

      {/* A few common lengths to tap, and any other as a number of hours or days. */}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
