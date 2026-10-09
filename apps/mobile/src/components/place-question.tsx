import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { onPlaceQuestion } from '@/lib/photo-place';
import { useSession } from '@/lib/session';

/**
 * The app's own question before the phone's location permission box: may the
 * place be added to proof photos? Mounted once, in the layout of the logged-in
 * screens, and shown by lib/photo-place.ts the first time someone is about to
 * take a proof photo: the moment the reason is plain.
 *
 * It says what is collected (where the phone is), when (only as a proof photo
 * is taken) and why (to show the photo was taken in this kitchen), and that
 * saying no changes nothing else. Only "Allow" brings up the phone's own box.
 * The same pattern as the notifications question (components/push-setup.tsx).
 */
export function PlaceQuestion() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useSession();
  const [asking, setAsking] = useState(false);
  // Whoever is waiting for the answer (the photo about to be taken).
  const waiting = useRef<((allow: boolean) => void) | null>(null);

  useEffect(
    () =>
      onPlaceQuestion(
        () =>
          new Promise<boolean>((resolve) => {
            waiting.current = resolve;
            setAsking(true);
          }),
      ),
    [],
  );

  function answer(allow: boolean) {
    setAsking(false);
    waiting.current?.(allow);
    waiting.current = null;
  }

  return (
    <Modal visible={asking} transparent animationType="fade" onRequestClose={() => answer(false)}>
      <DirectionView style={[styles.backdrop, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={[styles.card, { backgroundColor: theme.background }]}>
          <View style={styles.icon}>
            <Ionicons name="location" size={40} color={theme.primary} />
          </View>
          <ThemedText type="subtitle" style={styles.title} accessibilityRole="header">
            {t('place.ask.title')}
          </ThemedText>
          <ThemedText type="default">{t('place.ask.body')}</ThemedText>
          <ThemedText type="default">{t('place.ask.when')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('place.ask.optional')}
          </ThemedText>
          <Button icon="location" label={t('place.ask.yes')} onPress={() => answer(true)} />
          <Button label={t('place.ask.notNow')} variant="secondary" onPress={() => answer(false)} />
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
    paddingHorizontal: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: MaxContentWidth - Spacing.six,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  icon: { alignItems: 'center' },
  title: { fontSize: 22, lineHeight: 28, textAlign: 'center' },
});
