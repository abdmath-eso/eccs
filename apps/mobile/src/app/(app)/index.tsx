import Ionicons from '@expo/vector-icons/Ionicons';
import { isEccsRole, type OutletDashboardDto, type Role } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { OutletOverview } from '@/components/outlet-overview';
import { PinReveal } from '@/components/pin-reveal';
import { SideMenu, type MenuItem } from '@/components/side-menu';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { recallOutlet, rememberOutlet } from '@/lib/use-outlet';

const STAFF: MenuItem = { label: 'tile.staff', icon: 'key-outline', href: '/staff' };

// What each role finds in its menu. Mirrors docs/PROPOSAL.md section 8.
const HEAD_CHEF_MENU: MenuItem[] = [
  { label: 'tile.checklists', icon: 'checkbox-outline', href: '/checklists' },
  { label: 'tile.labels', icon: 'pricetag-outline' },
  { label: 'tile.issues', icon: 'chatbubble-ellipses-outline', href: '/support' },
  { label: 'tile.attendance', icon: 'people-outline' },
  { label: 'tile.sops', icon: 'book-outline', href: '/sops' },
];
const MANAGER_MENU: MenuItem[] = [
  ...HEAD_CHEF_MENU,
  { label: 'tile.services', icon: 'construct-outline' },
  { label: 'tile.dues', icon: 'receipt-outline' },
  { label: 'tile.salary', icon: 'wallet-outline' },
  { label: 'tile.history', icon: 'calendar-outline', href: '/history' },
  { label: 'tile.documents', icon: 'document-text-outline', href: '/documents' },
  STAFF,
];
const ECCS_MENU: MenuItem[] = [
  { label: 'tile.clients', icon: 'business-outline' },
  { label: 'tile.monitoring', icon: 'pulse-outline' },
  { label: 'tile.jobs', icon: 'construct-outline' },
  { label: 'tile.inspections', icon: 'clipboard-outline' },
];
const MENU: Record<Role, MenuItem[]> = {
  HEAD_CHEF: HEAD_CHEF_MENU,
  MANAGER: MANAGER_MENU,
  OWNER: [
    ...MANAGER_MENU,
    { label: 'tile.subscription', icon: 'card-outline' },
    { label: 'tile.qr', icon: 'qr-code-outline' },
  ],
  SUPERVISOR: [
    { label: 'tile.jobs', icon: 'construct-outline' },
    { label: 'tile.inspections', icon: 'clipboard-outline' },
    { label: 'tile.issues', icon: 'chatbubble-ellipses-outline' },
    { label: 'tile.clients', icon: 'business-outline' },
  ],
  OPS_MANAGER: ECCS_MENU,
  SUPER_ADMIN: ECCS_MENU,
};

/**
 * Home: how today is going at the outlet. An Owner with several outlets
 * picks one at the top. Everything else is in the menu, opened from the
 * button in the corner.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const { t, api, user, newPin, dismissNewPin } = useSession();
  const [overview, setOverview] = useState<OutletDashboardDto[] | null>(null);
  const [chosenOutlet, setChosenOutlet] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const membership = user?.memberships[0];
  // The restaurant's home opens with how today is going. ECCS staff have the web console for that.
  const showsOverview = membership !== undefined && !isEccsRole(membership.role) && !newPin;

  // Reloads whenever the home screen comes back into view, so it reflects what was just
  // done, and follows the outlet last chosen on any other screen.
  useFocusEffect(
    useCallback(() => {
      if (!showsOverview) return;
      let cancelled = false;
      (async () => {
        try {
          const [outlets, remembered] = await Promise.all([api.dashboard.get(), recallOutlet()]);
          if (cancelled) return;
          setOverview(outlets);
          setChosenOutlet(remembered);
          setError(null);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e, t));
        }
      })();
      return () => {
        cancelled = true;
      };
      // `t` changes with language; reloading for that is unnecessary.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, showsOverview]),
  );

  // The person's photo for the top of the menu; read again on coming back, in case they changed it.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      api.profile
        .get()
        .then((profile) => !cancelled && setPhotoPath(profile.photoPath))
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, user?.id]),
  );

  if (!user || !membership) return null;

  // An owner who has just been given a PIN must see it before anything else.
  if (newPin) {
    return (
      <Screen title={t('newPin.title')}>
        <PinReveal pin={newPin} message={t('newPin.help')} onDone={dismissNewPin} />
      </Screen>
    );
  }

  const place =
    membership.outletName ?? membership.organizationName ?? (membership.role === 'OWNER' ? t('home.allOutlets') : null);
  const roleAndPlace = `${t(`role.${membership.role}`)}${place ? ` · ${place}` : ''}`;
  const outlet = overview?.find((entry) => entry.outletId === chosenOutlet) ?? overview?.[0];

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dash.menu')}
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [
            styles.menuButton,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <Ionicons name="menu" size={28} color={theme.text} />
        </Pressable>
        <View style={styles.headerText}>
          <ThemedText type="subtitle" style={styles.greeting}>
            {t('home.greeting', { name: user.name })}
          </ThemedText>
          <ThemedText type="default" themeColor="primary">
            {roleAndPlace}
          </ThemedText>
        </View>
      </View>

      {showsOverview ? (
        <>
          {overview && overview.length > 1 && (
            <View style={styles.outlets} accessibilityLabel={t('checklists.chooseOutlet')}>
              {overview.map((entry) => {
                const selected = entry.outletId === outlet?.outletId;
                return (
                  <Pressable
                    key={entry.outletId}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setChosenOutlet(entry.outletId);
                      void rememberOutlet(entry.outletId);
                    }}
                    style={[
                      styles.outlet,
                      { borderColor: selected ? theme.primary : theme.border },
                      selected && { backgroundColor: theme.backgroundElement },
                    ]}>
                    <ThemedText type="small" themeColor={selected ? 'primary' : 'text'}>
                      {entry.outletName}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}

          <ErrorText message={error} />
          {overview === null && !error && <ActivityIndicator color={theme.primary} />}
          {outlet && <OutletOverview outlet={outlet} />}
          {outlet && membership.role !== 'HEAD_CHEF' && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('dash.soon')}
            </ThemedText>
          )}
        </>
      ) : (
        <ThemedText type="default" themeColor="textSecondary">
          {t('home.useMenu')}
        </ThemedText>
      )}

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
        onSelect={(href) => {
          setMenuOpen(false);
          router.push(href);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingTop: Spacing.two },
  menuButton: {
    width: MinTouchSize,
    height: MinTouchSize,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: Spacing.one },
  greeting: { fontSize: 24, lineHeight: 30 },
  outlets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  outlet: {
    minHeight: MinTouchSize - 8,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
});
