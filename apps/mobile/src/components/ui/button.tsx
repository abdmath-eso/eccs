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
  /**
   * One `primary` (filled) button per screen, for its main action (Material 3). `tonal` is a
   * soft teal fill for a second action that still matters (Take photo beside Submit, Call beside
   * the lead's main step); `secondary` is grey; `link` is words only.
   */
  variant?: 'primary' | 'tonal' | 'secondary' | 'danger' | 'link';
  /** A link on the content's left edge rather than centred, for links inside left-aligned cards. */
  align?: 'center' | 'start';
  loading?: boolean;
  disabled?: boolean;
  /**
   * Grows to the height of its container. For buttons side by side, so they
   * stay the same height when one label wraps onto a second line.
   */
  fill?: boolean;
}

export function Button({
  label,
  icon,
  hint,
  onPress,
  variant = 'primary',
  align = 'center',
  loading,
  disabled,
  fill,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;
  // Switched off (not just busy): a neutral grey button with grey words, as Material 3 draws a
  // disabled button, rather than the button's own colour faded, which in the dark theme looked
  // like an ordinary button.
  const off = disabled && !loading;

  const background = off
    ? variant === 'link'
      ? 'transparent'
      : theme.backgroundElement
    : variant === 'primary'
      ? theme.primary
      : variant === 'tonal'
        ? theme.primaryContainer
        : variant === 'link'
          ? 'transparent'
          : theme.backgroundElement;
  const color = off
    ? theme.textSecondary
    : variant === 'primary'
      ? theme.onPrimary
      : variant === 'tonal'
        ? theme.onPrimaryContainer
        : variant === 'danger'
          ? theme.danger
          : variant === 'link'
            ? theme.primary
            : theme.text;
  // With a picture in front, the words line up on their left edge beside it, so a label that
  // wraps (or a longer hint) keeps the picture next to the words instead of stranding it at the
  // button's edge. A one-line label still sits in the middle of the button.
  const start = align === 'start' || !!icon || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'link' && styles.link,
        align === 'start' && styles.alignStart,
        fill && styles.fill,
        { backgroundColor: background, opacity: off ? 0.75 : loading ? 0.7 : pressed ? 0.8 : 1 },
      ]}>
      <View style={[styles.row, align === 'start' && styles.rowStart]}>
        {loading ? <ActivityIndicator color={color} /> : icon ? <Ionicons name={icon} size={22} color={color} /> : null}
        <View style={[styles.labels, start && styles.labelsStart]}>
          <ThemedText type="default" style={[styles.label, start && styles.textStart, { color }]}>
            {label}
          </ThemedText>
          {hint && (
            <ThemedText
              type="small"
              // Under a link the hint is an explanation, not a second link, so it is grey.
              style={[
                styles.hint,
                start && styles.textStart,
                { color: variant === 'link' ? theme.textSecondary : color },
              ]}>
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
  // Words only: no side padding, so a link's words line up with the text around it.
  link: { paddingVertical: Spacing.two, paddingHorizontal: 0 },
  alignStart: { alignItems: 'flex-start' },
  fill: { flexGrow: 1, paddingHorizontal: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  rowStart: { justifyContent: 'flex-start' },
  labels: { flexShrink: 1, alignItems: 'center', gap: Spacing.one },
  labelsStart: { alignItems: 'flex-start' },
  label: { fontWeight: 700, textAlign: 'center' },
  hint: { textAlign: 'center', opacity: 0.85, fontWeight: 400 },
  textStart: { textAlign: 'auto' },
});
