import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface ProofPhotoProps {
  uri: string;
  /** What the photo proves, read out by screen readers. */
  label: string;
  /** When and by whom the photo was taken, shown on the photo like a camera timestamp. */
  stamp?: string | null;
  /**
   * For a photo just taken on this phone: 'sending' while it uploads, 'failed'
   * when the upload did not go through. A failed photo stays on screen and
   * tapping it sends the same photo again, so nobody has to retake it.
   */
  state?: 'sending' | 'failed' | null;
  /** Sends the same photo again. Needed when `state` can be 'failed'. */
  onRetry?: () => void;
  /** Shows an x in the corner that takes the photo away, for photos not yet sent with a form. */
  onRemove?: () => void;
  /** A small square instead of the full-width picture, for a row of attached photos. */
  compact?: boolean;
}

/** A proof photo with its time and name stamped on it. Tapping it shows the whole photo. */
export function ProofPhoto({ uri, label, stamp, state, onRetry, onRemove, compact }: ProofPhotoProps) {
  const theme = useTheme();
  const { t } = useSession();
  const [enlarged, setEnlarged] = useState(false);
  // Keeps the enlarged photo and its Close button clear of the status bar and home indicator.
  const insets = useSafeAreaInsets();
  const failed = state === 'failed';
  const sending = state === 'sending';

  return (
    <>
      <View style={compact ? styles.compactFrame : styles.frame}>
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={failed ? `${label}. ${t('checklists.photoNotSent')}` : label}
          accessibilityHint={failed ? undefined : t('checklists.viewPhoto')}
          accessibilityState={{ busy: sending }}
          onPress={() => (failed && onRetry ? onRetry() : setEnlarged(true))}
          style={[
            styles.picture,
            { backgroundColor: theme.backgroundElement },
            failed && { borderWidth: 3, borderColor: theme.danger },
          ]}>
          <Image source={{ uri }} style={[styles.photo, (failed || sending) && styles.dimmed]} resizeMode="cover" />

          {sending && (
            <View style={styles.overlay}>
              <ActivityIndicator color="#ffffff" />
              {!compact && (
                <ThemedText type="smallBold" style={styles.overlayText}>
                  {t('checklists.photoSending')}
                </ThemedText>
              )}
            </View>
          )}
          {failed && (
            <View style={styles.overlay}>
              <Ionicons name="refresh-circle" size={compact ? 36 : 48} color="#ffffff" />
              {!compact && (
                <ThemedText type="smallBold" style={styles.overlayText}>
                  {t('checklists.photoNotSent')}
                </ThemedText>
              )}
            </View>
          )}

          {stamp && !state && !compact && (
            <View style={styles.stamp}>
              <ThemedText type="small" style={styles.stampText} numberOfLines={2}>
                {stamp}
              </ThemedText>
            </View>
          )}
        </Pressable>

        {onRemove && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('checklists.removePhoto')}
            onPress={onRemove}
            style={styles.remove}>
            <View style={styles.removeMark}>
              <Ionicons name="close" size={20} color="#ffffff" />
            </View>
          </Pressable>
        )}
      </View>

      <Modal visible={enlarged} transparent animationType="fade" onRequestClose={() => setEnlarged(false)}>
        <DirectionView
          style={[
            styles.viewer,
            { paddingTop: Spacing.three + insets.top, paddingBottom: Spacing.three + insets.bottom },
          ]}>
          <Image source={{ uri }} style={styles.full} resizeMode="contain" accessibilityLabel={label} />
          {stamp && (
            <ThemedText type="default" style={styles.viewerStamp}>
              {stamp}
            </ThemedText>
          )}
          <Button label={t('common.close')} variant="secondary" onPress={() => setEnlarged(false)} />
        </DirectionView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', height: 200 },
  compactFrame: { width: 120, height: 120 },
  picture: { flex: 1, borderRadius: Spacing.two, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  dimmed: { opacity: 0.45 },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    padding: Spacing.two,
  },
  overlayText: { color: '#ffffff', textAlign: 'center' },
  stamp: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  stampText: { color: '#ffffff' },
  // The x is small to look at but its touch area is full size, so wet fingers still hit it.
  remove: {
    position: 'absolute',
    top: 0,
    end: 0,
    width: MinTouchSize,
    height: MinTouchSize,
    alignItems: 'flex-end',
    padding: Spacing.one,
  },
  removeMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    padding: Spacing.three,
    gap: Spacing.three,
    justifyContent: 'center',
  },
  full: { width: '100%', flex: 1 },
  viewerStamp: { color: '#ffffff', textAlign: 'center' },
});
