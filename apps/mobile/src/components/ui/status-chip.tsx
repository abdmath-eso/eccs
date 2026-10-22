import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type StatusTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

/**
 * One small label for where something stands (a checklist, a visit, an issue), drawn the same way
 * everywhere: a soft tint of its colour, an icon and a word, so it never relies on colour alone
 * (WCAG 1.4.1) and does not look like a button (Atlassian's lozenge: status labels are not
 * interactive, so they carry no outline). Until 22 Oct 2026 three components drew it three ways:
 * grey or black outlines, a text tick on one and an icon on the others.
 */
export function StatusChip({
  tone,
  icon,
  label,
}: {
  tone: StatusTone;
  icon?: ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  const theme = useTheme();
  const color = {
    neutral: theme.textSecondary,
    good: theme.primary,
    warn: theme.warning,
    bad: theme.danger,
    info: theme.info,
  }[tone];
  return (
    // The tint is the colour at 8% (its hex code with an alpha), light enough that the word on it keeps 4.5:1.
    <View style={[styles.chip, { backgroundColor: `${color}14` }]}>
      {icon && <Ionicons name={icon} size={16} color={color} />}
      <ThemedText type="smallBold" style={[styles.label, { color }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.one,
  },
  label: { flexShrink: 1 },
});
