import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';

interface ListRowProps {
  title: string;
  /** One or two short lines under the title. */
  subtitle?: string | null;
  /** Anything else under the subtitle (a status label, a small mark). */
  below?: ReactNode;
  /** A picture or initials in the 40-wide slot before the words, the same slot on every row. */
  leading?: ReactNode;
  /** A short thing at the end (a count, a switch, a status), centred on the row. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** The arrow that says the row opens; shown by default when the row can be tapped. */
  chevron?: boolean;
  /** A thin line above the row: give it to every row but the first. */
  divider?: boolean;
  /** Bold title (the default) or regular. */
  strong?: boolean;
  /** Dimmed, for a person who has left or an entry that is switched off. */
  dimmed?: boolean;
  accessibilityLabel?: string;
}

/**
 * One row of a plain list with a thin line between rows (Material 3's list item: an optional
 * leading slot, a headline and supporting text, an optional trailing part). For lists of like
 * things (people, chats, notifications, documents), which the eye runs down quicker than a pile
 * of boxed cards (Nielsen Norman Group, cards against lists).
 */
export function ListRow({
  title,
  subtitle,
  below,
  leading,
  trailing,
  onPress,
  chevron = onPress !== undefined,
  divider,
  strong = true,
  dimmed,
  accessibilityLabel,
}: ListRowProps) {
  const theme = useTheme();
  const { forwardIcon } = useDirection();
  const content = (
    <>
      {leading !== undefined && <View style={[styles.leading, dimmed && styles.dimmed]}>{leading}</View>}
      <View style={[styles.words, dimmed && styles.dimmed]}>
        <ThemedText type="default" style={strong && styles.strong}>
          {title}
        </ThemedText>
        {!!subtitle && (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        )}
        {below}
      </View>
      {trailing}
      {chevron && <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />}
    </>
  );
  const line = divider ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : null;
  if (!onPress) return <View style={[styles.row, line]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, line, pressed && { backgroundColor: theme.backgroundElement }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouchSize + Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  leading: { width: 40, alignItems: 'center' },
  words: { flex: 1, gap: Spacing.half },
  strong: { fontWeight: 700 },
  dimmed: { opacity: 0.6 },
});
