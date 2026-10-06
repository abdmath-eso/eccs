import type { IssueStatus } from '@eccs/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/** A small coloured label for where an ECCS support issue stands. */
export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const theme = useTheme();
  const { t } = useSession();
  const color =
    status === 'OPEN' ? theme.danger : status === 'IN_PROGRESS' ? theme.text : status === 'RESOLVED' ? theme.primary : theme.textSecondary;

  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <ThemedText type="smallBold" style={{ color }}>
        {status === 'RESOLVED' ? '✓ ' : ''}
        {t(`issueStatus.${status}`)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.half,
  },
});
