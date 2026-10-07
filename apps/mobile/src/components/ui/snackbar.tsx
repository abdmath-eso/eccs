import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const VISIBLE_MS = 4000;
// Room for the bottom bar, so the message never covers it.
const ABOVE_BOTTOM_BAR = 76;

type Notify = (message: string) => void;

const SnackbarContext = createContext<Notify>(() => undefined);

/**
 * Says briefly that something worked ("Saved", "Request sent"), at the bottom
 * of the screen, then goes away by itself. Call it right after a successful
 * save or send; failures are shown beside what caused them, not here.
 */
export const useSnackbar = () => use(SnackbarContext);

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState<{ message: string; at: number } | null>(null);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  const notify: Notify = (message) => setShown({ message, at: Date.now() });

  return (
    <SnackbarContext value={notify}>
      {children}
      {shown && (
        <View pointerEvents="none" style={[styles.layer, { bottom: insets.bottom + ABOVE_BOTTOM_BAR }]}>
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.bar, { backgroundColor: theme.text }]}>
            <Ionicons name="checkmark-circle" size={22} color={theme.background} />
            <ThemedText type="default" style={[styles.message, { color: theme.background }]}>
              {shown.message}
            </ThemedText>
          </View>
        </View>
      )}
    </SnackbarContext>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: Spacing.three },
  bar: {
    width: '100%',
    maxWidth: MaxContentWidth - Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  message: { flex: 1, fontWeight: 600 },
});
