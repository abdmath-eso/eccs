import Ionicons from '@expo/vector-icons/Ionicons';
import type { IssueStatus } from '@eccs/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

// An icon goes with each colour, so the stage does not rely on colour alone.
const ICONS: Record<IssueStatus, keyof typeof Ionicons.glyphMap> = {
  OPEN: 'alert',
  IN_PROGRESS: 'time-outline',
  RESOLVED: 'checkmark',
  CLOSED: 'lock-closed',
};

/** A small coloured label for where an ECCS support issue stands. */
export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const theme = useTheme();
  const { t } = useSession();
  const color =
    status === 'OPEN' ? theme.danger : status === 'IN_PROGRESS' ? theme.text : status === 'RESOLVED' ? theme.primary : theme.textSecondary;

  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Ionicons name={ICONS[status]} size={16} color={color} />
      <ThemedText type="smallBold" style={{ color }}>
        {t(`issueStatus.${status}`)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1.5,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.half,
  },
});
