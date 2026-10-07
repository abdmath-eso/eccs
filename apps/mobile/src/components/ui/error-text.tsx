import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface ErrorTextProps {
  message: string | null;
  /** For a failed load: adds a "Try again" button that runs this. */
  onRetry?: () => void;
}

/** What went wrong, in red with a warning mark. Place it next to whatever caused it. */
export function ErrorText({ message, onRetry }: ErrorTextProps) {
  const theme = useTheme();
  const { t } = useSession();
  if (!message) return null;
  return (
    <View style={styles.wrapper}>
      <View style={styles.row} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Ionicons name="alert-circle" size={22} color={theme.danger} />
        <ThemedText type="default" themeColor="danger" style={styles.message}>
          {message}
        </ThemedText>
      </View>
      {onRetry && <Button label={t('common.retry')} variant="secondary" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  message: { flex: 1 },
});
