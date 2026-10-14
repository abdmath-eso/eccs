import { useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';

interface TextFieldProps extends TextInputProps {
  /** Always give one: a placeholder disappears as soon as the person types. */
  label?: string;
  /** A short line under the field: the format expected, or what was understood. */
  hint?: string | null;
  /** What is wrong with what was typed, shown under the field. */
  error?: string | null;
  /** A small mark after the label, such as the sparkles on a field AI filled in. */
  labelMark?: ReactNode;
}

export function TextField({ label, hint, error, labelMark, style, onFocus, onBlur, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const { isRtl } = useDirection();
  // In Urdu, a box for words starts at the right. A box for digits (a phone number,
  // a one-time code, a date, a time) stays left to right: numbers are written the same
  // way round in every language, and their groups must not swap places.
  const forDigits =
    rest.keyboardType === 'number-pad' ||
    rest.keyboardType === 'phone-pad' ||
    rest.keyboardType === 'numeric' ||
    rest.keyboardType === 'decimal-pad' ||
    rest.inputMode === 'numeric' ||
    rest.inputMode === 'decimal' ||
    rest.inputMode === 'tel';
  return (
    // Set to the app's direction again here, so a field placed inside something kept
    // left to right (the phone number row) still has its label and messages the Urdu way.
    <DirectionView style={styles.wrapper}>
      {label && (
        <View style={styles.labelRow}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.labelText}>
            {label}
          </ThemedText>
          {labelMark}
        </View>
      )}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          isRtl && (forDigits ? styles.leftToRight : styles.rightToLeft),
          { color: theme.text, borderColor: theme.outline, backgroundColor: theme.backgroundElement },
          focused && { borderColor: theme.primary, borderWidth: 2 },
          error ? { borderColor: theme.danger, borderWidth: 2 } : null,
          style,
        ]}
        {...rest}
      />
      {hint && !error && (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      )}
      <ErrorText message={error ?? null} />
    </DirectionView>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.two },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  labelText: { flexShrink: 1 },
  input: {
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 20,
  },
  rightToLeft: { writingDirection: 'rtl' },
  leftToRight: { writingDirection: 'ltr' },
});
