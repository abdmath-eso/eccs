import { Modal, StyleSheet, View } from 'react-native';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface ConfirmDialogProps {
  visible: boolean;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A yes/no question. Used instead of the system alert so it also works in the browser preview. */
export function ConfirmDialog({ visible, message, confirmLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const theme = useTheme();
  const { t } = useSession();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <DirectionView style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.background }]}>
          <ThemedText type="default">{message}</ThemedText>
          <Button label={confirmLabel} variant={danger ? 'danger' : 'primary'} onPress={onConfirm} />
          <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} />
        </View>
      </DirectionView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: MaxContentWidth - Spacing.six,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
