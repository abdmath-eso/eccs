import Ionicons from '@expo/vector-icons/Ionicons';
import type { ChecklistRunStatus } from '@eccs/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/** A small coloured label for a checklist's state. An icon goes with the colour, so it does not rely on colour alone. */
export function StatusBadge({ status, reviewed }: { status: ChecklistRunStatus; reviewed?: boolean }) {
  const theme = useTheme();
  const { t } = useSession();

  const done = status === 'SUBMITTED';
  const missed = status === 'MISSED';
  const color = done ? theme.primary : missed ? theme.danger : theme.textSecondary;
  const label = done && reviewed ? t('status.reviewed') : t(`status.${status}`);

  return (
    <View style={[styles.badge, { borderColor: color }]}>
      {(done || missed) && <Ionicons name={done ? 'checkmark' : 'alert'} size={16} color={color} />}
      <ThemedText type="smallBold" style={{ color }}>
        {label}
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
