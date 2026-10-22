import type { InspectionOutletDto } from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/**
 * Starts an inspection for today: choose the outlet and go. Giving an
 * inspection to someone else, or planning one for another day, is done by
 * ECCS in the console.
 *
 * PATTERN FOLLOWED: a list of radio buttons for one choice out of several (Material 3's radio
 * button in a list; GOV.UK Design System's radios): each outlet a full-width row with an empty or
 * filled circle, its name and the brand on a second line, as the pay-day settings choose a divisor.
 * Chips squeezed two-line outlet names into small boxes with no empty circle to say they were choices.
 */
export default function StartInspectionScreen() {
  const theme = useTheme();
  const { t, api } = useSession();

  const [outlets, setOutlets] = useState<InspectionOutletDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.inspections.outlets();
      setOutlets(list);
      // With only one outlet there is nothing to choose.
      if (list.length === 1) setOutletId(list[0]!.id);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function start() {
    if (busy) return;
    if (!outletId) {
      setMissing(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const inspection = await api.inspections.start({ outletId });
      // Back from the inspection should return to the list, not to this form.
      router.replace({ pathname: '/inspections/[inspectionId]', params: { inspectionId: inspection.id } });
    } catch (e) {
      setError(errorMessage(e, t));
      setBusy(false);
    }
  }

  const footer = outlets !== null && outlets.length > 0 && (
    <>
      <ErrorText message={error ?? (missing && !outletId ? t('insp.needOutlet') : null)} />
      <Button label={t('insp.startNow')} loading={busy} onPress={() => void start()} />
    </>
  );

  return (
    <Screen back title={t('insp.start')} subtitle={t('insp.startHelp')} onRefresh={load} footer={footer || undefined}>
      <ErrorText message={loadError} onRetry={() => void load()} />
      {outlets === null && !loadError && <ActivityIndicator color={theme.primary} />}
      {outlets !== null && outlets.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('insp.noOutlets')}
        </ThemedText>
      )}
      {/* The line under the title asks the question, so the list carries no label of its own on screen. */}
      {outlets !== null && outlets.length > 0 && (
        <View accessibilityRole="radiogroup" accessibilityLabel={t('insp.chooseOutlet')}>
          {outlets.map((outlet, index) => {
            const selected = outlet.id === outletId;
            return (
              <Pressable
                key={outlet.id}
                accessibilityRole="radio"
                accessibilityState={{ selected, checked: selected }}
                onPress={() => setOutletId(outlet.id)}
                style={({ pressed }) => [
                  styles.option,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
                  pressed && { backgroundColor: theme.backgroundElement },
                ]}>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={26}
                  color={selected ? theme.primary : theme.textSecondary}
                  style={styles.radio}
                />
                <View style={styles.optionText}>
                  <ThemedText type="default" style={selected && styles.bold}>
                    {outlet.name}
                  </ThemedText>
                  {outlet.organizationName !== outlet.name && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {outlet.organizationName}
                    </ThemedText>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A plain row, tall enough for a thumb, with the radio beside the outlet's name, its first line.
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    minHeight: MinTouchSize + Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  radio: { marginTop: -1 },
  optionText: { flex: 1, gap: Spacing.half },
  bold: { fontWeight: 700 },
});
