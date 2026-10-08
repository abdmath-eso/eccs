import Ionicons from '@expo/vector-icons/Ionicons';
import type { DuesDto } from '@eccs/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
import { useDirection } from '@/lib/direction';
import { useSession } from '@/lib/session';
import { rememberOutlet } from '@/lib/use-outlet';

/**
 * One line on Home for the Owner and the Manager when the outlet has
 * something to pay: how much, and whether any of it is overdue. Tapping it
 * opens Invoices. Nothing at all is shown when nothing is due, to the Head
 * Chef, or if the amount could not be fetched (Invoices itself says why).
 * `stamp` changes whenever Home reloads, so the amount is fetched again with it.
 */
export function DuesLine({ outletId, stamp }: { outletId: string; stamp: number }) {
  const theme = useTheme();
  const { t, api, language, user } = useSession();
  const { forwardIcon } = useDirection();
  const [loaded, setLoaded] = useState<{ outletId: string; dues: DuesDto } | null>(null);

  const role = user?.memberships[0]?.role;
  const reads = role === 'OWNER' || role === 'MANAGER';

  useEffect(() => {
    if (!reads) return;
    let cancelled = false;
    api.billing
      .dues({ outletId })
      .then((dues) => {
        if (!cancelled) setLoaded({ outletId, dues });
      })
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, outletId, stamp, reads]);

  // After the Owner picks another outlet, the last outlet's amount must not be shown as this one's.
  const dues = reads && loaded?.outletId === outletId ? loaded.dues : null;
  if (!dues || dues.duePaise <= 0) return null;

  const overdue = dues.overdueCount > 0;
  const color = overdue ? theme.danger : theme.text;
  const title = t('bill.homeDue', { amount: formatMoney(dues.duePaise, language) });
  const detail = overdue ? t('bill.homeOverdue', { count: dues.oldestOverdueDays }) : t('bill.homeOpen');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      // Invoices works on one outlet at a time and remembers which, so an Owner lands on this one.
      onPress={() => void rememberOutlet(outletId).then(() => router.push('/invoices'))}
      style={({ pressed }) => [
        styles.line,
        { borderColor: overdue ? theme.danger : theme.border, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
      ]}>
      <Ionicons name={overdue ? 'alert-circle' : 'receipt-outline'} size={26} color={overdue ? theme.danger : theme.primary} />
      <View style={styles.words}>
        <ThemedText type="default" style={[styles.title, { color }]}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
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
