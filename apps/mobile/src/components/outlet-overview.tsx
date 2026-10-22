import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey } from '@eccs/i18n';
import { localize, type DashboardLicenceDto, type OutletDashboardDto } from '@eccs/shared';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { tallScript, ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
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

  // "1 day left", never "1 days left": a count of one has words of its own.
  const countdown = (licence: DashboardLicenceDto) =>
    licence.daysLeft < 0
      ? licence.daysLeft === -1
        ? t('docs.dayOverdueOne')
        : t('docs.expiredAgo', { count: -licence.daysLeft })
      : licence.daysLeft === 0
        ? t('docs.expiresToday')
        : licence.daysLeft === 1
          ? t('docs.dayLeftOne')
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
      <ThemedText type="small" themeColor="textSecondary" style={[styles.statLabel, tallScript(language) && styles.statLabelTall]}>
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
        // The same card as on the Checklists tab: the title, its state under it (so a long word in another
        // language never squeezes the title), the progress line, and the arrow that says it opens.
        <Card
          key={checklist.id}
          variant="filled"
          chevron
          onPress={() => router.push({ pathname: '/checklists/[runId]', params: { runId: checklist.id } })}>
          <ThemedText type="default" style={styles.rowTitle}>
            {localize(checklist.title, language)}
          </ThemedText>
          <StatusBadge status={checklist.status} reviewed={checklist.reviewed} overdue={checklist.isOverdue} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('checklists.progress', { done: checklist.doneCount, total: checklist.itemCount })}
            {checklist.dueTime && checklist.status !== 'SUBMITTED'
              ? ` · ${t('checklists.due', { time: formatTime(checklist.dueTime, language) })}`
              : ''}
          </ThemedText>
          {checklist.problemCount > 0 && (
            <ThemedText type="small" themeColor="danger">
              {t('checklists.hasProblems', { count: checklist.problemCount })}
            </ThemedText>
          )}
        </Card>
      ))}

      {licences && licences.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('dash.licencesAttention')}
          </ThemedText>
          {licences.slice(0, MAX_LICENCES).map((licence) => {
            const color = licence.state === 'EXPIRED' ? theme.danger : theme.warning;
            return (
              <Card key={licence.id} variant="filled" chevron onPress={() => go('/documents')}>
                <ThemedText type="default" style={styles.rowTitle}>
                  {licence.name ?? t(`licenceType.${licence.type}`)}
                </ThemedText>
                <View style={styles.state}>
                  <Ionicons
                    name={licence.state === 'EXPIRED' ? 'alert-circle' : 'hourglass-outline'}
                    size={18}
                    color={color}
                  />
                  <ThemedText type="smallBold" style={[styles.stateText, { color }]}>
                    {t(`docs.state${licence.state}`)} · {countdown(licence)}
                  </ThemedText>
                </View>
              </Card>
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
    // From the top, so the three numbers stay on one line however many lines each label takes.
    justifyContent: 'flex-start',
    gap: Spacing.half,
  },
  statValue: { fontSize: 26, lineHeight: 32 },
  // Smaller than other small text: in Tamil or Malayalam these labels run to three lines.
  statLabel: { fontSize: 12, lineHeight: 16 },
  // Indian scripts are taller: 13 with more room between lines, so stacked letters do not crowd.
  statLabelTall: { fontSize: 13, lineHeight: 19 },
  state: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  stateText: { flex: 1 },
  rowTitle: { fontWeight: 700 },
  sectionGap: { marginTop: Spacing.two },
});
