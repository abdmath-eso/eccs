import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface UnsentMarkProps {
  /** True while there is signal and it is on its way; false while it waits on the phone. */
  sending: boolean;
  /** Says something more specific than "Saved on this phone. Not sent yet." while waiting. */
  text?: string;
}

/**
 * The mark on anything that is saved on this phone and has not reached the
 * server yet: a cloud with an arrow and the words, so it does not rely on
 * colour. It goes away by itself once the server has it.
 */
export function UnsentMark({ sending, text }: UnsentMarkProps) {
  const theme = useTheme();
  const { t } = useSession();
  return (
    <View style={styles.row}>
      {sending ? (
        <ActivityIndicator size="small" color={theme.textSecondary} />
      ) : (
        <Ionicons name="cloud-upload-outline" size={20} color={theme.warning} />
      )}
      <ThemedText type="small" themeColor={sending ? 'textSecondary' : 'warning'} style={styles.text}>
        {sending ? t('checklists.photoSending') : (text ?? t('offline.itemSaved'))}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1 },
});
