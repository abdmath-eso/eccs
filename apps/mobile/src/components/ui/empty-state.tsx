import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface EmptyStateProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  /** What is missing, in a few words ("No certificates yet"). */
  title: string;
  /** One sentence: why it is empty, or what will appear here. */
  body?: string;
  /** The next step, where there is one. */
  action?: { label: string; onPress: () => void; icon?: ComponentProps<typeof Ionicons>['name'] };
}

/**
 * What a list shows when there is nothing in it: a picture, a one-line heading, one sentence and,
 * where there is a next step, a button. Nielsen Norman Group: an empty state says what the space
 * is for and gives a direct way on; a bare grey paragraph reads as a fault.
 */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.box}>
      <View style={[styles.circle, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name={icon} size={32} color={theme.textSecondary} />
      </View>
      <ThemedText type="default" style={styles.title}>
        {title}
      </ThemedText>
      {body && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.centre}>
          {body}
        </ThemedText>
      )}
      {action && <Button label={action.label} icon={action.icon} variant="secondary" onPress={action.onPress} />}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four, paddingHorizontal: Spacing.three },
  circle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  title: { fontWeight: 700, textAlign: 'center' },
  centre: { textAlign: 'center' },
});
