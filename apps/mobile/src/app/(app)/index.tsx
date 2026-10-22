import { type OutletDashboardDto, type VisitSummaryDto } from '@eccs/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { isEccsUser } from '@/components/app-nav';
import { BdeHome } from '@/components/bde-home';
import { BuddyButton } from '@/components/buddy-button';
import { BuddyHomeCard } from '@/components/buddy-parts';
import { DuesLine } from '@/components/dues-line';
import { NotificationBell } from '@/components/notification-bell';
import { OutletOverview } from '@/components/outlet-overview';
import { PinReveal } from '@/components/pin-reveal';
import { ScoreCard } from '@/components/score-parts';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { VisitCard, visitMissed } from '@/components/visit-card';
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
  // When the overview was last loaded: the score card reloads whenever this changes.
  const [loadedAt, setLoadedAt] = useState(0);

  const membership = user?.memberships[0];
  const eccs = isEccsUser(membership?.role);
  // A BDE (sales) loads their own day instead (components/bde-home.tsx).
  const loads = membership !== undefined && !newPin && membership.role !== 'BDE';

  const load = useCallback(async () => {
    if (!loads) return;
    try {
      if (eccs) {
        setVisits(await api.visits.list({ state: 'open' }));
      } else {
        const [outlets, remembered] = await Promise.all([api.dashboard.get(), recallOutlet()]);
        setOverview(outlets);
        setChosenOutlet(remembered);
        setLoadedAt(Date.now());
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

  // A BDE (sales, B2) has a Home of their own: their day's to-dos and Log a lead.
  if (membership.role === 'BDE') return <BdeHome />;

  const place =
    membership.outletName ?? membership.organizationName ?? (membership.role === 'OWNER' ? t('home.allOutlets') : null);
  const roleAndPlace = `${t(`role.${membership.role}`)}${place ? ` · ${place}` : ''}`;
  const outlet = overview?.find((entry) => entry.outletId === chosenOutlet) ?? overview?.[0];
  const today = indiaToday();
  // Today's visits first, then any earlier ones still open, under their own heading (22 Oct 2026:
  // they were one list, oldest first, and today's work sat four screens down).
  const todaysVisits = visits?.filter((visit) => visit.date === today) ?? [];
  const earlierVisits = visits?.filter((visit) => visit.date < today) ?? [];
  // A restaurant's visits the same way round: today's and coming ones first, then a booked visit
  // whose day passed without it starting, under "Earlier, not done yet" (22 Oct 2026: those came first).
  const missedVisits = outlet?.visits?.filter((visit) => visitMissed(visit, today)) ?? [];
  const comingVisits = outlet?.visits?.filter((visit) => !missedVisits.includes(visit)) ?? [];
  const loading = loads && (eccs ? visits : overview) === null && !error;

  return (
    <Screen onRefresh={load}>
      <View>
        <View style={styles.top}>
          {/* The first name only, on one line, as apps greet people ("Hello, Ravi"); the full name is on My profile. */}
          <ThemedText type="subtitle" numberOfLines={1} style={styles.greeting}>
            {t('home.greeting', { name: user.name.trim().split(/\s+/)[0] ?? user.name })}
          </ThemedText>
          {/* Top right, where people look for it. It fetches its own number each time Home comes into view. */}
          <View style={styles.topEnd}>
            {/* ECCS Buddy, for the Owner and the Manager only (it shows nothing for anyone else): the
                mascot alone beside the bell, as the greeting needs the width; the card below names it. */}
            <BuddyButton />
            <NotificationBell />
          </View>
        </View>
        {/* The role and place on a line of their own, the page's full width, so a long one ("యజమాని · Spice
            Route Kitchens") never wraps in the narrow column beside the two icons (22 Oct 2026). */}
        <ThemedText type="default" themeColor="textSecondary">
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
              {todaysVisits.length === 0 && (
                <ThemedText type="default" themeColor="textSecondary">
                  {t('home.noVisitsToday')}
                </ThemedText>
              )}
              {todaysVisits.map((visit) => (
                <VisitCard key={visit.id} visit={visit} showOutlet />
              ))}
              {earlierVisits.length > 0 && (
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
                  {t('svc.overdue')}
                </ThemedText>
              )}
              {earlierVisits.map((visit) => (
                <VisitCard key={visit.id} visit={visit} showOutlet />
              ))}
            </>
          )
        : outlet && (
            <>
              {overview && (
                <OutletPicker
                  outlets={overview.map((entry) => ({ id: entry.outletId, name: entry.outletName }))}
                  outletId={outlet.outletId}
                  onChoose={(outletId) => {
                    setChosenOutlet(outletId);
                    void rememberOutlet(outletId);
                  }}
                />
              )}

              {/* The hygiene score for this outlet; it is fetched again each time Home reloads. */}
              <ScoreCard outletId={outlet.outletId} stamp={loadedAt} />
              {/* For the Owner and Manager, and only when something is due: how much, leading to Invoices. */}
              <DuesLine outletId={outlet.outletId} stamp={loadedAt} />
              <OutletOverview outlet={outlet} />
              {/* ECCS Buddy's card, after the day's main part (the founder: main part first). Owner and Manager only. */}
              <BuddyHomeCard />
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
                  {comingVisits.map((visit) => (
                    <VisitCard key={visit.id} visit={visit} />
                  ))}
                  {/* A heading of their own only below others: alone, they sit under "ECCS visits" with their "Not done" label. */}
                  {missedVisits.length > 0 && comingVisits.length > 0 && (
                    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
                      {t('svc.overdue')}
                    </ThemedText>
                  )}
                  {missedVisits.map((visit) => (
                    <VisitCard key={visit.id} visit={visit} />
                  ))}
                </>
              )}
            </>
          )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The greeting beside the two icons, centred on them; the role and place go under the row.
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  greeting: { flex: 1, fontSize: 24, lineHeight: 30 },
  // The bell draws its picture 12 in from its 52 box: pulled out by that much so the picture lines up
  // with the cards' right edge.
  topEnd: { flexDirection: 'row', alignItems: 'center', marginEnd: -(Spacing.two + Spacing.one) },
  sectionGap: { marginTop: Spacing.three },
});
