import { PIN_LENGTH } from '@eccs/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

/** Large on-screen number pad with dots for the digits entered so far. */
export function PinPad({ value, onChange, disabled }: PinPadProps) {
  const theme = useTheme();
  const { t } = useSession();

  function press(key: string) {
    if (disabled) return;
    if (key === '⌫') onChange(value.slice(0, -1));
    else if (value.length < PIN_LENGTH) onChange(value + key);
  }

  return (
    <View style={[styles.wrapper, styles.wrapperWidth]}>
      <View style={styles.dots} accessibilityLabel={t('pin.progress', { count: value.length, total: PIN_LENGTH })}>
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
              accessibilityLabel={key === '⌫' ? t('pin.delete') : key}
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
  wrapperWidth: { width: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', maxWidth: 288, gap: Spacing.three, justifyContent: 'center' },
  // Three keys to a row at any width: a third of the row less the two gaps between them.
  key: { flexBasis: '28%', flexGrow: 1, maxWidth: 84, height: 72, borderRadius: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  keyLabel: { fontSize: 28, lineHeight: 34, fontWeight: 600 },
  disabled: { opacity: 0.5 },
});
