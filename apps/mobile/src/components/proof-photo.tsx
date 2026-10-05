import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

interface ProofPhotoProps {
  uri: string;
  /** What the photo proves, read out by screen readers. */
  label: string;
  /** When and by whom the photo was taken, shown on the photo like a camera timestamp. */
  stamp?: string | null;
}

/** A proof photo with its time and name stamped on it. Tapping it shows the whole photo. */
export function ProofPhoto({ uri, label, stamp }: ProofPhotoProps) {
  const theme = useTheme();
  const { t } = useSession();
  const [enlarged, setEnlarged] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={label}
        accessibilityHint={t('checklists.viewPhoto')}
        onPress={() => setEnlarged(true)}
        style={[styles.frame, { backgroundColor: theme.backgroundElement }]}>
        <Image source={{ uri }} style={styles.photo} resizeMode="cover" />
        {stamp && (
          <View style={styles.stamp}>
            <ThemedText type="small" style={styles.stampText} numberOfLines={2}>
              {stamp}
            </ThemedText>
          </View>
        )}
      </Pressable>

      <Modal visible={enlarged} transparent animationType="fade" onRequestClose={() => setEnlarged(false)}>
        <View style={styles.viewer}>
          <Image source={{ uri }} style={styles.full} resizeMode="contain" accessibilityLabel={label} />
          {stamp && (
            <ThemedText type="default" style={styles.viewerStamp}>
              {stamp}
            </ThemedText>
          )}
          <Button label={t('common.close')} variant="secondary" onPress={() => setEnlarged(false)} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', height: 200, borderRadius: Spacing.two, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
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
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', padding: Spacing.three, gap: Spacing.three, justifyContent: 'center' },
  full: { width: '100%', flex: 1 },
  viewerStamp: { color: '#ffffff', textAlign: 'center' },
});
