import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

export interface SheetOption {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  /** Shown in red, for removing or deleting. */
  danger?: boolean;
  onPress: () => void;
}

interface OptionSheetProps {
  visible: boolean;
  title?: string;
  options: SheetOption[];
  onClose: () => void;
}

/** A short list of choices that slides up from the bottom of the screen, with Cancel underneath. */
export function OptionSheet({ visible, title, options, onClose }: OptionSheetProps) {
  const theme = useTheme();
  const { t } = useSession();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Spacing.three + insets.bottom }]}>
          {title && (
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.title}>
              {title}
            </ThemedText>
          )}
          {options.map((option) => {
            const color = option.danger ? theme.danger : theme.text;
            return (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                onPress={option.onPress}
                style={({ pressed }) => [styles.option, pressed && { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name={option.icon} size={24} color={option.danger ? theme.danger : theme.primary} />
                <ThemedText type="default" style={[styles.label, { color }]}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
          <Button label={t('common.cancel')} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.one,
  },
  title: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.one },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouchSize + Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.three,
  },
  label: { fontWeight: 600 },
});
