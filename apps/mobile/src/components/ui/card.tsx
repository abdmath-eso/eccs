import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';

interface CardProps {
  children: ReactNode;
  /**
   * `outlined` (a 1 edge on the page colour) for information; `filled` (the light grey fill, no
   * edge) for a thing in a list that opens. Material 3's outlined and filled cards.
   */
  variant?: 'outlined' | 'filled';
  /** Makes the whole card a button. With `chevron`, an arrow at its end says it opens. */
  onPress?: () => void;
  chevron?: boolean;
  /** A coloured edge for a card that needs attention (an overdue bill). Otherwise leave it out. */
  borderColor?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one card of the app (22 Oct 2026): until then cards were drawn with edges of 0, 1, 1.5, 2
 * and 3 in several colours, which the screen review found made screens look uneven. One edge
 * width, one corner, one inner space (16), so contents line up from card to card (Material 3
 * cards; Nielsen Norman Group on consistency).
 */
export function Card({ children, variant = 'outlined', onPress, chevron, borderColor, accessibilityLabel, style }: CardProps) {
  const theme = useTheme();
  const { forwardIcon } = useDirection();
  const look = [
    styles.card,
    variant === 'outlined'
      ? { borderWidth: 1, borderColor: borderColor ?? theme.border, backgroundColor: theme.background }
      : { backgroundColor: theme.backgroundElement, ...(borderColor ? { borderWidth: 1, borderColor } : null) },
    chevron && styles.row,
  ];
  const body = chevron ? <View style={styles.body}>{children}</View> : children;
  const arrow = chevron && <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />;
  if (!onPress)
    return (
      <View style={[look, style]}>
        {body}
        {arrow}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        look,
        pressed && { backgroundColor: variant === 'outlined' ? theme.backgroundElement : theme.backgroundSelected },
        style,
      ]}>
      {body}
      {arrow}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two, minHeight: MinTouchSize },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  body: { flex: 1, gap: Spacing.two },
});
