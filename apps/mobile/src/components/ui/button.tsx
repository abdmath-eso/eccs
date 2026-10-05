import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ButtonProps {
  label: string;
  /** Smaller explanatory line under the label. */
  hint?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  loading?: boolean;
  disabled?: boolean;
}

export function Button({ label, hint, onPress, variant = 'primary', loading, disabled }: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;

  const background =
    variant === 'primary' ? theme.primary : variant === 'link' ? 'transparent' : theme.backgroundElement;
  const color =
    variant === 'primary' ? theme.onPrimary : variant === 'danger' ? theme.danger : variant === 'link' ? theme.primary : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'link' && styles.link,
        { backgroundColor: background, opacity: inactive ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
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
      )}
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
  labels: { alignItems: 'center', gap: Spacing.one },
  label: { fontWeight: 700, textAlign: 'center' },
  hint: { textAlign: 'center', opacity: 0.85, fontWeight: 400 },
});
