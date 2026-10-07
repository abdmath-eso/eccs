import { useEffect, useState } from 'react';
import { BackHandler, Platform, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface PinRevealProps {
  pin: string;
  message: string;
  /** The outlet's restaurant code, shown above the PIN so both can be handed over together. */
  restaurantCode?: string | null;
  /**
   * Whose PIN this is, when it was made for someone else. Adds a Share button
   * that hands the code and PIN to the phone's share sheet (WhatsApp, SMS and so on).
   */
  shareFor?: string;
  onDone: () => void;
}

/** Shows a newly generated PIN in large digits. It cannot be looked up again afterwards. */
export function PinReveal({ pin, message, restaurantCode, shareFor, onDone }: PinRevealProps) {
  const theme = useTheme();
  const { t } = useSession();
  const [shareError, setShareError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const box = [styles.box, { borderColor: theme.primary, backgroundColor: theme.backgroundElement }];

  // The PIN is shown only this once, so Android's back button asks first instead of leaving at a slip of the thumb.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setLeaving(true);
      return true;
    });
    return () => subscription.remove();
  }, []);

  async function share() {
    setShareError(null);
    const lines = [
      t('newPin.shareFor', { name: shareFor ?? '' }),
      ...(restaurantCode ? [`${t('staff.code')}: ${restaurantCode}`] : []),
      `${t('staff.pin')}: ${pin}`,
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // For example the browser preview, which has no share sheet.
      setShareError(t('newPin.shareFailed'));
    }
  }

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

      {shareFor !== undefined && (
        <View style={styles.share}>
          <Button icon="share-social" label={t('newPin.share')} variant="secondary" onPress={() => void share()} />
          <ErrorText message={shareError} />
        </View>
      )}
      <Button label={t('newPin.saved')} onPress={onDone} />

      <ConfirmDialog
        visible={leaving}
        message={t('newPin.leaveConfirm')}
        confirmLabel={t('newPin.leave')}
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false);
          onDone();
        }}
      />
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
  share: { gap: Spacing.two },
});
