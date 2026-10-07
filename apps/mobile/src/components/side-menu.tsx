import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey } from '@eccs/i18n';
import type { Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { LanguagePicker } from '@/components/language-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

const WIDTH = 310;

export interface MenuItem {
  label: MessageKey;
  icon: ComponentProps<typeof Ionicons>['name'];
  /** Where the item goes. Items without a destination are not built yet. */
  href?: Href;
}

interface SideMenuProps {
  visible: boolean;
  /** The person's name, and their role and place, shown at the top. */
  title: string;
  subtitle: string;
  /** The person's profile photo, if they have set one. */
  photoUrl?: string | null;
  /** Opens "My profile". */
  onOpenProfile: () => void;
  items: MenuItem[];
  onSelect: (href: Href) => void;
  onClose: () => void;
}

/**
 * The app's menu: a panel that slides in from the left with every section
 * the person can open and the lock button. Their photo and name at the top
 * open "My profile". The language is chosen at the foot of the menu.
 */
export function SideMenu({
  visible,
  title,
  subtitle,
  photoUrl,
  onOpenProfile,
  items,
  onSelect,
  onClose,
}: SideMenuProps) {
  const theme = useTheme();
  const { t, signOut, linkedDevice } = useSession();
  // A SafeAreaView inside a Modal is not told about the status bar on an iPhone and the
  // menu ran up under the clock, so the gaps are read from the app and applied by hand.
  const insets = useSafeAreaInsets();
  // Kept in state, not `useAnimatedValue`, which the browser build of React Native does not have.
  const [slide] = useState(() => new Animated.Value(-WIDTH));

  useEffect(() => {
    if (!visible) return;
    slide.setValue(-WIDTH);
    // The phone's own animation engine keeps the slide smooth. A browser has none, and
    // React Native warns if asked for it there, so the browser preview animates in script.
    Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [visible, slide]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={styles.backdrop}
        />
        <Animated.View
          style={[styles.panel, { backgroundColor: theme.background, transform: [{ translateX: slide }] }]}>
          <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={[styles.header, { borderColor: theme.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('profile.open')}
                onPress={onOpenProfile}
                style={({ pressed }) => [styles.profile, pressed && { opacity: 0.7 }]}>
                <Avatar name={title} photoUrl={photoUrl} size={52} />
                <View style={styles.headerText}>
                  <ThemedText type="default" style={styles.title}>
                    {title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="primary">
                    {subtitle}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('profile.open')} ›
                  </ThemedText>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                onPress={onClose}
                style={styles.close}>
                <Ionicons name="close" size={28} color={theme.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.items}>
              {/* What can be opened comes first; sections not built yet follow. */}
              {[...items.filter((item) => item.href), ...items.filter((item) => !item.href)].map((item) => {
                const href = item.href;
                return (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !href }}
                    disabled={!href}
                    onPress={() => href && onSelect(href)}
                    style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.backgroundElement }]}>
                    <Ionicons
                      name={item.icon}
                      size={24}
                      color={href ? theme.primary : theme.textSecondary}
                      style={!href && styles.muted}
                    />
                    <View style={styles.itemText}>
                      <ThemedText type="default" style={[styles.itemLabel, !href && styles.muted]}>
                        {t(item.label)}
                      </ThemedText>
                      {!href && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {t('home.comingSoon')}
                        </ThemedText>
                      )}
                    </View>
                    {href && <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />}
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={[styles.footer, { borderColor: theme.border }]}>
              <LanguagePicker />
              {/* On a restaurant's phone, logging out returns to the PIN pad for the next person. */}
              <Button
                label={linkedDevice ? t('home.lock') : t('home.logout')}
                variant="secondary"
                onPress={() => {
                  onClose();
                  void signOut();
                }}
              />
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  panel: { width: WIDTH, maxWidth: '86%', height: '100%' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.four,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
  },
  profile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headerText: { flex: 1, gap: Spacing.half },
  title: { fontWeight: 700, fontSize: 18 },
  close: { minWidth: MinTouchSize, minHeight: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
  items: { paddingVertical: Spacing.two },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouchSize + Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  itemText: { flex: 1 },
  itemLabel: { fontWeight: 600 },
  muted: { opacity: 0.55 },
  footer: { gap: Spacing.three, padding: Spacing.three, borderTopWidth: 1 },
});
