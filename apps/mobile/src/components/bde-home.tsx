import type { DoTodayItemDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { SavedCopyNote } from '@/components/field-sync-parts';
import { TodoRow, WeekRow } from '@/components/lead-parts';
import { NotificationBell } from '@/components/notification-bell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fieldSummary } from '@/lib/offline/field-ops';
import { outbox, useOutbox } from '@/lib/offline/outbox';
import { callLead } from '@/lib/sales';
import { useSession } from '@/lib/session';
import { useBdeDay } from '@/lib/use-leads';

/**
 * A BDE's Home (B2, 16 Oct 2026): a big Log a lead, then Do today (their own to-dos,
 * overdue first, each with its reason in a line and its one action), then this week
 * against target in one row. Nothing else.
 *
 * PATTERN FOLLOWED: Pipedrive's mobile Focus view, where the app opens on the day's most
 * pressing items, overdue counted first, then today's, with an add button at the top
 * (support.pipedrive.com, "Focus view in the mobile app"); LeadSquared's field-sales app,
 * with the day's tasks and quick lead capture on the phone (help.leadsquared.com).
 */
export function BdeHome() {
  const theme = useTheme();
  const { t, user } = useSession();
  const box = useOutbox();
  const { saved, error, load } = useBdeDay();
  const day = saved?.data ?? null;
  const hasSignal = box.online !== false;

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!user) return null;
  const membership = user.memberships[0];

  const openLead = (leadId: string, panel?: string) =>
    router.push({ pathname: '/sales/[leadId]', params: { leadId, ...(panel && { do: panel }) } });
  async function act(item: DoTodayItemDto, action: DoTodayItemDto['action']) {
    if (action === 'CALL') return callLead({ id: item.leadId, contactPhone: item.contactPhone, isSample: item.isSample });
    if (action === 'PARK_AGAIN') return openLead(item.leadId, 'park');
    if (action === 'SEND_QUOTE' || action === 'SEND_PLAN') {
      return router.push({ pathname: '/sales/quote', params: { leadId: item.leadId, ...(action === 'SEND_PLAN' && { plan: '1' }) } });
    }
    openLead(item.leadId);
  }

  // A to-do the BDE has acted on here since the list came: shown done, waiting to be sent.
  const loadedAt = saved?.at ?? 0;
  const actedOn = (leadId: string) =>
    box.ops.some((op) => 'subject' in op && op.subject === 'lead' && op.subjectId === leadId && op.kind !== 'leadPhoto' && Date.parse(op.createdAt) >= loadedAt - 1000);

  return (
    <Screen
      onRefresh={async () => {
        outbox.kick();
        await load();
      }}>
      <View style={styles.top}>
        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.greeting}>
            {t('home.greeting', { name: user.name })}
          </ThemedText>
          <ThemedText type="default" themeColor="primary">
            {membership ? t(`role.${membership.role}`) : ''}
          </ThemedText>
        </View>
        <NotificationBell />
      </View>

      <Button icon="camera" label={t('bde.logLead')} hint={t('bde.logLeadHint')} onPress={() => router.push('/sales/new')} />

      <ErrorText message={error} onRetry={() => void load()} />
      {!hasSignal && saved && <SavedCopyNote at={saved.at} />}
      {!day && !error && <ActivityIndicator color={theme.primary} />}

      {day && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {day.items.length > 0 ? t('bde.doToday.count', { count: day.items.length }) : t('bde.doToday')}
          </ThemedText>
          {day.items.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('bde.doToday.none')}
            </ThemedText>
          )}
          {day.items.map((item) => {
            const done = actedOn(item.leadId);
            return (
              <TodoRow
                key={item.leadId}
                item={item}
                done={done}
                sending={hasSignal && fieldSummary(box.ops, 'lead', item.leadId).unsent > 0}
                onOpen={() => openLead(item.leadId)}
                onAction={(action) => void act(item, action)}
              />
            );
          })}

          {day.week && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
                {t('bde.week.title')}
              </ThemedText>
              <WeekRow week={day.week} />
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  header: { flex: 1, gap: Spacing.one, paddingTop: Spacing.two },
  greeting: { fontSize: 24, lineHeight: 30 },
  sectionGap: { marginTop: Spacing.two },
});
