import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionView } from '@/components/direction-view';
import { Button } from '@/components/ui/button';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/** Until the picture's own shape is known: an A4 page standing up. */
const PAGE_SHAPE = 1 / Math.SQRT2;

/**
 * The photo of a document chosen for the licence form (14 Oct 2026), so what was read
 * can be checked against it. The small preview cannot be read, so tapping it opens the
 * whole picture: as wide as the screen, scrolled up and down, with Close at the bottom
 * (and the phone's Back). This is how receipt-capture apps show the receipt beside the
 * fields they filled in (Expensify, SAP Concur's receipt viewer), and how the app's own
 * proof photos open. On an iPhone it can also be pinched to zoom.
 */
export function DocumentPhoto({ uri, previewStyle }: { uri: string; previewStyle?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const { t } = useSession();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  // Width divided by height, read when it is opened.
  const [shape, setShape] = useState<{ uri: string; ratio: number } | null>(null);

  function enlarge() {
    setOpen(true);
    if (shape?.uri === uri) return;
    Image.getSize(
      uri,
      (w, h) => w > 0 && h > 0 && setShape({ uri, ratio: w / h }),
      () => undefined,
    );
  }

  const ratio = shape?.uri === uri ? shape.ratio : PAGE_SHAPE;
  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={t('ai.documentPhoto')}
        accessibilityHint={t('checklists.viewPhoto')}
        onPress={enlarge}
        style={[styles.preview, { backgroundColor: theme.backgroundElement }, previewStyle]}>
        <Image source={{ uri }} style={styles.fill} resizeMode="contain" />
        {/* A small "open full size" mark in the corner, so the preview is seen to open. */}
        <View style={styles.expand}>
          <Ionicons name="expand" size={20} color="#ffffff" />
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <DirectionView style={[styles.viewer, { paddingTop: insets.top, paddingBottom: Spacing.three + insets.bottom }]}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent>
            <Image
              source={{ uri }}
              style={{ width, height: width / ratio }}
              resizeMode="contain"
              accessibilityLabel={t('ai.documentPhoto')}
            />
          </ScrollView>
          <View style={styles.close}>
            <Button label={t('common.close')} variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </DirectionView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 200, borderRadius: Spacing.two, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  expand: {
    position: 'absolute',
    bottom: Spacing.two,
    end: Spacing.two,
    width: MinTouchSize - 16,
    height: MinTouchSize - 16,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', gap: Spacing.three },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  close: { paddingHorizontal: Spacing.three },
});
