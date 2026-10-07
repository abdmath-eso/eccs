import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface OptionChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}

/**
 * One choice out of a few (an outlet, a category, a role). The chosen one
 * carries a tick as well as the colour, so it does not rely on colour alone.
 * Lay several out in a row that wraps.
 */
export function OptionChip({ label, selected, onPress, disabled }: OptionChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? theme.primary : theme.outline },
        (selected || pressed) && { backgroundColor: theme.backgroundElement },
        disabled && styles.disabled,
      ]}>
      {selected && <Ionicons name="checkmark" size={20} color={theme.primary} />}
      <ThemedText type="default" themeColor={selected ? 'primary' : 'text'} style={selected && styles.selected}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  selected: { fontWeight: 700 },
  disabled: { opacity: 0.5 },
});
