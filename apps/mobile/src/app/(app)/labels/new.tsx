import { ApiError } from '@eccs/api-client';
import { findSameName } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { OtherLanguagesNote } from '@/components/ai-parts';
import { ShelfLifeField } from '@/components/shelf-life-field';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { errorMessage } from '@/lib/errors';
import { leaveAddedLabel } from '@/lib/label-added';
import { chosenHours, shelfLifeChoice } from '@/lib/labels';
import { isNoSignal } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

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
  const [life, setLife] = useState(() => shelfLifeChoice());
  const [nameError, setNameError] = useState<string | null>(null);
  const [lifeError, setLifeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // In hours; null while no length is chosen or the one typed is outside the limits.
  const lifeHours = chosenHours(life);

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
    setLifeError(lifeHours === null ? t(life.other ? 'labels.items.lifeNeeded' : 'labels.chooseKeeps') : null);
    if (trimmed.length < 2 || lifeHours === null) return;

    setSaving(true);
    setError(null);
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
      <OtherLanguagesNote typed={name.trim() !== ''} />

      {/* A few common lengths to tap, and any other as a number with Hours | Days: the same control as
          changing a saved label (22 Oct 2026). */}
      <ShelfLifeField
        label={t('labels.keepsQuestion')}
        value={life}
        onChange={(next) => {
          setLife(next);
          setLifeError(null);
        }}
        hint={t('labels.keepsHelp')}
        error={lifeError}
      />
    </Screen>
  );
}
