import Ionicons from '@expo/vector-icons/Ionicons';
import type { FoodLabelCountsDto } from '@eccs/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { useSession } from '@/lib/session';
import { rememberOutlet } from '@/lib/use-outlet';

/**
 * One line on Home for the Owner, the Manager and the Head Chef: how many
 * labelled tubs must be used today and how many are past their use-by.
 * Tapping it opens the list. It is there even when both are zero, as the
 * quick way into Food labels. Nothing is shown if the numbers could not be
 * fetched. `stamp` changes whenever Home reloads, so they are fetched again.
 */
export function LabelsLine({ outletId, stamp }: { outletId: string; stamp: number }) {
  const theme = useTheme();
  const { t, api } = useSession();
  const { forwardIcon } = useDirection();
  const [counts, setCounts] = useState<FoodLabelCountsDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.foodLabels
      .counts(outletId)
      .then((loaded) => {
        if (!cancelled) setCounts(loaded);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, outletId, stamp]);

  // After the Owner picks another outlet, the last outlet's numbers must not be shown as this one's.
  if (!counts || counts.outletId !== outletId) return null;

  const expired = counts.expired > 0;
  const quiet = counts.expired === 0 && counts.today === 0;
  const color = expired ? theme.danger : counts.today > 0 ? theme.warning : theme.primary;
  const title = quiet ? t('tile.labels') : t('labels.home.today', { count: counts.today });
  const detail = expired ? t('labels.home.expired', { count: counts.expired }) : t(quiet ? 'labels.home.quiet' : 'labels.home.open');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      // The labels screen works on one outlet at a time and remembers which, so an Owner lands on this one.
      onPress={() => void rememberOutlet(outletId).then(() => router.push('/labels'))}
      style={({ pressed }) => [
        styles.line,
        { borderColor: quiet ? theme.border : color, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
      ]}>
      <Ionicons name={expired ? 'alert-circle' : quiet ? 'pricetag-outline' : 'time'} size={26} color={color} />
      <View style={styles.words}>
        <ThemedText type="default" style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText type="small" style={expired ? { color: theme.danger, fontWeight: 700 } : { color: theme.textSecondary }}>
          {detail}
        </ThemedText>
      </View>
      <Ionicons name={forwardIcon} size={22} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  words: { flex: 1 },
  title: { fontWeight: 700 },
});
