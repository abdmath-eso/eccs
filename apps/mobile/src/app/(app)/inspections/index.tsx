import { isEccsRole, type InspectionSummaryDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { InspectionCard } from '@/components/inspection-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/**
 * Inspections. For ECCS staff: the inspections to carry out (a Supervisor sees
 * their own), set out by what needs doing first. For a restaurant's Owner or
 * Manager: the approved inspection reports of their outlet.
 */
export default function InspectionsScreen() {
  const theme = useTheme();
  const { t, api, user } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const role = user?.memberships[0]?.role;
  const eccs = role !== undefined && isEccsRole(role);

  const [inspections, setInspections] = useState<InspectionSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ECCS staff see every outlet they work at; a restaurant looks at one outlet at a time.
  const forOutlet = eccs ? undefined : (outletId ?? undefined);
  const ready = eccs || outletId !== null;

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      setInspections(await api.inspections.list(forOutlet ? { outletId: forOutlet } : {}));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, forOutlet, ready]);

  // Reloads on coming back, so a finished inspection moves to its new place.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const all = inspections ?? [];
  const oldestFirst = (list: InspectionSummaryDto[]) => [...list].sort((a, b) => a.date.localeCompare(b.date));
  // What is half done comes first, then what is planned (soonest first), then what is waiting or final.
  const underWay = all.filter((inspection) => inspection.status === 'IN_PROGRESS');
  const toDo = oldestFirst(all.filter((inspection) => inspection.status === 'PLANNED'));
  const withEccs = all.filter((inspection) => inspection.status === 'SUBMITTED');
  const approved = all.filter((inspection) => inspection.status === 'APPROVED');

  const group = (title: string, list: InspectionSummaryDto[]) =>
    list.length > 0 && (
      <>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
          {title}
        </ThemedText>
        {list.map((inspection) => (
          <InspectionCard key={inspection.id} inspection={inspection} showOutlet={eccs} />
        ))}
      </>
    );

  return (
    <Screen
      back
      title={t('insp.title')}
      subtitle={t(eccs ? (role === 'SUPERVISOR' ? 'insp.helpSupervisor' : 'insp.helpAdmin') : 'insp.helpRestaurant')}
      onRefresh={load}>
      {!eccs && outlets.length > 1 && (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => {
                if (outlet.id === outletId) return;
                setInspections(null);
                choose(outlet.id);
              }}
            />
          ))}
        </View>
      )}

      {eccs && <Button icon="add" label={t('insp.start')} onPress={() => router.push('/inspections/start')} />}

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (inspections === null && !error)) && <ActivityIndicator color={theme.primary} />}

      {inspections !== null && all.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t(eccs ? 'insp.none' : 'insp.noReports')}
        </ThemedText>
      )}

      {eccs ? (
        <>
          {group(t('insp.underWay'), underWay)}
          {group(t('insp.toDo'), toDo)}
          {group(t('insp.withEccs'), withEccs)}
          {group(t('insp.approved'), approved)}
        </>
      ) : (
        // A restaurant is only ever sent approved reports, newest first.
        all.map((inspection) => <InspectionCard key={inspection.id} inspection={inspection} />)
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sectionGap: { marginTop: Spacing.four },
});
