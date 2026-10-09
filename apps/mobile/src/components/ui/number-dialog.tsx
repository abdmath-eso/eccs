import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface NumberDialogProps {
  /** The question, for example "How many labels of Raita?". */
  title: string;
  /** The number it opens with. */
  value: number;
  /** The largest number allowed; the smallest is 0. */
  max: number;
  /** What is said when the number typed is not one from 0 to `max`. */
  rangeMessage: string;
  confirmLabel: string;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

/**
 * Asks for a whole number with the number pad, for when tapping plus many
 * times would be slow (thirty labels for a big batch). Show it only while it
 * is wanted (`{asking && <NumberDialog ... />}`), so it opens afresh each time.
 * It sits near the top of the screen so the number pad does not cover it.
 */
export function NumberDialog({ title, value, max, rangeMessage, confirmLabel, onConfirm, onCancel }: NumberDialogProps) {
  const theme = useTheme();
  const { t } = useSession();
  // Zero opens as an empty box, so the first digit typed is the number.
  const [typed, setTyped] = useState(value > 0 ? String(value) : '');
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    const text = typed.trim();
    const number = text === '' ? 0 : Number(text);
    if (!/^\d{0,4}$/.test(text) || number > max) return setError(rangeMessage);
    onConfirm(number);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <DirectionView style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.background }]}>
          <ThemedText type="default" style={styles.title}>
            {title}
          </ThemedText>
          <TextField
            accessibilityLabel={title}
            value={typed}
            onChangeText={(next) => {
              setTyped(next);
              setError(null);
            }}
            error={error}
            keyboardType="number-pad"
            maxLength={4}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={confirm}
          />
          <Button label={confirmLabel} onPress={confirm} />
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
    justifyContent: 'flex-start',
    padding: Spacing.four,
    paddingTop: Spacing.six,
  },
  card: {
    width: '100%',
    maxWidth: MaxContentWidth - Spacing.six,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: { fontWeight: 700 },
});
