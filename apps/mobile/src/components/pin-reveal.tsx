import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface PinRevealProps {
  pin: string;
  message: string;
  /** The outlet's restaurant code, shown above the PIN so both can be handed over together. */
  restaurantCode?: string | null;
  onDone: () => void;
}

/** Shows a newly generated PIN in large digits. It cannot be looked up again afterwards. */
export function PinReveal({ pin, message, restaurantCode, onDone }: PinRevealProps) {
  const theme = useTheme();
  const { t } = useSession();
  const box = [styles.box, { borderColor: theme.primary, backgroundColor: theme.backgroundElement }];

  return (
    <View style={styles.wrapper}>
      <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
        {message}
      </ThemedText>

      {restaurantCode && (
        <View style={box}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('staff.code')}
          </ThemedText>
          <ThemedText style={styles.code} themeColor="primary" selectable>
            {restaurantCode}
          </ThemedText>
        </View>
      )}

      <View style={box}>
        {restaurantCode && (
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('staff.pin')}
          </ThemedText>
        )}
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
  box: {
    borderWidth: 2,
    borderRadius: Spacing.four,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  code: { fontSize: 30, lineHeight: 38, fontWeight: 700, letterSpacing: 2 },
  pin: { fontSize: 56, lineHeight: 64, fontWeight: 700, letterSpacing: 12 },
});
