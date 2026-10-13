import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { OptionSheet } from '@/components/ui/option-sheet';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface OutletPickerProps {
  outlets: { id: string; name: string }[];
  /** The outlet in view. */
  outletId: string | null;
  /** Called only when a different outlet is picked, never for the one already in view. */
  onChoose: (outletId: string) => void;
  /** While true the line is faded and does not open: for a form that is busy sending something to the outlet chosen now. */
  disabled?: boolean;
}

/**
 * The Owner's choice of outlet, shown only when they have more than one.
 *
 * One line that names the outlet in view and opens the list when tapped. It was
 * a chip for every outlet, which took a row each on a phone and pushed the
 * screen's own content down (the founder found the attendance screen cluttered,
 * 12 Oct 2026). It began on the Staff screens; the founder then asked for the
 * same on every screen where the Owner chooses a branch (13 Oct 2026), so it is
 * one shared piece here. A single line that opens a list is how apps used across
 * several places let someone switch between them (the location switchers in
 * Xenia and Square, Material's exposed dropdown menu).
 *
 * Picking the outlet already in view only closes the list. Screens clear what
 * they have loaded when the outlet changes, and must not go blank for nothing.
 */
export function OutletPicker({ outlets, outletId, onChoose, disabled }: OutletPickerProps) {
  const theme = useTheme();
  const { t } = useSession();
  const [open, setOpen] = useState(false);
  if (outlets.length < 2) return null;
  const current = outlets.find((outlet) => outlet.id === outletId)?.name ?? '';
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('checklists.chooseOutlet')}: ${current}`}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.outlet,
          { borderColor: theme.outline },
          pressed && { backgroundColor: theme.backgroundElement },
          disabled && styles.disabled,
        ]}>
        <Ionicons name="storefront-outline" size={20} color={theme.primary} />
        <ThemedText type="default" numberOfLines={1} style={styles.outletName}>
          {current || t('checklists.chooseOutlet')}
        </ThemedText>
        <Ionicons name="chevron-down" size={20} color={theme.textSecondary} />
      </Pressable>
      <OptionSheet
        visible={open}
        title={t('checklists.chooseOutlet')}
        onClose={() => setOpen(false)}
        options={outlets.map((outlet) => ({
          label: outlet.name,
          // The outlet in view carries a filled mark, the others an empty one.
          icon: outlet.id === outletId ? ('radio-button-on' as const) : ('radio-button-off' as const),
          onPress: () => {
            setOpen(false);
            // Nothing changes for the outlet already in view, or if the form became busy while the list was open.
            if (disabled || outlet.id === outletId) return;
            onChoose(outlet.id);
          },
        }))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  outlet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  outletName: { flex: 1, fontWeight: 700 },
  disabled: { opacity: 0.5 },
});
