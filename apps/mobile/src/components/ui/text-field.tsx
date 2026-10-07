import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface TextFieldProps extends TextInputProps {
  /** Always give one: a placeholder disappears as soon as the person types. */
  label?: string;
  /** A short line under the field: the format expected, or what was understood. */
  hint?: string | null;
  /** What is wrong with what was typed, shown under the field. */
  error?: string | null;
}

export function TextField({ label, hint, error, style, onFocus, onBlur, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrapper}>
      {label && (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.two },
  input: {
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 20,
  },
});
