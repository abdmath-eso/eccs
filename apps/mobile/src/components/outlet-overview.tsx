import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey } from '@eccs/i18n';
import { localize, type DashboardLicenceDto, type OutletDashboardDto } from '@eccs/shared';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { rememberOutlet } from '@/lib/use-outlet';

// The dashboard lists at most this many licences; the rest are on the licences screen.
const MAX_LICENCES = 3;

/**
 * How today is going at one outlet: three numbers to take in at a glance
 * (for the Owner and Manager), today's checklists, and any licences that
 * need renewing. Everything opens the screen where it can be dealt with.
 */
export function OutletOverview({ outlet }: { outlet: OutletDashboardDto }) {
  const theme = useTheme();
  const { t, language } = useSession();

  const total = outlet.checklists.length;
  const submitted = outlet.checklists.filter((checklist) => checklist.status === 'SUBMITTED').length;
  const late = outlet.checklists.some((checklist) => checklist.isOverdue);
  const licences = outlet.licences;
  const unresolved = outlet.issues ? outlet.issues.open + outlet.issues.inProgress : 0;

  // Those screens work on one outlet at a time and remember which, so an Owner lands on this one.
  const go = (href: Href) => void rememberOutlet(outlet.outletId).then(() => router.push(href));

  const countdown = (licence: DashboardLicenceDto) =>
    licence.daysLeft < 0
      ? t('docs.expiredAgo', { count: -licence.daysLeft })
      : licence.daysLeft === 0
        ? t('docs.expiresToday')
        : t('docs.daysLeft', { count: licence.daysLeft });

  const stat = (value: string, label: MessageKey, color: string, href: Href) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t(label)}: ${value}`}
      onPress={() => go(href)}
      style={({ pressed }) => [
        styles.stat,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <ThemedText type="subtitle" style={[styles.statValue, { color }]}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t(label)}
      </ThemedText>
    </Pressable>
  );

  return (
    <View style={styles.outlet}>
      {licences && (
        <View style={styles.stats}>
          {stat(
            `${submitted}/${total}`,
            'dash.checklistsDone',
            late ? theme.danger : total > 0 && submitted === total ? theme.primary : theme.text,
            '/checklists',
          )}
          {stat(
            String(licences.length),
            'dash.licencesToRenew',
            licences.some((licence) => licence.state === 'EXPIRED')
              ? theme.danger
              : licences.length > 0
                ? theme.warning
                : theme.primary,
            '/documents',
          )}
          {stat(String(unresolved), 'dash.openIssues', unresolved > 0 ? theme.warning : theme.primary, '/support')}
        </View>
      )}

      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('dash.todayChecklists')}
      </ThemedText>
      {total === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('checklists.empty')}
        </ThemedText>
      )}
      {outlet.checklists.map((checklist) => (
        <Pressable
          key={checklist.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/checklists/[runId]', params: { runId: checklist.id } })}
          style={({ pressed }) => [
            styles.row,
            { borderColor: checklist.isOverdue ? theme.danger : theme.border },
            pressed && { backgroundColor: theme.backgroundElement },
          ]}>
          <View style={styles.rowText}>
            <ThemedText type="default" style={styles.rowTitle}>
              {localize(checklist.title, language)}
            </ThemedText>
            <ThemedText type="small" themeColor={checklist.isOverdue ? 'danger' : 'textSecondary'}>
              {t('checklists.progress', { done: checklist.doneCount, total: checklist.itemCount })}
              {checklist.dueTime && checklist.status !== 'SUBMITTED'
                ? ` · ${t('checklists.due', { time: formatTime(checklist.dueTime, language) })}`
                : ''}
              {checklist.isOverdue ? ` · ${t('checklists.overdue')}` : ''}
            </ThemedText>
            {checklist.problemCount > 0 && (
              <ThemedText type="small" themeColor="danger">
                {t('checklists.hasProblems', { count: checklist.problemCount })}
              </ThemedText>
            )}
          </View>
          {checklist.isOverdue ? (
            <Ionicons name="time" size={26} color={theme.danger} accessibilityLabel={t('checklists.overdue')} />
          ) : (
            <StatusBadge status={checklist.status} reviewed={checklist.reviewed} />
          )}
        </Pressable>
      ))}

      {licences && licences.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('dash.licencesAttention')}
          </ThemedText>
          {licences.slice(0, MAX_LICENCES).map((licence) => {
            const color = licence.state === 'EXPIRED' ? theme.danger : theme.warning;
            return (
              <Pressable
                key={licence.id}
                accessibilityRole="button"
                onPress={() => go('/documents')}
                style={({ pressed }) => [
                  styles.row,
                  { borderColor: color },
                  pressed && { backgroundColor: theme.backgroundElement },
                ]}>
                <View style={styles.rowText}>
                  <ThemedText type="default" style={styles.rowTitle}>
                    {licence.name ?? t(`licenceType.${licence.type}`)}
                  </ThemedText>
                  <ThemedText type="smallBold" style={{ color }}>
                    {t(`docs.state${licence.state}`)} · {countdown(licence)}
                  </ThemedText>
                </View>
                <Ionicons name={licence.state === 'EXPIRED' ? 'alert-circle' : 'time'} size={26} color={color} />
              </Pressable>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outlet: { gap: Spacing.two },
  stats: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  stat: {
    flex: 1,
    minHeight: MinTouchSize * 1.5,
    borderRadius: Spacing.three,
    padding: Spacing.two + Spacing.one,
    justifyContent: 'center',
    gap: Spacing.half,
  },
  statValue: { fontSize: 26, lineHeight: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1.5,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: MinTouchSize,
  },
  rowText: { flex: 1, gap: Spacing.half },
  rowTitle: { fontWeight: 700 },
  sectionGap: { marginTop: Spacing.two },
});
