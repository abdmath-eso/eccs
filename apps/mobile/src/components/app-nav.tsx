import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey } from '@eccs/i18n';
import { isEccsRole, type Role } from '@eccs/shared';
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SideMenu, type MenuItem } from '@/components/side-menu';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isTabRoute } from '@/lib/navigation';
import { useSession } from '@/lib/session';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface Tab {
  label: MessageKey;
  /** Outline when not selected, filled when selected. */
  icon: IconName;
  iconSelected: IconName;
  href: '/' | '/checklists' | '/support' | '/services' | '/sops';
}

const HOME: Tab = { label: 'tab.home', icon: 'home-outline', iconSelected: 'home', href: '/' };
const CHECKLISTS: Tab = { label: 'tab.checklists', icon: 'checkbox-outline', iconSelected: 'checkbox', href: '/checklists' };
const ISSUES: Tab = {
  label: 'tab.issues',
  icon: 'chatbubble-ellipses-outline',
  iconSelected: 'chatbubble-ellipses',
  href: '/support',
};
const SERVICES: Tab = { label: 'tab.services', icon: 'construct-outline', iconSelected: 'construct', href: '/services' };
const VISITS: Tab = { ...SERVICES, label: 'tab.visits' };
const SOPS: Tab = { label: 'tab.sops', icon: 'book-outline', iconSelected: 'book', href: '/sops' };

// The sections each role uses most, at most four, plus "More". The rest are in the menu.
const TABS: Record<Role, Tab[]> = {
  HEAD_CHEF: [HOME, CHECKLISTS, ISSUES, SOPS],
  MANAGER: [HOME, CHECKLISTS, SERVICES, ISSUES],
  OWNER: [HOME, CHECKLISTS, SERVICES, ISSUES],
  SUPERVISOR: [HOME, VISITS],
  OPS_MANAGER: [HOME, VISITS],
  SUPER_ADMIN: [HOME, VISITS],
};

const STAFF: MenuItem = { label: 'tile.staff', icon: 'key-outline', href: '/staff' };

// Everything each role can open, for the "More" menu. Mirrors docs/PROPOSAL.md section 8.
// Sections that are not built yet are left out until they are.
const HEAD_CHEF_MENU: MenuItem[] = [
  { label: 'tile.checklists', icon: 'checkbox-outline', href: '/checklists' },
  { label: 'tile.issues', icon: 'chatbubble-ellipses-outline', href: '/support' },
  { label: 'tile.sops', icon: 'book-outline', href: '/sops' },
];
const MANAGER_MENU: MenuItem[] = [
  ...HEAD_CHEF_MENU,
  { label: 'tile.services', icon: 'construct-outline', href: '/services' },
  { label: 'tile.history', icon: 'calendar-outline', href: '/history' },
  { label: 'tile.documents', icon: 'document-text-outline', href: '/documents' },
  STAFF,
];
const ECCS_MENU: MenuItem[] = [{ label: 'tile.jobs', icon: 'construct-outline', href: '/services' }];
const MENU: Record<Role, MenuItem[]> = {
  HEAD_CHEF: HEAD_CHEF_MENU,
  MANAGER: MANAGER_MENU,
  OWNER: MANAGER_MENU,
  SUPERVISOR: ECCS_MENU,
  OPS_MANAGER: ECCS_MENU,
  SUPER_ADMIN: ECCS_MENU,
};

/**
 * The app's main navigation: a bar along the bottom of the top-level screens
 * with the sections the person uses most, and "More", which opens the full
 * menu (every section, their profile, the language and the lock button).
 */
export function AppNav() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { t, api, user, newPin } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);

  // The person's photo for the top of the menu; read again each time the menu opens, in case they changed it.
  useEffect(() => {
    if (!menuOpen) return;
    let cancelled = false;
    api.profile
      .get()
      .then((profile) => !cancelled && setPhotoPath(profile.photoPath))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, menuOpen]);

  const membership = user?.memberships[0];
  // An owner who has just been given a PIN must see it before anything else.
  if (!user || !membership || newPin || !isTabRoute(pathname)) return null;

  const current = pathname.replace(/\/$/, '') || '/';
  const place =
    membership.outletName ?? membership.organizationName ?? (membership.role === 'OWNER' ? t('home.allOutlets') : null);
  const roleAndPlace = `${t(`role.${membership.role}`)}${place ? ` · ${place}` : ''}`;

  function open(href: Tab['href']) {
    if (href === current) return;
    // Home stays underneath the other sections, so Back from any of them returns to it.
    if (href === '/') router.dismissAll();
    else if (current === '/') router.push(href);
    else router.replace(href);
  }

  const item = (key: string, label: string, icon: IconName, selected: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.item}>
      <View style={[styles.pill, selected && { backgroundColor: theme.backgroundSelected }]}>
        <Ionicons name={icon} size={24} color={selected ? theme.primary : theme.textSecondary} />
      </View>
      <ThemedText
        type="small"
        numberOfLines={1}
        style={[styles.label, { color: selected ? theme.primary : theme.textSecondary }, selected && styles.selected]}>
        {label}
      </ThemedText>
    </Pressable>
  );

  return (
    <>
      <View style={[styles.bar, { backgroundColor: theme.background, borderColor: theme.border, paddingBottom: insets.bottom }]}>
        <View style={styles.items} accessibilityRole="tablist">
          {TABS[membership.role].map((tab) =>
            item(tab.href, t(tab.label), tab.href === current ? tab.iconSelected : tab.icon, tab.href === current, () =>
              open(tab.href),
            ),
          )}
          {item('more', t('tab.more'), 'menu', false, () => setMenuOpen(true))}
        </View>
      </View>

      <SideMenu
        visible={menuOpen}
        title={user.name}
        subtitle={roleAndPlace}
        photoUrl={photoPath ? api.fileUrl(photoPath) : null}
        onOpenProfile={() => {
          setMenuOpen(false);
          router.push('/profile');
        }}
        items={MENU[membership.role]}
        onClose={() => setMenuOpen(false)}
        onSelect={(href: Href) => {
          setMenuOpen(false);
          router.push(href);
        }}
      />
    </>
  );
}

/** True for ECCS staff, whose home shows their visits rather than a restaurant's day. */
export const isEccsUser = (role: Role | undefined) => role !== undefined && isEccsRole(role);

const styles = StyleSheet.create({
  bar: { borderTopWidth: 1, alignItems: 'center' },
  items: { flexDirection: 'row', width: '100%', maxWidth: MaxContentWidth },
  item: { flex: 1, minHeight: MinTouchSize + Spacing.three, alignItems: 'center', justifyContent: 'center', gap: Spacing.half },
  pill: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.half, borderRadius: Spacing.three },
  label: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
  selected: { fontWeight: 700 },
});
