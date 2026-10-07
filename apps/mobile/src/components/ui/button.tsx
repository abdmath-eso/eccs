import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ButtonProps {
  label: string;
  /**
   * A small picture before the label that says what the button does (a camera, a
   * phone). Drawn from the app's own icon set, so it looks the same on every phone;
   * do not put emoji in labels, which cheap phones draw differently or not at all.
   */
  icon?: ComponentProps<typeof Ionicons>['name'];
  /** Smaller explanatory line under the label. */
  hint?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  loading?: boolean;
  disabled?: boolean;
  /**
   * Grows to the height of its container. For buttons side by side, so they
   * stay the same height when one label wraps onto a second line.
   */
  fill?: boolean;
}

export function Button({ label, icon, hint, onPress, variant = 'primary', loading, disabled, fill }: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;

  const background =
    variant === 'primary' ? theme.primary : variant === 'link' ? 'transparent' : theme.backgroundElement;
  const color =
    variant === 'primary'
      ? theme.onPrimary
      : variant === 'danger'
        ? theme.danger
        : variant === 'link'
          ? theme.primary
          : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'link' && styles.link,
        fill && styles.fill,
        { backgroundColor: background, opacity: inactive ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={color} /> : icon ? <Ionicons name={icon} size={22} color={color} /> : null}
        <View style={styles.labels}>
          <ThemedText type="default" style={[styles.label, { color }]}>
            {label}
          </ThemedText>
          {hint && (
            <ThemedText type="small" style={[styles.hint, { color }]}>
              {hint}
            </ThemedText>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: MinTouchSize,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { paddingVertical: Spacing.two },
  fill: { flexGrow: 1, paddingHorizontal: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  labels: { flexShrink: 1, alignItems: 'center', gap: Spacing.one },
  label: { fontWeight: 700, textAlign: 'center' },
  hint: { textAlign: 'center', opacity: 0.85, fontWeight: 400 },
});
