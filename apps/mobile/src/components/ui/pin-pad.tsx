import { PIN_LENGTH } from '@eccs/shared';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Vibration, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /**
   * What went wrong with the last PIN. Shown right under the dots, which shake
   * and turn red, and the phone vibrates. Clear it on the next key press.
   */
  error?: string | null;
  /** A plain line under the error, such as the time left while the pad is locked. */
  note?: string | null;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

// How far the dots move left and right when the PIN is wrong.
const SHAKE = [10, -10, 8, -8, 4, 0];

/** Large on-screen number pad with dots for the digits entered so far. */
export function PinPad({ value, onChange, disabled, error, note }: PinPadProps) {
  const theme = useTheme();
  const { t } = useSession();
  const [shake] = useState(() => new Animated.Value(0));

  // A new error is felt and seen as well as read: a short buzz and a shake of the dots.
  useEffect(() => {
    if (!error) return;
    if (Platform.OS !== 'web') Vibration.vibrate(200);
    let cancelled = false;
    // People who have asked their phone for less movement get the red dots and the message only.
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      Animated.sequence(
        SHAKE.map((toValue) =>
          Animated.timing(shake, { toValue, duration: 60, useNativeDriver: Platform.OS !== 'web' }),
        ),
      ).start();
    });
    return () => {
      cancelled = true;
    };
  }, [error, shake]);

  function press(key: string) {
    if (disabled) return;
    if (key === '⌫') onChange(value.slice(0, -1));
    else if (value.length < PIN_LENGTH) onChange(value + key);
  }

  const dotColor = error ? theme.danger : theme.primary;

  return (
    <View style={[styles.wrapper, styles.wrapperWidth]}>
      <Animated.View
        style={[styles.dots, { transform: [{ translateX: shake }] }]}
        accessibilityLabel={t('pin.progress', { count: value.length, total: PIN_LENGTH })}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              { borderColor: dotColor },
              error ? styles.dotError : null,
              index < value.length && { backgroundColor: dotColor },
            ]}
          />
        ))}
      </Animated.View>
      {/* This space is kept even when empty, so the keys do not move when a message appears. */}
      <View style={styles.message}>
        <ErrorText message={error ?? null} />
        {note && (
          <ThemedText type="smallBold" style={styles.note}>
            {note}
          </ThemedText>
        )}
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
              accessibilityState={{ disabled: !!disabled }}
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
  wrapper: { alignItems: 'center', gap: Spacing.three },
  dots: { flexDirection: 'row', gap: Spacing.four },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  // A thicker edge as well as the red, so the change does not depend on colour alone.
  dotError: { borderWidth: 3 },
  wrapperWidth: { width: '100%' },
  message: { width: '100%', maxWidth: 288, minHeight: 52, gap: Spacing.one, justifyContent: 'center' },
  note: { textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', maxWidth: 288, gap: Spacing.three, justifyContent: 'center' },
  // Three keys to a row at any width: a third of the row less the two gaps between them.
  key: { flexBasis: '28%', flexGrow: 1, maxWidth: 84, height: 72, borderRadius: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  keyLabel: { fontSize: 28, lineHeight: 34, fontWeight: 600 },
  disabled: { opacity: 0.5 },
});
