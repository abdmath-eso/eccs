import type { MessageKey } from '@eccs/i18n';
import { isEccsRole, type OutletDashboardDto, type Role } from '@eccs/shared';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { LanguagePicker } from '@/components/language-picker';
import { OutletOverview } from '@/components/outlet-overview';
import { PinReveal } from '@/components/pin-reveal';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

interface Tile {
  label: MessageKey;
  /** Where the tile goes. Tiles without a destination are not built yet. */
  href?: Href;
}

const STAFF: Tile = { label: 'tile.staff', href: '/staff' };

// What each role sees on its home screen. Mirrors docs/PROPOSAL.md section 8.
const HEAD_CHEF_TILES: Tile[] = [
  { label: 'tile.checklists', href: '/checklists' },
  { label: 'tile.labels' },
  { label: 'tile.issues', href: '/support' },
  { label: 'tile.attendance' },
  { label: 'tile.sops' },
];
const MANAGER_TILES: Tile[] = [
  ...HEAD_CHEF_TILES,
  { label: 'tile.services' },
  { label: 'tile.dues' },
  { label: 'tile.salary' },
  { label: 'tile.history' },
  { label: 'tile.documents', href: '/documents' },
  STAFF,
];
const TILES: Record<Role, Tile[]> = {
  HEAD_CHEF: HEAD_CHEF_TILES,
  MANAGER: MANAGER_TILES,
  OWNER: [...MANAGER_TILES, { label: 'tile.subscription' }, { label: 'tile.qr' }],
  SUPERVISOR: [
    { label: 'tile.jobs' },
    { label: 'tile.inspections' },
    { label: 'tile.issues' },
    { label: 'tile.clients' },
  ],
  OPS_MANAGER: [
    { label: 'tile.clients' },
    { label: 'tile.monitoring' },
    { label: 'tile.jobs' },
    { label: 'tile.inspections' },
  ],
  SUPER_ADMIN: [
    { label: 'tile.clients' },
    { label: 'tile.monitoring' },
    { label: 'tile.jobs' },
    { label: 'tile.inspections' },
  ],
};

export default function HomeScreen() {
  const theme = useTheme();
  const { t, api, user, newPin, dismissNewPin, signOut, linkedDevice } = useSession();
  const [overview, setOverview] = useState<OutletDashboardDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const membership = user?.memberships[0];
  // The restaurant's home opens with how today is going. ECCS staff have the web console for that.
  const showsOverview = membership !== undefined && !isEccsRole(membership.role) && !newPin;

  // Reloads whenever the home screen comes back into view, so it reflects what was just done.
  useFocusEffect(
    useCallback(() => {
      if (!showsOverview) return;
      let cancelled = false;
      (async () => {
        try {
          const outlets = await api.dashboard.get();
          if (cancelled) return;
          setOverview(outlets);
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

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.greeting}>
          {t('home.greeting', { name: user.name })}
        </ThemedText>
        <ThemedText type="default" themeColor="primary">
          {t(`role.${membership.role}`)}
          {place ? ` · ${place}` : ''}
        </ThemedText>
      </View>

      {showsOverview && (
        <View style={styles.overview}>
          <ErrorText message={error} />
          {overview === null && !error && <ActivityIndicator color={theme.primary} />}
          {overview?.map((outlet) => (
            <OutletOverview key={outlet.outletId} outlet={outlet} showName={overview.length > 1} />
          ))}
          {overview && membership.role !== 'HEAD_CHEF' && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('dash.soon')}
            </ThemedText>
          )}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.menu}>
            {t('dash.menu')}
          </ThemedText>
        </View>
      )}

      <View style={styles.tiles}>
        {TILES[membership.role].map((tile) => {
          const href = tile.href;
          return (
            <Pressable
              key={tile.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: !href }}
              disabled={!href}
              onPress={() => href && router.push(href)}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
              ]}>
              <ThemedText type="default" style={[styles.tileLabel, !href && styles.muted]}>
                {t(tile.label)}
              </ThemedText>
              {!href && (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('home.comingSoon')}
                </ThemedText>
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <LanguagePicker />
        {/* On a restaurant's phone, logging out returns to the PIN pad for the next person. */}
        <Button
          label={linkedDevice ? t('home.lock') : t('home.logout')}
          variant="secondary"
          onPress={() => void signOut()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one, paddingTop: Spacing.two },
  greeting: { fontSize: 26, lineHeight: 34 },
  overview: { gap: Spacing.four },
  menu: { marginBottom: -Spacing.two },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: MinTouchSize * 1.7,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    justifyContent: 'center',
    gap: Spacing.one,
  },
  tileLabel: { fontWeight: 700 },
  muted: { opacity: 0.55 },
  footer: { gap: Spacing.three, marginTop: Spacing.four },
});
