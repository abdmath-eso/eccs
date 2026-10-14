import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface CheckboxRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * A box to tick, with its words beside it; the whole row is the tap target. For
 * a yes the person gives themselves, such as agreeing to terms: it starts
 * unticked and only their own tap ticks it. Ticked shows a filled box with a
 * tick and a stronger edge, so it never relies on colour alone, and a screen
 * reader hears "checkbox, checked" or "not checked".
 */
export function CheckboxRow({ label, checked, onChange, disabled }: CheckboxRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [
        styles.row,
        { borderColor: checked ? theme.primary : theme.outline },
        (checked || pressed) && { backgroundColor: theme.backgroundElement },
        disabled && styles.disabled,
      ]}>
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={28} color={checked ? theme.primary : theme.outline} />
      <ThemedText type="default" style={styles.label}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  label: { flex: 1 },
  disabled: { opacity: 0.5 },
});
