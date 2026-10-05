import { PIN_LENGTH } from '@eccs/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

/** Large on-screen number pad with dots for the digits entered so far. */
export function PinPad({ value, onChange, disabled }: PinPadProps) {
  const theme = useTheme();

  function press(key: string) {
    if (disabled) return;
    if (key === '⌫') onChange(value.slice(0, -1));
    else if (value.length < PIN_LENGTH) onChange(value + key);
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.dots} accessibilityLabel={`${value.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              { borderColor: theme.primary },
              index < value.length && { backgroundColor: theme.primary },
            ]}
          />
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map((key, index) =>
          key === '' ? (
            <View key={index} style={styles.key} />
          ) : (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={key === '⌫' ? 'Delete' : key}
              disabled={disabled}
              onPress={() => press(key)}
              style={({ pressed }) => [
                styles.key,
                { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                disabled && styles.disabled,
              ]}>
              <ThemedText style={styles.keyLabel}>{key}</ThemedText>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: Spacing.five },
  dots: { flexDirection: 'row', gap: Spacing.four },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 288, gap: Spacing.three, justifyContent: 'center' },
  key: { width: 84, height: 72, borderRadius: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  keyLabel: { fontSize: 28, lineHeight: 34, fontWeight: 600 },
  disabled: { opacity: 0.5 },
});
