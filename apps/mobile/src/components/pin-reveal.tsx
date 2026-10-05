import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface PinRevealProps {
  pin: string;
  message: string;
  onDone: () => void;
}

/** Shows a newly generated PIN in large digits. It cannot be looked up again afterwards. */
export function PinReveal({ pin, message, onDone }: PinRevealProps) {
  const theme = useTheme();
  const { t } = useSession();

  return (
    <View style={styles.wrapper}>
      <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
        {message}
      </ThemedText>
      <View style={[styles.pinBox, { borderColor: theme.primary, backgroundColor: theme.backgroundElement }]}>
        <ThemedText style={styles.pin} themeColor="primary" selectable accessibilityLabel={pin.split('').join(' ')}>
          {pin}
        </ThemedText>
      </View>
      <Button label={t('newPin.saved')} onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.four },
  center: { textAlign: 'center' },
  pinBox: { borderWidth: 2, borderRadius: Spacing.four, paddingVertical: Spacing.five, alignItems: 'center' },
  pin: { fontSize: 56, lineHeight: 64, fontWeight: 700, letterSpacing: 12 },
});
