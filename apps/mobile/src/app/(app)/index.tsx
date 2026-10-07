import { type OutletDashboardDto, type VisitSummaryDto } from '@eccs/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { isEccsUser } from '@/components/app-nav';
import { OutletOverview } from '@/components/outlet-overview';
import { PinReveal } from '@/components/pin-reveal';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { VisitCard } from '@/components/visit-card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { indiaToday } from '@/lib/format';
import { useSession } from '@/lib/session';
import { recallOutlet, rememberOutlet } from '@/lib/use-outlet';

/**
 * Home. For a restaurant: how today is going at the outlet, and an Owner with
 * several outlets picks one at the top. For ECCS staff: the visits to do today.
 * Everything else is reached from the bar at the bottom.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const { t, api, user, newPin, dismissNewPin } = useSession();
  const [overview, setOverview] = useState<OutletDashboardDto[] | null>(null);
  const [visits, setVisits] = useState<VisitSummaryDto[] | null>(null);
  const [chosenOutlet, setChosenOutlet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const membership = user?.memberships[0];
  const eccs = isEccsUser(membership?.role);
  const loads = membership !== undefined && !newPin;

  const load = useCallback(async () => {
    if (!loads) return;
    try {
      if (eccs) {
        setVisits(await api.visits.list({ state: 'open' }));
      } else {
        const [outlets, remembered] = await Promise.all([api.dashboard.get(), recallOutlet()]);
        setOverview(outlets);
        setChosenOutlet(remembered);
      }
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, eccs, loads]);

  // Reloads whenever the home screen comes back into view, so it reflects what was just
  // done, and follows the outlet last chosen on any other screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
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
  const today = indiaToday();
  // Today's visits, and any earlier ones still open, are what the Supervisor has to do now.
  const dueVisits = visits?.filter((visit) => visit.date <= today) ?? [];
  const loading = (eccs ? visits : overview) === null && !error;

  return (
    <Screen onRefresh={load}>
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.greeting}>
          {t('home.greeting', { name: user.name })}
        </ThemedText>
        <ThemedText type="default" themeColor="primary">
          {roleAndPlace}
        </ThemedText>
      </View>

      <ErrorText message={error} onRetry={() => void load()} />
      {loading && <ActivityIndicator color={theme.primary} />}

      {eccs
        ? visits && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
                {t('home.todayVisits')}
              </ThemedText>
              {dueVisits.length === 0 && (
                <ThemedText type="default" themeColor="textSecondary">
                  {t('home.noVisitsToday')}
                </ThemedText>
              )}
              {dueVisits.map((visit) => (
                <VisitCard key={visit.id} visit={visit} showOutlet />
              ))}
            </>
          )
        : outlet && (
            <>
              {overview && overview.length > 1 && (
                <View style={styles.outlets} accessibilityLabel={t('checklists.chooseOutlet')}>
                  {overview.map((entry) => (
                    <OptionChip
                      key={entry.outletId}
                      label={entry.outletName}
                      selected={entry.outletId === outlet.outletId}
                      onPress={() => {
                        setChosenOutlet(entry.outletId);
                        void rememberOutlet(entry.outletId);
                      }}
                    />
                  ))}
                </View>
              )}

              <OutletOverview outlet={outlet} />
              {outlet.visits && (
                <>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
                    {t('dash.visits')}
                  </ThemedText>
                  {outlet.visits.length === 0 && (
                    <ThemedText type="default" themeColor="textSecondary">
                      {t('dash.noVisits')}
                    </ThemedText>
                  )}
                  {outlet.visits.map((visit) => (
                    <VisitCard key={visit.id} visit={visit} />
                  ))}
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('dash.scoreSoon')}
                  </ThemedText>
                </>
              )}
            </>
          )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one, paddingTop: Spacing.two },
  greeting: { fontSize: 24, lineHeight: 30 },
  sectionGap: { marginTop: Spacing.three },
  outlets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
